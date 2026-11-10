import { isDesktop } from '../../lib/desktop';
import { download, toast } from './ui';

export const LIBRARY_CHANGED = 'folio:library-changed';

export async function backupLibrary() {
  try {
    const { exportLibrary, backupName } = await import('../../lib/backup');
    const { blob, count } = await exportLibrary();
    if (!count) return toast('Nothing to back up yet');
    download(backupName(), blob, 'application/zip');
    if (!isDesktop) toast(`Backed up ${count} document${count === 1 ? '' : 's'}`);
  } catch (e) {
    console.warn(e);
    toast('The backup could not be created');
  }
}

export async function restoreLibrary(file: Blob) {
  try {
    const { importLibrary } = await import('../../lib/backup');
    const { added, updated } = await importLibrary(file);
    const n = added + updated;
    toast(n ? `Restored ${n} document${n === 1 ? '' : 's'}` : 'That backup is empty');
    window.dispatchEvent(new Event(LIBRARY_CHANGED));
  } catch (e) {
    toast(e instanceof Error && e.message.includes('Folio backup') ? e.message : 'That file could not be restored');
  }
}
