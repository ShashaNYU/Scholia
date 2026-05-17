export interface SepSearchCandidate {
  title: string;
  url: string;
  snippet: string;
  normalizedTitle: string;
}

export interface RankedSepCandidate extends SepSearchCandidate {
  score: number;
}

export interface ParsedSepEntry {
  title: string;
  sourceUrl: string;
  revised: string;
  paragraphs: string[];
  preamble: string;
  sourceExcerpt: string;
}

export function fetchSepEntry(url: string): Promise<ParsedSepEntry>;
export function parseSepEntryHtml(html: string, sourceUrl?: string): ParsedSepEntry;
export function parseSepSearchResults(html: string): SepSearchCandidate[];
export function pickSepCandidateHeuristically(
  candidates: SepSearchCandidate[],
  term: string,
  aliases?: string[]
): { candidate: RankedSepCandidate | null; candidates: RankedSepCandidate[] };
export function rankSepCandidates(candidates: SepSearchCandidate[], term: string, aliases?: string[]): RankedSepCandidate[];
export function scoreSepCandidate(candidate: SepSearchCandidate, term: string, aliases?: string[]): number;
export function searchSep(query: string): Promise<SepSearchCandidate[]>;
export function stripHtml(value: string): string;
