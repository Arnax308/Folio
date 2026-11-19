/**
 * The free, offline path: rebuilds paragraphs from the PDF's own text layer (for scans, the OCR text
 * that came with the file). It can't see what the OCR missed — often the tiny note numbers.
 */
import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

interface Piece {
  x: number;
  y: number; // baseline, from the top of the page
  h: number;
  w: number;
  s: string;
}
interface Line {
  y: number;
  h: number;
  x: number;
  right: number;
  pieces: Piece[];
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export async function textOfPage(page: PDFPageProxy): Promise<string> {
  const tc = await page.getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}

export async function localPageMarkdown(page: PDFPageProxy, kind: 'body' | 'notes'): Promise<string> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const pieces: Piece[] = [];
  for (const it of tc.items as TextItem[]) {
    if (!it.str || !it.str.trim()) continue;
    const [, , , d, e, f] = it.transform;
    const h = Math.abs(d) || it.height || 10;
    pieces.push({ x: e, y: vp.height - f, h, w: it.width, s: it.str });
  }
  if (!pieces.length) return '';

  // lines: pieces whose baselines are close
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  const bodyH = median(pieces.map((p) => p.h));
  const lines: Line[] = [];
  for (const p of pieces) {
    const raised = p.h < bodyH * 0.75;
    const line = lines.find((l) => Math.abs(l.y - p.y) < (raised ? bodyH * 0.75 : bodyH * 0.45));
    if (line) {
      line.pieces.push(p);
      if (!raised) line.h = Math.max(line.h, p.h);
    } else lines.push({ y: p.y, h: p.h, x: 0, right: 0, pieces: [p] });
  }
  lines.forEach((l) => {
    // one oversized OCR box shouldn't make a whole line look like a heading
    const normal = l.pieces.filter((p) => p.h >= bodyH * 0.75).map((p) => p.h);
    if (normal.length) l.h = median(normal);
    l.pieces.sort((a, b) => a.x - b.x);
    l.x = l.pieces[0].x;
    l.right = Math.max(...l.pieces.map((p) => p.x + p.w));
  });
  lines.sort((a, b) => a.y - b.y);

  // running head and page number
  const textOf = (l: Line) => l.pieces.map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim();
  if (lines.length > 2 && lines[0].y < vp.height * 0.11 && textOf(lines[0]).length < 70) lines.shift();
  const lastText = lines.length ? textOf(lines[lines.length - 1]) : '';
  if (lines.length > 2 && lines[lines.length - 1].y > vp.height * 0.88 && /^[\W\dxivlc]{1,8}$/i.test(lastText)) lines.pop();
  if (!lines.length) return '';

  const margin = median(lines.map((l) => l.x));
  const right = median(lines.map((l) => l.right));
  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y);
  const gap = median(gaps) || bodyH * 1.3;

  // superscript note numbers: small digits sitting above the baseline
  const lineText = (l: Line) => {
    let out = '';
    for (const p of l.pieces) {
      const sup = p.h < l.h * 0.75 && p.y < l.y - l.h * 0.15 && /^\d{1,3}$/.test(p.s.trim());
      const s = sup ? `[^${p.s.trim()}]` : p.s;
      out += out && !sup && !/\s$/.test(out) && !/^\s/.test(s) ? ' ' + s : s;
    }
    return out.replace(/\s+/g, ' ').trim();
  };

  const blocks: string[] = [];
  let cur = '';
  lines.forEach((l, i) => {
    const t = lineText(l);
    const prev = lines[i - 1];
    const heading = l.h > bodyH * 1.3 && t.length < 80 && l.pieces.length < 14 && /[A-Za-z]{2}/.test(t);
    const breakAbove = i === 0 || heading || (prev && prev.h > bodyH * 1.3) || l.y - (prev?.y ?? 0) > gap * 1.6;
    // notes use hanging indents, so there only a leading number starts a new note
    const newPara =
      breakAbove ||
      (kind === 'notes'
        ? /^\d{1,3}[.)]\s/.test(t)
        : l.x > margin + bodyH * 0.8 || (prev && prev.right < right - bodyH * 3 && /[.!?”"]$/.test(lineText(prev))));
    if (newPara && cur) {
      blocks.push(cur);
      cur = '';
    }
    if (heading) {
      blocks.push('## ' + t);
      return;
    }
    if (!cur) cur = t;
    else if (/[A-Za-z]-$/.test(cur) && /^[a-z]/.test(t)) cur = cur.slice(0, -1) + t;
    else cur += ' ' + t;
  });
  if (cur) blocks.push(cur);
  return blocks.join('\n\n');
}
