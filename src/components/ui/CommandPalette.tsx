import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, BookOpen, CornerDownLeft, FileText, Hash, Library, Moon, PenLine, Search, Sparkles, Sun, Coffee, Upload,
} from 'lucide-react';
import type { Route } from '../../App';
import { collectPaletteItems, OPEN_PALETTE, type PaletteItem } from '../../lib/appState';
import { listDocs, patchDoc } from '../../lib/db';
import { createMarkdown, importFiles } from '../../lib/importer';
import { updateSettings, useSettings } from '../../lib/settings';
import type { DocMeta } from '../../lib/types';
import { backupLibrary, restoreLibrary } from './actions';
import { fileAccept } from '../../lib/desktop';
import { toast } from './ui';

function score(item: PaletteItem, tokens: string[]) {
  const title = item.title.toLowerCase();
  const rest = `${item.keywords ?? ''} ${item.group}`.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    const i = title.indexOf(t);
    if (i === 0) total += 100;
    else if (i > 0 && /[\s\-_:(]/.test(title[i - 1])) total += 60;
    else if (i > 0) total += 25;
    else if (rest.includes(t)) total += 8;
    else return 0;
  }
  return total;
}

export function CommandPalette({ go, route }: { go: (r: Route) => void; route: Route }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // Ctrl+K is "insert link" inside the Markdown editor (it marks the event handled); Ctrl+P always works.
      if ((k === 'k' && !e.defaultPrevented) || k === 'p') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSel(0);
    listDocs().then(setDocs);
    inputRef.current?.focus();
  }, [open]);

  const close = () => setOpen(false);

  const items = useMemo(() => {
    if (!open) return [];
    const context = collectPaletteItems(query);
    const docItems: PaletteItem[] = [...docs]
      .sort((a, b) => b.openedAt - a.openedAt)
      .filter((d) => !(route.view !== 'library' && route.id === d.id))
      .map((d) => ({
        id: 'doc-' + d.id,
        title: d.name,
        group: 'Documents',
        hint: d.kind === 'pdf' ? 'PDF' : 'Markdown',
        icon: d.kind === 'pdf' ? <FileText size={15} /> : <Hash size={15} />,
        keywords: d.kind === 'pdf' ? 'pdf' : 'markdown md note',
        run: () => {
          patchDoc(d.id, { openedAt: Date.now() });
          go({ view: d.kind, id: d.id });
        },
      }));
    const g = 'Commands';
    const commands: PaletteItem[] = [
      {
        id: 'new-note', title: 'New note', group: g, icon: <PenLine size={15} />, keywords: 'create write markdown',
        run: async () => {
          const d = await createMarkdown('Untitled', '# Untitled\n\n');
          go({ view: 'edit', id: d.id });
        },
      },
      { id: 'open-file', title: 'Open a file…', group: g, hint: 'Ctrl O', icon: <Upload size={15} />, keywords: 'import add pdf markdown', run: () => fileInput.current?.click() },
      ...(route.view !== 'library' ? [{ id: 'library', title: 'Go to library', group: g, hint: 'Esc', icon: <Library size={15} />, keywords: 'home back', run: () => go({ view: 'library' }) }] : []),
      {
        id: 'layout', title: settings.pdfLayout === 'spread' ? 'Switch PDFs to scroll view' : 'Switch PDFs to two-page view', group: g, hint: 'D',
        icon: <BookOpen size={15} />, keywords: 'book spread layout pages',
        run: () => updateSettings({ pdfLayout: settings.pdfLayout === 'spread' ? 'scroll' : 'spread' }),
      },
      {
        id: 'turn', title: settings.pageTurn ? 'Turn off the page-turn animation' : 'Turn on the page-turn animation', group: g,
        icon: <Sparkles size={15} />, keywords: 'curl flip motion', run: () => updateSettings({ pageTurn: !settings.pageTurn }),
      },
      { id: 'theme-light', title: 'Theme: Paper', group: g, icon: <Sun size={15} />, keywords: 'light appearance', run: () => updateSettings({ theme: 'light' }) },
      { id: 'theme-sepia', title: 'Theme: Sepia', group: g, icon: <Coffee size={15} />, keywords: 'warm appearance', run: () => updateSettings({ theme: 'sepia' }) },
      { id: 'theme-dark', title: 'Theme: Night', group: g, icon: <Moon size={15} />, keywords: 'dark appearance', run: () => updateSettings({ theme: 'dark' }) },
      { id: 'backup', title: 'Back up library', group: g, icon: <Archive size={15} />, keywords: 'export zip save', run: backupLibrary },
      { id: 'restore', title: 'Restore from a backup…', group: g, icon: <ArchiveRestore size={15} />, keywords: 'import zip', run: () => backupInput.current?.click() },
    ];

    const all = [...context, ...docItems, ...commands];
    const order = new Map<string, number>();
    all.forEach((it) => order.has(it.group) || order.set(it.group, order.size));
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      // nothing typed: a short list of recent documents, then everything else
      let shown = 0;
      return all.filter((it) => it.group !== 'Documents' || shown++ < 6);
    }
    return all
      .map((it) => ({ it, s: it.pinned ? 1000 : score(it, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (a.it.pinned ? -1 : 0) - (b.it.pinned ? -1 : 0) || order.get(a.it.group)! - order.get(b.it.group)! || b.s - a.s)
      .map((x) => x.it);
  }, [open, query, docs, route, settings.pdfLayout, settings.pageTurn, go]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (it?: PaletteItem) => {
    if (!it) return;
    close();
    it.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept={fileAccept('docs')}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          const added = await importFiles(files);
          const d = added[added.length - 1];
          if (d) go({ view: d.kind, id: d.id });
          else if (files.length) toast('Folio opens PDF and Markdown files');
        }}
      />
      <input
        ref={backupInput}
        type="file"
        hidden
        accept={fileAccept('backup')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) restoreLibrary(f);
        }}
      />
      {open && (
        <div className="pal-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
          <div className="pal" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
            <div className="pal-input">
              <Search size={17} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents, pages, headings and commands"
                aria-label="Search"
                spellCheck={false}
              />
              <span className="kbd">Esc</span>
            </div>
            <div className="pal-list" ref={listRef}>
              {items.length === 0 && <div className="pal-empty">Nothing matches “{query}”.</div>}
              {items.map((it, i) => (
                <div key={it.id}>
                  {(i === 0 || items[i - 1].group !== it.group) && <div className="pal-group">{it.group}</div>}
                  <button className={'pal-item' + (i === sel ? ' on' : '')} onPointerMove={() => sel !== i && setSel(i)} onClick={() => run(it)}>
                    <span className="pal-icon">{it.icon ?? <CornerDownLeft size={14} />}</span>
                    <span className="pal-title">{it.title}</span>
                    {it.hint && <span className="pal-hint">{it.hint}</span>}
                  </button>
                </div>
              ))}
            </div>
            <div className="pal-foot">
              <span><span className="kbd">↑</span><span className="kbd">↓</span> to move</span>
              <span><span className="kbd">↵</span> to open</span>
              <span className="pal-foot-right"><span className="kbd">Ctrl</span><span className="kbd">K</span> anywhere</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
