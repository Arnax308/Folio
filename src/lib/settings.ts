import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { isAndroid } from './desktop';

export type Theme = 'light' | 'sepia' | 'dark';
export type PageFilter = 'none' | 'warm' | 'night';
export type UiMode = 'auto' | 'touch' | 'mouse';
export interface Settings {
  theme: Theme;
  pageFilter: PageFilter;
  mdFont: 'serif' | 'sans';
  mdSize: number; // px
  mdWidth: number; // ch
  pdfLayout: 'scroll' | 'spread';
  pageTurn: boolean; // animated page flip in two-page view
  spreadCover: boolean; // show page 1 on its own, like a book cover
  uiMode: UiMode; // touch-first tablet interface, or the mouse-first desktop one
}

const KEY = 'folio.settings';
const defaults: Settings = {
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  pageFilter: 'none',
  mdFont: 'serif',
  mdSize: 19,
  mdWidth: 68,
  pdfLayout: 'scroll',
  pageTurn: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  spreadCover: true,
  uiMode: 'auto',
};

let current: Settings = (() => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
})();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/* ---------------------------- Touch interface ---------------------------- */
// Auto: touch on Android and on touch-only devices; a touchscreen laptop with a trackpad keeps the mouse UI.
const coarseOnly = matchMedia('(pointer: coarse) and (not (any-pointer: fine))');

export function resolveTouch(mode: UiMode, coarse = coarseOnly.matches) {
  return mode === 'touch' || (mode === 'auto' && (isAndroid || coarse));
}

/** True when the touch-first interface is active. */
export function useTouchUI() {
  const { uiMode } = useSettings();
  const coarse = useSyncExternalStore(
    (cb) => {
      coarseOnly.addEventListener('change', cb);
      return () => coarseOnly.removeEventListener('change', cb);
    },
    () => coarseOnly.matches,
  );
  return resolveTouch(uiMode, coarse);
}

export function useApplyTheme() {
  const { theme } = useSettings();
  const touch = useTouchUI();
  useLayoutEffect(() => {
    document.documentElement.dataset.ui = touch ? 'touch' : 'mouse';
  }, [touch]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.dataset.theme = theme;
    const t = setTimeout(() => root.classList.remove('theme-switching'), 450);
    return () => clearTimeout(t);
  }, [theme]);
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
