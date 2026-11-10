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

  // Development only: lets automated checks import a file without the file picker.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { folioImport: unknown }).folioImport = importFiles;
  }, []);

  // Desktop: open files handed to Folio by Explorer, at launch or while it is already running.
  useEffect(() => {
    const openPending = async () => {
      try {
        const opened = await takePendingFiles();
        if (!opened.length) return;
        const docs = await importFiles(opened.map((o) => o.file), opened.map((o) => o.path));
        const d = docs[docs.length - 1];
        if (d) go({ view: d.kind, id: d.id });
      } catch (e) {
        console.warn('Could not open file', e);
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
