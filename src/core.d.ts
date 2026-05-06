export interface Paragraph {
  index: number;
  start: number;
  end: number;
  raw: string;
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

export interface SentenceSpan {
  id: string;
  paragraphId: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  rawText: string;
  text: string;
}

export interface KeySentenceParagraph {
  id: string;
  paragraphIndex: number;
  heading: string;
  text: string;
  startOffset: number;
  endOffset: number;
  sentences: SentenceSpan[];
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

export interface MarkdownQualityReport {
  chars: number;
  lines: number;
  controlChars: number;
  mojibakeMarks: number;
  replacementChars: number;
  cidRefs: number;
  boxedFormulaMarks: number;
  mathSymbols: number;
  suspiciousFormulaMarks: number;
  longAlphaRuns: number;
  markdownTableLines: number;
  avgLineLength: number;
  riskScore: number;
  riskLevel: "ok" | "low" | "medium" | "high";
  warnings: string[];
}

export function analyzeMarkdownQuality(markdown: string): MarkdownQualityReport;
export function applySentenceHighlights(markdown: string, sentences: SentenceSpan[]): string;
export function buildContextClusters(markdown: string, paragraphs: Paragraph[], termCandidate: TermCandidate, maxClusters?: number): ContextCluster[];
export function buildGlossaryMarkdown(entry: Partial<GlossaryEntry> & { term: string }): string;
export function buildKeySentenceParagraphs(markdown: string, paragraphs: Paragraph[], minParagraphChars?: number): KeySentenceParagraph[];
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
export function removeManagedSentenceHighlights(markdown: string, records: Array<{ paragraphIndex: number; text: string }>): string;
export function slugify(value: string, fallback?: string): string;
export function splitParagraphSentences(markdown: string, paragraph: Paragraph): SentenceSpan[];
export function splitParagraphs(markdown: string): Paragraph[];
export function stripFrontmatter(markdown: string): { content: string; offset: number };
export function stripMarkdown(value: string): string;
