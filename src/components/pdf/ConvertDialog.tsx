import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookText, Check, ExternalLink, KeyRound, Laptop, Pause, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import { checkGroqKey, getGroqConfig, GROQ_DEFAULT_MODEL, groqPagesPerDay, setGroqConfig } from '../../lib/convert/groq';
import { groqPagesLeft, isActive, pagesDone, pagesToDo, pauseConversion, resumeConversion, startConversion, type ConvertJob, type ConvertMode } from '../../lib/convert/job';
import { isTauri, openExternal } from '../../lib/desktop';

const PAGES_PER_MIN = 3; // Groq's free plan: 8,000 tokens (7,000 input) a minute, about 2,500 a page

function duration(min: number) {
  if (min < 1.5) return 'about a minute';
  if (min < 55) return `about ${Math.round(min)} minutes`;
  const h = min / 60;
  return h < 1.25 ? 'about an hour' : `about ${Math.round(h * 2) / 2} hours`;
}

/** Time for Groq to read `pages` pages: fast until the free plan's daily budget runs out, then a day's worth a day. */
function groqTime(pages: number) {
  const perDay = groqPagesPerDay();
  if (pages <= perDay) return duration(pages / PAGES_PER_MIN);
  const days = pages / perDay;
  return days < 1.6 ? 'about a day and a half' : `about ${Math.ceil(days)} days`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function ConvertDialog({
  pdfId,
  pages,
  job,
  onOpenEdition,
  onClose,
}: {
  pdfId: string;
  pages: number;
  job: ConvertJob | null;
  onOpenEdition: (id: string) => void;
  onClose: () => void;
}) {
  const cfg = getGroqConfig();
  const [mode, setMode] = useState<ConvertMode>('groq');
  const [key, setKey] = useState(cfg.key);
  const [model, setModel] = useState(cfg.model);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState(() => !job || job.status === 'error');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const start = async () => {
    setError(null);
    if (mode === 'groq') {
      if (!key.trim()) return setError('Paste your Groq API key first.');
      setChecking(true);
      try {
        const models = await checkGroqKey(key.trim());
        if (models.length && !models.includes(model.trim())) {
          setChecking(false);
          return setError(`Groq doesn’t list the model “${model.trim()}” any more. Pick another under Model.`);
        }
      } catch (e) {
        setChecking(false);
        return setError(e instanceof Error ? e.message : 'Couldn’t reach Groq.');
      }
      setChecking(false);
      setGroqConfig({ key: key.trim(), model: model.trim() || GROQ_DEFAULT_MODEL });
    }
    setSetup(false);
    await startConversion(pdfId, mode);
  };

  const showSetup = setup || !job;
  // references and other back matter come from the PDF's own text, so roughly 85% of a book goes to Groq
  const groqPages = Math.round(pages > 120 ? pages * 0.85 : pages);
  const body = showSetup ? (
    <>
      <div className="cv-options" role="radiogroup">
        <button className={'cv-option' + (mode === 'groq' ? ' on' : '')} role="radio" aria-checked={mode === 'groq'} onClick={() => setMode('groq')}>
          <span className="cv-option-icon"><Sparkles size={18} /></span>
          <span className="cv-option-text">
            <span className="cv-option-title">Precise <span className="cv-tag">Groq · free</span></span>
            <span className="cv-option-desc">
              An AI model on Groq reads every page image, so note numbers, italics and headings come out right.{' '}
              {groqPages > groqPagesPerDay()
                ? `Groq’s free plan reads about ${groqPagesPerDay()} pages a day, so this book takes ${groqTime(groqPages)}: Folio works through it whenever it’s open and picks up where it left off.`
                : `${groqTime(groqPages)} for ${pages} pages on the free plan. Keep reading meanwhile; if you close Folio it carries on next time.`}
            </span>
          </span>
          {mode === 'groq' && <Check size={17} className="cv-check" />}
        </button>
        <button className={'cv-option' + (mode === 'local' ? ' on' : '')} role="radio" aria-checked={mode === 'local'} onClick={() => setMode('local')}>
          <span className="cv-option-icon"><Laptop size={18} /></span>
          <span className="cv-option-text">
            <span className="cv-option-title">Quick <span className="cv-tag">on this device</span></span>
            <span className="cv-option-desc">Uses the text already inside the PDF. A minute or two, works offline. In scans the OCR often misses the tiny note numbers, so fewer notes get linked.</span>
          </span>
          {mode === 'local' && <Check size={17} className="cv-check" />}
        </button>
      </div>

      {mode === 'groq' && (
        <div className="cv-key">
          <label className="cv-label" htmlFor="cv-key">
            <KeyRound size={14} /> Groq API key
          </label>
          <input
            id="cv-key"
            className="cv-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="gsk_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="cv-hint">
            Kept on this device only, never in backups. Page images go to Groq to be read.{' '}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (isTauri) {
                  e.preventDefault();
                  openExternal('https://console.groq.com/keys');
                }
              }}
            >
              Get a free key <ExternalLink size={11} />
            </a>
          </div>
          <details className="cv-more">
            <summary>Model</summary>
            <input className="cv-input" spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} />
            <div className="cv-hint">Any Groq model that can read images. Default: {GROQ_DEFAULT_MODEL}</div>
          </details>
        </div>
      )}

      {error && <div className="cv-error">{error}</div>}

      <div className="cv-actions">
        {job && !isActive(job) && job.status !== 'error' && (
          <button className="btn btn-quiet" onClick={() => setSetup(false)}>
            Back
          </button>
        )}
        <button className="btn btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-accent" onClick={start} disabled={checking}>
          {checking ? 'Checking the key…' : job?.editionId ? 'Make it again' : 'Start'}
        </button>
      </div>
    </>
  ) : (
    <Progress job={job!} onOpenEdition={onOpenEdition} onRedo={() => setSetup(true)} onClose={onClose} />
  );

  return createPortal(
    <div className="cv-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="cv-dialog" role="dialog" aria-modal="true" aria-labelledby="cv-title">
        <div className="cv-head">
          <span className="cv-head-icon"><BookText size={19} /></span>
          <div>
            <div id="cv-title" className="cv-title">Reading edition</div>
            <div className="cv-sub">This PDF as clean, reflowable text: adjustable type, night mode, highlights, and note numbers that open their note.</div>
          </div>
          <button className="icon-btn sm" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {body}
      </div>
    </div>,
    document.body,
  );
}

function Progress({ job, onOpenEdition, onRedo, onClose }: { job: ConvertJob; onOpenEdition: (id: string) => void; onRedo: () => void; onClose: () => void }) {
  const active = isActive(job);
  const now = useNow(active);
  const done = pagesDone(job);
  const total = pagesToDo(job) || 1;
  const frac = job.status === 'done' ? 1 : Math.min(1, done / total);
  const groqLeft = groqPagesLeft(job);
  const wait = job.waitUntil ? Math.max(0, Math.ceil((job.waitUntil - now) / 1000)) : 0;

  let line: string;
  if (job.status === 'preparing') line = job.message ?? 'Getting ready…';
  else if (job.status === 'done') line = 'Ready to read.';
  else if (job.status === 'paused') line = `Paused at ${done} of ${total} pages.`;
  else if (job.status === 'error') line = job.message ?? 'Something went wrong.';
  else if (job.message) line = job.message;
  else if (job.status === 'waiting' && wait > 2) line = `Page ${done + 1} of ${total} · waiting ${wait}s for Groq’s free limit`;
  else line = `Page ${done + 1} of ${total}`;

  return (
    <>
      <div className="cv-progress">
        <div className="cv-bar">
          <div style={{ transform: `scaleX(${frac})` }} className={active ? 'live' : ''} />
        </div>
        <div className="cv-line">
          <span className={job.status === 'error' ? 'cv-error-text' : ''}>{line}</span>
          {active && job.status !== 'preparing' && groqLeft > 0 && <span className="cv-eta">{groqTime(groqLeft)} left</span>}
        </div>
        {job.status === 'done' && job.stats && (
          <div className="cv-stats">
            {job.stats.markers > 0
              ? `${job.stats.linked} of ${job.stats.markers} note markers linked to their notes.`
              : job.stats.notes > 0
                ? `${job.stats.notes} notes found, but no note markers in the text.`
                : 'No notes in this book.'}
            {!!job.fallbacks?.length && ` ${job.fallbacks.length} page${job.fallbacks.length > 1 ? 's' : ''} used the PDF’s own text.`}
          </div>
        )}
        {active && <div className="cv-hint">You can close this and keep reading. Folio needs to stay open; if you close it, the conversion carries on next time.</div>}
      </div>
      <div className="cv-actions">
        {active && (
          <button className="btn btn-quiet" onClick={() => pauseConversion(job.pdfId)}>
            <Pause size={14} /> Pause
          </button>
        )}
        {job.status === 'paused' && (
          <button className="btn btn-quiet" onClick={() => resumeConversion(job.pdfId)}>
            <Play size={14} /> Resume
          </button>
        )}
        {(job.status === 'done' || job.status === 'error' || job.status === 'paused') && (
          <button className="btn btn-quiet" onClick={onRedo}>
            <RefreshCw size={14} /> {job.status === 'error' ? 'Change settings' : 'Start over'}
          </button>
        )}
        {job.status === 'error' && (
          <button className="btn btn-quiet" onClick={() => resumeConversion(job.pdfId)}>
            Try again
          </button>
        )}
        {job.status === 'done' && job.editionId ? (
          <button className="btn btn-accent" onClick={() => onOpenEdition(job.editionId!)}>
            Open reading edition
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={onClose}>
            {active ? 'Keep reading' : 'Close'}
          </button>
        )}
      </div>
    </>
  );
}

/** A small ring for the toolbar button while a conversion runs. */
export function ProgressRing({ frac }: { frac: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="cv-ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} className="cv-ring-track" />
      <circle cx="11" cy="11" r={r} className="cv-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
    </svg>
  );
}
