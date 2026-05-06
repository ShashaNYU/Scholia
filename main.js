/* Scholia */
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core.js
var require_core = __commonJS({
  "src/core.js"(exports, module2) {
    "use strict";
    var WORD_BOUNDARY_RE = /[A-Za-z0-9_-]/;
    var SENTENCE_SEGMENTER = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "sentence" }) : null;
    var MIN_KEY_SENTENCE_PARAGRAPH_CHARS = 80;
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
      return String(value || "").replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\[[^\]]*]\([^)]*\)/g, (match) => {
        const label = match.match(/^\[([^\]]*)]/);
        return label ? label[1] : " ";
      }).replace(/\[\[([^\]|]+)(?:\|[^\]]+)?]]/g, "$1").replace(/`([^`]*)`/g, "$1").replace(/[*_~=#>]/g, " ").replace(/\s+/g, " ").trim();
    }
    function normalizeTerm2(term) {
      return stripMarkdown(term).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").replace(/\s+/g, " ").toLowerCase().trim();
    }
    function slugify2(value, fallback) {
      const slug = normalizeTerm2(value).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      return slug || fallback || "item";
    }
    function getParentPath2(vaultPath) {
      const normalized = String(vaultPath || "").replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      return idx === -1 ? "" : normalized.slice(0, idx);
    }
    function getBaseName2(vaultPath) {
      const name = String(vaultPath || "").split("/").pop() || "";
      return name.replace(/\.[^.]+$/, "");
    }
    function splitParagraphs2(markdown) {
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
          raw,
          text,
          heading: currentHeading
        });
        index += 1;
      }
      return paragraphs;
    }
    function buildParagraphWindows2(paragraphs, size, overlap) {
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
          text: selected.map((paragraph) => `[${paragraph.index}] ${paragraph.text}`).join("\n\n")
        });
        if (start + safeSize >= paragraphs.length) {
          break;
        }
      }
      return windows;
    }
    function paragraphIdForIndex(index) {
      return `p-${index}`;
    }
    function segmentSentences(text) {
      const raw = String(text || "");
      if (!raw) {
        return [];
      }
      if (SENTENCE_SEGMENTER && !raw.includes("==")) {
        return Array.from(SENTENCE_SEGMENTER.segment(raw), (item) => ({
          index: item.index,
          segment: item.segment
        }));
      }
      const segments = [];
      let start = 0;
      for (let index = 0; index < raw.length; index += 1) {
        if (!/[.!?]/.test(raw[index])) {
          continue;
        }
        let end = index + 1;
        while (end < raw.length) {
          if (raw.slice(end, end + 2) === "==") {
            end += 2;
            continue;
          }
          if (/["')\]]/.test(raw[end])) {
            end += 1;
            continue;
          }
          break;
        }
        if (end < raw.length && !/\s/.test(raw[end])) {
          continue;
        }
        while (end < raw.length && /\s/.test(raw[end])) {
          end += 1;
        }
        segments.push({
          index: start,
          segment: raw.slice(start, end)
        });
        start = end;
      }
      if (start < raw.length) {
        segments.push({
          index: start,
          segment: raw.slice(start)
        });
      }
      return segments;
    }
    function normalizeSentenceText(value) {
      return stripMarkdown(value).replace(/\s+/g, " ").trim().toLowerCase();
    }
    function splitParagraphSentences(markdown, paragraph) {
      if (!paragraph || !Number.isFinite(paragraph.start) || !Number.isFinite(paragraph.end)) {
        return [];
      }
      const rawParagraph = String(markdown || "").slice(paragraph.start, paragraph.end);
      const paragraphId = paragraphIdForIndex(paragraph.index);
      const sentences = [];
      for (const item of segmentSentences(rawParagraph)) {
        let start = item.index;
        let end = item.index + item.segment.length;
        while (start < end && /\s/.test(rawParagraph[start])) {
          start += 1;
        }
        while (end > start && /\s/.test(rawParagraph[end - 1])) {
          end -= 1;
        }
        if (end <= start) {
          continue;
        }
        const rawText = rawParagraph.slice(start, end);
        const text = stripMarkdown(rawText).replace(/\s+/g, " ").trim();
        if (text.length < 20) {
          continue;
        }
        sentences.push({
          id: `${paragraphId}-s-${sentences.length + 1}`,
          paragraphId,
          paragraphIndex: paragraph.index,
          startOffset: paragraph.start + start,
          endOffset: paragraph.start + end,
          rawText,
          text
        });
      }
      return sentences;
    }
    function buildKeySentenceParagraphs2(markdown, paragraphs, minParagraphChars) {
      const safeMinParagraphChars = Math.max(40, Number(minParagraphChars) || MIN_KEY_SENTENCE_PARAGRAPH_CHARS);
      const candidates = [];
      for (const paragraph of paragraphs || []) {
        if (!paragraph || String(paragraph.text || "").length < safeMinParagraphChars) {
          continue;
        }
        const sentences = splitParagraphSentences(markdown, paragraph).filter((sentence) => !String(sentence.rawText || "").includes("=="));
        if (sentences.length < 2) {
          continue;
        }
        candidates.push({
          id: paragraphIdForIndex(paragraph.index),
          paragraphIndex: paragraph.index,
          heading: paragraph.heading || "",
          text: paragraph.text,
          startOffset: paragraph.start,
          endOffset: paragraph.end,
          sentences
        });
      }
      return candidates;
    }
    function mergeTermCandidates2(candidates, maxTerms) {
      const byTerm = /* @__PURE__ */ new Map();
      for (const candidate of candidates || []) {
        const term = String(candidate && candidate.term ? candidate.term : "").trim();
        const normalized = normalizeTerm2(term);
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
          const normalizedAlias = normalizeTerm2(alias);
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
      return Array.from(byTerm.values()).map((candidate) => ({
        ...candidate,
        score: candidate.importance * 10 + candidate.frequency * 2 + candidate.paragraphIndexes.length
      })).sort((a, b) => b.score - a.score || a.term.localeCompare(b.term)).slice(0, Math.max(1, Number(maxTerms) || 40));
    }
    function isBoundary(text, index) {
      if (index < 0 || index >= text.length) {
        return true;
      }
      return !WORD_BOUNDARY_RE.test(text[index]);
    }
    function findAliasOccurrences(markdown, alias) {
      const normalizedAlias = normalizeTerm2(alias);
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
    function findTermOccurrences2(markdown, term, aliases) {
      const allAliases = [term, ...aliases || []].filter(Boolean);
      const seen = /* @__PURE__ */ new Set();
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
    function excerptAround2(markdown, start, end, radius) {
      const safeRadius = Number(radius) || 500;
      const from = Math.max(0, start - safeRadius);
      const to = Math.min(markdown.length, end + safeRadius);
      return stripMarkdown(markdown.slice(from, to)).slice(0, safeRadius * 2);
    }
    function buildContextClusters2(markdown, paragraphs, termCandidate, maxClusters) {
      const occurrences = findTermOccurrences2(markdown, termCandidate.term, termCandidate.aliases);
      const byLabel = /* @__PURE__ */ new Map();
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
        const related = paragraph.heading ? paragraphs.filter((item) => item.heading === paragraph.heading) : paragraphs.filter((item) => Math.abs(item.index - paragraph.index) <= 1);
        for (const item of related) {
          if (!existing.paragraphIndexes.includes(item.index)) {
            existing.paragraphIndexes.push(item.index);
          }
          existing.startOffset = Math.min(existing.startOffset, item.start);
          existing.endOffset = Math.max(existing.endOffset, item.end);
        }
        existing.excerpt = excerptAround2(markdown, existing.startOffset, existing.endOffset, 800);
        byLabel.set(key, existing);
      }
      const clusters = Array.from(byLabel.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.startOffset - b.startOffset).slice(0, Math.max(1, Number(maxClusters) || 5));
      if (clusters.length > 0) {
        return clusters.sort((a, b) => a.startOffset - b.startOffset);
      }
      return [{
        id: "cluster-1",
        label: "Paper context",
        paragraphIndexes: paragraphs.slice(0, 3).map((paragraph) => paragraph.index),
        startOffset: paragraphs[0] ? paragraphs[0].start : 0,
        endOffset: paragraphs[2] ? paragraphs[2].end : paragraphs[0] ? paragraphs[0].end : 0,
        excerpt: paragraphs.slice(0, 3).map((paragraph) => paragraph.text).join("\n\n"),
        occurrenceCount: 0
      }];
    }
    function chooseClusterForOffset2(entry, offset) {
      const clusters = entry && Array.isArray(entry.clusters) ? entry.clusters : [];
      if (clusters.length === 0) {
        return null;
      }
      const containing = clusters.find((cluster) => cluster.startOffset <= offset && cluster.endOffset >= offset);
      if (containing) {
        return containing;
      }
      return clusters.slice().sort((a, b) => Math.abs(a.startOffset - offset) - Math.abs(b.startOffset - offset))[0];
    }
    function isWrappedSentenceHighlight(text) {
      const raw = String(text || "");
      return raw.startsWith("==") && raw.endsWith("==") && raw.length > 4;
    }
    function applySentenceHighlights2(markdown, sentences) {
      let output = String(markdown || "");
      const seen = /* @__PURE__ */ new Set();
      const ordered = (Array.isArray(sentences) ? sentences : []).filter((sentence) => sentence && Number.isFinite(sentence.startOffset) && Number.isFinite(sentence.endOffset)).filter((sentence) => {
        const key = `${sentence.startOffset}:${sentence.endOffset}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      }).sort((a, b) => b.startOffset - a.startOffset);
      for (const sentence of ordered) {
        const snippet = output.slice(sentence.startOffset, sentence.endOffset);
        if (!snippet) {
          continue;
        }
        if (isWrappedSentenceHighlight(snippet) || snippet.includes("==")) {
          continue;
        }
        output = `${output.slice(0, sentence.startOffset)}==${snippet}==${output.slice(sentence.endOffset)}`;
      }
      return output;
    }
    function removeManagedSentenceHighlights2(markdown, records) {
      const source = String(markdown || "");
      if (!Array.isArray(records) || records.length === 0) {
        return source;
      }
      const byParagraph = /* @__PURE__ */ new Map();
      for (const record of records) {
        const paragraphIndex = Number(record && record.paragraphIndex);
        const text = normalizeSentenceText(record && record.text);
        if (!Number.isFinite(paragraphIndex) || !text) {
          continue;
        }
        const existing = byParagraph.get(paragraphIndex) || [];
        existing.push(text);
        byParagraph.set(paragraphIndex, existing);
      }
      const matches = [];
      for (const paragraph of splitParagraphs2(source)) {
        const targets = byParagraph.get(paragraph.index);
        if (!targets || targets.length === 0) {
          continue;
        }
        const remaining = targets.slice();
        for (const sentence of splitParagraphSentences(source, paragraph)) {
          if (!isWrappedSentenceHighlight(sentence.rawText)) {
            continue;
          }
          const normalized = normalizeSentenceText(sentence.text);
          const targetIndex = remaining.indexOf(normalized);
          if (targetIndex === -1) {
            continue;
          }
          remaining.splice(targetIndex, 1);
          matches.push(sentence);
        }
      }
      let output = source;
      matches.sort((a, b) => b.startOffset - a.startOffset).forEach((sentence) => {
        const snippet = output.slice(sentence.startOffset, sentence.endOffset);
        if (!isWrappedSentenceHighlight(snippet)) {
          return;
        }
        output = `${output.slice(0, sentence.startOffset)}${snippet.slice(2, -2)}${output.slice(sentence.endOffset)}`;
      });
      return output;
    }
    function jsonCandidateFromText(text) {
      const raw = String(text || "").trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      return fenced ? fenced[1].trim() : raw;
    }
    function parseJsonFromText2(text) {
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
    function parseLooseJsonFromText2(text) {
      try {
        return parseJsonFromText2(text);
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
          if (char === '"') {
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
        if (char === '"') {
          const next = nextNonWhitespace(text, index + 1);
          if (!next || next === "," || next === "}" || next === "]" || next === ":") {
            output += char;
            inString = false;
          } else {
            output += '\\"';
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
      if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith('"')) {
        try {
          return JSON.parse(trimmed);
        } catch (_) {
          return trimmed.replace(/^"|"$/g, "");
        }
      }
      return trimmed;
    }
    function buildGlossaryMarkdown2(entry) {
      const clusters = Array.isArray(entry.clusters) ? entry.clusters : [];
      const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
      const sep2 = normalizeSepEntry(entry.sep);
      const sepEnabled = sep2 ? sep2.status === "matched" : Boolean(entry.sep_enabled);
      const frontmatter = {
        term: entry.term,
        normalizedTerm: normalizeTerm2(entry.term),
        aliases,
        sourcePaper: entry.sourcePaper || "",
        provider: entry.provider || "",
        model: entry.model || "",
        created: entry.created || (/* @__PURE__ */ new Date()).toISOString(),
        updated: entry.updated || (/* @__PURE__ */ new Date()).toISOString(),
        definition: entry.definition || "",
        sep_enabled: sepEnabled,
        ...sep2 ? { sep: sep2 } : {},
        clusters
      };
      const frontmatterText = Object.entries(frontmatter).map(([key, value]) => `${key}: ${yamlScalar(value)}`).join("\n");
      const usageNotes = clusters.map((cluster) => {
        const note = cluster.usageNote || "";
        return `### ${cluster.label || cluster.id}

${note || "No passage-specific note generated yet."}`;
      }).join("\n\n");
      const sections = [
        `---
${frontmatterText}
---`,
        `# ${entry.term}`,
        entry.definition || ""
      ];
      if (sep2) {
        sections.push("## SEP");
        if (sep2.status === "matched") {
          sections.push(sep2.summary || "SEP summary cached but empty.");
          if (sep2.entryUrl) {
            const label = sep2.entryTitle || "SEP entry";
            sections.push(`Source: [${label}](${sep2.entryUrl})`);
          }
          if (sep2.revised) {
            sections.push(`Revised: ${sep2.revised}`);
          }
        } else if (sep2.status === "not_found") {
          sections.push("No SEP entry matched this term.");
        } else {
          sections.push(`SEP enrichment failed.${sep2.error ? ` ${sep2.error}` : ""}`.trim());
        }
      }
      sections.push("## Usage notes");
      sections.push(usageNotes);
      return `${sections.join("\n\n")}
`;
    }
    function parseGlossaryMarkdown2(markdown) {
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
      const sep2 = normalizeSepEntry(data.sep);
      return {
        term: data.term || data.normalizedTerm,
        normalizedTerm: data.normalizedTerm || normalizeTerm2(data.term),
        aliases: Array.isArray(data.aliases) ? data.aliases : [],
        sourcePaper: data.sourcePaper || "",
        provider: data.provider || "",
        model: data.model || "",
        created: data.created || "",
        updated: data.updated || "",
        definition: data.definition || "",
        clusters: Array.isArray(data.clusters) ? data.clusters : [],
        sep: sep2,
        sep_enabled: sep2 ? sep2.status === "matched" : Boolean(data.sep_enabled)
      };
    }
    function normalizeSepEntry(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const status = String(value.status || "").trim();
      if (!status) {
        return null;
      }
      return {
        status: status === "matched" || status === "not_found" || status === "failed" ? status : "failed",
        query: String(value.query || ""),
        entryTitle: String(value.entryTitle || ""),
        entryUrl: String(value.entryUrl || ""),
        summary: String(value.summary || ""),
        sourceExcerpt: String(value.sourceExcerpt || ""),
        revised: String(value.revised || ""),
        fetchedAt: String(value.fetchedAt || ""),
        error: String(value.error || "")
      };
    }
    function collectEntryTerms(entry) {
      const terms = [entry.term, ...entry.aliases || []].map((term) => String(term || "").trim()).filter(Boolean);
      return Array.from(new Set(terms));
    }
    function findPreparedTermAtPosition2(lineText, position, entries) {
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
    function findWordAtPosition2(lineText, position) {
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
    function analyzeMarkdownQuality2(markdown) {
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
      const avgLineLength = nonEmptyLines.length ? Math.round(nonEmptyLines.reduce((sum, line) => sum + line.length, 0) / nonEmptyLines.length) : 0;
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
      const riskScore = cidRefs * 4 + boxedFormulaMarks * 3 + controlChars * 4 + mojibakeMarks * 2 + replacementChars * 4 + suspiciousFormulaMarks * 2 + Math.min(longAlphaRuns, 50) + Math.min(markdownTableLines, 100);
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
    module2.exports = {
      analyzeMarkdownQuality: analyzeMarkdownQuality2,
      applySentenceHighlights: applySentenceHighlights2,
      buildContextClusters: buildContextClusters2,
      buildGlossaryMarkdown: buildGlossaryMarkdown2,
      buildKeySentenceParagraphs: buildKeySentenceParagraphs2,
      buildParagraphWindows: buildParagraphWindows2,
      chooseClusterForOffset: chooseClusterForOffset2,
      collectEntryTerms,
      excerptAround: excerptAround2,
      findPreparedTermAtPosition: findPreparedTermAtPosition2,
      findTermOccurrences: findTermOccurrences2,
      findWordAtPosition: findWordAtPosition2,
      getBaseName: getBaseName2,
      getParentPath: getParentPath2,
      mergeTermCandidates: mergeTermCandidates2,
      normalizeTerm: normalizeTerm2,
      parseGlossaryMarkdown: parseGlossaryMarkdown2,
      parseJsonFromText: parseJsonFromText2,
      parseLooseJsonFromText: parseLooseJsonFromText2,
      removeManagedSentenceHighlights: removeManagedSentenceHighlights2,
      slugify: slugify2,
      splitParagraphSentences,
      splitParagraphs: splitParagraphs2,
      stripFrontmatter,
      stripMarkdown
    };
  }
});

// src/sep.js
var require_sep = __commonJS({
  "src/sep.js"(exports, module2) {
    "use strict";
    var { normalizeTerm: normalizeTerm2 } = require_core();
    var SEP_SEARCH_ENDPOINT = "https://plato.stanford.edu/searcher.py";
    var SEP_ENTRY_SUFFIX = /^https:\/\/plato\.stanford\.edu\/entries\/.+\/$/;
    var SEP_RESULT_LIMIT = 5;
    var SEP_DISAMBIGUATION_LIMIT = 3;
    var SEP_CLEAR_SCORE = 90;
    var SEP_CLEAR_SCORE_GAP = 15;
    async function requestSepText(url) {
      const { requestUrl: requestUrl2 } = require("obsidian");
      const response = await requestUrl2({
        url,
        method: "GET",
        throw: false,
        headers: {
          Accept: "text/html,application/xhtml+xml"
        }
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`SEP request failed (${response.status}): ${String(response.text || "").slice(0, 280)}`);
      }
      return String(response.text || "");
    }
    async function searchSep2(query) {
      const html = await requestSepText(`${SEP_SEARCH_ENDPOINT}?query=${encodeURIComponent(String(query || "").trim())}`);
      return parseSepSearchResults(html).slice(0, SEP_RESULT_LIMIT);
    }
    async function fetchSepEntry2(url) {
      const html = await requestSepText(url);
      return parseSepEntryHtml(html, url);
    }
    function parseSepSearchResults(html) {
      const source = String(html || "");
      if (!source.trim() || /No documents found/.test(source)) {
        return [];
      }
      const blocks = source.match(/<div class="result_listing">[\s\S]*?<\/div><!-- end result_listing -->/g) || [];
      const results = [];
      for (const block of blocks) {
        const titleHtml = firstCapture(block, /<div class="result_title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i, 2);
        const titleHref = firstCapture(block, /<div class="result_title">\s*<a[^>]*href="([^"]+)"[^>]*>/i, 1);
        const resultUrl = stripHtml(firstCapture(block, /<div class="result_url">\s*<a[^>]*>([\s\S]*?)<\/a>/i, 1));
        const snippet = stripHtml(firstCapture(block, /<div class="result_snippet">\s*([\s\S]*?)<\/div><!-- end result_snippet -->/i, 1));
        const title = stripHtml(titleHtml);
        const url = canonicalizeSepUrl(resultUrl, titleHref);
        if (!title || !url) {
          continue;
        }
        results.push({
          title,
          url,
          snippet,
          normalizedTitle: normalizeTerm2(title)
        });
      }
      return results;
    }
    function parseSepEntryHtml(html, sourceUrl = "") {
      const source = String(html || "");
      const title = stripHtml(firstCapture(source, /<h1[^>]*>([\s\S]*?)<\/h1>/i, 1));
      const preambleHtml = firstCapture(
        source,
        /<div id="preamble">([\s\S]*?)<\/div>\s*(?:<div id="toc">|<\/div>\s*<div id="toc">)/i,
        1
      ) || firstCapture(source, /<div id="preamble">([\s\S]*?)<\/div>/i, 1);
      const paragraphs = Array.from(preambleHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (match) => stripHtml(match[1])).map((paragraph) => paragraph.trim()).filter(Boolean);
      const revised = firstCapture(source, /<meta name="DCTERMS\.modified" content="([^"]+)"/i, 1) || firstCapture(source, /<meta property="citation_publication_date" content="([^"]+)"/i, 1) || "";
      const preamble = paragraphs.join("\n\n").trim();
      const sourceExcerpt = paragraphs.slice(0, 2).join("\n\n").trim() || preamble;
      return {
        title,
        sourceUrl: sanitizeSepUrl(sourceUrl),
        revised,
        paragraphs,
        preamble,
        sourceExcerpt
      };
    }
    function rankSepCandidates(candidates, term, aliases) {
      return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
        ...candidate,
        score: scoreSepCandidate(candidate, term, aliases)
      })).sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.title.localeCompare(right.title);
      });
    }
    function pickSepCandidateHeuristically2(candidates, term, aliases) {
      const ranked = rankSepCandidates(candidates, term, aliases);
      const best = ranked[0] || null;
      const second = ranked[1] || null;
      const exactMatch = best && isExactSepTitleMatch(best, term, aliases);
      const clearWinner = best && best.score >= SEP_CLEAR_SCORE && (!second || best.score - second.score >= SEP_CLEAR_SCORE_GAP);
      return {
        candidate: exactMatch || clearWinner ? best : null,
        candidates: ranked.slice(0, SEP_DISAMBIGUATION_LIMIT)
      };
    }
    function scoreSepCandidate(candidate, term, aliases) {
      const title = normalizeTerm2(candidate && candidate.title);
      const snippet = normalizeTerm2(candidate && candidate.snippet);
      const url = normalizeTerm2(urlSlug(candidate && candidate.url));
      const queries = uniqueNormalizedTerms([term, ...Array.isArray(aliases) ? aliases : []]);
      let score = 0;
      for (const query of queries) {
        if (!query) {
          continue;
        }
        if (title === query) {
          score = Math.max(score, 120);
          continue;
        }
        if (title.startsWith(`${query} `) || title.endsWith(` ${query}`)) {
          score = Math.max(score, 100);
        }
        if (title.includes(query)) {
          score = Math.max(score, 90);
        }
        if (url === query || url.includes(query.replace(/\s+/g, "-"))) {
          score = Math.max(score, 88);
        }
        if (containsAllWords(title, query)) {
          score = Math.max(score, 78);
        }
        if (containsAllWords(url, query)) {
          score = Math.max(score, 72);
        }
        if (containsAllWords(snippet, query)) {
          score = Math.max(score, 62);
        }
      }
      return score;
    }
    function isExactSepTitleMatch(candidate, term, aliases) {
      const title = normalizeTerm2(candidate && candidate.title);
      return uniqueNormalizedTerms([term, ...Array.isArray(aliases) ? aliases : []]).some((query) => query && query === title);
    }
    function stripHtml(value) {
      return decodeHtmlEntities(String(value || "")).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
    }
    function decodeHtmlEntities(value) {
      return String(value || "").replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16))).replace(/&#([0-9]+);/g, (_, num) => safeCodePoint(parseInt(num, 10))).replace(/&nbsp;/gi, " ").replace(/&ndash;/gi, "\u2013").replace(/&mdash;/gi, "\u2014").replace(/&hellip;/gi, "\u2026").replace(/&ldquo;/gi, "\u201C").replace(/&rdquo;/gi, "\u201D").replace(/&lsquo;/gi, "\u2018").replace(/&rsquo;/gi, "\u2019").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
    }
    function safeCodePoint(value) {
      if (!Number.isFinite(value) || value <= 0) {
        return "";
      }
      try {
        return String.fromCodePoint(value);
      } catch (_) {
        return "";
      }
    }
    function canonicalizeSepUrl(resultUrl, titleHref) {
      const direct = sanitizeSepUrl(resultUrl);
      if (direct) {
        return direct;
      }
      const href = String(titleHref || "");
      if (!href) {
        return "";
      }
      try {
        const parsed = new URL(href);
        const entry = parsed.searchParams.get("entry");
        if (entry && /^\/entries\/.+\/$/.test(entry)) {
          return `https://plato.stanford.edu${entry}`;
        }
      } catch (_) {
        return "";
      }
      return "";
    }
    function sanitizeSepUrl(value) {
      const raw = String(value || "").trim();
      if (!raw) {
        return "";
      }
      try {
        const url = new URL(raw);
        const normalized = `${url.origin}${url.pathname}`;
        return SEP_ENTRY_SUFFIX.test(normalized) ? normalized : "";
      } catch (_) {
        return "";
      }
    }
    function containsAllWords(haystack, needle) {
      const words = normalizeTerm2(needle).split(" ").filter(Boolean);
      if (words.length === 0) {
        return false;
      }
      return words.every((word) => String(haystack || "").includes(word));
    }
    function uniqueNormalizedTerms(values) {
      return Array.from(new Set((values || []).map((value) => normalizeTerm2(value)).filter(Boolean)));
    }
    function urlSlug(url) {
      try {
        return new URL(String(url || "")).pathname.replace(/^\/+|\/+$/g, "").replace(/^entries\//, "").replace(/\//g, " ");
      } catch (_) {
        return "";
      }
    }
    function firstCapture(text, pattern, index) {
      const match = String(text || "").match(pattern);
      return match ? String(match[index] || "") : "";
    }
    module2.exports = {
      fetchSepEntry: fetchSepEntry2,
      parseSepEntryHtml,
      parseSepSearchResults,
      pickSepCandidateHeuristically: pickSepCandidateHeuristically2,
      rankSepCandidates,
      scoreSepCandidate,
      searchSep: searchSep2,
      stripHtml
    };
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PhilosophyReaderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_child_process = require("child_process");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_util = require("util");
var import_view = require("@codemirror/view");
var import_obsidian2 = require("obsidian");
var import_core2 = __toESM(require_core());

// src/llmProviders.ts
var import_obsidian = require("obsidian");

// prompts/batch-explanation.md
var batch_explanation_default = 'You are writing concise hover glossary entries for a philosophy or humanities paper.\n\nThe user will read the paper in Obsidian. Your job is to explain each selected term in English, using the paper context rather than a generic dictionary definition.\n\nFor each term:\n- {{DEFINITION_REQUIREMENT}}\n- {{CLUSTER_REQUIREMENT}}\n- Do not mention SEP. SEP integration is disabled in this MVP.\n- Do not invent certainty. If the context is insufficient, say so briefly.\n- Paraphrase source passages instead of quoting them. Avoid quotation marks inside string values.\n\nReturn JSON only:\n{\n  "terms": [\n    {\n      "term": "canonical term",\n      "aliases": ["aliases"],\n      "definition": "definition grounded in the paper",\n      "clusters": [\n        {\n          "id": "cluster id from input",\n          "usageNote": "short contextual note"\n        }\n      ]\n    }\n  ]\n}\n\nThe value of "terms" must be an array, not a string containing JSON.\nDo not put JSON inside a string field.\n';

// prompts/fallback-explanation.md
var fallback_explanation_default = `You are writing a concise hover glossary entry for a philosophy or humanities paper.

Explain the selected term in English using the supplied surrounding context.

Requirements:
- {{DEFINITION_REQUIREMENT}}
- Ground the explanation in this paper's usage.
- {{CLUSTER_REQUIREMENT}}
- Do not mention SEP. SEP integration is disabled in this MVP.

Return JSON only:
{
  "term": "canonical term",
  "aliases": ["aliases"],
  "definition": "definition grounded in the paper",
  "clusters": [
    {
      "id": "fallback",
      "usageNote": "short contextual note"
    }
  ]
}
`;

// prompts/key-sentence-selection.md
var key_sentence_selection_default = 'You are helping prepare a philosophy or humanities paper for easier reading in Obsidian.\n\nTask: for each paragraph, choose sentences worth highlighting before the user reads the paper.\n\nThe input includes a `density` value:\n- `medium`: choose at most one sentence from a paragraph only when one sentence is clearly structurally important for following the argument. `medium` should still be conservative and omit most paragraphs.\n- `sparse`: be much more selective. Choose only sentences that state a central thesis, important definition, decisive objection, or major transition in the argument. Omit most paragraphs.\n\nPrefer sentences that do at least one of these:\n- State the main claim, local thesis, or decisive argumentative turn.\n- Introduce a key distinction, definition, objection, or methodological move that the reader is likely to need later.\n- Compress the paragraph\'s essential takeaway into one sentence without depending heavily on neighboring sentences.\n\nDo not choose a sentence when:\n- The paragraph is mostly setup, citation, transition, example, restatement, or low-information prose.\n- No single sentence is clearly more important than the rest.\n- The best sentence would be too fragmentary without its neighbors.\n- The sentence is merely helpful, elegant, or representative rather than structurally important.\n- The sentence mostly repeats the section heading, opens background context, or provides an example.\n- In `sparse` mode, the sentence is merely useful rather than structurally important.\n\nConstraints:\n- Return at most one sentence per paragraph.\n- Use only the provided `paragraphId` and `sentenceId` values.\n- Omit paragraphs where no sentence deserves highlighting.\n- If you are unsure, omit the paragraph.\n- In `medium` mode, do not try to find a highlight in every paragraph; most eligible paragraphs should still receive no highlight.\n- Do not quote or rewrite the sentence text.\n\nReturn JSON only:\n{\n  "paragraphs": [\n    {\n      "paragraphId": "p-3",\n      "sentenceId": "p-3-s-2"\n    }\n  ]\n}\n';

// prompts/sep-entry-selection.md
var sep_entry_selection_default = 'You are selecting the single most relevant Stanford Encyclopedia of Philosophy entry for a glossary term from a philosophy paper.\n\nUse the paper-local definition and passage notes to decide which candidate gives the best background article for this term.\n\nRequirements:\n- Prefer an exact or near-exact title match when it is genuinely relevant.\n- Do not choose a candidate just because one keyword overlaps.\n- If none of the candidates is relevant enough, return `matched: false`.\n- Keep the reason short and concrete.\n\nReturn JSON only:\n{\n  "matched": true,\n  "title": "candidate title",\n  "url": "https://plato.stanford.edu/entries/...",\n  "reason": "short reason"\n}\n';

// prompts/sep-summary.md
var sep_summary_default = 'You are writing a short SEP supplement for a cached hover glossary entry in a philosophy-reading plugin.\n\nUse the supplied SEP preamble to write exactly two English sentences.\n\nRequirements:\n- Write a definition-style supplement, not a generic review.\n- Complement the paper-local definition instead of replacing or contradicting it.\n- Do not repeat the local definition sentence-for-sentence.\n- Stay faithful to the supplied SEP preamble.\n- Do not use quotation marks.\n\nReturn JSON only:\n{\n  "summary": "Two concise sentences."\n}\n';

// prompts/term-discovery.md
var term_discovery_default = `You are helping prepare a philosophy or humanities paper for faster reading.

Task: identify terms in the provided paragraph window that are likely to need explanation for a reader of dense academic prose.

Choose terms that satisfy at least one of these:
- A philosophical, theoretical, historical, or methodological term of art.
- A phrase whose meaning depends on this author's argument.
- A repeated local concept, distinction, objection, principle, or named view.
- A compact phrase that is likely to block comprehension if misunderstood.

Do not choose:
- Ordinary vocabulary.
- Author names unless the name functions as a view or school.
- Bibliographic metadata, journal names, page numbers, or section labels.
- Terms that are too broad to explain usefully in context, unless the author is giving them a technical sense.

Return JSON only:
{
  "terms": [
    {
      "term": "canonical term",
      "aliases": ["optional alternative spellings or close variants"],
      "importance": 1-5,
      "reason": "short reason this term matters here",
      "paragraphIndexes": [0, 1]
    }
  ]
}

Return at most 12 terms for this paragraph window. Prefer fewer high-value terms over an exhaustive list.
Prefer multi-word terms when the multi-word phrase is the actual concept.
Use the paragraph indexes from the input.
`;

// src/llmProviders.ts
var import_core = __toESM(require_core());
var BaseProvider = class {
  constructor(explanationLength) {
    this.explanationLength = explanationLength;
  }
  async callJsonModel(systemPrompt, userPrompt, maxTokens, schema) {
    const text = await this.callModel(systemPrompt, userPrompt, maxTokens);
    return (0, import_core.parseJsonFromText)(text);
  }
  async discoverTerms(request) {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      window: request.window
    }, null, 2);
    const json = await this.callJsonModel(term_discovery_default, userPrompt, 2400, termDiscoverySchema);
    return readTermsArray(json, "Term discovery response");
  }
  async explainTerms(request) {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      terms: request.terms
    }, null, 2);
    const json = await this.callJsonModel(buildBatchExplanationPrompt(this.explanationLength), userPrompt, 5e3, batchExplanationSchema);
    return readTermsArray(json, "Batch explanation response");
  }
  async explainTermFallback(request) {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      term: request.terms[0]
    }, null, 2);
    const json = await this.callJsonModel(buildFallbackExplanationPrompt(this.explanationLength), userPrompt, 1800, fallbackExplanationSchema);
    if (!json || !json.term || !json.definition) {
      throw new Error("Fallback explanation response did not include a term definition.");
    }
    return json;
  }
  async selectKeySentences(request) {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      density: request.density,
      paragraphs: request.paragraphs
    }, null, 2);
    const json = await this.callJsonModel(key_sentence_selection_default, userPrompt, 2600, keySentenceSelectionSchema);
    return readArrayField(json, "paragraphs", "Key sentence selection response");
  }
  async chooseSepEntry(request) {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      term: request.term,
      aliases: request.aliases,
      definition: request.definition,
      clusters: request.clusters,
      candidates: request.candidates
    }, null, 2);
    const json = await this.callJsonModel(sep_entry_selection_default, userPrompt, 1800, sepEntrySelectionSchema);
    if (!json || typeof json.matched !== "boolean") {
      throw new Error("SEP entry selection response did not include a matched flag.");
    }
    return {
      matched: Boolean(json.matched),
      title: String(json.title || ""),
      url: String(json.url || ""),
      reason: String(json.reason || "")
    };
  }
  async summarizeSepEntry(request) {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      term: request.term,
      definition: request.definition,
      sepEntry: {
        title: request.entryTitle,
        url: request.entryUrl,
        preamble: request.preamble
      }
    }, null, 2);
    const json = await this.callJsonModel(sep_summary_default, userPrompt, 1200, sepSummarySchema);
    if (!json || typeof json.summary !== "string" || !json.summary.trim()) {
      throw new Error("SEP summary response did not include a summary string.");
    }
    return {
      summary: json.summary.trim()
    };
  }
};
function readArrayField(json, fieldName, context) {
  if (Array.isArray(json)) {
    return json;
  }
  if (!json || typeof json !== "object") {
    throw new Error(`${context} did not include a ${fieldName} array.`);
  }
  const value = json[fieldName];
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = (0, import_core.parseLooseJsonFromText)(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed[fieldName])) {
      return parsed[fieldName];
    }
  }
  throw new Error(`${context} did not include a ${fieldName} array.`);
}
function readTermsArray(json, context) {
  return readArrayField(json, "terms", context);
}
var OpenAIProvider = class extends BaseProvider {
  constructor(apiKey, model, explanationLength) {
    super(explanationLength);
    this.name = "openai";
    this.apiKey = apiKey;
    this.model = model;
  }
  async callModel(systemPrompt, userPrompt, maxTokens) {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is missing.");
    }
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://api.openai.com/v1/responses",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: maxTokens
      }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAI request failed (${response.status}): ${response.text.slice(0, 400)}`);
    }
    return extractOpenAIText(response.json);
  }
};
var AnthropicProvider = class extends BaseProvider {
  constructor(apiKey, model, explanationLength) {
    super(explanationLength);
    this.name = "anthropic";
    this.apiKey = apiKey;
    this.model = model;
  }
  async callJsonModel(systemPrompt, userPrompt, maxTokens, schema) {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is missing.");
    }
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: [
          {
            name: "return_json",
            description: "Return the requested structured JSON object.",
            input_schema: schema
          }
        ],
        tool_choice: {
          type: "tool",
          name: "return_json"
        },
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 404 && response.text.includes("not_found_error")) {
        throw new Error(`Anthropic model is not available for this API key: ${this.model}. Change the model in Scholia settings.`);
      }
      throw new Error(`Anthropic request failed (${response.status}): ${response.text.slice(0, 400)}`);
    }
    const responseJson = response.json;
    const toolInput = extractAnthropicToolInput(responseJson);
    if (responseJson.stop_reason === "max_tokens" && isEmptyObject(toolInput)) {
      throw new Error(`Anthropic response hit max_tokens (${maxTokens}) before returning structured JSON. Reduce the glossary window size or increase the output budget.`);
    }
    if (!toolInput) {
      return (0, import_core.parseJsonFromText)(extractAnthropicText(responseJson));
    }
    return toolInput;
  }
  async callModel(systemPrompt, userPrompt, maxTokens) {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is missing.");
    }
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 404 && response.text.includes("not_found_error")) {
        throw new Error(`Anthropic model is not available for this API key: ${this.model}. Try claude-3-5-sonnet-latest or change the model in Scholia settings.`);
      }
      throw new Error(`Anthropic request failed (${response.status}): ${response.text.slice(0, 400)}`);
    }
    return extractAnthropicText(response.json);
  }
};
function extractOpenAIText(json) {
  const response = json;
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        parts.push(content.text);
      }
    }
  }
  if (parts.length === 0) {
    throw new Error("OpenAI response did not contain output text.");
  }
  return parts.join("\n");
}
function extractAnthropicText(json) {
  const response = json;
  const text = (response.content || []).filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\n");
  if (!text.trim()) {
    throw new Error("Anthropic response did not contain text.");
  }
  return text;
}
function extractAnthropicToolInput(json) {
  const response = json;
  const toolUse = (response.content || []).find((item) => item.type === "tool_use" && item.name === "return_json");
  return toolUse && typeof toolUse === "object" && "input" in toolUse ? toolUse.input : null;
}
function isEmptyObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}
var explanationPromptVariants = {
  standard: {
    definitionRequirement: "Write a paper-level definition of about 80-120 words.",
    clusterRequirement: "Write one short usage note for each supplied context cluster. The usage note should explain what the term is doing in that passage or section."
  },
  brief: {
    definitionRequirement: "Write a concise definition of about 30-50 words that only explains the term's meaning in this paper.",
    clusterRequirement: "For each supplied context cluster, leave usageNote empty unless that passage materially changes the meaning; if needed, keep it to one very short sentence."
  }
};
function buildBatchExplanationPrompt(explanationLength) {
  return renderExplanationPrompt(batch_explanation_default, explanationLength);
}
function buildFallbackExplanationPrompt(explanationLength) {
  return renderExplanationPrompt(fallback_explanation_default, explanationLength);
}
function renderExplanationPrompt(template, explanationLength) {
  const variant = explanationPromptVariants[explanationLength] || explanationPromptVariants.standard;
  return template.replace("{{DEFINITION_REQUIREMENT}}", variant.definitionRequirement).replace("{{CLUSTER_REQUIREMENT}}", variant.clusterRequirement);
}
var termDiscoverySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    terms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          importance: { type: "number" },
          reason: { type: "string" },
          paragraphIndexes: { type: "array", items: { type: "number" } }
        },
        required: ["term", "aliases", "importance", "reason", "paragraphIndexes"]
      }
    }
  },
  required: ["terms"]
};
var explainedClusterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    usageNote: { type: "string" }
  },
  required: ["id", "usageNote"]
};
var explainedTermSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    term: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    definition: { type: "string" },
    clusters: { type: "array", items: explainedClusterSchema }
  },
  required: ["term", "aliases", "definition", "clusters"]
};
var chosenSepEntrySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched: { type: "boolean" },
    title: { type: "string" },
    url: { type: "string" },
    reason: { type: "string" }
  },
  required: ["matched", "title", "url", "reason"]
};
var sepSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" }
  },
  required: ["summary"]
};
var selectedKeySentenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    paragraphId: { type: "string" },
    sentenceId: { type: "string" }
  },
  required: ["paragraphId", "sentenceId"]
};
var keySentenceSelectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    paragraphs: {
      type: "array",
      items: selectedKeySentenceSchema
    }
  },
  required: ["paragraphs"]
};
var batchExplanationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    terms: {
      type: "array",
      items: explainedTermSchema
    }
  },
  required: ["terms"]
};
var fallbackExplanationSchema = explainedTermSchema;
var sepEntrySelectionSchema = chosenSepEntrySchema;
function createLLMProvider(settings) {
  if (settings.provider === "anthropic") {
    return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel, settings.glossaryExplanationLength);
  }
  return new OpenAIProvider(settings.openaiApiKey, settings.openaiModel, settings.glossaryExplanationLength);
}

// src/main.ts
var import_sep = __toESM(require_sep());
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var EXPLANATION_BATCH_SIZE = 2;
var KEY_SENTENCE_BATCH_SIZE = 6;
var MAX_EXPLANATION_OCCURRENCES = 5;
var EXPLANATION_EXCERPT_RADIUS = 350;
var MAX_EXPLANATION_CLUSTERS = 3;
var SEP_CANDIDATE_LIMIT = 5;
var DEFAULT_SETTINGS = {
  provider: "openai",
  openaiApiKey: "",
  anthropicApiKey: "",
  openaiModel: "gpt-5.4-mini",
  anthropicModel: "claude-sonnet-4-6",
  pdfImportBackend: "paper2mdviallm",
  paper2mdviallmCommand: "paper2mdviallm",
  paper2mdviallmModel: "claude-sonnet-4-6",
  paper2mdviallmConcurrency: 3,
  markerCommand: "marker_single",
  maxPrecomputedTerms: 40,
  glossaryFolderName: "_glossary",
  glossaryExplanationLength: "standard",
  sepEnrichmentEnabled: false,
  hoverDelayMs: 350,
  windowSize: 4,
  windowOverlap: 1,
  autoHighlightKeySentences: true,
  keySentenceDensity: "medium"
};
var PhilosophyReaderPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.statusEl = null;
    this.glossaryCache = /* @__PURE__ */ new Map();
  }
  async onload() {
    await this.loadSettings();
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("scholia-progress");
    this.setStatus("");
    this.addSettingTab(new PhilosophyReaderSettingTab(this.app, this));
    this.registerEditorExtension(this.buildHoverExtension());
    this.registerContextMenuActions();
    this.addCommand({
      id: "import-pdf-as-philosophy-paper",
      name: "Scholia: Import PDF and Prepare for Reading",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "pdf";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.importPdfAsPaper(file, { precomputeGlossary: true });
        }
        return canRun;
      }
    });
    this.addCommand({
      id: "convert-current-pdf-to-markdown",
      name: "Scholia: Convert Current PDF to Markdown Only",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "pdf";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.importPdfAsPaper(file, { precomputeGlossary: false });
        }
        return canRun;
      }
    });
    this.addCommand({
      id: "rebuild-glossary-for-current-paper",
      name: "Scholia: Rebuild Glossary for Current Paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "md";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.rebuildGlossary(file, { background: false });
        }
        return canRun;
      }
    });
    this.addCommand({
      id: "extract-terms-and-explain-current-markdown",
      name: "Scholia: Extract Terms and Explain from Current Markdown",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "md";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.extractTermsAndExplain(file);
        }
        return canRun;
      }
    });
    this.addCommand({
      id: "enrich-glossary-with-sep-for-current-paper",
      name: "Scholia: Enrich Glossary with SEP for Current Paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "md";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.enrichGlossaryWithSepForPaper(file, { background: false });
        }
        return canRun;
      }
    });
    this.addCommand({
      id: "highlight-key-sentences-for-current-paper",
      name: "Scholia: Highlight Key Sentences for Current Paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "md";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.highlightKeySentences(file, { background: false });
        }
        return canRun;
      }
    });
    this.addCommand({
      id: "explain-term-now",
      name: "Scholia: Explain Term Now",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        const selection = editor.getSelection().trim();
        const canRun = file instanceof import_obsidian2.TFile && file.extension.toLowerCase() === "md" && selection.length > 0;
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.explainSelectedTerm(file, selection);
        }
        return canRun;
      }
    });
  }
  onunload() {
    this.setStatus("");
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.migrateStaleImportSettings();
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.glossaryCache.clear();
  }
  getLocalMarkerCommand() {
    return this.findLocalToolCommand("marker_single");
  }
  getLocalScholarMdCommand() {
    return this.findLocalToolCommand("scholar-md");
  }
  getLocalPaper2mdViaLlmCommand() {
    return this.findLocalToolCommand("paper2mdviallm");
  }
  findLocalToolCommand(executableBaseName) {
    const pluginPath = this.getPluginDiskPath();
    if (!pluginPath) {
      return null;
    }
    const candidates = [
      path.join(pluginPath, ".venv", "bin", executableBaseName),
      path.join(pluginPath, ".venv", "Scripts", `${executableBaseName}.exe`),
      path.join(pluginPath, ".venv", "Scripts", executableBaseName),
      path.join(pluginPath, ".venv", "bin", `${executableBaseName}.exe`)
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }
  resolveScholarMdCommand() {
    const localScholarMd = this.getLocalScholarMdCommand();
    if (localScholarMd && fs.existsSync(localScholarMd)) {
      return { command: localScholarMd, source: "local" };
    }
    return { command: "scholar-md", source: "path" };
  }
  resolvePaper2mdViaLlmCommand() {
    const configured = this.settings.paper2mdviallmCommand.trim();
    if (configured && configured !== DEFAULT_SETTINGS.paper2mdviallmCommand) {
      const resolvedConfigured = resolveConfiguredToolCommand(configured, "paper2mdviallm");
      return {
        command: resolvedConfigured,
        source: looksLikeLocalPath(configured) ? "local" : "path"
      };
    }
    const localPaper2mdViaLlm = this.getLocalPaper2mdViaLlmCommand();
    if (localPaper2mdViaLlm && fs.existsSync(localPaper2mdViaLlm)) {
      return { command: localPaper2mdViaLlm, source: "local" };
    }
    return { command: DEFAULT_SETTINGS.paper2mdviallmCommand, source: "path" };
  }
  getPluginDiskPath() {
    const adapter = this.app.vault.adapter;
    const pluginDir = this.manifest.dir;
    if (!(adapter instanceof import_obsidian2.FileSystemAdapter) || !pluginDir) {
      return null;
    }
    return path.join(adapter.getBasePath(), pluginDir);
  }
  migrateStaleImportSettings() {
    const markerCommand = this.settings.markerCommand || "";
    const pointsAtDeletedLocalMarker = markerCommand.includes(`${path.sep}.venv${path.sep}bin${path.sep}marker_single`) && !fs.existsSync(markerCommand);
    if (pointsAtDeletedLocalMarker) {
      this.settings.pdfImportBackend = DEFAULT_SETTINGS.pdfImportBackend;
      this.settings.markerCommand = DEFAULT_SETTINGS.markerCommand;
      void this.saveSettings();
    }
    if (this.settings.pdfImportBackend === "markitdown" || this.settings.pdfImportBackend === "pdfjs") {
      this.settings.pdfImportBackend = DEFAULT_SETTINGS.pdfImportBackend;
      void this.saveSettings();
    }
    const raw = this.settings;
    if (raw.paper2mdCommand !== void 0 && raw.paper2mdviallmCommand === void 0) {
      raw.paper2mdviallmCommand = raw.paper2mdCommand;
      delete raw.paper2mdCommand;
      void this.saveSettings();
    }
    if (raw.paper2mdModel !== void 0 && raw.paper2mdviallmModel === void 0) {
      raw.paper2mdviallmModel = raw.paper2mdModel;
      delete raw.paper2mdModel;
      void this.saveSettings();
    }
    if (raw.paper2mdConcurrency !== void 0 && raw.paper2mdviallmConcurrency === void 0) {
      raw.paper2mdviallmConcurrency = raw.paper2mdConcurrency;
      delete raw.paper2mdConcurrency;
      void this.saveSettings();
    }
    if (this.settings.pdfImportBackend === "paper2md") {
      this.settings.pdfImportBackend = "paper2mdviallm";
      void this.saveSettings();
    }
    if (raw.markitdownCommand !== void 0) {
      delete raw.markitdownCommand;
      void this.saveSettings();
    }
    if (raw.scholarMdCommand !== void 0) {
      delete raw.scholarMdCommand;
      void this.saveSettings();
    }
  }
  buildHoverExtension() {
    return (0, import_view.hoverTooltip)(
      async (view, pos) => this.resolveHoverTooltip(view, pos),
      { hoverTime: this.settings.hoverDelayMs }
    );
  }
  registerContextMenuActions() {
    this.registerEvent(this.app.workspace.on("file-menu", (menu, abstractFile) => {
      if (!(abstractFile instanceof import_obsidian2.TFile)) {
        return;
      }
      const extension = abstractFile.extension.toLowerCase();
      if (extension === "pdf") {
        menu.addItem((item) => item.setTitle("Import PDF and Prepare for Reading").setIcon("sparkles").onClick(() => {
          void this.importPdfAsPaper(abstractFile, { precomputeGlossary: true });
        }));
        menu.addItem((item) => item.setTitle("Convert PDF to Markdown Only").setIcon("file-text").onClick(() => {
          void this.importPdfAsPaper(abstractFile, { precomputeGlossary: false });
        }));
      }
      if (extension === "md") {
        menu.addItem((item) => item.setTitle("Highlight Key Sentences").setIcon("highlighter").onClick(() => {
          void this.highlightKeySentences(abstractFile, { background: false });
        }));
        menu.addItem((item) => item.setTitle("Extract Terms and Explain").setIcon("brain").onClick(() => {
          void this.extractTermsAndExplain(abstractFile);
        }));
        menu.addItem((item) => item.setTitle("Enrich Glossary with SEP").setIcon("book-open").onClick(() => {
          void this.enrichGlossaryWithSepForPaper(abstractFile, { background: false });
        }));
      }
    }));
  }
  async resolveHoverTooltip(view, pos) {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof import_obsidian2.TFile) || file.extension.toLowerCase() !== "md") {
      return null;
    }
    const line = view.state.doc.lineAt(pos);
    const relativePosition = pos - line.from;
    const index = await this.loadGlossaryIndex(file);
    const prepared = (0, import_core2.findPreparedTermAtPosition)(line.text, relativePosition, index.entries);
    if (prepared) {
      const cluster = (0, import_core2.chooseClusterForOffset)(prepared.entry, pos);
      return {
        pos: line.from + prepared.from,
        end: line.from + prepared.to,
        above: true,
        create: () => ({ dom: this.renderPreparedTooltip(prepared.entry, cluster) })
      };
    }
    const word = (0, import_core2.findWordAtPosition)(line.text, relativePosition);
    if (!word) {
      return null;
    }
    return {
      pos: line.from + word.from,
      end: line.from + word.to,
      above: true,
      create: () => ({ dom: this.renderUnpreparedTooltip(word.word, file) })
    };
  }
  renderPreparedTooltip(entry, cluster) {
    const root = document.createElement("div");
    root.addClass("scholia-tooltip");
    const title = document.createElement("h4");
    title.setText(entry.term);
    root.appendChild(title);
    const definition = document.createElement("p");
    definition.setText(entry.definition || "No definition was generated.");
    root.appendChild(definition);
    if (entry.sep?.status === "matched" && entry.sep.summary) {
      const label = document.createElement("div");
      label.addClass("scholia-label");
      label.setText("SEP");
      root.appendChild(label);
      const summary = document.createElement("p");
      summary.setText(entry.sep.summary);
      root.appendChild(summary);
      if (entry.sep.entryUrl) {
        const link = document.createElement("a");
        link.href = entry.sep.entryUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setText(entry.sep.entryTitle || "Open SEP entry");
        root.appendChild(link);
      }
    }
    if (cluster?.usageNote) {
      const label = document.createElement("div");
      label.addClass("scholia-label");
      label.setText(cluster.label || "This passage");
      root.appendChild(label);
      const usage = document.createElement("p");
      usage.setText(cluster.usageNote);
      root.appendChild(usage);
    }
    return root;
  }
  renderUnpreparedTooltip(word, file) {
    const root = document.createElement("div");
    root.addClass("scholia-tooltip");
    const title = document.createElement("h4");
    title.setText(word);
    root.appendChild(title);
    const message = document.createElement("p");
    message.addClass("scholia-empty");
    message.setText("No prepared glossary entry yet.");
    root.appendChild(message);
    const button = document.createElement("button");
    button.setText("Explain now");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.explainSelectedTerm(file, word);
    });
    root.appendChild(button);
    return root;
  }
  async importPdfAsPaper(file, options = {}) {
    try {
      const precomputeGlossary = options.precomputeGlossary !== false;
      if (this.settings.pdfImportBackend === "marker" && !this.settings.markerCommand.trim()) {
        new import_obsidian2.Notice("Set the Marker CLI path in Scholia settings first.");
        return;
      }
      const scholarMdCommand = this.resolveScholarMdCommand();
      const paper2mdViaLlmCommand = this.resolvePaper2mdViaLlmCommand();
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof import_obsidian2.FileSystemAdapter)) {
        new import_obsidian2.Notice("PDF import requires a local filesystem vault.");
        return;
      }
      const baseName = (0, import_core2.getBaseName)(file.path);
      const paperSlug = (0, import_core2.slugify)(baseName, "paper");
      const parentPath = (0, import_core2.getParentPath)(file.path);
      const parentBaseName = parentPath ? (0, import_core2.getBaseName)(parentPath) : "";
      const defaultPaperFolder = joinVaultPath(parentPath, paperSlug);
      const existingDefaultFolder = this.app.vault.getAbstractFileByPath(defaultPaperFolder);
      const paperFolder = parentBaseName === paperSlug ? parentPath : !existingDefaultFolder || existingDefaultFolder instanceof import_obsidian2.TFolder ? defaultPaperFolder : await this.uniqueFolderPath(defaultPaperFolder);
      await this.ensureFolder(paperFolder);
      let pdfTarget = joinVaultPath(paperFolder, `${paperSlug}.pdf`);
      if (file.path !== pdfTarget) {
        const existingPdfTarget = this.app.vault.getAbstractFileByPath(pdfTarget);
        if (!existingPdfTarget) {
          await this.app.vault.createBinary(pdfTarget, await this.app.vault.readBinary(file));
        } else if (!(existingPdfTarget instanceof import_obsidian2.TFile)) {
          throw new Error(`${pdfTarget} exists and is not a PDF file.`);
        }
      }
      const movedPdf = this.app.vault.getAbstractFileByPath(pdfTarget);
      if (!(movedPdf instanceof import_obsidian2.TFile)) {
        throw new Error("PDF import copy could not be found in the vault.");
      }
      await this.ensureFolder(joinVaultPath(paperFolder, this.settings.glossaryFolderName));
      await this.ensureFolder(joinVaultPath(paperFolder, "_source"));
      const pdfAbsPath = adapter.getFullPath(pdfTarget);
      const importedMarkdown = this.settings.pdfImportBackend === "marker" ? await this.convertPdfWithMarker(pdfAbsPath, paperFolder, adapter) : this.settings.pdfImportBackend === "paper2mdviallm" ? await this.convertPdfWithPaper2MDViaLLM(pdfAbsPath, paperFolder, baseName, pdfTarget, adapter, paper2mdViaLlmCommand) : await this.convertPdfWithScholarMd(pdfAbsPath, paperFolder, baseName, pdfTarget, adapter, scholarMdCommand);
      const paperMarkdown = buildImportedPaperMarkdown(importedMarkdown, {
        title: baseName,
        sourcePdf: pdfTarget,
        importedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      const mdTarget = await this.uniqueVaultPath(joinVaultPath(paperFolder, `${paperSlug}.md`));
      await this.app.vault.create(mdTarget, paperMarkdown);
      const markdownFile = this.app.vault.getAbstractFileByPath(mdTarget);
      if (markdownFile instanceof import_obsidian2.TFile) {
        await this.app.workspace.getLeaf(false).openFile(markdownFile);
        if (precomputeGlossary) {
          if (this.settings.autoHighlightKeySentences) {
            new import_obsidian2.Notice("PDF imported. Key sentence highlighting and glossary preprocessing are running in the background.");
            void this.preparePaperForReading(markdownFile, { background: true });
          } else {
            new import_obsidian2.Notice("PDF imported. Glossary preprocessing is running in the background. Check _glossary/_status.md for progress.");
            void this.rebuildGlossary(markdownFile, { background: true });
          }
        } else {
          new import_obsidian2.Notice("PDF converted to Markdown. Run 'Extract Terms and Explain from Current Markdown' when you are ready.");
        }
      }
    } catch (error) {
      new import_obsidian2.Notice(`PDF import failed: ${toErrorMessage(error)}`);
      console.error(error);
    } finally {
      this.setStatus("");
    }
  }
  async convertPdfWithPaper2MDViaLLM(pdfAbsPath, paperFolder, paperTitle, sourcePdfPath, adapter, resolvedCommand) {
    const model = this.resolvePaper2mdViaLlmModel();
    const concurrency = Math.max(1, Math.round(this.settings.paper2mdviallmConcurrency || DEFAULT_SETTINGS.paper2mdviallmConcurrency));
    const usingOpenAI = isOpenAIModel(model);
    if (usingOpenAI && !this.settings.openaiApiKey.trim()) {
      throw new Error("Paper2MDViaLLM is configured with an OpenAI model, but the OpenAI API key is empty.");
    }
    if (!usingOpenAI && !this.settings.anthropicApiKey.trim()) {
      throw new Error("Paper2MDViaLLM is configured with an Anthropic model, but the Anthropic API key is empty.");
    }
    this.setStatus("Scholia: converting PDF with Paper2MDViaLLM...");
    const commandLabel = resolvedCommand.source === "local" ? "local Paper2MDViaLLM" : "Paper2MDViaLLM";
    new import_obsidian2.Notice(`Converting PDF with ${commandLabel}...`);
    const outputDir = path.join(adapter.getFullPath(paperFolder), ".paper2mdviallm-output");
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const logPath = path.join(outputDir, "import.log");
    const paper2mdViaLlmArgs = [
      "convert",
      pdfAbsPath,
      "-o",
      outputDir,
      "--model",
      model,
      "--concurrency",
      String(concurrency)
    ];
    try {
      const result = await execFileAsync(resolvedCommand.command, paper2mdViaLlmArgs, {
        maxBuffer: 1024 * 1024 * 80,
        env: this.buildPaper2mdEnv()
      });
      fs.writeFileSync(logPath, formatMarkerLog(resolvedCommand.command, paper2mdViaLlmArgs, result.stdout, result.stderr), "utf8");
    } catch (error) {
      const execError = error;
      fs.writeFileSync(logPath, formatMarkerLog(resolvedCommand.command, paper2mdViaLlmArgs, execError.stdout || "", execError.stderr || toErrorMessage(error)), "utf8");
      throw new Error(`Paper2MDViaLLM conversion failed. See ${logPath}`);
    }
    const paper2mdViaLlmMarkdown = findLargestMarkdownFile(outputDir);
    if (!paper2mdViaLlmMarkdown) {
      throw new Error("Paper2MDViaLLM finished without producing a markdown file.");
    }
    const importedMarkdown = fs.readFileSync(paper2mdViaLlmMarkdown, "utf8").trim();
    if (importedMarkdown.replace(/\s/g, "").length < 800) {
      throw new Error("Paper2MDViaLLM found very little readable text. This PDF may still need targeted OCR or a different import backend.");
    }
    const quality = (0, import_core2.analyzeMarkdownQuality)(importedMarkdown);
    await this.writeVaultTextFile(joinVaultPath(paperFolder, "_source", "paper2mdviallm.md"), `${importedMarkdown}
`);
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-quality.json"),
      `${JSON.stringify({
        backend: "paper2mdviallm",
        command: resolvedCommand.command,
        commandSource: resolvedCommand.source,
        model,
        llmProvider: usingOpenAI ? "openai" : "anthropic",
        concurrency,
        generatedFile: path.basename(paper2mdViaLlmMarkdown),
        paperTitle,
        sourcePdf: sourcePdfPath,
        importedAt: (/* @__PURE__ */ new Date()).toISOString(),
        quality
      }, null, 2)}
`
    );
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-warnings.md"),
      buildImportWarningsMarkdown("Paper2MDViaLLM", sourcePdfPath, quality)
    );
    fs.rmSync(outputDir, { recursive: true, force: true });
    if (quality.riskLevel === "high" || quality.riskLevel === "medium") {
      new import_obsidian2.Notice(`PDF imported with ${quality.riskLevel} extraction risk. Check _source/import-warnings.md before trusting formulas.`);
    }
    return importedMarkdown;
  }
  async convertPdfWithScholarMd(pdfAbsPath, paperFolder, paperTitle, sourcePdfPath, adapter, resolvedCommand) {
    this.setStatus("Scholia: converting PDF with Scholar-MD...");
    const commandLabel = resolvedCommand.source === "local" ? "local Scholar-MD" : "Scholar-MD";
    new import_obsidian2.Notice(`Converting PDF with ${commandLabel} (beta)...`);
    const outputDir = path.join(adapter.getFullPath(paperFolder), ".scholar-md-output");
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "scholar-md.md");
    const diagnosticsPath = path.join(outputDir, "scholar-md.diagnostics.json");
    const logPath = path.join(outputDir, "import.log");
    const scholarMdArgs = [
      pdfAbsPath,
      "-o",
      outputPath,
      "--emit-diagnostics",
      "--diagnostics-output",
      diagnosticsPath
    ];
    try {
      const result = await execFileAsync(resolvedCommand.command, scholarMdArgs, {
        maxBuffer: 1024 * 1024 * 80
      });
      fs.writeFileSync(logPath, formatMarkerLog(resolvedCommand.command, scholarMdArgs, result.stdout, result.stderr), "utf8");
    } catch (error) {
      const execError = error;
      fs.writeFileSync(logPath, formatMarkerLog(resolvedCommand.command, scholarMdArgs, execError.stdout || "", execError.stderr || toErrorMessage(error)), "utf8");
      throw new Error(`Scholar-MD conversion failed. See ${logPath}`);
    }
    if (!fs.existsSync(outputPath)) {
      throw new Error("Scholar-MD finished without producing a markdown file.");
    }
    const importedMarkdown = fs.readFileSync(outputPath, "utf8").trim();
    if (importedMarkdown.replace(/\s/g, "").length < 800) {
      throw new Error("Scholar-MD found very little selectable text. This PDF may need OCR.");
    }
    const quality = (0, import_core2.analyzeMarkdownQuality)(importedMarkdown);
    await this.writeVaultTextFile(joinVaultPath(paperFolder, "_source", "scholar-md.md"), `${importedMarkdown}
`);
    if (fs.existsSync(diagnosticsPath)) {
      const diagnostics = fs.readFileSync(diagnosticsPath, "utf8");
      await this.writeVaultTextFile(joinVaultPath(paperFolder, "_source", "scholar-md.diagnostics.json"), diagnostics);
    }
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-quality.json"),
      `${JSON.stringify({
        backend: "scholar-md",
        command: resolvedCommand.command,
        commandSource: resolvedCommand.source,
        paperTitle,
        sourcePdf: sourcePdfPath,
        importedAt: (/* @__PURE__ */ new Date()).toISOString(),
        quality
      }, null, 2)}
`
    );
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-warnings.md"),
      buildImportWarningsMarkdown("Scholar-MD", sourcePdfPath, quality)
    );
    fs.rmSync(outputDir, { recursive: true, force: true });
    if (quality.riskLevel === "high" || quality.riskLevel === "medium") {
      new import_obsidian2.Notice(`PDF imported with ${quality.riskLevel} extraction risk. Check _source/import-warnings.md before trusting formulas.`);
    }
    return importedMarkdown;
  }
  async convertPdfWithMarker(pdfAbsPath, paperFolder, adapter) {
    this.setStatus("Scholia: converting PDF with Marker...");
    new import_obsidian2.Notice("Converting PDF with Marker...");
    const outputDir = path.join(adapter.getFullPath(paperFolder), ".marker-output");
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const logPath = path.join(outputDir, "import.log");
    const markerArgs = [
      pdfAbsPath,
      "--output_dir",
      outputDir,
      "--output_format",
      "markdown",
      "--disable_image_extraction",
      "--disable_ocr",
      "--disable_multiprocessing",
      "--disable_tqdm"
    ];
    try {
      const result = await execFileAsync(this.settings.markerCommand, markerArgs, {
        maxBuffer: 1024 * 1024 * 40
      });
      fs.writeFileSync(logPath, formatMarkerLog(this.settings.markerCommand, markerArgs, result.stdout, result.stderr), "utf8");
    } catch (error) {
      const execError = error;
      fs.writeFileSync(logPath, formatMarkerLog(this.settings.markerCommand, markerArgs, execError.stdout || "", execError.stderr || toErrorMessage(error)), "utf8");
      throw new Error(`Marker conversion failed. See ${logPath}`);
    }
    const markerMarkdown = findLargestMarkdownFile(outputDir);
    if (!markerMarkdown) {
      throw new Error("Marker finished without producing a markdown file.");
    }
    const importedMarkdown = fs.readFileSync(markerMarkdown, "utf8");
    fs.rmSync(outputDir, { recursive: true, force: true });
    return importedMarkdown;
  }
  resolvePaper2mdViaLlmModel() {
    const override = this.settings.paper2mdviallmModel.trim();
    if (override) {
      return override;
    }
    return DEFAULT_SETTINGS.paper2mdviallmModel;
  }
  buildPaper2mdEnv() {
    const env = { ...process.env };
    if (this.settings.openaiApiKey.trim()) {
      env.OPENAI_API_KEY = this.settings.openaiApiKey.trim();
    }
    if (this.settings.anthropicApiKey.trim()) {
      env.ANTHROPIC_API_KEY = this.settings.anthropicApiKey.trim();
    }
    return env;
  }
  async preparePaperForReading(file, options = {}) {
    if (this.settings.autoHighlightKeySentences) {
      await this.highlightKeySentences(file, {
        background: options.background,
        silentSuccess: true
      });
    }
    await this.rebuildGlossary(file, { background: options.background });
  }
  async highlightKeySentences(file, options = {}) {
    try {
      const provider = createLLMProvider(this.settings);
      const originalMarkdown = await this.app.vault.read(file);
      const existingSidecar = await this.loadKeySentenceSidecar(file);
      const cleanedMarkdown = (0, import_core2.removeManagedSentenceHighlights)(originalMarkdown, existingSidecar.highlights);
      const paragraphs = (0, import_core2.splitParagraphs)(cleanedMarkdown);
      const candidates = (0, import_core2.buildKeySentenceParagraphs)(cleanedMarkdown, paragraphs);
      if (candidates.length === 0) {
        if (cleanedMarkdown !== originalMarkdown) {
          await this.writeVaultTextFile(file.path, cleanedMarkdown);
        }
        await this.writeKeySentenceSidecar(file, this.buildKeySentenceSidecar(file, provider.name, provider.model, this.settings.keySentenceDensity, []));
        if (!options.silentSuccess) {
          new import_obsidian2.Notice("No multi-sentence prose paragraphs were eligible for key-sentence highlighting.");
        }
        return true;
      }
      const selectedByParagraph = /* @__PURE__ */ new Map();
      let processed = 0;
      for (const batch of chunk(candidates, KEY_SENTENCE_BATCH_SIZE)) {
        const rangeStart = processed + 1;
        const rangeEnd = processed + batch.length;
        processed += batch.length;
        this.setStatus(`Scholia: selecting key sentences ${rangeStart}-${rangeEnd}/${candidates.length}`);
        const selections = await provider.selectKeySentences({
          paperTitle: (0, import_core2.getBaseName)(file.path),
          sourcePaper: file.path,
          density: this.settings.keySentenceDensity,
          paragraphs: batch.map((paragraph) => this.toKeySentenceParagraphInput(paragraph))
        });
        for (const selection of selections) {
          if (selectedByParagraph.has(selection.paragraphId)) {
            continue;
          }
          const sentence = findSelectedKeySentence(batch, selection.paragraphId, selection.sentenceId);
          if (sentence) {
            selectedByParagraph.set(selection.paragraphId, sentence);
          }
        }
      }
      const highlights = Array.from(selectedByParagraph.values());
      const highlightedMarkdown = (0, import_core2.applySentenceHighlights)(cleanedMarkdown, highlights);
      if (highlightedMarkdown !== originalMarkdown) {
        await this.writeVaultTextFile(file.path, highlightedMarkdown);
      }
      await this.writeKeySentenceSidecar(file, this.buildKeySentenceSidecar(file, provider.name, provider.model, this.settings.keySentenceDensity, highlights));
      if (!options.silentSuccess) {
        if (highlights.length === 0) {
          new import_obsidian2.Notice("No key sentences were selected for highlighting.");
        } else {
          new import_obsidian2.Notice(`Highlighted key sentences: ${highlights.length} paragraph${highlights.length === 1 ? "" : "s"}.`);
        }
      }
      return true;
    } catch (error) {
      new import_obsidian2.Notice(`Key sentence highlighting failed: ${toErrorMessage(error)}`);
      console.error(error);
      return false;
    } finally {
      this.setStatus("");
    }
  }
  toKeySentenceParagraphInput(paragraph) {
    return {
      paragraphId: paragraph.id,
      paragraphIndex: paragraph.paragraphIndex,
      heading: paragraph.heading,
      text: paragraph.text,
      sentences: paragraph.sentences.map((sentence) => ({
        id: sentence.id,
        text: sentence.text
      }))
    };
  }
  async rebuildGlossary(file, options) {
    try {
      const provider = createLLMProvider(this.settings);
      const markdown = await this.app.vault.read(file);
      const paragraphs = (0, import_core2.splitParagraphs)(markdown);
      await this.ensureFolder(this.glossaryFolderPath(file));
      await this.writeGlossaryStatus(file, "running", [
        `Started: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`,
        `Paper: ${file.path}`
      ]);
      if (paragraphs.length === 0) {
        new import_obsidian2.Notice("No readable paragraphs found in this paper.");
        await this.writeGlossaryStatus(file, "failed", [
          "No readable paragraphs found in this paper."
        ]);
        return;
      }
      const windows = (0, import_core2.buildParagraphWindows)(paragraphs, this.settings.windowSize, this.settings.windowOverlap);
      const discovered = [];
      for (let index = 0; index < windows.length; index += 1) {
        this.setStatus(`Scholia: discovering terms ${index + 1}/${windows.length}`);
        const terms = await provider.discoverTerms({
          paperTitle: (0, import_core2.getBaseName)(file.path),
          sourcePaper: file.path,
          window: windows[index]
        });
        discovered.push(...terms);
      }
      const topTerms = (0, import_core2.mergeTermCandidates)(discovered, this.settings.maxPrecomputedTerms);
      await this.writeGlossaryStatus(file, "running", [
        `Discovered candidate terms: ${topTerms.length}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`,
        "Explaining terms now."
      ]);
      const existingIndex = await this.loadGlossaryIndex(file, true);
      const pendingTerms = topTerms.filter((term) => !existingIndex.byTerm.has((0, import_core2.normalizeTerm)(term.term)));
      if (pendingTerms.length === 0) {
        new import_obsidian2.Notice("Glossary is already prepared for the top discovered terms.");
        await this.writeGlossaryStatus(file, "ready", [
          "Glossary is already prepared for the top discovered terms.",
          `Prepared entries: ${existingIndex.entries.length}`
        ]);
        this.setStatus("");
        return;
      }
      const inputs = pendingTerms.map((term) => this.buildExplainTermInput(markdown, paragraphs, term));
      const batches = chunk(inputs, EXPLANATION_BATCH_SIZE);
      let completed = 0;
      const writtenTerms = /* @__PURE__ */ new Set();
      for (const batch of batches) {
        this.setStatus(`Scholia: explaining terms ${completed + 1}-${completed + batch.length}/${inputs.length}`);
        const explanations = await provider.explainTerms({
          paperTitle: (0, import_core2.getBaseName)(file.path),
          sourcePaper: file.path,
          terms: batch
        });
        for (const explanation of explanations) {
          const input = findMatchingInput(batch, explanation);
          if (!input) {
            continue;
          }
          const entry = this.toGlossaryEntry(file, provider.name, provider.model, input, explanation);
          await this.writeGlossaryEntry(file, entry);
          writtenTerms.add((0, import_core2.normalizeTerm)(entry.term));
          completed += 1;
        }
      }
      this.glossaryCache.delete(file.path);
      await this.loadGlossaryIndex(file, true);
      let sepSummary = null;
      if (this.settings.sepEnrichmentEnabled && writtenTerms.size > 0) {
        sepSummary = await this.enrichGlossaryWithSepForPaper(file, {
          background: true,
          provider,
          requestedTerms: Array.from(writtenTerms),
          writeStatus: false
        });
      }
      await this.writeGlossaryStatus(file, "ready", [
        `Completed: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `New terms prepared: ${completed}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`,
        ...this.buildSepStatusLines(sepSummary)
      ]);
      new import_obsidian2.Notice(buildGlossaryReadyNotice(completed, sepSummary));
    } catch (error) {
      await this.writeGlossaryStatus(file, "failed", [
        `Failed: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        toErrorMessage(error)
      ]);
      new import_obsidian2.Notice(`Glossary preprocessing failed: ${toErrorMessage(error)}`);
      console.error(error);
      if (!options.background) {
        throw error;
      }
    } finally {
      this.setStatus("");
    }
  }
  async extractTermsAndExplain(file) {
    await this.rebuildGlossary(file, { background: false });
  }
  buildExplainTermInput(markdown, paragraphs, term) {
    const aliases = Array.isArray(term.aliases) ? term.aliases : [];
    const occurrences = (0, import_core2.findTermOccurrences)(markdown, term.term, aliases).slice(0, MAX_EXPLANATION_OCCURRENCES).map((occurrence) => ({
      start: occurrence.start,
      end: occurrence.end,
      alias: occurrence.alias,
      excerpt: (0, import_core2.excerptAround)(markdown, occurrence.start, occurrence.end, EXPLANATION_EXCERPT_RADIUS)
    }));
    const clusters = (0, import_core2.buildContextClusters)(markdown, paragraphs, term, MAX_EXPLANATION_CLUSTERS);
    return {
      term: term.term,
      aliases,
      reason: term.reason,
      importance: term.importance,
      occurrences,
      clusters
    };
  }
  toGlossaryEntry(file, provider, model, input, explanation) {
    const notes = new Map((explanation.clusters || []).map((cluster) => [cluster.id, cluster.usageNote]));
    const clusters = input.clusters.map((cluster) => ({
      ...cluster,
      usageNote: notes.get(cluster.id) || ""
    }));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const aliases = Array.from(new Set([...input.aliases || [], ...explanation.aliases || []].filter(Boolean)));
    return {
      term: explanation.term || input.term,
      normalizedTerm: (0, import_core2.normalizeTerm)(explanation.term || input.term),
      aliases,
      sourcePaper: file.path,
      provider,
      model,
      created: now,
      updated: now,
      definition: explanation.definition || "",
      clusters,
      sep: null,
      sep_enabled: false
    };
  }
  async explainSelectedTerm(file, selectedTerm) {
    try {
      const provider = createLLMProvider(this.settings);
      const markdown = await this.app.vault.read(file);
      const paragraphs = (0, import_core2.splitParagraphs)(markdown);
      const candidate = {
        term: selectedTerm,
        aliases: [],
        importance: 5,
        paragraphIndexes: []
      };
      const input = this.buildExplainTermInput(markdown, paragraphs, candidate);
      const explanation = await provider.explainTermFallback({
        paperTitle: (0, import_core2.getBaseName)(file.path),
        sourcePaper: file.path,
        terms: [input]
      });
      await this.ensureFolder(this.glossaryFolderPath(file));
      const entry = this.toGlossaryEntry(file, provider.name, provider.model, input, explanation);
      await this.writeGlossaryEntry(file, entry);
      this.glossaryCache.delete(file.path);
      let sepSummary = null;
      if (this.settings.sepEnrichmentEnabled) {
        sepSummary = await this.enrichGlossaryWithSepForPaper(file, {
          background: true,
          provider,
          requestedTerms: [(0, import_core2.normalizeTerm)(entry.term)],
          writeStatus: false
        });
      }
      new import_obsidian2.Notice(buildPreparedTermNotice(explanation.term || selectedTerm, sepSummary));
    } catch (error) {
      new import_obsidian2.Notice(`Explain Term Now failed: ${toErrorMessage(error)}`);
      console.error(error);
    }
  }
  async enrichGlossaryWithSepForPaper(file, options = {}) {
    const provider = options.provider || createLLMProvider(this.settings);
    const writeStatus = options.writeStatus !== false;
    const requestedTerms = new Set((options.requestedTerms || []).map((term) => (0, import_core2.normalizeTerm)(term)).filter(Boolean));
    const summary = {
      attempted: 0,
      matched: 0,
      notFound: 0,
      failed: 0,
      skipped: 0
    };
    try {
      const index = await this.loadGlossaryIndex(file, true);
      const matchingEntries = index.entries.filter((entry) => requestedTerms.size === 0 || requestedTerms.has((0, import_core2.normalizeTerm)(entry.term)));
      const targets = matchingEntries.filter((entry) => entry.sep?.status !== "matched" && entry.sep?.status !== "not_found");
      summary.skipped = matchingEntries.length - targets.length;
      if (writeStatus) {
        await this.writeGlossaryStatus(file, "running", [
          `SEP enrichment started: ${(/* @__PURE__ */ new Date()).toISOString()}`,
          `Provider: ${provider.name}`,
          `Model: ${provider.model}`,
          `Targets: ${targets.length}`
        ]);
      }
      if (targets.length === 0) {
        if (writeStatus) {
          await this.writeGlossaryStatus(file, "ready", [
            "SEP enrichment is already cached for the selected glossary entries.",
            `Skipped entries: ${summary.skipped}`
          ]);
        }
        if (!options.background) {
          new import_obsidian2.Notice("SEP enrichment is already cached for the selected glossary entries.");
        }
        return summary;
      }
      for (let index2 = 0; index2 < targets.length; index2 += 1) {
        const target = targets[index2];
        summary.attempted += 1;
        this.setStatus(`Scholia: enriching glossary with SEP ${index2 + 1}/${targets.length}`);
        try {
          const sep2 = await this.buildSepDataForEntry(file, target, provider);
          await this.writeGlossaryEntry(file, {
            ...target,
            updated: (/* @__PURE__ */ new Date()).toISOString(),
            sep: sep2,
            sep_enabled: sep2.status === "matched"
          });
          if (sep2.status === "matched") {
            summary.matched += 1;
          } else if (sep2.status === "not_found") {
            summary.notFound += 1;
          } else {
            summary.failed += 1;
          }
        } catch (error) {
          summary.failed += 1;
          const sep2 = this.buildFailedSepData(target.term, target.term, error);
          await this.writeGlossaryEntry(file, {
            ...target,
            updated: (/* @__PURE__ */ new Date()).toISOString(),
            sep: sep2,
            sep_enabled: false
          });
        }
      }
      this.glossaryCache.delete(file.path);
      await this.loadGlossaryIndex(file, true);
      if (writeStatus) {
        await this.writeGlossaryStatus(file, "ready", [
          `SEP enrichment completed: ${(/* @__PURE__ */ new Date()).toISOString()}`,
          ...this.buildSepStatusLines(summary)
        ]);
      }
      if (!options.background) {
        new import_obsidian2.Notice(buildSepNotice(summary));
      }
      return summary;
    } catch (error) {
      if (writeStatus) {
        await this.writeGlossaryStatus(file, "failed", [
          `SEP enrichment failed: ${(/* @__PURE__ */ new Date()).toISOString()}`,
          toErrorMessage(error)
        ]);
      }
      if (!options.background) {
        new import_obsidian2.Notice(`SEP enrichment failed: ${toErrorMessage(error)}`);
      }
      console.error(error);
      return summary;
    } finally {
      this.setStatus("");
    }
  }
  async buildSepDataForEntry(file, entry, provider) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const queries = Array.from(new Set([entry.term, ...entry.aliases || []].map((term) => String(term || "").trim()).filter(Boolean)));
    let usedQuery = entry.term;
    let candidates = [];
    for (const query of queries) {
      usedQuery = query;
      candidates = (await (0, import_sep.searchSep)(query)).slice(0, SEP_CANDIDATE_LIMIT);
      if (candidates.length > 0) {
        break;
      }
    }
    if (candidates.length === 0) {
      return {
        status: "not_found",
        query: usedQuery,
        entryTitle: "",
        entryUrl: "",
        summary: "",
        sourceExcerpt: "",
        revised: "",
        fetchedAt: now
      };
    }
    const heuristic = (0, import_sep.pickSepCandidateHeuristically)(candidates, entry.term, entry.aliases);
    let chosenCandidate = heuristic.candidate;
    if (!chosenCandidate) {
      const choice = await provider.chooseSepEntry({
        paperTitle: (0, import_core2.getBaseName)(file.path),
        sourcePaper: file.path,
        term: entry.term,
        aliases: entry.aliases || [],
        definition: entry.definition,
        clusters: entry.clusters || [],
        candidates: heuristic.candidates.map(({ score, ...candidate }) => candidate)
      });
      chosenCandidate = this.resolveChosenSepCandidate(choice, heuristic.candidates);
      if (!chosenCandidate) {
        return {
          status: "not_found",
          query: usedQuery,
          entryTitle: "",
          entryUrl: "",
          summary: "",
          sourceExcerpt: "",
          revised: "",
          fetchedAt: now
        };
      }
    }
    const sepEntry = await (0, import_sep.fetchSepEntry)(chosenCandidate.url);
    if (!sepEntry.preamble.trim()) {
      return this.buildFailedSepData(entry.term, usedQuery, new Error("SEP entry did not include a readable preamble."));
    }
    const summary = await provider.summarizeSepEntry({
      paperTitle: (0, import_core2.getBaseName)(file.path),
      sourcePaper: file.path,
      term: entry.term,
      definition: entry.definition,
      entryTitle: sepEntry.title || chosenCandidate.title,
      entryUrl: chosenCandidate.url,
      preamble: sepEntry.preamble
    });
    return this.buildMatchedSepData(usedQuery, chosenCandidate, sepEntry, summary, now);
  }
  resolveChosenSepCandidate(choice, candidates) {
    if (!choice.matched) {
      return null;
    }
    const byUrl = candidates.find((candidate) => candidate.url === choice.url);
    if (byUrl) {
      return byUrl;
    }
    const normalizedTitle = (0, import_core2.normalizeTerm)(choice.title);
    const byTitle = candidates.find((candidate) => (0, import_core2.normalizeTerm)(candidate.title) === normalizedTitle);
    if (byTitle) {
      return byTitle;
    }
    if (!choice.url.startsWith("https://plato.stanford.edu/entries/")) {
      return null;
    }
    return {
      title: choice.title,
      url: choice.url,
      snippet: "",
      normalizedTitle,
      score: 0
    };
  }
  buildMatchedSepData(query, candidate, sepEntry, summary, fetchedAt) {
    return {
      status: "matched",
      query,
      entryTitle: sepEntry.title || candidate.title,
      entryUrl: candidate.url,
      summary: summary.summary,
      sourceExcerpt: sepEntry.sourceExcerpt || sepEntry.preamble,
      revised: sepEntry.revised || "",
      fetchedAt
    };
  }
  buildFailedSepData(term, query, error) {
    return {
      status: "failed",
      query: query || term,
      entryTitle: "",
      entryUrl: "",
      summary: "",
      sourceExcerpt: "",
      revised: "",
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      error: toErrorMessage(error)
    };
  }
  buildSepStatusLines(summary) {
    if (!summary) {
      return [];
    }
    return [
      `SEP attempted: ${summary.attempted}`,
      `SEP matched: ${summary.matched}`,
      `SEP not found: ${summary.notFound}`,
      `SEP failed: ${summary.failed}`,
      `SEP skipped: ${summary.skipped}`
    ];
  }
  async writeGlossaryEntry(file, entry) {
    const folderPath = this.glossaryFolderPath(file);
    await this.ensureFolder(folderPath);
    const notePath = joinVaultPath(folderPath, `${(0, import_core2.slugify)(entry.term, "term")}.md`);
    const markdown = (0, import_core2.buildGlossaryMarkdown)(entry);
    await this.writeVaultTextFile(notePath, markdown);
  }
  async writeGlossaryStatus(file, status, lines) {
    const folderPath = this.glossaryFolderPath(file);
    await this.ensureFolder(folderPath);
    const markdown = [
      "---",
      `status: ${JSON.stringify(status)}`,
      `paper: ${JSON.stringify(file.path)}`,
      `updated: ${JSON.stringify((/* @__PURE__ */ new Date()).toISOString())}`,
      "---",
      "",
      `# Glossary ${status}`,
      "",
      ...lines.map((line) => `- ${line}`),
      ""
    ].join("\n");
    await this.writeVaultTextFile(joinVaultPath(folderPath, "_status.md"), markdown);
  }
  buildKeySentenceSidecar(file, provider, model, density, highlights) {
    return {
      version: 1,
      paper: file.path,
      provider,
      model,
      density,
      updated: (/* @__PURE__ */ new Date()).toISOString(),
      highlights: highlights.map((sentence) => ({
        paragraphId: sentence.paragraphId,
        paragraphIndex: sentence.paragraphIndex,
        sentenceId: sentence.id,
        text: sentence.text
      }))
    };
  }
  async loadKeySentenceSidecar(file) {
    const sidecarPath = this.keySentenceSidecarPath(file);
    const existing = this.app.vault.getAbstractFileByPath(sidecarPath);
    if (!(existing instanceof import_obsidian2.TFile)) {
      return {
        version: 1,
        paper: file.path,
        provider: "",
        model: "",
        density: "medium",
        updated: "",
        highlights: []
      };
    }
    try {
      const parsed = JSON.parse(await this.app.vault.read(existing));
      return {
        version: Number(parsed.version) || 1,
        paper: typeof parsed.paper === "string" ? parsed.paper : file.path,
        provider: typeof parsed.provider === "string" ? parsed.provider : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
        density: parsed.density === "sparse" ? "sparse" : "medium",
        updated: typeof parsed.updated === "string" ? parsed.updated : "",
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((item) => !!item && typeof item === "object").map((item) => ({
          paragraphId: typeof item.paragraphId === "string" ? item.paragraphId : "",
          paragraphIndex: Number(item.paragraphIndex),
          sentenceId: typeof item.sentenceId === "string" ? item.sentenceId : "",
          text: typeof item.text === "string" ? item.text : ""
        })).filter((item) => item.paragraphId && item.sentenceId && Number.isFinite(item.paragraphIndex) && item.text) : []
      };
    } catch (error) {
      console.error(error);
      return {
        version: 1,
        paper: file.path,
        provider: "",
        model: "",
        density: "medium",
        updated: "",
        highlights: []
      };
    }
  }
  async writeKeySentenceSidecar(file, sidecar) {
    await this.ensureFolder(this.sourceFolderPath(file));
    await this.writeVaultTextFile(
      this.keySentenceSidecarPath(file),
      `${JSON.stringify(sidecar, null, 2)}
`
    );
  }
  async writeVaultTextFile(vaultPath, text) {
    const existing = this.app.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof import_obsidian2.TFile) {
      await this.app.vault.modify(existing, text);
    } else {
      await this.app.vault.create(vaultPath, text);
    }
  }
  async loadGlossaryIndex(file, force = false) {
    const cached = this.glossaryCache.get(file.path);
    if (cached && !force) {
      return cached;
    }
    const folder = this.app.vault.getAbstractFileByPath(this.glossaryFolderPath(file));
    const entries = [];
    if (folder instanceof import_obsidian2.TFolder) {
      for (const child of folder.children) {
        if (child instanceof import_obsidian2.TFile && child.extension.toLowerCase() === "md") {
          const markdown = await this.app.vault.read(child);
          const entry = (0, import_core2.parseGlossaryMarkdown)(markdown);
          if (entry && (!entry.sourcePaper || entry.sourcePaper === file.path)) {
            entries.push(entry);
          }
        }
      }
    }
    const byTerm = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      byTerm.set((0, import_core2.normalizeTerm)(entry.term), entry);
      for (const alias of entry.aliases || []) {
        byTerm.set((0, import_core2.normalizeTerm)(alias), entry);
      }
    }
    const index = { entries, byTerm };
    this.glossaryCache.set(file.path, index);
    return index;
  }
  glossaryFolderPath(file) {
    return joinVaultPath((0, import_core2.getParentPath)(file.path), this.settings.glossaryFolderName);
  }
  sourceFolderPath(file) {
    return joinVaultPath((0, import_core2.getParentPath)(file.path), "_source");
  }
  keySentenceSidecarPath(file) {
    return joinVaultPath(this.sourceFolderPath(file), "key-sentences.json");
  }
  async uniqueFolderPath(basePath) {
    let candidate = basePath;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${basePath}-${index}`;
      index += 1;
    }
    return candidate;
  }
  async uniqueVaultPath(basePath) {
    const extensionIndex = basePath.lastIndexOf(".");
    const prefix = extensionIndex === -1 ? basePath : basePath.slice(0, extensionIndex);
    const extension = extensionIndex === -1 ? "" : basePath.slice(extensionIndex);
    let candidate = basePath;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${prefix}-${index}${extension}`;
      index += 1;
    }
    return candidate;
  }
  async ensureFolder(vaultPath) {
    const normalized = (0, import_obsidian2.normalizePath)(vaultPath);
    if (!normalized) {
      return;
    }
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      } else if (!(existing instanceof import_obsidian2.TFolder)) {
        throw new Error(`${current} exists and is not a folder.`);
      }
    }
  }
  setStatus(text) {
    if (this.statusEl) {
      this.statusEl.setText(text);
    }
  }
};
var PhilosophyReaderSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("Scholia").setHeading();
    new import_obsidian2.Setting(containerEl).setName("Markdown generation").setHeading();
    new import_obsidian2.Setting(containerEl).setName("PDF import backend").setDesc("Paper2MDViaLLM is now the default path. Scholar-MD stays available as a lighter beta path; Marker remains optional and not recommended.").addDropdown((dropdown) => dropdown.addOption("paper2mdviallm", "Paper2MDViaLLM").addOption("scholar-md", "Scholar-MD (beta)").addOption("marker", "Marker CLI (not recommended)").setValue(this.plugin.settings.pdfImportBackend).onChange(async (value) => {
      const backend = value === "marker" ? "marker" : value === "paper2mdviallm" ? "paper2mdviallm" : "scholar-md";
      this.plugin.settings.pdfImportBackend = backend;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Paper2MDViaLLM CLI path").setDesc("Optional. Resolution order: explicit setting, plugin .venv local tool, then shell PATH. You can paste either the executable itself or an environment root such as a conda env; Scholia will resolve `bin/paper2mdviallm` or `Scripts/paper2mdviallm.exe` inside it.").addText((text) => text.setPlaceholder("paper2mdviallm").setValue(this.plugin.settings.paper2mdviallmCommand).onChange(async (value) => {
      this.plugin.settings.paper2mdviallmCommand = value.trim() || DEFAULT_SETTINGS.paper2mdviallmCommand;
      await this.plugin.saveSettings();
    })).addButton((button) => button.setButtonText("Use local Paper2MDViaLLM").onClick(async () => {
      const localCommand = this.plugin.getLocalPaper2mdViaLlmCommand();
      if (!localCommand || !fs.existsSync(localCommand)) {
        new import_obsidian2.Notice("Local paper2mdviallm was not found in this plugin's .venv.");
        return;
      }
      this.plugin.settings.paper2mdviallmCommand = localCommand;
      await this.plugin.saveSettings();
      this.display();
      new import_obsidian2.Notice("Paper2MDViaLLM CLI path set to local paper2mdviallm.");
    }));
    new import_obsidian2.Setting(containerEl).setName("Markdown generation model").setDesc("Used by Paper2MDViaLLM. Provider is inferred from the model name, so API keys stay global and only need to be filled once.").addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.paper2mdviallmModel).setValue(this.plugin.settings.paper2mdviallmModel).onChange(async (value) => {
      this.plugin.settings.paper2mdviallmModel = value.trim() || DEFAULT_SETTINGS.paper2mdviallmModel;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Paper2MDViaLLM concurrency").setDesc("Only used when the backend is Paper2MDViaLLM. Higher values are faster but cost more API work in parallel.").addSlider((slider) => slider.setLimits(1, 6, 1).setDynamicTooltip().setValue(this.plugin.settings.paper2mdviallmConcurrency).onChange(async (value) => {
      this.plugin.settings.paper2mdviallmConcurrency = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Marker CLI path").setDesc("Optional. Only used when the backend is Marker CLI, which is not recommended.").addText((text) => text.setPlaceholder("marker_single").setValue(this.plugin.settings.markerCommand).onChange(async (value) => {
      this.plugin.settings.markerCommand = value.trim();
      await this.plugin.saveSettings();
    })).addButton((button) => button.setButtonText("Use local Marker").onClick(async () => {
      const localCommand = this.plugin.getLocalMarkerCommand();
      if (!localCommand || !fs.existsSync(localCommand)) {
        new import_obsidian2.Notice("Local marker_single was not found in this plugin's .venv.");
        return;
      }
      this.plugin.settings.markerCommand = localCommand;
      await this.plugin.saveSettings();
      this.display();
      new import_obsidian2.Notice("Marker CLI path set to local marker_single.");
    }));
    new import_obsidian2.Setting(containerEl).setName("API keys").setHeading();
    new import_obsidian2.Setting(containerEl).setName("OpenAI API key").setDesc("Stored in this plugin's Obsidian data.json for compatibility with older supported Obsidian versions.").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("sk-...").setValue(this.plugin.settings.openaiApiKey).onChange(async (value) => {
        this.plugin.settings.openaiApiKey = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Anthropic API key").setDesc("Stored in this plugin's Obsidian data.json for compatibility with older supported Obsidian versions.").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("sk-ant-...").setValue(this.plugin.settings.anthropicApiKey).onChange(async (value) => {
        this.plugin.settings.anthropicApiKey = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Reading prep").setHeading();
    new import_obsidian2.Setting(containerEl).setName("Reading prep provider").setDesc("Used for key-sentence highlighting plus term discovery and explanation after Markdown import.").addDropdown((dropdown) => dropdown.addOption("openai", "OpenAI (GPT)").addOption("anthropic", "Anthropic (Claude)").setValue(this.plugin.settings.provider).onChange(async (value) => {
      this.plugin.settings.provider = value === "anthropic" ? "anthropic" : "openai";
      await this.plugin.saveSettings();
      this.display();
    }));
    new import_obsidian2.Setting(containerEl).setName("Reading prep model").setDesc("This can differ from the Markdown generation model above. One-click import and reading prep stays available either way.").addText((text) => text.setPlaceholder(this.plugin.settings.provider === "anthropic" ? DEFAULT_SETTINGS.anthropicModel : DEFAULT_SETTINGS.openaiModel).setValue(getReadingModel(this.plugin.settings)).onChange(async (value) => {
      if (this.plugin.settings.provider === "anthropic") {
        this.plugin.settings.anthropicModel = value.trim() || DEFAULT_SETTINGS.anthropicModel;
      } else {
        this.plugin.settings.openaiModel = value.trim() || DEFAULT_SETTINGS.openaiModel;
      }
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Auto highlight key sentences after import").setDesc("When enabled, import runs key-sentence highlighting before glossary preprocessing.").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoHighlightKeySentences).onChange(async (value) => {
      this.plugin.settings.autoHighlightKeySentences = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Key sentence density").setDesc("Medium matches the current behavior. Sparse highlights only structurally important sentences.").addDropdown((dropdown) => dropdown.addOption("medium", "Medium").addOption("sparse", "Sparse").setValue(this.plugin.settings.keySentenceDensity).onChange(async (value) => {
      this.plugin.settings.keySentenceDensity = value === "sparse" ? "sparse" : "medium";
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Glossary").setHeading();
    new import_obsidian2.Setting(containerEl).setName("Max precomputed terms").setDesc("MVP default is 40. Higher values cost more and take longer.").addSlider((slider) => slider.setLimits(10, 120, 5).setDynamicTooltip().setValue(this.plugin.settings.maxPrecomputedTerms).onChange(async (value) => {
      this.plugin.settings.maxPrecomputedTerms = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Glossary folder name").addText((text) => text.setValue(this.plugin.settings.glossaryFolderName).onChange(async (value) => {
      this.plugin.settings.glossaryFolderName = value.trim() || DEFAULT_SETTINGS.glossaryFolderName;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Glossary explanation length").setDesc("Controls newly generated glossary entries. Standard stores a fuller contextual definition plus cluster notes; Concise stores a 30-50 word definition plus cluster notes. Rebuild glossary entries to refresh existing cache.").addDropdown((dropdown) => dropdown.addOption("standard", "Standard (current)").addOption("brief", "Concise (30-50 words)").setValue(this.plugin.settings.glossaryExplanationLength).onChange(async (value) => {
      this.plugin.settings.glossaryExplanationLength = value === "brief" ? "brief" : "standard";
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Enable SEP enrichment").setDesc("After glossary entries are prepared, fetch matching Stanford Encyclopedia of Philosophy introductions and cache a short SEP supplement for hover.").addToggle((toggle) => toggle.setValue(this.plugin.settings.sepEnrichmentEnabled).onChange(async (value) => {
      this.plugin.settings.sepEnrichmentEnabled = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Hover delay").setDesc("Milliseconds before the hover tooltip appears. Reload Obsidian after changing this.").addSlider((slider) => slider.setLimits(100, 1e3, 50).setDynamicTooltip().setValue(this.plugin.settings.hoverDelayMs).onChange(async (value) => {
      this.plugin.settings.hoverDelayMs = value;
      await this.plugin.saveSettings();
    }));
  }
};
function buildGlossaryReadyNotice(completed, sepSummary) {
  const base = `Glossary prepared: ${completed} new term${completed === 1 ? "" : "s"}.`;
  if (!sepSummary || sepSummary.attempted === 0) {
    return base;
  }
  return `${base} SEP matched ${sepSummary.matched}/${sepSummary.attempted}.`;
}
function buildPreparedTermNotice(term, sepSummary) {
  const base = `Prepared glossary entry: ${term}`;
  if (!sepSummary || sepSummary.attempted === 0) {
    return base;
  }
  if (sepSummary.matched > 0) {
    return `${base}. SEP summary cached.`;
  }
  if (sepSummary.notFound > 0) {
    return `${base}. No SEP entry matched.`;
  }
  if (sepSummary.failed > 0) {
    return `${base}. SEP enrichment failed.`;
  }
  return base;
}
function buildSepNotice(summary) {
  if (summary.attempted === 0) {
    return "SEP enrichment is already cached for the selected glossary entries.";
  }
  return `SEP enrichment complete: ${summary.matched} matched, ${summary.notFound} not found, ${summary.failed} failed, ${summary.skipped} skipped.`;
}
function joinVaultPath(...parts) {
  return (0, import_obsidian2.normalizePath)(parts.filter(Boolean).join("/"));
}
function buildImportedPaperMarkdown(markdown, metadata) {
  const content = markdown.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(metadata.title)}`,
    `source_pdf: ${JSON.stringify(metadata.sourcePdf)}`,
    `imported_at: ${JSON.stringify(metadata.importedAt)}`,
    "philosophy_reader: true",
    "---",
    ""
  ].join("\n");
  return `${frontmatter}${content}
`;
}
function buildImportWarningsMarkdown(backend, sourcePdfPath, quality) {
  const lines = [
    "---",
    `backend: ${JSON.stringify(backend)}`,
    `source_pdf: ${JSON.stringify(sourcePdfPath)}`,
    `risk_level: ${JSON.stringify(quality.riskLevel)}`,
    `risk_score: ${quality.riskScore}`,
    `updated: ${JSON.stringify((/* @__PURE__ */ new Date()).toISOString())}`,
    "---",
    "",
    "# PDF import warnings",
    "",
    `Backend: ${backend}`,
    `Source PDF: [[${sourcePdfPath}]]`,
    `Risk: ${quality.riskLevel} (${quality.riskScore})`,
    "",
    "## Counters",
    "",
    `- CID placeholders: ${quality.cidRefs}`,
    `- Boxed formula marks: ${quality.boxedFormulaMarks}`,
    `- Control characters: ${quality.controlChars}`,
    `- Encoding anomalies: ${quality.mojibakeMarks + quality.replacementChars}`,
    `- Suspicious formula marks: ${quality.suspiciousFormulaMarks}`,
    `- Long unspaced alphabetic runs: ${quality.longAlphaRuns}`,
    `- Markdown table-like lines: ${quality.markdownTableLines}`,
    "",
    "## Warnings",
    ""
  ];
  if (quality.warnings.length === 0) {
    lines.push("- No automatic warnings.");
  } else {
    lines.push(...quality.warnings.map((warning) => `- ${warning}`));
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    "- Ordinary prose may still be readable when risk is medium or high.",
    "- Do not trust formulas until CID placeholders, modal boxes, arrows, Greek letters, and subscripts have been spot-checked.",
    "- The next fallback stage should target only risky pages or formula regions, not OCR the whole PDF by default.",
    ""
  );
  return `${lines.join("\n")}
`;
}
function findLargestMarkdownFile(folder) {
  const files = [];
  const visit = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const itemPath = path.join(current, item.name);
      if (item.isDirectory()) {
        visit(itemPath);
      } else if (item.isFile() && item.name.toLowerCase().endsWith(".md")) {
        files.push(itemPath);
      }
    }
  };
  visit(folder);
  return files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0] || null;
}
function looksLikeLocalPath(command) {
  return command.includes("/") || command.includes("\\") || command.startsWith(`.${path.sep}`) || command.startsWith("~/") || command.startsWith("~\\");
}
function resolveConfiguredToolCommand(configured, executableBaseName) {
  const expanded = expandUserHome(configured);
  if (!looksLikeLocalPath(expanded) || !fs.existsSync(expanded)) {
    return expanded;
  }
  const stat = fs.statSync(expanded);
  if (!stat.isDirectory()) {
    return expanded;
  }
  const candidates = [
    path.join(expanded, "bin", executableBaseName),
    path.join(expanded, "Scripts", `${executableBaseName}.exe`),
    path.join(expanded, "Scripts", executableBaseName),
    path.join(expanded, "bin", `${executableBaseName}.exe`)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || expanded;
}
function expandUserHome(inputPath) {
  if (!inputPath.startsWith("~")) {
    return inputPath;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    return inputPath;
  }
  if (inputPath === "~") {
    return homeDir;
  }
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}
function getReadingModel(settings) {
  if (settings.provider === "anthropic") {
    return settings.anthropicModel.trim() || DEFAULT_SETTINGS.anthropicModel;
  }
  return settings.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel;
}
function isOpenAIModel(model) {
  return /^(gpt-|o1-|o3-|o4-)/.test(String(model || "").trim());
}
function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
function findSelectedKeySentence(paragraphs, paragraphId, sentenceId) {
  for (const paragraph of paragraphs) {
    if (paragraph.id !== paragraphId) {
      continue;
    }
    return paragraph.sentences.find((sentence) => sentence.id === sentenceId) || null;
  }
  return null;
}
function findMatchingInput(inputs, explanation) {
  const normalized = (0, import_core2.normalizeTerm)(explanation.term);
  return inputs.find((input) => (0, import_core2.normalizeTerm)(input.term) === normalized) || inputs[0] || null;
}
function formatMarkerLog(command, args, stdout, stderr) {
  return [
    `Command: ${JSON.stringify(command)} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`,
    "",
    "STDOUT:",
    String(stdout || "").trim() || "(empty)",
    "",
    "STDERR:",
    String(stderr || "").trim() || "(empty)",
    ""
  ].join("\n");
}
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
