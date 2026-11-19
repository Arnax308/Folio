import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';

export interface NotePeek {
  html: string;
  title: string;
  targetId: string;
  anchor: DOMRect;
  pinned: boolean;
}

/** Note markers: a reading edition's linked notes, or ordinary Markdown footnotes. */
export const NOTE_REF = 'sup.nref a[href^="#"], sup.footnote-ref a[href^="#"]';

/** The text of the note a marker points to, ready to show in a card (ids removed, back links dropped). */
export function noteFor(root: HTMLElement, link: HTMLAnchorElement): { html: string; title: string; targetId: string } | null {
  const targetId = decodeURIComponent(link.hash.slice(1));
  const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(targetId)}"]`);
  if (!target) return null;
  const box = document.createElement('div');
  if (target.classList.contains('note-num')) {
    // a reading-edition note: its paragraph, plus any paragraphs that continue it
    let p: Element | null = target.closest('p');
    if (!p) return null;
    box.append(p.cloneNode(true));
    for (let n = p.nextElementSibling; n && n.tagName === 'P' && !n.querySelector('.note-num'); n = n.nextElementSibling) box.append(n.cloneNode(true));
    box.querySelector('.note-num')?.remove();
  } else {
    box.innerHTML = target.innerHTML;
    box.querySelectorAll('.footnote-backref').forEach((b) => b.remove());
  }
  box.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  box.querySelectorAll('.pg').forEach((el) => el.remove());
  return { html: box.innerHTML, title: `Note ${link.textContent?.trim() ?? ''}`, targetId };
}

export function NotePopup({
  peek,
  onGo,
  onClose,
  onHoverChange,
}: {
  peek: NotePeek;
  onGo: (id: string) => void;
  onClose: () => void;
  onHoverChange: (inside: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const W = Math.min(420, window.innerWidth - 32);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = peek.anchor;
    const h = ref.current?.offsetHeight ?? 200;
    const below = a.bottom + h + 16 < window.innerHeight || a.top < h + 16;
    const left = Math.max(16, Math.min(window.innerWidth - W - 16, a.left + a.width / 2 - W / 2));
    setPos({ left, top: below ? a.bottom + 8 : a.top - h - 8 });
  }, [peek.anchor, peek.html, W]);

  useEffect(() => {
    if (!peek.pinned) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // reading on: close once the text has really moved, not on a nudge
    const start = new Map<EventTarget, number>();
    const scroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement;
      if (!el || ref.current?.contains(el)) return;
      const top = el.scrollTop;
      if (!start.has(el)) start.set(el, top);
      if (Math.abs(top - start.get(el)!) > 60) onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      document.removeEventListener('scroll', scroll, { capture: true });
    };
  }, [peek.pinned, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={'ref-card note-card' + (peek.pinned ? ' pinned' : '')}
      style={{ width: W, left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="ref-head">
        <span className="ref-where">{peek.title}</span>
        <button className="btn btn-quiet ref-go" onClick={() => onGo(peek.targetId)}>
          Go to note <ArrowUpRight size={14} />
        </button>
        {peek.pinned && (
          <button className="icon-btn sm" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="note-card-body prose" dangerouslySetInnerHTML={{ __html: peek.html }} />
    </div>,
    document.body,
  );
}
