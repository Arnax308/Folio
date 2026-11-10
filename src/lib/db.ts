import { get, set, del, createStore } from 'idb-keyval';
import type { DocMeta, MdState, PdfState } from './types';

const store = createStore('folio', 'kv');

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function listDocs(): Promise<DocMeta[]> {
  return (await get<DocMeta[]>('docs', store)) ?? [];
}
async function saveDocs(docs: DocMeta[]) {
  await set('docs', docs, store);
}
export async function upsertDoc(meta: DocMeta) {
  const docs = await listDocs();
  const i = docs.findIndex((d) => d.id === meta.id);
  if (i >= 0) docs[i] = meta;
  else docs.unshift(meta);
  await saveDocs(docs);
}
export async function patchDoc(id: string, patch: Partial<DocMeta>) {
  const docs = await listDocs();
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0) return;
  docs[i] = { ...docs[i], ...patch };
  await saveDocs(docs);
  return docs[i];
}
export async function getDoc(id: string) {
  return (await listDocs()).find((d) => d.id === id);
}
export async function deleteDoc(id: string) {
  await saveDocs((await listDocs()).filter((d) => d.id !== id));
  await del('file:' + id, store);
  await del('state:' + id, store);
}

export const getPdfBlob = (id: string) => get<Blob>('file:' + id, store);
export const getMarkdown = async (id: string) => (await get<string>('file:' + id, store)) ?? '';
export const saveMarkdown = (id: string, text: string) => set('file:' + id, text, store);
export const savePdfBlob = (id: string, blob: Blob) => set('file:' + id, blob, store);

export async function getPdfState(id: string): Promise<PdfState> {
  return (await get<PdfState>('state:' + id, store)) ?? { highlights: [], pageRotations: {}, rotation: 0 };
}
export const savePdfState = (id: string, s: PdfState) => set('state:' + id, s, store);

export async function getMdState(id: string): Promise<MdState> {
  return (await get<MdState>('state:' + id, store)) ?? { highlights: [] };
}
export const saveMdState = (id: string, s: MdState) => set('state:' + id, s, store);

// Raw access, used by backup / restore.
export const getRawFile = (id: string) => get<Blob | string>('file:' + id, store);
export const getRawState = (id: string) => get<unknown>('state:' + id, store);
export const setRawState = (id: string, s: unknown) => set('state:' + id, s, store);

export const getFlag =(k: string) => get<boolean>('flag:' + k, store);
export const setFlag = (k: string) => set('flag:' + k, true, store);
