export type DocKind = 'pdf' | 'md';

export interface DocMeta {
  id: string;
  name: string;
  kind: DocKind;
  size: number;
  addedAt: number;
  openedAt: number;
  updatedAt: number;
  progress: number; // 0..1
  lastPage?: number;
  pageCount?: number;
  words?: number;
  cover?: string; // data URL thumbnail
  sourcePath?: string; // desktop: the file on disk this document came from
  editionId?: string; // PDF: its converted reading edition (a Markdown document)
  sourcePdf?: string; // reading edition: the PDF it was made from
  notebookId?: string; // PDF: the Markdown note written beside it
}

export interface NRect { x: number; y: number; w: number; h: number } // normalised 0..1, unrotated page space

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Annotation {
  id: string;
  color: HighlightColor;
  text: string;
  note: string;
  createdAt: number;
  page?: number;
}

export interface Highlight extends Annotation {
  page: number; // 1-based
  rects: NRect[];
}

/** Markdown highlights are anchored by text position plus surrounding context. */
export interface MdHighlight extends Annotation {
  start: number;
  prefix: string;
  suffix: string;
  section?: string;
}

export interface MdState {
  highlights: MdHighlight[];
}

export interface PdfState {
  highlights: Highlight[];
  pageRotations: Record<number, number>;
  rotation: number;
  bookmarks?: number[]; // bookmarked page numbers
  zoom?: number | 'fit-width' | 'fit-page';
  /** Where the notes are (found once, in the background). null = looked, there's no notes section. */
  notesIndex?: import('./references').NotesIndex | null;
  /** Pen and highlighter drawings. */
  ink?: InkStroke[];
  /** Where the text sits on odd and even pages (found once, when margin trimming is first used). null = nothing to trim. */
  trim?: TrimBoxes | null;
}

export type InkTool = 'pen' | 'marker';
/** One stroke of the pen. Points are normalised 0..1 in unrotated page space; width is a fraction of the page width. */
export interface InkStroke {
  id: string;
  page: number;
  tool: InkTool;
  color: string;
  width: number;
  pts: number[]; // x0, y0, x1, y1, …
  createdAt: number;
}

export interface TrimBoxes {
  odd: NRect | null;
  even: NRect | null;
}

export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string }[] = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'pink', label: 'Pink' },
  { id: 'purple', label: 'Purple' },
];
