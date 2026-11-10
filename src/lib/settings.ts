import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'sepia' | 'dark';
export type PageFilter = 'none' | 'warm' | 'night';
export interface Settings {
  theme: Theme;
  pageFilter: PageFilter;
  mdFont: 'serif' | 'sans';
  mdSize: number; // px
  mdWidth: number; // ch
}

const KEY = 'folio.settings';
const defaults: Settings = {
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  pageFilter: 'none',
  mdFont: 'serif',
  mdSize: 19,
  mdWidth: 68,
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

export function useApplyTheme() {
  const { theme } = useSettings();
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
