export interface Paragraph {
  index: number;
  start: number;
  end: number;
  text: string;
  heading: string;
}

export interface ParagraphWindow {
  id: string;
  paragraphIndexes: number[];
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface TermCandidate {
  term: string;
  normalizedTerm?: string;
  aliases?: string[];
  reason?: string;
  importance?: number;
  frequency?: number;
  paragraphIndexes?: number[];
  score?: number;
}

export interface ContextCluster {
  id: string;
  label: string;
  paragraphIndexes: number[];
  startOffset: number;
  endOffset: number;
  excerpt: string;
  occurrenceCount?: number;
  usageNote?: string;
}

export interface GlossaryEntry {
  term: string;
  normalizedTerm: string;
  aliases: string[];
  sourcePaper: string;
  provider: string;
  model: string;
  created: string;
  updated: string;
  firstUse: string;
  definition: string;
  authorUsage: string;
  clusters: ContextCluster[];
  sep_enabled?: boolean;
}

export function buildContextClusters(markdown: string, paragraphs: Paragraph[], termCandidate: TermCandidate, maxClusters?: number): ContextCluster[];
export function buildGlossaryMarkdown(entry: Partial<GlossaryEntry> & { term: string }): string;
export function buildParagraphWindows(paragraphs: Paragraph[], size?: number, overlap?: number): ParagraphWindow[];
export function chooseClusterForOffset(entry: { clusters?: ContextCluster[] }, offset: number): ContextCluster | null;
export function collectEntryTerms(entry: GlossaryEntry): string[];
export function excerptAround(markdown: string, start: number, end: number, radius?: number): string;
export function findPreparedTermAtPosition(lineText: string, position: number, entries: GlossaryEntry[]): { term: string; entry: GlossaryEntry; from: number; to: number } | null;
export function findTermOccurrences(markdown: string, term: string, aliases?: string[]): Array<{ start: number; end: number; text: string; alias: string }>;
export function findWordAtPosition(lineText: string, position: number): { word: string; from: number; to: number } | null;
export function getBaseName(vaultPath: string): string;
export function getParentPath(vaultPath: string): string;
export function mergeTermCandidates(candidates: TermCandidate[], maxTerms?: number): TermCandidate[];
export function normalizeTerm(term: string): string;
export function parseGlossaryMarkdown(markdown: string): GlossaryEntry | null;
export function parseJsonFromText(text: string): unknown;
export function parseLooseJsonFromText(text: string): unknown;
export function slugify(value: string, fallback?: string): string;
export function splitParagraphs(markdown: string): Paragraph[];
export function stripFrontmatter(markdown: string): { content: string; offset: number };
export function stripMarkdown(value: string): string;
