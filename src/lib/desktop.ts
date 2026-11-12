/** Helpers for the Tauri shells (Windows desktop app and Android app). */

/** Running inside a Folio app (desktop or Android), not a plain browser. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
/** The Windows desktop app: own title bar, Explorer integration, save-back to files on disk. */
export const isDesktop = isTauri && !isAndroid;

/**
 * `accept` for a file input. Android's picker filters by MIME type and most file managers don't know
 * `.md`, so there we allow everything and let the importer skip what it can't open.
 */
export const fileAccept = (kind: 'docs' | 'backup') =>
  isAndroid ? '*/*' : kind === 'docs' ? '.pdf,.md,.markdown,.txt,application/pdf,text/markdown' : '.zip,application/zip';

const core = () => import('@tauri-apps/api/core');

export interface OpenedFile {
  file: File;
  path: string;
}

/** Files Folio was asked to open (Explorer double-click / "Open with"), at launch or while running. */
export async function takePendingFiles(): Promise<OpenedFile[]> {
  if (!isTauri) return [];
  const { invoke } = await core();
  const paths = await invoke<string[]>('take_pending');
  const out: OpenedFile[] = [];
  for (const path of paths) {
    try {
      const bytes = await invoke<ArrayBuffer>('read_file', { path });
      out.push({ file: new File([bytes], path.split(/[\\/]/).pop() || 'file'), path });
    } catch (e) {
      console.warn('Could not read', path, e);
    }
  }
  return out;
}

/** Called when a second launch hands its file to this window. */
export async function onOpenRequest(cb: () => void): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('folio-open', cb);
}

export async function writeTextFile(path: string, contents: string) {
  const { invoke } = await core();
  await invoke('write_text_file', { path, contents });
}

/** Native "Save as" dialog. Resolves to the chosen path, or null if cancelled. */
export async function saveAs(name: string, data: Blob | string): Promise<string | null> {
  const { invoke } = await core();
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const labels: Record<string, string> = { md: 'Markdown', pdf: 'PDF', zip: 'Folio backup' };
  return invoke<string | null>('save_as', bytes, {
    headers: { 'x-name': encodeURIComponent(name), 'x-ext': ext, 'x-label': encodeURIComponent(labels[ext] ?? 'File') },
  });
}

export async function openExternal(url: string) {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;
