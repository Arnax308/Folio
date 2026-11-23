import { Eraser, Highlighter, PenTool, Redo2, Undo2 } from 'lucide-react';
import { MARKER_COLORS, PEN_COLORS, type InkMode, type InkSettings } from '../../lib/ink';

const COLOR_NAMES: Record<string, string> = {
  '#1d1f24': 'Black',
  '#2457c5': 'Blue',
  '#c8322f': 'Red',
  '#1f7a4c': 'Green',
  '#ffd84a': 'Yellow',
  '#86e3a8': 'Green',
  '#ff9cc2': 'Pink',
  '#85c8ff': 'Blue',
};

/** The floating pen toolbar: pen / highlighter / eraser, colour, thickness, undo, done. */
export function InkBar({
  settings,
  onChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDone,
}: {
  settings: InkSettings;
  onChange: (s: InkSettings) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}) {
  const { mode } = settings;
  const tool = mode === 'marker' ? 'marker' : 'pen';
  const colors = tool === 'marker' ? MARKER_COLORS : PEN_COLORS;
  const setMode = (m: InkMode) => onChange({ ...settings, mode: m });
  const set = (patch: Partial<InkSettings['pen']>) => onChange({ ...settings, [tool]: { ...settings[tool], ...patch } });

  return (
    <div className="ink-bar" role="toolbar" aria-label="Pen" onPointerDown={(e) => e.stopPropagation()}>
      <button className={'ink-tool' + (mode === 'pen' ? ' on' : '')} data-tip="Pen" aria-label="Pen" aria-pressed={mode === 'pen'} onClick={() => setMode('pen')}>
        <PenTool size={18} />
      </button>
      <button className={'ink-tool' + (mode === 'marker' ? ' on' : '')} data-tip="Highlighter" aria-label="Highlighter" aria-pressed={mode === 'marker'} onClick={() => setMode('marker')}>
        <Highlighter size={18} />
      </button>
      <button className={'ink-tool' + (mode === 'eraser' ? ' on' : '')} data-tip="Eraser  E" aria-label="Eraser" aria-pressed={mode === 'eraser'} onClick={() => setMode('eraser')}>
        <Eraser size={18} />
      </button>
      {mode !== 'eraser' && (
        <>
          <span className="divider-v" />
          {colors.map((c) => (
            <button
              key={c}
              className={'ink-color' + (settings[tool].color === c ? ' on' : '')}
              style={{ ['--c' as string]: c }}
              aria-label={COLOR_NAMES[c] ?? c}
              onClick={() => set({ color: c })}
            />
          ))}
          <span className="divider-v" />
          {[0, 1, 2].map((i) => (
            <button key={i} className={'ink-size' + (settings[tool].size === i ? ' on' : '')} aria-label={['Fine', 'Medium', 'Bold'][i]} onClick={() => set({ size: i })}>
              <span style={{ width: (tool === 'marker' ? 7 : 4) + i * 3, height: (tool === 'marker' ? 7 : 4) + i * 3 }} />
            </button>
          ))}
        </>
      )}
      <span className="divider-v" />
      <button className="ink-tool" data-tip="Undo  Ctrl Z" aria-label="Undo" onClick={onUndo} disabled={!canUndo}>
        <Undo2 size={18} />
      </button>
      <button className="ink-tool" data-tip="Redo  Ctrl Y" aria-label="Redo" onClick={onRedo} disabled={!canRedo}>
        <Redo2 size={18} />
      </button>
      <button className="ink-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
