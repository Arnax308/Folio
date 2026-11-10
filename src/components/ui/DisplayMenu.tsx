import { Type } from 'lucide-react';
import { updateSettings, useSettings } from '../../lib/settings';
import { PopoverButton, Slider, Switch, ThemePicker } from './ui';

export function DisplayMenu({ mode }: { mode: 'pdf' | 'md' }) {
  const s = useSettings();
  return (
    <PopoverButton icon={<Type size={17} />} tip="Display" width={268}>
      {() => (
        <div className="display-menu">
          <div className="menu-label">Theme</div>
          <div style={{ padding: '6px 10px 10px' }}>
            <ThemePicker />
          </div>
          {mode === 'pdf' ? (
            <>
              <div className="menu-label">Pages</div>
              <div style={{ padding: '4px 8px 8px' }}>
                <div className="segmented full">
                  <button className={s.pageFilter === 'none' ? 'on' : ''} onClick={() => updateSettings({ pageFilter: 'none' })}>Original</button>
                  <button className={s.pageFilter === 'warm' ? 'on' : ''} onClick={() => updateSettings({ pageFilter: 'warm' })}>Warm</button>
                  <button className={s.pageFilter === 'night' ? 'on' : ''} onClick={() => updateSettings({ pageFilter: 'night' })}>Night</button>
                </div>
              </div>
              <div className="menu-label">Layout</div>
              <div style={{ padding: '4px 8px 6px' }}>
                <div className="segmented full">
                  <button className={s.pdfLayout === 'scroll' ? 'on' : ''} onClick={() => updateSettings({ pdfLayout: 'scroll' })}>Scroll</button>
                  <button className={s.pdfLayout === 'spread' ? 'on' : ''} onClick={() => updateSettings({ pdfLayout: 'spread' })}>Two pages</button>
                </div>
              </div>
              <Switch label="Page-turn animation" hint="Flip pages like a book" checked={s.pageTurn} onChange={(v) => updateSettings({ pageTurn: v })} />
              <Switch label="Cover on its own" hint="Start spreads from page 2" checked={s.spreadCover} onChange={(v) => updateSettings({ spreadCover: v })} />
            </>
          ) : (
            <>
              <div className="menu-label">Typeface</div>
              <div style={{ padding: '4px 8px 6px' }}>
                <div className="segmented full">
                  <button className={'font-opt serif' + (s.mdFont === 'serif' ? ' on' : '')} onClick={() => updateSettings({ mdFont: 'serif' })}>Serif</button>
                  <button className={'font-opt' + (s.mdFont === 'sans' ? ' on' : '')} onClick={() => updateSettings({ mdFont: 'sans' })}>Sans</button>
                </div>
              </div>
              <Slider label="Size" value={s.mdSize} min={15} max={24} onChange={(v) => updateSettings({ mdSize: v })} format={(v) => v + 'px'} />
              <Slider label="Line width" value={s.mdWidth} min={52} max={90} step={2} onChange={(v) => updateSettings({ mdWidth: v })} format={(v) => v + 'ch'} />
            </>
          )}
        </div>
      )}
    </PopoverButton>
  );
}
