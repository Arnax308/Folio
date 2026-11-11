import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { isDesktop } from './desktop';

/* ------------------------- Current document title ------------------------- */
let docTitle: string | null = null;
const titleListeners = new Set<() => void>();

function setDocTitle(name: string | null) {
  docTitle = name;
  const title = name ? `${name} — Folio` : 'Folio';
  document.title = title;
  // desktop: also name the native window, which is what the taskbar and Alt+Tab show
  if (isDesktop) import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title)).catch(() => {});
  titleListeners.forEach((l) => l());
}

/** Shows the open document's name in the window title (and the desktop title bar). */
export function useDocTitle(name: string | null | undefined) {
  useEffect(() => {
    setDocTitle(name || null);
    return () => setDocTitle(null);
  }, [name]);
}

export function useCurrentDocTitle() {
  return useSyncExternalStore(
    (cb) => {
      titleListeners.add(cb);
      return () => titleListeners.delete(cb);
    },
    () => docTitle,
  );
}

/* ----------------------------- Command palette ---------------------------- */
export interface PaletteItem {
  id: string;
  title: string;
  group: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
  /** Always shown for the current query, skipping the text filter (e.g. "Go to page 12"). */
  pinned?: boolean;
  run: () => void;
}
type Provider = (query: string) => PaletteItem[];
const providers = new Map<string, Provider>();

export function collectPaletteItems(query: string) {
  return [...providers.values()].flatMap((p) => p(query));
}

/** Lets the current view add its own entries (pages, bookmarks, headings…) to the palette. */
export function usePaletteProvider(key: string, provider: Provider) {
  useEffect(() => {
    providers.set(key, provider);
    return () => {
      if (providers.get(key) === provider) providers.delete(key);
    };
  }, [key, provider]);
}
