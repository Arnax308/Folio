import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import {
  ArrowLeft, BookOpen, Check, Code, Columns2, Download, Eye, Heading1, Heading2, Italic, Link, List, ListChecks, ListOrdered,
  Minus, PenLine, Quote, Strikethrough, Table, Workflow, SquareCode, Save,
} from 'lucide-react';
import type { Route } from '../../App';
import { getDoc, getMarkdown, patchDoc, saveMarkdown } from '../../lib/db';
import { wordCount } from '../../lib/markdown';
import { useDebounced, useSettings } from '../../lib/settings';
import type { DocMeta } from '../../lib/types';
import { folioHighlight, folioTheme, insertBlock, insertLink, linePrefix, markdownKeymap, SNIPPETS, wrap } from '../../lib/cm';
import { DisplayMenu } from '../ui/DisplayMenu';
import { download, toast } from '../ui/ui';
import { MarkdownView } from './MarkdownView';

type Mode = 'write' | 'split' | 'preview';

type FileHandle = { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>; name: string };

export default function MdEditor({ id, go }: { id: string; go: (r: Route) => void }) {
  const s = useSettings();
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => (window.innerWidth > 1000 ? 'split' : 'write'));
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const viewRef = useRef<EditorView | null>(null);
  const previewScroll = useRef<HTMLDivElement>(null);
  const handleRef = useRef<FileHandle | null>(null);
  const preview = useDebounced(text ?? '', 180);

  useEffect(() => {
    (async () => {
      const m = await getDoc(id);
      if (!m) return go({ view: 'library' });
      setMeta(m);
      setText(await getMarkdown(id));
      patchDoc(id, { openedAt: Date.now() });
    })();
  }, [id, go]);

  // Autosave
  const firstLoad = useRef(true);
  useEffect(() => {
    if (text === null) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    setSaved('saving');
    const t = setTimeout(async () => {
      await saveMarkdown(id, text);
      await patchDoc(id, { words: wordCount(text), size: text.length, updatedAt: Date.now() });
      setSaved('saved');
    }, 500);
    return () => clearTimeout(t);
  }, [text, id]);

  const saveToDisk = useCallback(async () => {
    if (text === null || !meta) return;
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandle> }).showSaveFilePicker;
    try {
      if (picker) {
        if (!handleRef.current) {
          handleRef.current = await picker({
            suggestedName: meta.name + '.md',
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
          });
        }
        const w = await handleRef.current.createWritable();
        await w.write(text);
        await w.close();
        toast('Saved to ' + handleRef.current.name);
      } else {
        download(meta.name + '.md', text);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Could not save file');
    }
  }, [text, meta]);
  const saveRef = useRef(saveToDisk);
  saveRef.current = saveToDisk;

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      folioTheme,
      folioHighlight,
      markdownKeymap(() => saveRef.current()),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          setCursor({ line: line.number, col: head - line.from + 1 });
        }
      }),
    ],
    [],
  );

  // Proportional scroll sync editor -> preview
  useEffect(() => {
    const view = viewRef.current;
    if (!view || mode !== 'split') return;
    const sc = view.scrollDOM;
    const on = () => {
      const p = previewScroll.current;
      if (!p) return;
      const f = sc.scrollTop / Math.max(1, sc.scrollHeight - sc.clientHeight);
      p.scrollTop = f * (p.scrollHeight - p.clientHeight);
    };
    sc.addEventListener('scroll', on, { passive: true });
    return () => sc.removeEventListener('scroll', on);
  }, [mode, text === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setMode((m) => (m === 'split' ? 'write' : m === 'write' ? 'preview' : 'split'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rename = async (name: string) => {
    const v = name.trim();
    if (!v || !meta || v === meta.name) return;
    const m = await patchDoc(id, { name: v });
    if (m) setMeta(m);
  };

  const cmd = (fn: (v: EditorView) => unknown) => () => {
    if (viewRef.current) fn(viewRef.current);
  };

  const words = useMemo(() => wordCount(preview), [preview]);

  return (
    <div className={'reader md-editor mode-' + mode}>
      <header className="reader-bar">
        <div className="bar-left">
          <button className="icon-btn" data-tip="Library" aria-label="Back to library" onClick={() => go({ view: 'library' })}>
            <ArrowLeft size={18} />
          </button>
          {meta && (
            <input
              key={meta.id}
              className="doc-title-input"
              defaultValue={meta.name}
              aria-label="Document name"
              size={Math.max(8, Math.min(meta.name.length + 1, 40))}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          )}
          <span className={'save-state ' + saved}>
            {saved === 'saved' ? <><Check size={13} strokeWidth={2.5} /> Saved</> : 'Saving…'}
          </span>
        </div>
        <div className="bar-center">
          <div className="segmented">
            <button className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')}>
              <PenLine size={14} /> Write
            </button>
            <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>
              <Columns2 size={14} /> Split
            </button>
            <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
              <Eye size={14} /> Preview
            </button>
          </div>
        </div>
        <div className="bar-right">
          <button className="icon-btn" data-tip="Download .md" aria-label="Download" onClick={() => meta && text !== null && download(meta.name + '.md', text)}>
            <Download size={17} />
          </button>
          <button className="icon-btn" data-tip="Save to disk  Ctrl S" aria-label="Save to disk" onClick={saveToDisk}>
            <Save size={17} />
          </button>
          <DisplayMenu mode="md" />
          <button className="btn btn-quiet edit-btn" onClick={() => go({ view: 'md', id })}>
            <BookOpen size={15} /> Read
          </button>
        </div>
      </header>

      <div className="editor-body">
        {mode !== 'preview' && (
          <div className="editor-pane">
            <div className="format-bar" role="toolbar" aria-label="Formatting">
              <FB tip="Heading 1" onClick={cmd((v) => linePrefix(v, '# ', true))}><Heading1 size={16} /></FB>
              <FB tip="Heading 2" onClick={cmd((v) => linePrefix(v, '## ', true))}><Heading2 size={16} /></FB>
              <span className="divider-v" />
              <FB tip="Bold  Ctrl B" onClick={cmd((v) => wrap(v, '**'))}><span className="fb-bold">B</span></FB>
              <FB tip="Italic  Ctrl I" onClick={cmd((v) => wrap(v, '*'))}><Italic size={16} /></FB>
              <FB tip="Strikethrough" onClick={cmd((v) => wrap(v, '~~'))}><Strikethrough size={16} /></FB>
              <FB tip="Inline code  Ctrl E" onClick={cmd((v) => wrap(v, '`', '`', 'code'))}><Code size={16} /></FB>
              <FB tip="Link  Ctrl K" onClick={cmd(insertLink)}><Link size={16} /></FB>
              <span className="divider-v" />
              <FB tip="Quote" onClick={cmd((v) => linePrefix(v, '> '))}><Quote size={16} /></FB>
              <FB tip="Bulleted list" onClick={cmd((v) => linePrefix(v, '- '))}><List size={16} /></FB>
              <FB tip="Numbered list" onClick={cmd((v) => linePrefix(v, (i) => `${i + 1}. `))}><ListOrdered size={16} /></FB>
              <FB tip="Checklist" onClick={cmd((v) => linePrefix(v, '- [ ] '))}><ListChecks size={16} /></FB>
              <span className="divider-v" />
              <FB tip="Code block" onClick={cmd((v) => insertBlock(v, SNIPPETS.code, 6))}><SquareCode size={16} /></FB>
              <FB tip="Table" onClick={cmd((v) => insertBlock(v, SNIPPETS.table))}><Table size={16} /></FB>
              <FB tip="Mermaid diagram" onClick={cmd((v) => insertBlock(v, SNIPPETS.mermaid))}><Workflow size={16} /></FB>
              <FB tip="Divider" onClick={cmd((v) => insertBlock(v, SNIPPETS.hr))}><Minus size={16} /></FB>
            </div>
            {text !== null && (
              <CodeMirror
                className="cm-host"
                value={text}
                onChange={setText}
                extensions={extensions}
                theme="none"
                autoFocus
                placeholder="Start writing…"
                basicSetup={{
                  lineNumbers: false,
                  foldGutter: false,
                  highlightActiveLine: false,
                  highlightActiveLineGutter: false,
                  autocompletion: false,
                  searchKeymap: true,
                }}
                onCreateEditor={(v) => {
                  viewRef.current = v;
                  v.dispatch({ selection: { anchor: v.state.doc.length } });
                }}
              />
            )}
          </div>
        )}
        {mode !== 'write' && (
          <div className="preview-pane" ref={previewScroll}>
            <div className="md-page" style={{ '--measure': s.mdWidth + 'ch' } as React.CSSProperties}>
              <MarkdownView source={preview} className={s.mdFont === 'serif' ? 'serif' : 'sans'} style={{ fontSize: mode === 'split' ? Math.max(15, s.mdSize - 2) : s.mdSize }} />
            </div>
          </div>
        )}
      </div>

      <footer className="status-bar">
        <span>{words.toLocaleString()} words</span>
        <span>{(text ?? '').length.toLocaleString()} characters</span>
        <span>{Math.max(1, Math.round(words / 230))} min read</span>
        <span className="status-right">
          Ln {cursor.line}, Col {cursor.col}
          <span className="status-sep" />
          <span className="kbd">Ctrl</span><span className="kbd">\</span> cycle view
        </span>
      </footer>
    </div>
  );
}

function FB({ tip, onClick, children }: { tip: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn fb" data-tip={tip} aria-label={tip} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}
