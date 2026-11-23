/**
 * Offline dictionary (Princeton WordNet 3.0), built into public/dict by scripts/build-dictionary.mjs.
 * Words are split into small files by their first two letters, so a lookup reads a few kilobytes.
 */

export type Pos = 'noun' | 'verb' | 'adj' | 'adv';
export interface Sense {
  pos: Pos;
  def: string;
  examples: string[];
  synonyms: string[];
}
export interface Entry {
  word: string; // the dictionary form ("run" for "running")
  senses: Sense[];
}

type Shard = { s: [Pos, string, string[], string[]][]; w: Record<string, number[]> };

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/') + 'dict/';
const shards = new Map<string, Promise<Shard | null>>();
let exc: Promise<Record<string, string[]>> | null = null;

const shardKey = (w: string) => {
  const k = w.toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  return k.length === 2 ? k : (k || '_') + '_';
};

function loadShard(k: string) {
  let p = shards.get(k);
  if (!p) {
    p = fetch(base + k + '.json')
      .then((r) => (r.ok ? (r.json() as Promise<Shard>) : null))
      .catch(() => null);
    shards.set(k, p);
  }
  return p;
}

function loadExceptions() {
  exc ??= fetch(base + 'exc.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return exc;
}

/** Tidy a selection into something to look up: no surrounding punctuation, possessives or extra spaces. */
export function cleanWord(text: string) {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '')
    .replace(/\.$/, '')
    .replace(/'s$/i, '');
}

/** Is a selection short enough to be worth looking up? (a word, or a short phrase like "ad hoc") */
export function isLookupable(text: string) {
  const w = cleanWord(text);
  return !!w && w.length <= 40 && w.split(' ').length <= 4 && /\p{L}/u.test(w);
}

// WordNet's "morphy" detachment rules: inflected ending -> dictionary ending
const RULES: [string, string][] = [
  ['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y'],
  ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''],
  ['er', ''], ['est', ''], ['er', 'e'], ['est', 'e'], ['ier', 'y'], ['iest', 'y'], ['ly', ''], ['ily', 'y'],
];

async function candidates(word: string): Promise<string[]> {
  const w = word.toLowerCase();
  const out = [w];
  const ex = (await loadExceptions())[w];
  if (ex) out.push(...ex);
  for (const [from, to] of RULES) {
    if (w.length > from.length + 1 && w.endsWith(from)) {
      const stem = w.slice(0, -from.length) + to;
      out.push(stem);
      // running -> runn -> run, stopped -> stopp -> stop
      if (!to && /([b-df-hj-np-tv-z])\1$/.test(stem)) out.push(stem.slice(0, -1));
    }
  }
  // "re-read", "e-mail": also try without the hyphen
  if (w.includes('-')) out.push(w.replace(/-/g, ''), w.replace(/-/g, ' '));
  return [...new Set(out)];
}

async function find(word: string): Promise<Entry | null> {
  const sh = await loadShard(shardKey(word));
  const ids = sh?.w[word];
  if (!sh || !ids?.length) return null;
  return {
    word,
    senses: ids.map((i) => {
      const [pos, def, examples, words] = sh.s[i];
      return { pos, def, examples, synonyms: words.filter((x) => x.toLowerCase() !== word) };
    }),
  };
}

/** Every dictionary entry the text could be: the word itself first, then its base forms. */
export async function lookup(text: string): Promise<Entry[]> {
  const word = cleanWord(text);
  if (!word) return [];
  const found: Entry[] = [];
  for (const c of await candidates(word)) {
    const e = await find(c);
    if (e && !found.some((f) => f.word === e.word)) found.push(e);
  }
  return found;
}

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
}

/** A short Wikipedia summary, for names and things a dictionary doesn't have. Needs the internet. */
export async function wikipedia(text: string, signal?: AbortSignal): Promise<WikiSummary | null> {
  const q = cleanWord(text);
  const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, '_'))}?redirect=true`, { signal });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.extract || j.type === 'disambiguation') return j.type === 'disambiguation' ? { title: j.title, extract: `“${j.title}” can mean several things.`, url: j.content_urls?.desktop?.page ?? '' } : null;
  return { title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page ?? '' };
}
