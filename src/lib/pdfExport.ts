import { PDFDocument, PDFHexString, PDFString } from 'pdf-lib';
import type { PDFDoc } from './pdf';
import type { Highlight, HighlightColor, InkStroke } from './types';

const COLORS: Record<HighlightColor, [number, number, number]> = {
  yellow: [1, 0.847, 0.29],
  green: [0.525, 0.89, 0.659],
  blue: [0.522, 0.784, 1],
  pink: [1, 0.612, 0.761],
  purple: [0.741, 0.643, 1],
};
const n2 = (v: number) => Number(v.toFixed(2));

/**
 * Returns a copy of the PDF with Folio's highlights written in as standard Highlight annotations
 * (with notes as their comments), so they show up in Acrobat, Edge, Preview and other readers.
 * `doc` is the pdf.js document, used to map Folio's page-relative rectangles back to PDF coordinates.
 */
export async function exportAnnotatedPdf(bytes: ArrayBuffer, doc: PDFDoc, highlights: Highlight[], ink: InkStroke[] = []): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPages();
  const byPage = new Map<number, Highlight[]>();
  for (const h of highlights) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);

  for (const [num, list] of byPage) {
    const page = pages[num - 1];
    if (!page) continue;
    const vp = (await doc.getPage(num)).getViewport({ scale: 1 });
    for (const h of list) {
      const quads: number[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const r of h.rects) {
        // corner order per the PDF spec's de-facto convention: top-left, top-right, bottom-left, bottom-right
        const corners = [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x, r.y + r.h],
          [r.x + r.w, r.y + r.h],
        ];
        for (const [u, v] of corners) {
          const [x, y] = vp.convertToPdfPoint(u * vp.width, v * vp.height) as [number, number];
          quads.push(n2(x), n2(y));
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (!quads.length) continue;
      const rect = [n2(minX), n2(minY), n2(maxX), n2(maxY)];
      const [cr, cg, cb] = COLORS[h.color];

      // Appearance stream: readers that don't build their own still draw the highlight.
      const ops = ['/GS0 gs', `${cr} ${cg} ${cb} rg`];
      for (let i = 0; i < quads.length; i += 8) {
        const q = quads.slice(i, i + 8);
        ops.push(`${q[0]} ${q[1]} m ${q[2]} ${q[3]} l ${q[6]} ${q[7]} l ${q[4]} ${q[5]} l h f`);
      }
      const appearance = pdf.context.register(
        pdf.context.stream(ops.join('\n'), {
          Type: 'XObject',
          Subtype: 'Form',
          FormType: 1,
          BBox: rect,
          Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply', ca: 0.9 } } },
        }),
      );

      const annot = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Highlight',
        Rect: rect,
        QuadPoints: quads,
        C: [cr, cg, cb],
        F: 4, // print
        T: PDFString.of('Folio'),
        NM: PDFString.of(h.id),
        M: PDFString.fromDate(new Date(h.createdAt)),
        Contents: PDFHexString.fromText(h.note.trim()),
        AP: { N: appearance },
      });
      page.node.addAnnot(pdf.context.register(annot));
    }
  }
  // pen drawings: standard Ink annotations, so other readers show (and can erase) them too
  const inkByPage = new Map<number, InkStroke[]>();
  for (const st of ink) inkByPage.set(st.page, [...(inkByPage.get(st.page) ?? []), st]);
  for (const [num, list] of inkByPage) {
    const page = pages[num - 1];
    if (!page) continue;
    const vp = (await doc.getPage(num)).getViewport({ scale: 1 });
    for (const st of list) {
      const pts: number[] = [];
      for (let i = 0; i < st.pts.length; i += 2) {
        const [x, y] = vp.convertToPdfPoint(st.pts[i] * vp.width, st.pts[i + 1] * vp.height) as [number, number];
        pts.push(n2(x), n2(y));
      }
      if (pts.length === 2) pts.push(n2(pts[0] + 0.1), pts[1]);
      const lw = n2(Math.max(0.3, st.width * vp.width));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]);
        maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]);
        maxY = Math.max(maxY, pts[i + 1]);
      }
      const rect = [n2(minX - lw), n2(minY - lw), n2(maxX + lw), n2(maxY + lw)];
      const hex = parseInt(st.color.slice(1), 16);
      const rgb = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255].map((v) => +v.toFixed(3));
      const marker = st.tool === 'marker';
      const ops = [marker ? '/GS0 gs' : '', `${rgb.join(' ')} RG`, `${lw} w`, '1 J', '1 j', `${pts[0]} ${pts[1]} m`];
      for (let i = 2; i < pts.length; i += 2) ops.push(`${pts[i]} ${pts[i + 1]} l`);
      ops.push('S');
      const appearance = pdf.context.register(
        pdf.context.stream(ops.filter(Boolean).join(' \n'), {
          Type: 'XObject',
          Subtype: 'Form',
          FormType: 1,
          BBox: rect,
          ...(marker ? { Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply', CA: 0.5 } } } } : {}),
        }),
      );
      const annot = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Ink',
        Rect: rect,
        InkList: [pts],
        C: rgb,
        BS: { W: lw, S: 'S' },
        ...(marker ? { CA: 0.5 } : {}),
        F: 4,
        T: PDFString.of('Folio'),
        NM: PDFString.of(st.id),
        M: PDFString.fromDate(new Date(st.createdAt)),
        AP: { N: appearance },
      });
      page.node.addAnnot(pdf.context.register(annot));
    }
  }
  return pdf.save();
}
