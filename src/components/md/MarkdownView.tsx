import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { fillCachedMermaid, renderMarkdown, renderMermaidIn, type TocItem } from '../../lib/markdown';
import { useSettings } from '../../lib/settings';
import { isTauri, openExternal } from '../../lib/desktop';

interface Props {
  source: string;
  className?: string;
  style?: React.CSSProperties;
  onToc?: (toc: TocItem[]) => void;
  /** Called synchronously after the HTML is (re)written, e.g. to paint highlights. */
  decorate?: (root: HTMLElement) => void;
}

export const MarkdownView = forwardRef<HTMLDivElement | null, Props>(function MarkdownView({ source, className, style, onToc, decorate }, fwd) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(fwd, () => ref.current!, []);
  const decorateRef = useRef(decorate);
  decorateRef.current = decorate;
  const { theme } = useSettings();
  const { html, toc } = useMemo(() => renderMarkdown(source), [source]);

  useLayoutEffect(() => {
    onToc?.(toc);
  }, [toc, onToc]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    fillCachedMermaid(el);
    decorateRef.current?.(el);
    let stale = false;
    renderMermaidIn(el, () => stale);
    return () => {
      stale = true;
    };
  }, [html, theme]);

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const copy = t.closest<HTMLButtonElement>('.code-copy');
    if (copy) {
      const code = copy.parentElement?.querySelector('code')?.textContent ?? '';
      navigator.clipboard.writeText(code);
      copy.textContent = 'Copied';
      copy.classList.add('done');
      setTimeout(() => {
        copy.textContent = 'Copy';
        copy.classList.remove('done');
      }, 1400);
      return;
    }
    const ext = t.closest<HTMLAnchorElement>('a[href^="http"]');
    if (ext && isTauri) {
      e.preventDefault();
      openExternal(ext.href);
      return;
    }
    const a = t.closest<HTMLAnchorElement>('a[href^="#"]');
    if (a) {
      e.preventDefault();
      const target = ref.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(a.hash.slice(1)))}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return <div ref={ref} className={'prose ' + (className ?? '')} style={style} onClick={onClick} />;
});
