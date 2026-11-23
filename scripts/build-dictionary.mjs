// Builds Folio's offline dictionary from Princeton WordNet 3.0 (the wndb-with-exceptions package)
// into small JSON files under public/dict, split by the first two letters of each word so a lookup
// only loads a few kilobytes. Runs before `vite` / `vite build`; skips the work when it's up to date.
//
//   node scripts/build-dictionary.mjs [--force]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const VERSION = 2; // bump when the output format changes
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'dict');
const stamp = join(out, 'version.json');

if (!process.argv.includes('--force') && existsSync(stamp)) {
  try {
    if (JSON.parse(readFileSync(stamp, 'utf8')).v === VERSION) process.exit(0);
  } catch {
    /* rebuild */
  }
}

const require = createRequire(import.meta.url);
let src;
try {
  src = join(dirname(require.resolve('wndb-with-exceptions/package.json')), 'dict');
} catch {
  console.warn('[dictionary] wndb-with-exceptions is not installed; the dictionary will be empty. Run npm install.');
  process.exit(0);
}

const POS = { n: 'noun', v: 'verb', a: 'adj', s: 'adj', r: 'adv' };
const FILES = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };
const shardOf = (w) => {
  const k = w.toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  return k.length === 2 ? k : (k || '_') + '_';
};
const clean = (w) => w.replace(/\([a-z]+\)$/, '').replace(/_/g, ' ');

// 1. synsets: offset -> [pos, definition, examples, words]
const synsets = { n: new Map(), v: new Map(), a: new Map(), r: new Map() };
for (const [file, p] of Object.entries(FILES)) {
  for (const line of readFileSync(join(src, 'data.' + file), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue; // licence header
    const bar = line.indexOf(' | ');
    const head = line.slice(0, bar < 0 ? undefined : bar).split(' ');
    const gloss = bar < 0 ? '' : line.slice(bar + 3).trim();
    const offset = head[0];
    const type = head[2];
    const count = parseInt(head[3], 16);
    const words = [];
    for (let i = 0; i < count; i++) words.push(clean(head[4 + i * 2]));
    const examples = [...gloss.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).slice(0, 2);
    let def = gloss.split('"')[0].trim().replace(/[;:\s]+$/, '');
    if (!def && examples.length) def = examples.shift();
    synsets[p].set(offset, [POS[type], def, examples, words]);
  }
}

// 2. words, with their senses in WordNet's order (most common first), and the part of speech
//    used most often in WordNet's tagged texts first ("run" is a verb before it's a noun)
const shards = new Map();
const shard = (k) => {
  let s = shards.get(k);
  if (!s) shards.set(k, (s = { s: [], w: Object.create(null), g: Object.create(null), ids: new Map() }));
  return s;
};
let words = 0;
for (const [file, p] of Object.entries(FILES)) {
  for (const line of readFileSync(join(src, 'index.' + file), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const f = line.trim().split(' ');
    const lemma = clean(f[0]);
    const nSyn = Number(f[2]);
    const offsets = f.slice(f.length - nSyn);
    const sh = shard(shardOf(lemma));
    const tagged = Number(f[f.length - nSyn - 1]) || 0;
    const groups = (sh.g[lemma] ||= []);
    if (!groups.length) words++;
    const list = [];
    groups.push({ tagged, list });
    for (const off of offsets) {
      const key = p + off;
      let id = sh.ids.get(key);
      if (id === undefined) {
        const syn = synsets[p].get(off);
        if (!syn) continue;
        id = sh.s.push(syn) - 1;
        sh.ids.set(key, id);
      }
      list.push(id);
    }
  }
}

for (const sh of shards.values()) {
  for (const [lemma, groups] of Object.entries(sh.g)) sh.w[lemma] = groups.sort((a, b) => b.tagged - a.tagged).flatMap((x) => x.list);
}

// 3. irregular forms: "ran" -> "run", "mice" -> "mouse", "better" -> "good"
const exc = Object.create(null);
for (const file of ['noun', 'verb', 'adj', 'adv']) {
  for (const line of readFileSync(join(src, file + '.exc'), 'utf8').split('\n')) {
    const [form, ...bases] = line.trim().split(' ');
    if (!form || !bases.length) continue;
    const k = clean(form);
    exc[k] = [...new Set([...(exc[k] ?? []), ...bases.map(clean)])];
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let bytes = 0;
for (const [k, sh] of shards) {
  const json = JSON.stringify({ s: sh.s, w: sh.w });
  bytes += json.length;
  writeFileSync(join(out, k + '.json'), json);
}
writeFileSync(join(out, 'exc.json'), JSON.stringify(exc));
copyFileSync(join(src, '..', 'LICENSE'), join(out, 'LICENSE.txt'));
writeFileSync(stamp, JSON.stringify({ v: VERSION, words }));
console.log(`[dictionary] ${words.toLocaleString()} words in ${shards.size} files (${(bytes / 1048576).toFixed(1)} MB)`);
