import { useEffect, useState } from 'react';
import { useCurrentDocTitle } from '../../lib/appState';
import { isDesktop } from '../../lib/desktop';
import { Logo } from '../Library';

const appWindow = async () => (await import('@tauri-apps/api/window')).getCurrentWindow();

/** The desktop app's own title bar: drag to move, double-click to maximise, themed like the rest of Folio. */
export function TitleBar() {
  const title = useCurrentDocTitle();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    let off: (() => void) | undefined;
    let gone = false;
    (async () => {
      const w = await appWindow();
      const sync = async () => !gone && setMaximized(await w.isMaximized());
      sync();
      off = await w.onResized(sync);
      if (gone) off();
    })();
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  const act = (what: 'minimize' | 'toggleMaximize' | 'close') => async () => {
    if (!isDesktop) return;
    const w = await appWindow();
    await w[what]();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="tb-title" data-tauri-drag-region>
        <Logo size={15} />
        <span className="tb-app">Folio</span>
        {title && <span className="tb-doc">{title}</span>}
      </div>
      <div className="tb-controls">
        <button className="tb-btn" aria-label="Minimise" onClick={act('minimize')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="tb-btn" aria-label={maximized ? 'Restore' : 'Maximise'} onClick={act('toggleMaximize')}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 2.5v-2h7v7h-2" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button className="tb-btn close" aria-label="Close" onClick={act('close')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.1" /></svg>
        </button>
      </div>
    </div>
  );
}
