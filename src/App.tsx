import { useCallback, useEffect, useState } from 'react';
import Library from './components/Library';
import PdfReader from './components/pdf/PdfReader';
import MdReader from './components/md/MdReader';
import MdEditor from './components/md/MdEditor';
import { Toasts } from './components/ui/ui';
import { CommandPalette } from './components/ui/CommandPalette';
import { TitleBar } from './components/ui/TitleBar';
import { useApplyTheme } from './lib/settings';
import { importFiles } from './lib/importer';
import { listDocs } from './lib/db';
import { resumeConversions } from './lib/convert/job';
import { isDesktop, onOpenRequest, takePendingFiles } from './lib/desktop';

export type Route =
  | { view: 'library' }
  | { view: 'pdf'; id: string }
  | { view: 'md'; id: string }
  | { view: 'edit'; id: string };

function parseHash(): Route {
  const [, view, id] = location.hash.replace(/^#/, '').split('/');
  if ((view === 'pdf' || view === 'md' || view === 'edit') && id) return { view, id };
  return { view: 'library' };
}

// The custom title bar only exists in the desktop app; `?titlebar` previews it in the dev server.
const showTitleBar = isDesktop || (import.meta.env.DEV && location.search.includes('titlebar'));

export default function App() {
  useApplyTheme();
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((r: Route) => {
    location.hash = r.view === 'library' ? '' : `/${r.view}/${r.id}`;
  }, []);

  // Carry on with reading editions that were being made when Folio was last closed.
  useEffect(() => {
    listDocs().then((docs) => resumeConversions(docs.filter((d) => d.kind === 'pdf').map((d) => d.id)));
  }, []);

  // Development only: lets automated checks import a file without the file picker.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { folioImport: unknown }).folioImport = importFiles;
  }, []);

  // Open files handed to Folio (Explorer on Windows, "Open with" / "Share" on Android), at launch
  // or while it is already running.
  useEffect(() => {
    let busy = false;
    const openPending = async () => {
      if (busy) return;
      busy = true;
      try {
        const opened = await takePendingFiles();
        if (!opened.length) return;
        // Android hands over a temporary copy, so there's no file on disk to save back to
        const docs = await importFiles(opened.map((o) => o.file), isDesktop ? opened.map((o) => o.path) : undefined);
        const d = docs[docs.length - 1];
        if (d) go({ view: d.kind, id: d.id });
      } catch (e) {
        console.warn('Could not open file', e);
      } finally {
        busy = false;
      }
    };
    openPending();
    let off: (() => void) | undefined;
    let gone = false;
    onOpenRequest(openPending).then((un) => (gone ? un() : (off = un)));
    return () => {
      gone = true;
      off?.();
    };
  }, [go]);

  const key = route.view === 'library' ? 'lib' : route.view + route.id;
  return (
    <div className={'app' + (showTitleBar ? ' has-titlebar' : '')}>
      {showTitleBar && <TitleBar />}
      <div className="app-body">
        <div key={key} className="route fade-in">
          {route.view === 'library' && <Library go={go} />}
          {route.view === 'pdf' && <PdfReader id={route.id} go={go} />}
          {route.view === 'md' && <MdReader id={route.id} go={go} />}
          {route.view === 'edit' && <MdEditor id={route.id} go={go} />}
        </div>
      </div>
      <CommandPalette go={go} route={route} />
      <Toasts />
    </div>
  );
}
