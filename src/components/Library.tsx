import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, BookOpen, Ellipsis, FileText, Hash, Library as LibraryIcon, PenLine, Plus, Search, Trash, Upload, ArrowUpRight, Pencil,
} from 'lucide-react';
import type { Route } from '../App';
import type { DocMeta } from '../lib/types';
import { deleteDoc, listDocs, patchDoc } from '../lib/db';
import { createMarkdown, importFiles, seedIfFirstRun } from '../lib/importer';
import { ThemePicker, timeAgo, toast, useDismiss } from './ui/ui';
import { backupLibrary, LIBRARY_CHANGED, restoreLibrary } from './ui/actions';

type Filter = 'all' | 'pdf' | 'md';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export default function Library({ go }: { go: (r: Route) => void }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setDocs(await listDocs()), []);
  useEffect(() => {
    seedIfFirstRun().then(refresh);
    window.addEventListener(LIBRARY_CHANGED, refresh);
    return () => window.removeEventListener(LIBRARY_CHANGED, refresh);
  }, [refresh]);

  const open = useCallback(
    (d: DocMeta) => {
      patchDoc(d.id, { openedAt: Date.now() });
      go({ view: d.kind, id: d.id });
    },
    [go],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter((f) => /\.(pdf|md|markdown|mdown|mkd|txt)$/i.test(f.name));
      if (!valid.length) {
        toast('Folio opens PDF and Markdown files');
        return;
      }
      setBusy(valid.length);
      const added = await importFiles(valid);
      setBusy(0);
      await refresh();
      if (added.length === 1) open(added[0]);
      else toast(`Added ${added.length} documents`);
    },
    [refresh, open],
  );

  // Drag & drop anywhere
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) handleFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [handleFiles]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInput.current?.click();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const newNote = async () => {
    const d = await createMarkdown('Untitled', '# Untitled\n\n');
    go({ view: 'edit', id: d.id });
  };

  const shown = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => filter === 'all' || d.kind === filter)
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((a, b) => b.openedAt - a.openedAt);
  }, [docs, filter, query]);

  const resume = useMemo(
    () => docs?.filter((d) => d.progress > 0.005 && d.progress < 0.98).sort((a, b) => b.openedAt - a.openedAt)[0],
    [docs],
  );

  const counts = useMemo(
    () => ({
      all: docs?.length ?? 0,
      pdf: docs?.filter((d) => d.kind === 'pdf').length ?? 0,
      md: docs?.filter((d) => d.kind === 'md').length ?? 0,
    }),
    [docs],
  );

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="lib">
      <aside className="lib-side">
        <div className="brand">
          <Logo />
          <span>Folio</span>
        </div>
        <nav className="side-nav">
          <NavItem icon={<LibraryIcon size={16} />} label="All documents" count={counts.all} on={filter === 'all'} onClick={() => setFilter('all')} />
          <NavItem icon={<FileText size={16} />} label="PDFs" count={counts.pdf} on={filter === 'pdf'} onClick={() => setFilter('pdf')} />
          <NavItem icon={<Hash size={16} />} label="Markdown" count={counts.md} on={filter === 'md'} onClick={() => setFilter('md')} />
        </nav>
        <div className="side-spacer" />
        <div className="side-card">
          <div className="side-card-title">Backup</div>
          <div className="backup-row">
            <button className="backup-btn" onClick={backupLibrary} data-tip="Save everything to a .zip" data-tip-pos="top">
              <Archive size={14} /> Back up
            </button>
            <button className="backup-btn" onClick={() => backupInput.current?.click()} data-tip="Load a Folio backup" data-tip-pos="top">
              <ArchiveRestore size={14} /> Restore
            </button>
          </div>
          <input
            ref={backupInput}
            type="file"
            hidden
            accept=".zip,application/zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) restoreLibrary(f);
            }}
          />
        </div>
        <div className="side-card">
          <div className="side-card-title">Appearance</div>
          <ThemePicker />
        </div>
        <p className="side-foot">
          Everything stays on this device.
          <span className="side-version">
            v{__APP_VERSION__} · <span className="kbd">Ctrl</span> <span className="kbd">K</span> to search
          </span>
        </p>
      </aside>

      <main className="lib-main">
        <div className="lib-inner">
          <header className="lib-head">
            <div>
              <div className="eyebrow">{today}</div>
              <h1 className="lib-title">{greeting()}.</h1>
            </div>
            <div className="lib-actions">
              <label className="search-field">
                <Search size={15} />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search library" />
                {!query && <span className="kbd">/</span>}
              </label>
              <button className="btn btn-ghost" onClick={newNote}>
                <PenLine size={15} /> New note
              </button>
              <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
                <Upload size={15} /> Open file
              </button>
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown"
                onChange={(e) => {
                  if (e.target.files) handleFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
            </div>
          </header>

          {resume && filter === 'all' && !query && <ResumeCard doc={resume} onOpen={() => open(resume)} />}

          <div className="section-head">
            <h2>{filter === 'all' ? 'Library' : filter === 'pdf' ? 'PDFs' : 'Markdown'}</h2>
            <span className="section-count">{shown.length}</span>
          </div>

          {docs && shown.length === 0 && !busy ? (
            <EmptyState onOpen={() => fileInput.current?.click()} onNew={newNote} searching={!!query} />
          ) : (
            <div className="grid">
              <button className="card add-card" onClick={() => fileInput.current?.click()}>
                <div className="add-inner">
                  <span className="add-icon">
                    <Plus size={20} />
                  </span>
                  <span className="add-title">Add documents</span>
                  <span className="add-sub">Drop PDFs or Markdown anywhere</span>
                </div>
              </button>
              {Array.from({ length: busy }, (_, i) => (
                <div key={'b' + i} className="card">
                  <div className="cover shimmer" />
                  <div className="card-body">
                    <div className="skel-line shimmer" />
                    <div className="skel-line short shimmer" />
                  </div>
                </div>
              ))}
              {shown.map((d, i) => (
                <DocCard key={d.id} doc={d} index={i} onOpen={() => open(d)} onChanged={refresh} go={go} />
              ))}
            </div>
          )}
        </div>
      </main>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-box">
            <Upload size={28} />
            <div className="drop-title">Drop to add to your library</div>
            <div className="drop-sub">PDF · Markdown</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M13 8h7a3 3 0 0 1 3 3v13l-3.5-2.2L16 24V11a3 3 0 0 0-3-3z" fill="var(--on-accent)" opacity=".5" />
      <path d="M9 11a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v13l-3.5-2.2L9 24z" fill="var(--on-accent)" />
    </svg>
  );
}

function NavItem({ icon, label, count, on, onClick }: { icon: React.ReactNode; label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <button className={'nav-item' + (on ? ' on' : '')} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <span className="nav-count">{count}</span>
    </button>
  );
}

function ResumeCard({ doc, onOpen }: { doc: DocMeta; onOpen: () => void }) {
  const pct = Math.round(doc.progress * 100);
  return (
    <button className="resume" onClick={onOpen}>
      <div className="resume-cover">
        {doc.kind === 'pdf' && doc.cover ? <img src={doc.cover} alt="" /> : <MdCover doc={doc} small />}
      </div>
      <div className="resume-body">
        <div className="eyebrow accent">Continue reading</div>
        <div className="resume-title">{doc.name}</div>
        <div className="resume-meta">
          {doc.kind === 'pdf' && doc.lastPage ? `Page ${doc.lastPage} of ${doc.pageCount ?? '—'}` : `${doc.words ?? 0} words`} · opened {timeAgo(doc.openedAt)}
        </div>
        <div className="resume-progress">
          <div className="bar">
            <div style={{ width: pct + '%' }} />
          </div>
          <span>{pct}%</span>
        </div>
      </div>
      <span className="resume-cta">
        Resume <ArrowUpRight size={15} />
      </span>
    </button>
  );
}

function MdCover({ doc, small }: { doc: DocMeta; small?: boolean }) {
  const h = hue(doc.name);
  return (
    <div className={'md-cover' + (small ? ' small' : '')} style={{ '--h': h } as React.CSSProperties}>
      <span className="md-cover-mark">#</span>
      <div className="md-cover-title">{doc.name}</div>
      <div className="md-cover-lines">
        <i style={{ width: '92%' }} />
        <i style={{ width: '78%' }} />
        <i style={{ width: '86%' }} />
        <i style={{ width: '54%' }} />
      </div>
    </div>
  );
}

function DocCard({ doc, index, onOpen, onChanged, go }: { doc: DocMeta; index: number; onOpen: () => void; onChanged: () => void; go: (r: Route) => void }) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const refs = useRef([menuRef, btnRef]).current;
  const close = useCallback(() => {
    setMenu(false);
    setConfirm(false);
  }, []);
  useDismiss(menu, close, refs);

  const meta =
    doc.kind === 'pdf'
      ? `${doc.pageCount ?? '?'} pages`
      : `${doc.words ?? 0} words`;

  return (
    <div className="card doc-card" style={{ animationDelay: Math.min(index, 12) * 25 + 'ms' }}>
      <button className="card-hit" onClick={onOpen} aria-label={'Open ' + doc.name} />
      <div className="cover">
        {doc.kind === 'pdf' ? (
          doc.cover ? <img src={doc.cover} alt="" loading="lazy" /> : <div className="cover-fallback"><FileText size={28} /></div>
        ) : (
          <MdCover doc={doc} />
        )}
        <span className={'kind-badge ' + doc.kind}>{doc.kind === 'pdf' ? 'PDF' : 'MD'}</span>
        {doc.progress > 0.005 && (
          <div className="cover-progress">
            <div style={{ width: Math.round(doc.progress * 100) + '%' }} />
          </div>
        )}
      </div>
      <div className="card-body">
        {renaming ? (
          <input
            className="rename-input"
            autoFocus
            defaultValue={doc.name}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={async (e) => {
              const v = e.target.value.trim();
              setRenaming(false);
              if (v && v !== doc.name) {
                await patchDoc(doc.id, { name: v });
                onChanged();
              }
            }}
          />
        ) : (
          <div className="card-title" title={doc.name}>{doc.name}</div>
        )}
        <div className="card-meta">
          {meta} <span className="dot" /> {timeAgo(doc.openedAt)}
        </div>
      </div>
      <div className="card-menu">
        <button ref={btnRef} className={'icon-btn sm' + (menu ? ' active' : '')} aria-label="More" onClick={() => setMenu((m) => !m)}>
          <Ellipsis size={16} />
        </button>
        {menu && (
          <div ref={menuRef} className="popover" style={{ right: 0, top: 'calc(100% + 6px)', minWidth: 180 }}>
            <button className="menu-item" onClick={() => { close(); onOpen(); }}>
              <BookOpen size={15} /> Open
            </button>
            {doc.kind === 'md' && (
              <button className="menu-item" onClick={() => { close(); go({ view: 'edit', id: doc.id }); }}>
                <PenLine size={15} /> Edit
              </button>
            )}
            <button className="menu-item" onClick={() => { close(); setRenaming(true); }}>
              <Pencil size={15} /> Rename
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item danger"
              onClick={async () => {
                if (!confirm) return setConfirm(true);
                close();
                await deleteDoc(doc.id);
                onChanged();
                toast('Removed from library');
              }}
            >
              <Trash size={15} /> {confirm ? 'Click again to remove' : 'Remove'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onOpen, onNew, searching }: { onOpen: () => void; onNew: () => void; searching: boolean }) {
  if (searching) return <div className="empty"><div className="empty-title">Nothing matches that search.</div></div>;
  return (
    <div className="empty">
      <div className="empty-art">
        <div className="sheet s1" />
        <div className="sheet s2" />
        <div className="sheet s3">
          <i /> <i /> <i /> <i className="hl" /> <i />
        </div>
      </div>
      <div className="empty-title">Your shelf is empty</div>
      <p className="empty-sub">Drop a PDF or Markdown file anywhere on this window, or start writing.</p>
      <div className="empty-actions">
        <button className="btn btn-primary" onClick={onOpen}><Upload size={15} /> Open file</button>
        <button className="btn btn-ghost" onClick={onNew}><PenLine size={15} /> New note</button>
      </div>
    </div>
  );
}
