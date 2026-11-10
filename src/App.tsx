import { useCallback, useEffect, useState } from 'react';
import Library from './components/Library';
import PdfReader from './components/pdf/PdfReader';
import MdReader from './components/md/MdReader';
import MdEditor from './components/md/MdEditor';
import { Toasts } from './components/ui/ui';
import { useApplyTheme } from './lib/settings';
import { importFiles } from './lib/importer';
import { takeStartupFile } from './lib/desktop';

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

  // Dev / automation hook: import a file programmatically.
  useEffect(() => {
    (window as unknown as { folioImport: unknown }).folioImport = importFiles;
  }, []);

  // Desktop: open the file Folio was launched with.
  useEffect(() => {
    takeStartupFile()
      .then(async (f) => {
        if (!f) return;
        const [doc] = await importFiles([f]);
        if (doc) go({ view: doc.kind, id: doc.id });
      })
      .catch((e) => console.warn('Could not open startup file', e));
  }, [go]);

  const key = route.view === 'library' ? 'lib' : route.view + route.id;
  return (
    <>
      <div key={key} className="route fade-in">
        {route.view === 'library' && <Library go={go} />}
        {route.view === 'pdf' && <PdfReader id={route.id} go={go} />}
        {route.view === 'md' && <MdReader id={route.id} go={go} />}
        {route.view === 'edit' && <MdEditor id={route.id} go={go} />}
      </div>
      <Toasts />
    </>
  );
}
