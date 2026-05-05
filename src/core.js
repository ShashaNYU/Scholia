"use strict";

const WORD_BOUNDARY_RE = /[A-Za-z0-9_-]/;

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { content: markdown, offset: 0 };
  }
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) {
    return { content: markdown, offset: 0 };
  }
  const after = markdown.indexOf("\n", end + 4);
  const offset = after === -1 ? markdown.length : after + 1;
  return { content: markdown.slice(offset), offset };
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => {
      const label = match.match(/^\[([^\]]*)]/);
      return label ? label[1] : " ";
    })
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?]]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~=#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTerm(term) {
  return stripMarkdown(term)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function slugify(value, fallback) {
  const slug = normalizeTerm(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback || "item";
}

function getParentPath(vaultPath) {
  const normalized = String(vaultPath || "").replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? "" : normalized.slice(0, idx);
}

function getBaseName(vaultPath) {
  const name = String(vaultPath || "").split("/").pop() || "";
  return name.replace(/\.[^.]+$/, "");
}

function splitParagraphs(markdown) {
  const stripped = stripFrontmatter(markdown);
  const content = stripped.content;
  const offset = stripped.offset;
  const paragraphs = [];
  const blockRe = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  let currentHeading = "";
  let match;
  let index = 0;

  while ((match = blockRe.exec(content)) !== null) {
    const raw = match[0];
    const start = offset + match.index;
    const end = start + raw.length;
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && !trimmed.includes("\n")) {
      currentHeading = stripMarkdown(headingMatch[2]);
      continue;
    }

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      continue;
    }

    const text = stripMarkdown(raw.replace(/\n/g, " "));
    if (text.length < 20) {
      continue;
    }

    paragraphs.push({
      index,
      start,
      end,
      text,
      heading: currentHeading
    });
    index += 1;
  }

  return paragraphs;
}

function buildParagraphWindows(paragraphs, size, overlap) {
  const safeSize = Math.max(1, Number(size) || 4);
  const safeOverlap = Math.max(0, Math.min(safeSize - 1, Number(overlap) || 0));
  const step = Math.max(1, safeSize - safeOverlap);
  const windows = [];

  for (let start = 0; start < paragraphs.length; start += step) {
    const selected = paragraphs.slice(start, start + safeSize);
    if (selected.length === 0) {
      break;
    }
    windows.push({
      id: `w-${windows.length + 1}`,
      paragraphIndexes: selected.map((paragraph) => paragraph.index),
      startOffset: selected[0].start,
      endOffset: selected[selected.length - 1].end,
      text: selected
        .map((paragraph) => `[${paragraph.index}] ${paragraph.text}`)
        .join("\n\n")
    });
    if (start + safeSize >= paragraphs.length) {
      break;
    }
  }

  return windows;
}

function mergeTermCandidates(candidates, maxTerms) {
  const byTerm = new Map();
  for (const candidate of candidates || []) {
    const term = String(candidate && candidate.term ? candidate.term : "").trim();
    const normalized = normalizeTerm(term);
    if (!normalized || normalized.length < 3) {
      continue;
    }
    const existing = byTerm.get(normalized) || {
      term,
      normalizedTerm: normalized,
      aliases: [],
      reason: "",
      importance: 0,
      frequency: 0,
      paragraphIndexes: []
    };
    existing.frequency += 1;
    existing.importance = Math.max(existing.importance, Number(candidate.importance) || 1);
    if (!existing.reason && candidate.reason) {
      existing.reason = String(candidate.reason);
    }
    for (const alias of candidate.aliases || []) {
      const normalizedAlias = normalizeTerm(alias);
      if (normalizedAlias && normalizedAlias !== normalized && !existing.aliases.includes(alias)) {
        existing.aliases.push(String(alias));
      }
    }
    for (const paragraphIndex of candidate.paragraphIndexes || []) {
      if (Number.isFinite(paragraphIndex) && !existing.paragraphIndexes.includes(paragraphIndex)) {
        existing.paragraphIndexes.push(paragraphIndex);
      }
    }
    byTerm.set(normalized, existing);
  }

  return Array.from(byTerm.values())
    .map((candidate) => ({
      ...candidate,
      score: candidate.importance * 10 + candidate.frequency * 2 + candidate.paragraphIndexes.length
    }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, Math.max(1, Number(maxTerms) || 40));
}

function isBoundary(text, index) {
  if (index < 0 || index >= text.length) {
    return true;
  }
  return !WORD_BOUNDARY_RE.test(text[index]);
}

function findAliasOccurrences(markdown, alias) {
  const normalizedAlias = normalizeTerm(alias);
  if (!normalizedAlias) {
    return [];
  }
  const haystack = markdown.toLowerCase();
  const needle = String(alias).toLowerCase();
  const occurrences = [];
  let index = 0;

  while ((index = haystack.indexOf(needle, index)) !== -1) {
    const end = index + needle.length;
    if (isBoundary(haystack, index - 1) && isBoundary(haystack, end)) {
      occurrences.push({
        start: index,
        end,
        text: markdown.slice(index, end)
      });
    }
    index = end;
  }

  return occurrences;
}

function findTermOccurrences(markdown, term, aliases) {
  const allAliases = [term, ...(aliases || [])].filter(Boolean);
  const seen = new Set();
  const occurrences = [];

  for (const alias of allAliases) {
    for (const occurrence of findAliasOccurrences(markdown, alias)) {
      const key = `${occurrence.start}:${occurrence.end}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      occurrences.push({ ...occurrence, alias });
    }
  }

  return occurrences.sort((a, b) => a.start - b.start);
}

function findParagraphForOffset(paragraphs, offset) {
  return paragraphs.find((paragraph) => paragraph.start <= offset && paragraph.end >= offset) || null;
}

function excerptAround(markdown, start, end, radius) {
  const safeRadius = Number(radius) || 500;
  const from = Math.max(0, start - safeRadius);
  const to = Math.min(markdown.length, end + safeRadius);
  return stripMarkdown(markdown.slice(from, to)).slice(0, safeRadius * 2);
}

function buildContextClusters(markdown, paragraphs, termCandidate, maxClusters) {
  const occurrences = findTermOccurrences(markdown, termCandidate.term, termCandidate.aliases);
  const byLabel = new Map();

  for (const occurrence of occurrences) {
    const paragraph = findParagraphForOffset(paragraphs, occurrence.start);
    if (!paragraph) {
      continue;
    }
    const label = paragraph.heading || `Paragraphs ${Math.max(0, paragraph.index - 1)}-${paragraph.index + 1}`;
    const key = paragraph.heading ? `heading:${paragraph.heading}` : `paragraph:${paragraph.index}`;
    const existing = byLabel.get(key) || {
      id: `cluster-${byLabel.size + 1}`,
      label,
      paragraphIndexes: [],
      startOffset: occurrence.start,
      endOffset: occurrence.end,
      excerpt: "",
      occurrenceCount: 0
    };
    existing.startOffset = Math.min(existing.startOffset, occurrence.start);
    existing.endOffset = Math.max(existing.endOffset, occurrence.end);
    existing.occurrenceCount += 1;

    const related = paragraph.heading
      ? paragraphs.filter((item) => item.heading === paragraph.heading)
      : paragraphs.filter((item) => Math.abs(item.index - paragraph.index) <= 1);
    for (const item of related) {
      if (!existing.paragraphIndexes.includes(item.index)) {
        existing.paragraphIndexes.push(item.index);
      }
      existing.startOffset = Math.min(existing.startOffset, item.start);
      existing.endOffset = Math.max(existing.endOffset, item.end);
    }
    existing.excerpt = excerptAround(markdown, existing.startOffset, existing.endOffset, 800);
    byLabel.set(key, existing);
  }

  const clusters = Array.from(byLabel.values())
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.startOffset - b.startOffset)
    .slice(0, Math.max(1, Number(maxClusters) || 5));

  if (clusters.length > 0) {
    return clusters.sort((a, b) => a.startOffset - b.startOffset);
  }

  return [{
    id: "cluster-1",
    label: "Paper context",
    paragraphIndexes: paragraphs.slice(0, 3).map((paragraph) => paragraph.index),
    startOffset: paragraphs[0] ? paragraphs[0].start : 0,
    endOffset: paragraphs[2] ? paragraphs[2].end : (paragraphs[0] ? paragraphs[0].end : 0),
    excerpt: paragraphs.slice(0, 3).map((paragraph) => paragraph.text).join("\n\n"),
    occurrenceCount: 0
  }];
}

function chooseClusterForOffset(entry, offset) {
  const clusters = entry && Array.isArray(entry.clusters) ? entry.clusters : [];
  if (clusters.length === 0) {
    return null;
  }
  const containing = clusters.find((cluster) => cluster.startOffset <= offset && cluster.endOffset >= offset);
  if (containing) {
    return containing;
  }
  return clusters
    .slice()
    .sort((a, b) => Math.abs(a.startOffset - offset) - Math.abs(b.startOffset - offset))[0];
}

function jsonCandidateFromText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw;
}

function parseJsonFromText(text) {
  const candidate = jsonCandidateFromText(text);
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = candidate.indexOf("[");
    const arrayEnd = candidate.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    }
    throw new Error("The model did not return parseable JSON.");
  }
}

function parseLooseJsonFromText(text) {
  try {
    return parseJsonFromText(text);
  } catch (error) {
    const repaired = escapeBareQuotesInJsonStrings(jsonCandidateFromText(text));
    try {
      return JSON.parse(repaired);
    } catch (_) {
      throw error;
    }
  }
}

function escapeBareQuotesInJsonStrings(text) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (!inString) {
      output += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      const next = nextNonWhitespace(text, index + 1);
      if (!next || next === "," || next === "}" || next === "]" || next === ":") {
        output += char;
        inString = false;
      } else {
        output += "\\\"";
      }
      continue;
    }

    output += char;
  }

  return output;
}

function nextNonWhitespace(text, start) {
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (!/\s/.test(char)) {
      return char;
    }
  }
  return "";
}

function yamlScalar(value) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value == null ? "" : value);
}

function parseYamlScalar(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return trimmed.replace(/^"|"$/g, "");
    }
  }
  return trimmed;
}

function buildGlossaryMarkdown(entry) {
  const clusters = Array.isArray(entry.clusters) ? entry.clusters : [];
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  const frontmatter = {
    term: entry.term,
    normalizedTerm: normalizeTerm(entry.term),
    aliases,
    sourcePaper: entry.sourcePaper || "",
    provider: entry.provider || "",
    model: entry.model || "",
    created: entry.created || new Date().toISOString(),
    updated: entry.updated || new Date().toISOString(),
    firstUse: entry.firstUse || "",
    definition: entry.definition || "",
    authorUsage: entry.authorUsage || "",
    sep_enabled: false,
    clusters
  };

  const frontmatterText = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
    .join("\n");

  const usageNotes = clusters
    .map((cluster) => {
      const note = cluster.usageNote || "";
      return `### ${cluster.label || cluster.id}\n\n${note || "No passage-specific note generated yet."}`;
    })
    .join("\n\n");

  return `---\n${frontmatterText}\n---\n\n# ${entry.term}\n\n${entry.definition || ""}\n\n## Author usage\n\n${entry.authorUsage || ""}\n\n## First use\n\n${entry.firstUse || "No reliable first definition identified in the supplied context."}\n\n## Usage notes\n\n${usageNotes}\n`;
}

function parseGlossaryMarkdown(markdown) {
  const match = String(markdown || "").match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }
  const data = {};
  for (const line of match[1].split("\n")) {
    const item = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!item) {
      continue;
    }
    data[item[1]] = parseYamlScalar(item[2]);
  }
  if (!data.term && !data.normalizedTerm) {
    return null;
  }
  return {
    term: data.term || data.normalizedTerm,
    normalizedTerm: data.normalizedTerm || normalizeTerm(data.term),
    aliases: Array.isArray(data.aliases) ? data.aliases : [],
    sourcePaper: data.sourcePaper || "",
    provider: data.provider || "",
    model: data.model || "",
    created: data.created || "",
    updated: data.updated || "",
    firstUse: data.firstUse || "",
    definition: data.definition || "",
    authorUsage: data.authorUsage || "",
    clusters: Array.isArray(data.clusters) ? data.clusters : [],
    sep_enabled: Boolean(data.sep_enabled)
  };
}

function collectEntryTerms(entry) {
  const terms = [entry.term, ...(entry.aliases || [])]
    .map((term) => String(term || "").trim())
    .filter(Boolean);
  return Array.from(new Set(terms));
}

function findPreparedTermAtPosition(lineText, position, entries) {
  const candidates = [];
  for (const entry of entries || []) {
    for (const term of collectEntryTerms(entry)) {
      candidates.push({ term, entry });
    }
  }
  candidates.sort((a, b) => b.term.length - a.term.length);

  const lowerLine = String(lineText || "").toLowerCase();
  const relativePosition = Number(position) || 0;
  for (const candidate of candidates) {
    const needle = candidate.term.toLowerCase();
    if (!needle) {
      continue;
    }
    let index = 0;
    while ((index = lowerLine.indexOf(needle, index)) !== -1) {
      const end = index + needle.length;
      if (relativePosition >= index && relativePosition <= end && isBoundary(lowerLine, index - 1) && isBoundary(lowerLine, end)) {
        return {
          term: candidate.term,
          entry: candidate.entry,
          from: index,
          to: end
        };
      }
      index = end;
    }
  }
  return null;
}

function findWordAtPosition(lineText, position) {
  const text = String(lineText || "");
  let from = Math.max(0, Math.min(text.length, Number(position) || 0));
  let to = from;

  while (from > 0 && /[A-Za-z-]/.test(text[from - 1])) {
    from -= 1;
  }
  while (to < text.length && /[A-Za-z-]/.test(text[to])) {
    to += 1;
  }

  const word = text.slice(from, to).trim();
  if (word.length < 5) {
    return null;
  }
  return { word, from, to };
}

function analyzeMarkdownQuality(markdown) {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  const controlChars = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
  const mojibakeMarks = (text.match(/(?:â.|Ã.|Â.|ð|Ñ|ă|ĺ|ď|§|¶)/g) || []).length;
  const replacementChars = (text.match(/\uFFFD/g) || []).length;
  const cidRefs = (text.match(/\(cid:\d+\)/g) || []).length;
  const boxedFormulaMarks = (text.match(/\\boxed\s*\{/g) || []).length;
  const suspiciousFormulaMarks = (text.match(/\b6=|ConT p|gp\(|Ñ|ðñ|\(cid:\d+\)|\\boxed\s*\{/g) || []).length;
  const mathSymbols = (text.match(/[□◇◻⊢⊨→↔¬∧∨∀∃λβηφψΓΣ≤≥≠∈∉⊂⊆⊥]/g) || []).length;
  const longAlphaRuns = (text.match(/[A-Za-z]{24,}/g) || []).length;
  const markdownTableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const avgLineLength = nonEmptyLines.length
    ? Math.round(nonEmptyLines.reduce((sum, line) => sum + line.length, 0) / nonEmptyLines.length)
    : 0;

  const warnings = [];
  if (cidRefs > 0) {
    warnings.push(`${cidRefs} PDF CID placeholder(s), often failed math or symbol extraction.`);
  }
  if (boxedFormulaMarks > 0) {
    warnings.push(`${boxedFormulaMarks} \\boxed{...} expression(s); verify modal boxes were not misread as boxing notation.`);
  }
  if (controlChars > 0) {
    warnings.push(`${controlChars} control character(s), often failed TeX symbol extraction.`);
  }
  if (mojibakeMarks > 0 || replacementChars > 0) {
    warnings.push(`${mojibakeMarks + replacementChars} encoding anomaly marker(s).`);
  }
  if (longAlphaRuns > 0) {
    warnings.push(`${longAlphaRuns} long unspaced alphabetic run(s), often layout or word-boundary loss.`);
  }
  if (markdownTableLines > 30) {
    warnings.push(`${markdownTableLines} Markdown table-like line(s), often layout fragments in prose PDFs.`);
  }

  const riskScore = cidRefs * 4
    + boxedFormulaMarks * 3
    + controlChars * 4
    + mojibakeMarks * 2
    + replacementChars * 4
    + suspiciousFormulaMarks * 2
    + Math.min(longAlphaRuns, 50)
    + Math.min(markdownTableLines, 100);
  const riskLevel = riskScore >= 80 ? "high" : riskScore >= 20 ? "medium" : warnings.length > 0 ? "low" : "ok";

  return {
    chars: text.length,
    lines: text ? lines.length : 0,
    controlChars,
    mojibakeMarks,
    replacementChars,
    cidRefs,
    boxedFormulaMarks,
    mathSymbols,
    suspiciousFormulaMarks,
    longAlphaRuns,
    markdownTableLines,
    avgLineLength,
    riskScore,
    riskLevel,
    warnings
  };
}

module.exports = {
  analyzeMarkdownQuality,
  buildContextClusters,
  buildGlossaryMarkdown,
  buildParagraphWindows,
  chooseClusterForOffset,
  collectEntryTerms,
  excerptAround,
  findPreparedTermAtPosition,
  findTermOccurrences,
  findWordAtPosition,
  getBaseName,
  getParentPath,
  mergeTermCandidates,
  normalizeTerm,
  parseGlossaryMarkdown,
  parseJsonFromText,
  parseLooseJsonFromText,
  slugify,
  splitParagraphs,
  stripFrontmatter,
  stripMarkdown
};
