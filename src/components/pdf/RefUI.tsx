import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, NotebookText, X } from 'lucide-react';
import { getPage, type PDFDoc } from '../../lib/pdf';
import { PRIORITY, toolsFor } from '../../lib/renderQueue';
import { useSettings } from '../../lib/settings';
import type { DestTarget } from '../../lib/references';

/**
 * A rendered slice of a page: from `y` (fraction of the page height, null = top) for `height` px,
 * or the whole page when height is omitted. Renders ahead of everything else in the queue.
 */
export function PageSnippet({
  doc,
  page,
  y,
  width,
  height,
  zoom = 1,
}: {
  doc: PDFDoc;
  page: number;
  y: number | null;
  width: number;
  height?: number;
  /** >1 trims the side margins: the page is drawn wider than the card and centred. */
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [aspect, setAspect] = useState(1.4);
  const { pageFilter } = useSettings();

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const { queue } = toolsFor(doc);
    const cancel = queue.add(
      PRIORITY.urgent,
      async () => {
        const p = await getPage(doc, page);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const base = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: (width * zoom * dpr) / base.width });
        setAspect((base.height * zoom) / base.width);
        const full = document.createElement('canvas');
        full.width = Math.floor(vp.width);
        full.height = Math.floor(vp.height);
        const r = p.render({ canvasContext: full.getContext('2d', { alpha: false })!, viewport: vp });
        task = r;
        await r.promise;
        const out = ref.current;
        if (cancelled || !out) return;
        // start a little above the target so the note's first line isn't cut
        const cropH = height ? Math.round(height * dpr) : full.height;
        const top = y === null || !height ? 0 : Math.max(0, Math.min(full.height - cropH, Math.round(y * full.height - 0.02 * full.height)));
        const outW = Math.round(width * dpr);
        const left = Math.max(0, Math.round((full.width - outW) / 2)); // centred: side margins fall away
        out.width = outW;
        out.height = cropH;
        out.getContext('2d')!.drawImage(full, left, top, outW, cropH, 0, 0, outW, cropH);
        setReady(true);
      },
      () => task?.cancel(),
    );
    return () => {
      cancelled = true;
      cancel();
    };
  }, [doc, page, y, width, height, zoom]);

  const h = height ?? Math.round(width * aspect);
  return (
    <div className={`snippet filter-${pageFilter}`} style={{ width, height: h }}>
      {!ready && <div className="snippet-skel shimmer" />}
      <canvas ref={ref} style={{ width, height: h, opacity: ready ? 1 : 0 }} />
    </div>
  );
}

/* ------------------------------- Link preview ------------------------------- */
export interface LinkPeek {
  target: DestTarget;
  anchor: DOMRect;
  pinned: boolean;
}

export function LinkPreview({
  doc,
  peek,
  onGo,
  onClose,
  onHoverChange,
}: {
  doc: PDFDoc;
  peek: LinkPeek;
  onGo: (t: DestTarget) => void;
  onClose: () => void;
  onHoverChange: (inside: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const W = Math.min(460, window.innerWidth - 32);
  const [pos, setPos] = useState({ left: 0, top: 0, below: true });

  useLayoutEffect(() => {
    const a = peek.anchor;
    const h = ref.current?.offsetHeight ?? 320;
    const below = a.bottom + h + 16 < window.innerHeight || a.top < h + 16;
    const left = Math.max(16, Math.min(window.innerWidth - W - 16, a.left + a.width / 2 - W / 2));
    setPos({ left, top: below ? a.bottom + 10 : a.top - h - 10, below });
  }, [peek.anchor, W]);

  useEffect(() => {
    if (!peek.pinned) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [peek.pinned, onClose]);

  return (
    <div
      ref={ref}
      className={'ref-card' + (peek.pinned ? ' pinned' : '')}
      style={{ left: pos.left, top: pos.top, width: W }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="ref-head">
        <span className="ref-where">Page {peek.target.page}</span>
        <button className="btn btn-quiet ref-go" onClick={() => onGo(peek.target)}>
          Go to <ArrowUpRight size={14} />
        </button>
        {peek.pinned && (
          <button className="icon-btn sm" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="ref-body">
        <PageSnippet doc={doc} page={peek.target.page} y={peek.target.y} width={W - 20} height={250} zoom={1.45} />
      </div>
    </div>
  );
}

/* -------------------------------- Notes peek -------------------------------- */
export function NotesPeek({
  doc,
  entries,
  printed,
  onOpen,
  onClose,
}: {
  doc: PDFDoc;
  entries: { page: number; from: number; to: number }[];
  printed: number | null;
  onOpen: (page: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = Math.min(520, window.innerWidth - 56);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div ref={ref} className="notes-peek" role="dialog" aria-label="Notes for this page">
      <div className="notes-peek-head">
        <NotebookText size={17} />
        <div>
          <div className="notes-peek-title">Notes for this page</div>
          <div className="notes-peek-sub">
            {printed !== null ? `Book page ${printed} · ` : ''}
            {entries.length === 1 ? 'one page of notes' : `${entries.length} pages of notes`}
          </div>
        </div>
        <button className="icon-btn sm" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="notes-peek-body">
        {entries.map((e) => (
          <div key={e.page} className="notes-peek-page">
            <div className="notes-peek-cap">
              <span>
                Notes to pages {e.from}–{e.to} · page {e.page}
              </span>
              <button className="btn btn-quiet ref-go" onClick={() => onOpen(e.page)}>
                Open <ArrowUpRight size={14} />
              </button>
            </div>
            <PageSnippet doc={doc} page={e.page} y={null} width={width} zoom={1.15} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- Back chip -------------------------------- */
export function BackChip({ label, onBack, onDismiss }: { label: string; onBack: () => void; onDismiss: () => void }) {
  return (
    <div className="back-chip">
      <button className="back-chip-main" onClick={onBack}>
        <ArrowLeft size={15} /> {label}
      </button>
      <button className="back-chip-x" aria-label="Dismiss" onClick={onDismiss}>
        <X size={13} />
      </button>
    </div>
  );
}
