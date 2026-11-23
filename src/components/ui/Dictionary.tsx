import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, Globe, X } from 'lucide-react';
import { cleanWord, lookup, wikipedia, type Entry, type Pos, type WikiSummary } from '../../lib/dictionary';
import { openExternal } from '../../lib/desktop';

/* A tiny store, so any reader (or the command palette) can open the dictionary card. */
type Req = { word: string; anchor: DOMRect | null; n: number };
let req: Req | null = null;
let seq = 0;
const listeners = new Set<(r: Req | null) => void>();
export function openDictionary(word: string, anchor: DOMRect | null = null) {
  req = { word: cleanWord(word), anchor, n: ++seq };
  listeners.forEach((l) => l(req));
}
const close = () => {
  req = null;
  listeners.forEach((l) => l(null));
};

export function DictionaryHost() {
  const [r, setR] = useState<Req | null>(req);
  useEffect(() => {
    listeners.add(setR);
    return () => void listeners.delete(setR);
  }, []);
  return r ? <DictionaryCard key={r.n} word={r.word} anchor={r.anchor} /> : null;
}

const POS_LABEL: Record<Pos, string> = { noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb' };
const SHOWN = 3;

function DictionaryCard({ word: first, anchor }: { word: string; anchor: DOMRect | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [trail, setTrail] = useState<string[]>([first]); // words looked up from this card, for "back"
  const word = trail[trail.length - 1];
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [wiki, setWiki] = useState<WikiSummary | 'loading' | 'none' | 'offline' | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const W = Math.min(400, window.innerWidth - 24);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let gone = false;
    setEntries(null);
    setWiki(null);
    setOpen({});
    lookup(word).then((e) => !gone && setEntries(e));
    return () => {
      gone = true;
    };
  }, [word]);

  // place it next to the word, below if there's room; settle once, so it doesn't jump while reading
  useLayoutEffect(() => {
    if (pos && entries === null) return;
    const h = ref.current?.offsetHeight ?? 240;
    const vh = window.innerHeight;
    if (!anchor) return setPos({ left: (window.innerWidth - W) / 2, top: Math.max(60, vh * 0.18) });
    const below = anchor.bottom + h + 20 < vh || anchor.top < h + 20;
    const left = Math.max(12, Math.min(window.innerWidth - W - 12, anchor.left + anchor.width / 2 - W / 2));
    const top = below ? Math.min(anchor.bottom + 12, vh - h - 12) : Math.max(12, anchor.top - h - 12);
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, W, entries === null]);

  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    // Escape closes the card, and only the card (not the book behind it)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const loadWiki = async () => {
    if (!navigator.onLine) return setWiki('offline');
    setWiki('loading');
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    try {
      setWiki((await wikipedia(word, c.signal)) ?? 'none');
    } catch {
      if (!c.signal.aborted) setWiki('offline');
    }
  };

  const go = (w: string) => setTrail((t) => [...t, w]);
  const notFound = entries !== null && entries.length === 0;

  return createPortal(
    <div ref={ref} className="ref-card dict-card pinned" role="dialog" aria-label={`Dictionary: ${word}`} style={{ width: W, left: pos?.left ?? -9999, top: pos?.top ?? 0 }}>
      <div className="dict-head">
        {trail.length > 1 && (
          <button className="icon-btn sm" aria-label="Back" data-tip="Back" onClick={() => setTrail((t) => t.slice(0, -1))}>
            <ArrowLeft size={15} />
          </button>
        )}
        <div className="dict-word">{word}</div>
        <button className="icon-btn sm" aria-label="Close" onClick={close}>
          <X size={15} />
        </button>
      </div>

      <div className="dict-body">
        {entries === null && <div className="dict-loading shimmer" />}
        {notFound && <p className="dict-empty">Not in the dictionary. Names, places and very new words usually aren’t.</p>}
        {entries?.map((e) => {
          const groups = new Map<Pos, Entry['senses']>();
          e.senses.forEach((s) => groups.set(s.pos, [...(groups.get(s.pos) ?? []), s]));
          return (
            <div key={e.word} className="dict-entry">
              {(entries.length > 1 || e.word !== word.toLowerCase()) && (
                <div className="dict-lemma">
                  {e.word !== word.toLowerCase() ? <>from <b>{e.word}</b></> : <b>{e.word}</b>}
                </div>
              )}
              {[...groups].map(([p, senses]) => {
                const k = e.word + p;
                const all = open[k];
                return (
                  <section key={p} className="dict-pos">
                    <div className="dict-pos-label">{POS_LABEL[p]}</div>
                    <ol>
                      {(all ? senses : senses.slice(0, SHOWN)).map((s, i) => (
                        <li key={i}>
                          <span className="dict-def">{s.def}</span>
                          {s.examples[0] && <span className="dict-ex">“{s.examples[0]}”</span>}
                          {s.synonyms.length > 0 && (
                            <span className="dict-syn">
                              {s.synonyms.slice(0, 5).map((w) => (
                                <button key={w} onClick={() => go(w)}>{w}</button>
                              ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                    {senses.length > SHOWN && (
                      <button className="dict-more" onClick={() => setOpen((o) => ({ ...o, [k]: !all }))}>
                        {all ? 'Fewer meanings' : `${senses.length - SHOWN} more meaning${senses.length - SHOWN === 1 ? '' : 's'}`}
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          );
        })}

        {wiki && wiki !== 'loading' && (
          <div className="dict-wiki">
            {wiki === 'none' && <p>Wikipedia has no article called “{word}”.</p>}
            {wiki === 'offline' && <p>Wikipedia needs an internet connection.</p>}
            {typeof wiki === 'object' && (
              <>
                <div className="dict-wiki-title">{wiki.title}</div>
                <p>{wiki.extract}</p>
                {wiki.url && (
                  <button className="dict-more" onClick={() => openExternal(wiki.url)}>
                    Read on Wikipedia <ArrowUpRight size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {entries !== null && (wiki === null || wiki === 'loading') && (
        <div className="dict-foot">
          <button className={'btn btn-quiet dict-wiki-btn' + (wiki === 'loading' ? ' busy' : '')} onClick={loadWiki} disabled={wiki === 'loading'}>
            <Globe size={14} /> {wiki === 'loading' ? 'Looking it up…' : notFound ? 'Look it up on Wikipedia' : 'Wikipedia'}
          </button>
          <span className="dict-src">WordNet · offline</span>
        </div>
      )}
    </div>,
    document.body,
  );
}
