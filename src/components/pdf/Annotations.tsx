import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FileDown, FilePlus, Highlighter, MessageSquare, Trash, X } from 'lucide-react';
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor } from '../../lib/types';
import { timeAgo } from '../ui/ui';

/* --------------------------- Selection toolbar --------------------------- */
export function SelectionToolbar({
  rect,
  onColor,
  onNote,
  onCopy,
  lastColor,
  below = false,
}: {
  /** Touch: Android's own Copy / Share menu sits above a selection, so ours goes underneath. */
  below?: boolean;
  rect: DOMRect;
  onColor: (c: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  lastColor: HighlightColor;
}) {
  const above = below ? rect.bottom > window.innerHeight - 110 : rect.top > 90;
  const left = Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170);
  const top = above ? rect.top - 10 : rect.bottom + (below ? 30 : 10); // room for the selection handles
  return (
    <div
      className={'sel-toolbar' + (above ? '' : ' below')}
      style={{ left, top }}
      onPointerDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.id}
          className={`swatch hl-${c.id}${c.id === lastColor ? ' last' : ''}`}
          aria-label={'Highlight ' + c.label}
          onClick={() => onColor(c.id)}
        />
      ))}
      <span className="divider-v" />
      <button className="sel-btn" onClick={onNote}>
        <MessageSquare size={15} /> Note
      </button>
      <button className="sel-btn icon" onClick={onCopy} aria-label="Copy">
        <Copy size={15} />
      </button>
    </div>
  );
}

/* --------------------------- Highlight popover --------------------------- */
export function HighlightPopover({
  hl,
  label,
  x,
  y,
  autoFocus,
  onChange,
  onDelete,
  onClose,
}: {
  hl: Annotation;
  label?: string;
  x: number;
  y: number;
  autoFocus: boolean;
  onChange: (patch: Partial<Annotation>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x - r.width / 2;
    let top = y + 14;
    left = Math.max(12, Math.min(left, window.innerWidth - r.width - 12));
    if (top + r.height > window.innerHeight - 12) top = y - r.height - 14;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.style.height = '0';
    t.style.height = Math.min(t.scrollHeight, 220) + 'px';
  }, [hl.note]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="hl-popover" style={pos}>
      <div className="hl-pop-head">
        <div className="hl-pop-swatches">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.id}
              className={`swatch sm hl-${c.id}${hl.color === c.id ? ' on' : ''}`}
              aria-label={c.label}
              onClick={() => onChange({ color: c.id })}
            />
          ))}
        </div>
        <button className="icon-btn sm" aria-label="Delete highlight" data-tip="Delete" onClick={onDelete}>
          <Trash size={14} />
        </button>
        <button className="icon-btn sm" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <blockquote className={`hl-pop-quote q-${hl.color}`}>{hl.text}</blockquote>
      <textarea
        ref={ta}
        className="hl-pop-note"
        placeholder="Add a note…"
        value={hl.note}
        onChange={(e) => onChange({ note: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onClose();
        }}
      />
      <div className="hl-pop-foot">
        {label ?? (hl.page ? `Page ${hl.page}` : '')} · {timeAgo(hl.createdAt)}
        <span className="kbd-hint">
          <span className="kbd">Ctrl</span>
          <span className="kbd">↵</span> done
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ Notes panel ------------------------------ */
export function NotesPanel<T extends Annotation>({
  highlights,
  onJump,
  onChange,
  onDelete,
  onExport,
  onExportNote,
  onExportPdf,
  activeId,
  sortKey,
  label,
  isDetached,
  emptyHint = 'Select text on any page and pick a colour. Add notes to remember why it mattered.',
}: {
  highlights: T[];
  onJump: (h: T) => void;
  onChange: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onExportNote: () => void;
  onExportPdf?: () => void;
  activeId: string | null;
  sortKey: (h: T) => number;
  label: (h: T) => string;
  isDetached?: (h: T) => boolean;
  emptyHint?: string;
}) {
  const [filter, setFilter] = useState<HighlightColor | 'all' | 'notes'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const noteCount = highlights.filter((h) => h.note.trim()).length;
  const list = useMemo(
    () =>
      [...highlights]
        .filter((h) => filter === 'all' || (filter === 'notes' ? h.note.trim() : h.color === filter))
        .sort((a, b) => sortKey(a) - sortKey(b)),
    [highlights, filter, sortKey],
  );

  return (
    <aside className="side-panel right">
      <div className="notes-head">
        <div>
          <div className="notes-title">Notes</div>
          <div className="notes-sub">
            {highlights.length} highlight{highlights.length === 1 ? '' : 's'} · {noteCount} note{noteCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="notes-actions">
          {onExportPdf && (
            <button className="icon-btn sm" data-tip="Export PDF with highlights" aria-label="Export PDF with highlights" onClick={onExportPdf} disabled={!highlights.length}>
              <FileDown size={15} />
            </button>
          )}
          <button className="icon-btn sm" data-tip="Save as Markdown note" aria-label="Save as Markdown note" onClick={onExportNote} disabled={!highlights.length}>
            <FilePlus size={15} />
          </button>
          <button className="icon-btn sm" data-tip="Download .md" aria-label="Download notes" onClick={onExport} disabled={!highlights.length}>
            <Download size={15} />
          </button>
        </div>
      </div>
      <div className="notes-filter">
        <button className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>All</button>
        <button className={'chip' + (filter === 'notes' ? ' on' : '')} onClick={() => setFilter('notes')}>
          <MessageSquare size={12} /> With notes
        </button>
        <span className="chip-dots">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.id}
              className={`swatch xs hl-${c.id}${filter === c.id ? ' on' : ''}`}
              aria-label={'Only ' + c.label}
              onClick={() => setFilter(filter === c.id ? 'all' : c.id)}
            />
          ))}
        </span>
      </div>
      <div className="notes-list">
        {!highlights.length && (
          <div className="notes-empty">
            <div className="notes-empty-art">
              <Highlighter size={20} />
            </div>
            <div className="notes-empty-title">No highlights yet</div>
            <p>{emptyHint}</p>
          </div>
        )}
        {list.map((h) => (
          <div
            key={h.id}
            className={`note-card c-${h.color}${activeId === h.id ? ' active' : ''}${isDetached?.(h) ? ' detached' : ''}`}
            onClick={() => onJump(h)}
          >
            <div className="note-card-top">
              <span className="note-page">{label(h)}</span>
              {isDetached?.(h) && <span className="note-detached" title="This passage changed since you highlighted it">Detached</span>}
              <span className="note-time">{timeAgo(h.createdAt)}</span>
              <button
                className="icon-btn sm note-del"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(h.id);
                }}
              >
                <Trash size={13} />
              </button>
            </div>
            <div className="note-quote">{h.text}</div>
            {editing === h.id ? (
              <textarea
                className="note-edit"
                autoFocus
                value={h.note}
                placeholder="Write a note…"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChange(h.id, { note: e.target.value })}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) && setEditing(null)}
              />
            ) : h.note.trim() ? (
              <div
                className="note-text"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(h.id);
                }}
              >
                {h.note}
              </div>
            ) : (
              <button
                className="note-add"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(h.id);
                }}
              >
                <MessageSquare size={12} /> Add note
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function highlightsToMarkdown<T extends Annotation>(title: string, hls: T[], sortKey: (h: T) => number, label: (h: T) => string) {
  const sorted = [...hls].sort((a, b) => sortKey(a) - sortKey(b));
  let md = `# Notes — ${title}\n\n*${hls.length} highlights, exported ${new Date().toLocaleDateString()}*\n`;
  let group: string | null = null;
  for (const h of sorted) {
    const g = label(h);
    if (g !== group) {
      group = g;
      if (g) md += `\n## ${g}\n`;
    }
    md += `\n> ${h.text.replace(/\s+/g, ' ').trim()}\n`;
    if (h.note.trim()) md += `\n${h.note.trim()}\n`;
  }
  return md;
}
