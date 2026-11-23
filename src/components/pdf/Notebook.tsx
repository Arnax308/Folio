import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { ArrowUpRight, Check, Eye, NotebookPen, PenLine, Plus, X } from 'lucide-react';
import type { Route } from '../../App';
import { getDoc, getMarkdown, listDocs, patchDoc, saveMarkdown } from '../../lib/db';
import { createMarkdown } from '../../lib/importer';
import { toggleTaskAt, wordCount } from '../../lib/markdown';
import { folioHighlight, folioTheme, imageChips, imagePaste, markdownKeymap } from '../../lib/cm';
import { baseName, isDesktop, writeTextFile } from '../../lib/desktop';
import { useDebounced, useSettings } from '../../lib/settings';
import type { DocMeta } from '../../lib/types';
import { MarkdownView } from '../md/MarkdownView';
import { timeAgo, toast } from '../ui/ui';

/** Data carried when a passage or highlight is dragged onto the notebook. */
export const QUOTE_MIME = 'application/x-folio-quote';

/** A quote with a link back to its page: [p. 12](<Book.pdf#page=12>) opens the book there. */
export function quoteMarkdown(text: string, page: number, pdfName: string) {
  const q = text.replace(/\s+/g, ' ').trim();
  const target = `${pdfName}.pdf#page=${page}`.replace(/</g, '%3C').replace(/>/g, '%3E');
  return `> ${q}\n>\n> — [p. ${page}](<${target}>)\n`;
}

export interface NotebookHandle {
  /** Add Markdown at the cursor (or at the end when reading). */
  insert: (md: string) => void;
}

interface Props {
  pdf: DocMeta;
  width: number;
  onResize: (w: number) => void;
  onLink: (m: DocMeta) => void;
  onClose: () => void;
  go: (r: Route) => void;
}

/** A Markdown note open beside the book: write while reading, drop quotes in that link back to their page. */
export const Notebook = forwardRef<NotebookHandle, Props>(function Notebook({ pdf, width, onResize, onLink, onClose, go }, ref) {
  const s = useSettings();
  const [note, setNote] = useState<DocMeta | null | undefined>(undefined); // undefined = loading, null = none yet
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<'write' | 'read'>('write');
  const [saved, setSaved] = useState(true);
  const viewRef = useRef<EditorView | null>(null);
  const preview = useDebounced(text ?? '', 150);

  // the linked note (it may have been deleted from the library since)
  useEffect(() => {
    let gone = false;
    (async () => {
      const m = pdf.notebookId ? await getDoc(pdf.notebookId) : undefined;
      if (gone) return;
      setNote(m ?? null);
      setText(m ? await getMarkdown(m.id) : null);
    })();
    return () => {
      gone = true;
    };
  }, [pdf.notebookId]);

  // autosave, and on the desktop also into the file on disk the note came from
  const first = useRef(true);
  const writeFailed = useRef(false);
  useEffect(() => {
    if (text === null || !note) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(false);
    const t = setTimeout(async () => {
      await saveMarkdown(note.id, text);
      await patchDoc(note.id, { words: wordCount(text), size: text.length, updatedAt: Date.now() });
      if (isDesktop && note.sourcePath) {
        try {
          await writeTextFile(note.sourcePath, text);
          writeFailed.current = false;
        } catch {
          if (!writeFailed.current) toast('Couldn’t write to ' + baseName(note.sourcePath));
          writeFailed.current = true;
        }
      }
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [text, note]);
  useEffect(() => {
    first.current = true;
  }, [note?.id]);

  const insert = useCallback((md: string) => {
    const view = viewRef.current;
    if (view && view.dom.isConnected) {
      const { state } = view;
      const at = state.selection.main.head;
      const before = state.sliceDoc(Math.max(0, at - 2), at);
      // exactly one blank line before and after the new block
      const lead = at === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const body = md.replace(/\n+$/, '');
      const after = state.sliceDoc(at, at + 2);
      const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : after ? '\n\n' : '\n';
      const end = at + lead.length + body.length;
      view.dispatch({
        changes: { from: at, insert: lead + body + trail },
        selection: { anchor: end },
        effects: EditorView.scrollIntoView(end, { y: 'center' }),
      });
      return;
    }
    setText((t) => (t === null ? t : (t.replace(/\s*$/, '') + '\n\n' + md).replace(/^\n+/, '')));
  }, []);
  useImperativeHandle(ref, () => ({ insert }), [insert]);

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      folioTheme,
      folioHighlight,
      imageChips,
      imagePaste,
      markdownKeymap(() => {}),
      // a passage or highlight dropped from the book becomes a linked quote where it lands
      EditorView.domEventHandlers({
        dragover(e) {
          if (e.dataTransfer?.types.includes(QUOTE_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            return true;
          }
          return false;
        },
        drop(e, view) {
          const raw = e.dataTransfer?.getData(QUOTE_MIME);
          if (!raw) return false;
          e.preventDefault();
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos !== null) view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).to } });
          try {
            insert(JSON.parse(raw).md);
          } catch {
            /* ignore */
          }
          return true;
        },
      }),
    ],
    [insert],
  );

  // read mode accepts drops too
  const onReadDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(QUOTE_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      insert(JSON.parse(raw).md);
    } catch {
      /* ignore */
    }
  };

  const onToggleTask = useCallback((line: number, checked: boolean, col?: number) => {
    setText((t) => (t === null ? t : (toggleTaskAt(t, line, checked, col) ?? t)));
  }, []);

  /* ----------------------------- No notebook yet ---------------------------- */
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<DocMeta[]>([]);
  useEffect(() => {
    if (picking) listDocs().then((d) => setNotes(d.filter((x) => x.kind === 'md' && !x.sourcePdf).sort((a, b) => b.openedAt - a.openedAt)));
  }, [picking]);
  const link = async (m: DocMeta) => {
    const p = await patchDoc(pdf.id, { notebookId: m.id });
    if (p) onLink(p);
    setPicking(false);
  };
  const start = async () => {
    const m = await createMarkdown(`Notes — ${pdf.name}`, `# Notes — ${pdf.name}\n\n`);
    await link(m);
  };

  /* --------------------------------- Resize --------------------------------- */
  const onGrip = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => onResize(Math.round(Math.min(window.innerWidth * 0.62, Math.max(300, w0 + x0 - m.clientX))));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.documentElement.classList.remove('resizing-x');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    document.documentElement.classList.add('resizing-x');
  };

  return (
    <aside className="notebook" style={{ width }} aria-label="Notebook">
      <div className="nb-grip" onPointerDown={onGrip} aria-hidden />
      <div className="nb-head">
        <NotebookPen size={16} className="nb-icon" />
        <div className="nb-title" title={note?.name}>{note ? note.name : 'Notebook'}</div>
        {note && text !== null && (
          <span className={'nb-saved' + (saved ? '' : ' saving')}>{saved ? <Check size={13} strokeWidth={2.5} /> : '…'}</span>
        )}
        {note && (
          <div className="segmented nb-modes">
            <button className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')} aria-label="Write">
              <PenLine size={13} />
            </button>
            <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')} aria-label="Read">
              <Eye size={13} />
            </button>
          </div>
        )}
        {note && (
          <button className="icon-btn sm" data-tip="Open in the editor" aria-label="Open in the editor" onClick={() => go({ view: 'edit', id: note.id })}>
            <ArrowUpRight size={15} />
          </button>
        )}
        <button className="icon-btn sm" data-tip="Close  W" aria-label="Close notebook" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      {note === undefined ? null : note === null || picking ? (
        <div className="nb-empty">
          {!picking ? (
            <>
              <div className="nb-empty-art">
                <NotebookPen size={22} />
              </div>
              <div className="nb-empty-title">Write beside the book</div>
              <p>A Markdown note that stays open next to this PDF. Quotes you send to it link back to their page.</p>
              <button className="btn btn-primary" onClick={start}>
                <Plus size={15} /> Start a notebook
              </button>
              <button className="btn btn-quiet" onClick={() => setPicking(true)}>
                Use a note you already have
              </button>
            </>
          ) : (
            <div className="nb-pick">
              <div className="nb-pick-head">
                Choose a note
                <button className="btn btn-quiet" onClick={() => setPicking(false)}>Cancel</button>
              </div>
              {notes.length === 0 && <p>No Markdown notes in your library yet.</p>}
              {notes.map((n) => (
                <button key={n.id} className="nb-pick-item" onClick={() => link(n)}>
                  <span>{n.name}</span>
                  <span className="nb-pick-meta">{timeAgo(n.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : text === null ? null : mode === 'write' ? (
        <div className="nb-editor">
          <CodeMirror
            className="cm-host"
            value={text}
            onChange={setText}
            extensions={extensions}
            theme="none"
            placeholder="Write as you read…"
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }}
            onCreateEditor={(v) => {
              viewRef.current = v;
              v.dispatch({ selection: { anchor: v.state.doc.length } });
            }}
          />
        </div>
      ) : (
        <div className="nb-read" onDragOver={(e) => e.dataTransfer.types.includes(QUOTE_MIME) && e.preventDefault()} onDrop={onReadDrop}>
          <MarkdownView source={preview} onToggleTask={onToggleTask} className={s.mdFont === 'serif' ? 'serif' : 'sans'} style={{ fontSize: 16 }} />
        </div>
      )}
      {note && <div className="nb-hint">Select text in the book and press <b>Quote</b>, or drag a passage here.</div>}
    </aside>
  );
});
