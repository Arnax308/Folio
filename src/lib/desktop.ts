/** Helpers that only do something inside the Tauri desktop shell. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let startupTaken = false;

/** The file Folio was launched with (Explorer double-click / "Open with"), if any. */
export async function takeStartupFile(): Promise<File | null> {
  if (!isDesktop || startupTaken) return null;
  startupTaken = true;
  const { invoke } = await import('@tauri-apps/api/core');
  const name = await invoke<string | null>('startup_file_name');
  if (!name) return null;
  const bytes = await invoke<ArrayBuffer>('startup_file_bytes');
  return new File([bytes], name);
}

export async function openExternal(url: string) {
  if (!isDesktop) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
