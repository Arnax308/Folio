import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check, Moon, Sun, Coffee } from 'lucide-react';
import { updateSettings, useSettings, type Theme } from '../../lib/settings';
import { baseName, isDesktop, saveAs } from '../../lib/desktop';

/* ------------------------------- Toasts ------------------------------- */
type ToastItem = { id: number; text: string };
let toastId = 0;
const toastListeners = new Set<(t: ToastItem[]) => void>();
let toasts: ToastItem[] = [];
export function toast(text: string) {
  const t = { id: ++toastId, text };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l(toasts));
  }, 2400);
}
export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => void toastListeners.delete(setItems);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <Check size={15} strokeWidth={2.5} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Popover ------------------------------ */
export function useDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close, refs]);
}

export function PopoverButton({
  icon,
  tip,
  children,
  align = 'right',
  className = 'icon-btn',
  width,
}: {
  icon: ReactNode;
  tip?: string;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const refs = useRef([btn, pop]).current;
  useDismiss(open, () => setOpen(false), refs);
  const pos: React.CSSProperties =
    align === 'right' ? { right: 0 } : align === 'left' ? { left: 0 } : { left: '50%', translate: '-50% 0' };
  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btn}
        className={className + (open ? ' active' : '')}
        data-tip={open ? undefined : tip}
        aria-label={tip}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div ref={pop} className="popover" style={{ top: 'calc(100% + 8px)', width, ...pos }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Theme picker ---------------------------- */
const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'light', label: 'Paper', icon: <Sun size={14} /> },
  { id: 'sepia', label: 'Sepia', icon: <Coffee size={14} /> },
  { id: 'dark', label: 'Night', icon: <Moon size={14} /> },
];
export function ThemePicker() {
  const { theme } = useSettings();
  return (
    <div className="theme-dots" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          aria-label={t.label}
          data-tip={t.label}
          data-t={t.id}
          className={'theme-dot' + (theme === t.id ? ' on' : '')}
          onClick={() => updateSettings({ theme: t.id })}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="slider-val">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': pct + '%' } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span>{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={'switch' + (checked ? ' on' : '')}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </label>
  );
}

export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Saves a file: a native "Save as" dialog in the desktop app, a normal download in the browser. */
export function download(name: string, content: Blob | string, type = 'text/markdown') {
  if (isDesktop) {
    saveAs(name, content)
      .then((path) => path && toast('Saved to ' + baseName(path)))
      .catch(() => toast('Could not save the file'));
    return;
  }
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
