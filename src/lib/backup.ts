import { strFromU8, strToU8, unzip, zip, type Zippable } from 'fflate';
import { getRawFile, getRawState, listDocs, saveMarkdown, savePdfBlob, setRawState, upsertDoc } from './db';
import type { DocMeta } from './types';

const MANIFEST = 'folio-backup.json';

interface Manifest {
  format: 'folio-backup';
  version: 1;
  exportedAt: number;
  docs: DocMeta[];
  states: Record<string, unknown>;
  settings: string | null;
}

/** Packs every document, its highlights, notes, bookmarks and reading position into one .zip. */
export async function exportLibrary(): Promise<{ blob: Blob; count: number }> {
  const docs = await listDocs();
  const files: Zippable = {};
  const states: Record<string, unknown> = {};
  const kept: DocMeta[] = [];
  for (const d of docs) {
    const raw = await getRawFile(d.id);
    if (raw === undefined) continue;
    if (d.kind === 'pdf') {
      const bytes = new Uint8Array(await (raw as Blob).arrayBuffer());
      files[`files/${d.id}.pdf`] = [bytes, { level: 0 }]; // PDFs are already compressed
    } else {
      files[`files/${d.id}.md`] = strToU8(String(raw));
    }
    const st = await getRawState(d.id);
    if (st) states[d.id] = st;
    kept.push(d);
  }
  const manifest: Manifest = {
    format: 'folio-backup',
    version: 1,
    exportedAt: Date.now(),
    docs: kept,
    states,
    settings: localStorage.getItem('folio.settings'),
  };
  files[MANIFEST] = strToU8(JSON.stringify(manifest));
  const data = await new Promise<Uint8Array>((res, rej) => zip(files, (err, out) => (err ? rej(err) : res(out))));
  return { blob: new Blob([data as BlobPart], { type: 'application/zip' }), count: kept.length };
}

/** Restores a backup. Documents already in the library are updated; nothing else is removed. */
export async function importLibrary(file: Blob): Promise<{ added: number; updated: number }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((res, rej) => unzip(buf, (err, out) => (err ? rej(err) : res(out))));
  const raw = entries[MANIFEST];
  if (!raw) throw new Error('This file is not a Folio backup.');
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  if (manifest.format !== 'folio-backup' || !Array.isArray(manifest.docs)) throw new Error('This file is not a Folio backup.');

  const existing = new Set((await listDocs()).map((d) => d.id));
  let added = 0;
  let updated = 0;
  // oldest first, so the newest documents end up at the front of the library
  for (const d of [...manifest.docs].reverse()) {
    const bytes = entries[`files/${d.id}.${d.kind === 'pdf' ? 'pdf' : 'md'}`];
    if (!bytes || !d.id || (d.kind !== 'pdf' && d.kind !== 'md')) continue;
    if (d.kind === 'pdf') await savePdfBlob(d.id, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    else await saveMarkdown(d.id, strFromU8(bytes));
    if (manifest.states?.[d.id]) await setRawState(d.id, manifest.states[d.id]);
    await upsertDoc(d);
    if (existing.has(d.id)) updated++;
    else added++;
  }
  return { added, updated };
}

export const backupName = () => `Folio backup ${new Date().toISOString().slice(0, 10)}.zip`;
