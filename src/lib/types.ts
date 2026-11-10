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
}

export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string }[] = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'pink', label: 'Pink' },
  { id: 'purple', label: 'Purple' },
];
