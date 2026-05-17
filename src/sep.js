import core from "./core.js";

const { normalizeTerm } = core;

const SEP_SEARCH_ENDPOINT = "https://plato.stanford.edu/searcher.py";
const SEP_ENTRY_SUFFIX = /^https:\/\/plato\.stanford\.edu\/entries\/.+\/$/;
const SEP_RESULT_LIMIT = 5;
const SEP_DISAMBIGUATION_LIMIT = 3;
const SEP_CLEAR_SCORE = 90;
const SEP_CLEAR_SCORE_GAP = 15;
let requestUrlFn = null;

async function loadRequestUrl() {
  if (!requestUrlFn) {
    ({ requestUrl: requestUrlFn } = await import("obsidian"));
  }
  return requestUrlFn;
}

async function requestSepText(url) {
  const requestUrl = await loadRequestUrl();
  const response = await requestUrl({
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

async function searchSep(query) {
  const html = await requestSepText(`${SEP_SEARCH_ENDPOINT}?query=${encodeURIComponent(String(query || "").trim())}`);
  return parseSepSearchResults(html).slice(0, SEP_RESULT_LIMIT);
}

async function fetchSepEntry(url) {
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
      normalizedTitle: normalizeTerm(title)
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
  const paragraphs = Array.from(preambleHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (match) => stripHtml(match[1]))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const revised = firstCapture(source, /<meta name="DCTERMS\.modified" content="([^"]+)"/i, 1)
    || firstCapture(source, /<meta property="citation_publication_date" content="([^"]+)"/i, 1)
    || "";
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
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      ...candidate,
      score: scoreSepCandidate(candidate, term, aliases)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    });
}

function pickSepCandidateHeuristically(candidates, term, aliases) {
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
  const title = normalizeTerm(candidate && candidate.title);
  const snippet = normalizeTerm(candidate && candidate.snippet);
  const url = normalizeTerm(urlSlug(candidate && candidate.url));
  const queries = uniqueNormalizedTerms([term, ...(Array.isArray(aliases) ? aliases : [])]);
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
  const title = normalizeTerm(candidate && candidate.title);
  return uniqueNormalizedTerms([term, ...(Array.isArray(aliases) ? aliases : [])])
    .some((query) => query && query === title);
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => safeCodePoint(parseInt(num, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rsquo;/gi, "’")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safeCodePoint(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  try {
    return String.fromCodePoint(value);
  } catch {
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
  } catch {
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
  } catch {
    return "";
  }
}

function containsAllWords(haystack, needle) {
  const words = normalizeTerm(needle).split(" ").filter(Boolean);
  if (words.length === 0) {
    return false;
  }
  return words.every((word) => String(haystack || "").includes(word));
}

function uniqueNormalizedTerms(values) {
  return Array.from(new Set((values || [])
    .map((value) => normalizeTerm(value))
    .filter(Boolean)));
}

function urlSlug(url) {
  try {
    return new URL(String(url || "")).pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/^entries\//, "")
      .replace(/\//g, " ");
  } catch {
    return "";
  }
}

function firstCapture(text, pattern, index) {
  const match = String(text || "").match(pattern);
  return match ? String(match[index] || "") : "";
}

export {
  fetchSepEntry,
  parseSepEntryHtml,
  parseSepSearchResults,
  pickSepCandidateHeuristically,
  rankSepCandidates,
  scoreSepCandidate,
  searchSep,
  stripHtml
};
