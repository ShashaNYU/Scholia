import { requestUrl } from "obsidian";
import batchExplanationPrompt from "../prompts/batch-explanation.md";
import fallbackExplanationPrompt from "../prompts/fallback-explanation.md";
import keySentenceSelectionPrompt from "../prompts/key-sentence-selection.md";
import sepEntrySelectionPrompt from "../prompts/sep-entry-selection.md";
import sepSummaryPrompt from "../prompts/sep-summary.md";
import termDiscoveryPrompt from "../prompts/term-discovery.md";
import { parseJsonFromText, parseLooseJsonFromText, type ContextCluster, type ParagraphWindow, type TermCandidate } from "./core.js";
import type { SepSearchCandidate } from "./sep.js";

export type ProviderName = "openai" | "anthropic";
export type PdfImportBackend = "scholar-md" | "paper2mdviallm" | "marker";
export type GlossaryExplanationLength = "standard" | "brief";
export type KeySentenceDensity = "sparse" | "medium";

export interface PhilosophyReaderSettings {
  provider: ProviderName;
  openaiApiKey: string;
  anthropicApiKey: string;
  openaiModel: string;
  anthropicModel: string;
  pdfImportBackend: PdfImportBackend;
  paper2mdviallmCommand: string;
  paper2mdviallmModel: string;
  paper2mdviallmConcurrency: number;
  markerCommand: string;
  maxPrecomputedTerms: number;
  glossaryFolderName: string;
  glossaryExplanationLength: GlossaryExplanationLength;
  sepEnrichmentEnabled: boolean;
  hoverDelayMs: number;
  windowSize: number;
  windowOverlap: number;
  autoHighlightKeySentences: boolean;
  keySentenceDensity: KeySentenceDensity;
}

export interface DiscoverTermsRequest {
  paperTitle: string;
  sourcePaper: string;
  window: ParagraphWindow;
}

export interface ExplainTermInput {
  term: string;
  aliases: string[];
  reason?: string;
  importance?: number;
  occurrences: Array<{
    start: number;
    end: number;
    alias: string;
    excerpt: string;
  }>;
  clusters: ContextCluster[];
}

export interface ExplainTermsRequest {
  paperTitle: string;
  sourcePaper: string;
  terms: ExplainTermInput[];
}

export interface ChooseSepEntryRequest {
  paperTitle: string;
  sourcePaper: string;
  term: string;
  aliases: string[];
  definition: string;
  clusters: ContextCluster[];
  candidates: SepSearchCandidate[];
}

export interface ChosenSepEntry {
  matched: boolean;
  title: string;
  url: string;
  reason: string;
}

export interface SummarizeSepEntryRequest {
  paperTitle: string;
  sourcePaper: string;
  term: string;
  definition: string;
  entryTitle: string;
  entryUrl: string;
  preamble: string;
}

export interface SepSummary {
  summary: string;
}

export interface KeySentenceInput {
  id: string;
  text: string;
}

export interface KeySentenceParagraphInput {
  paragraphId: string;
  paragraphIndex: number;
  heading: string;
  text: string;
  sentences: KeySentenceInput[];
}

export interface SelectKeySentencesRequest {
  paperTitle: string;
  sourcePaper: string;
  density: KeySentenceDensity;
  paragraphs: KeySentenceParagraphInput[];
}

export interface SelectedKeySentence {
  paragraphId: string;
  sentenceId: string;
}

export interface ExplainedCluster {
  id: string;
  usageNote: string;
}

export interface ExplainedTerm {
  term: string;
  aliases: string[];
  definition: string;
  clusters: ExplainedCluster[];
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  chooseSepEntry(request: ChooseSepEntryRequest): Promise<ChosenSepEntry>;
  discoverTerms(request: DiscoverTermsRequest): Promise<TermCandidate[]>;
  explainTerms(request: ExplainTermsRequest): Promise<ExplainedTerm[]>;
  explainTermFallback(request: ExplainTermsRequest): Promise<ExplainedTerm>;
  selectKeySentences(request: SelectKeySentencesRequest): Promise<SelectedKeySentence[]>;
  summarizeSepEntry(request: SummarizeSepEntryRequest): Promise<SepSummary>;
}

type JsonSchema = Record<string, unknown>;

abstract class BaseProvider implements LLMProvider {
  protected readonly explanationLength: GlossaryExplanationLength;
  abstract readonly name: ProviderName;
  abstract readonly model: string;

  constructor(explanationLength: GlossaryExplanationLength) {
    this.explanationLength = explanationLength;
  }

  abstract callModel(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
  async callJsonModel(systemPrompt: string, userPrompt: string, maxTokens: number, schema: JsonSchema): Promise<unknown> {
    const text = await this.callModel(systemPrompt, userPrompt, maxTokens);
    return parseJsonFromText(text);
  }

  async discoverTerms(request: DiscoverTermsRequest): Promise<TermCandidate[]> {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      window: request.window
    }, null, 2);
    const json = await this.callJsonModel(termDiscoveryPrompt, userPrompt, 2400, termDiscoverySchema);
    return readTermsArray<TermCandidate>(json, "Term discovery response");
  }

  async explainTerms(request: ExplainTermsRequest): Promise<ExplainedTerm[]> {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      terms: request.terms
    }, null, 2);
    const json = await this.callJsonModel(buildBatchExplanationPrompt(this.explanationLength), userPrompt, 5000, batchExplanationSchema);
    return readTermsArray<ExplainedTerm>(json, "Batch explanation response");
  }

  async explainTermFallback(request: ExplainTermsRequest): Promise<ExplainedTerm> {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      term: request.terms[0]
    }, null, 2);
    const json = await this.callJsonModel(buildFallbackExplanationPrompt(this.explanationLength), userPrompt, 1800, fallbackExplanationSchema) as ExplainedTerm;
    if (!json || !json.term || !json.definition) {
      throw new Error("Fallback explanation response did not include a term definition.");
    }
    return json;
  }

  async selectKeySentences(request: SelectKeySentencesRequest): Promise<SelectedKeySentence[]> {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      density: request.density,
      paragraphs: request.paragraphs
    }, null, 2);
    const json = await this.callJsonModel(keySentenceSelectionPrompt, userPrompt, 2600, keySentenceSelectionSchema);
    return readArrayField<SelectedKeySentence>(json, "paragraphs", "Key sentence selection response");
  }

  async chooseSepEntry(request: ChooseSepEntryRequest): Promise<ChosenSepEntry> {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      term: request.term,
      aliases: request.aliases,
      definition: request.definition,
      clusters: request.clusters,
      candidates: request.candidates
    }, null, 2);
    const json = await this.callJsonModel(sepEntrySelectionPrompt, userPrompt, 1800, sepEntrySelectionSchema) as ChosenSepEntry;
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

  async summarizeSepEntry(request: SummarizeSepEntryRequest): Promise<SepSummary> {
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
    const json = await this.callJsonModel(sepSummaryPrompt, userPrompt, 1200, sepSummarySchema) as SepSummary;
    if (!json || typeof json.summary !== "string" || !json.summary.trim()) {
      throw new Error("SEP summary response did not include a summary string.");
    }
    return {
      summary: json.summary.trim()
    };
  }
}

function readArrayField<T>(json: unknown, fieldName: string, context: string): T[] {
  if (Array.isArray(json)) {
    return json as T[];
  }
  if (!json || typeof json !== "object") {
    throw new Error(`${context} did not include a ${fieldName} array.`);
  }

  const value = (json as Record<string, unknown>)[fieldName];
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = parseLooseJsonFromText(value);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)[fieldName])) {
      return (parsed as Record<string, T[]>)[fieldName];
    }
  }

  throw new Error(`${context} did not include a ${fieldName} array.`);
}

function readTermsArray<T>(json: unknown, context: string): T[] {
  return readArrayField<T>(json, "terms", context);
}

class OpenAIProvider extends BaseProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string, explanationLength: GlossaryExplanationLength) {
    super(explanationLength);
    this.apiKey = apiKey;
    this.model = model;
  }

  async callModel(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is missing.");
    }

    const response = await requestUrl({
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
}

class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string, explanationLength: GlossaryExplanationLength) {
    super(explanationLength);
    this.apiKey = apiKey;
    this.model = model;
  }

  async callJsonModel(systemPrompt: string, userPrompt: string, maxTokens: number, schema: JsonSchema): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is missing.");
    }

    const response = await requestUrl({
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

    const responseJson = response.json as { stop_reason?: string };
    const toolInput = extractAnthropicToolInput(responseJson);
    if (responseJson.stop_reason === "max_tokens" && isEmptyObject(toolInput)) {
      throw new Error(`Anthropic response hit max_tokens (${maxTokens}) before returning structured JSON. Reduce the glossary window size or increase the output budget.`);
    }
    if (!toolInput) {
      return parseJsonFromText(extractAnthropicText(responseJson));
    }
    return toolInput;
  }

  async callModel(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is missing.");
    }

    const response = await requestUrl({
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
}

function extractOpenAIText(json: unknown): string {
  const response = json as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts: string[] = [];
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

function extractAnthropicText(json: unknown): string {
  const response = json as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (response.content || [])
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
  if (!text.trim()) {
    throw new Error("Anthropic response did not contain text.");
  }
  return text;
}

function extractAnthropicToolInput(json: unknown): unknown | null {
  const response = json as {
    content?: Array<{ type?: string; name?: string; input?: unknown }>;
  };
  const toolUse = (response.content || []).find((item) => item.type === "tool_use" && item.name === "return_json");
  return toolUse && typeof toolUse === "object" && "input" in toolUse ? toolUse.input : null;
}

function isEmptyObject(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

interface ExplanationPromptVariant {
  definitionRequirement: string;
  clusterRequirement: string;
}

const explanationPromptVariants: Record<GlossaryExplanationLength, ExplanationPromptVariant> = {
  standard: {
    definitionRequirement: "Write a paper-level definition of about 80-120 words.",
    clusterRequirement: "Write one short usage note for each supplied context cluster. The usage note should explain what the term is doing in that passage or section."
  },
  brief: {
    definitionRequirement: "Write a concise definition of about 30-50 words that only explains the term's meaning in this paper.",
    clusterRequirement: "For each supplied context cluster, leave usageNote empty unless that passage materially changes the meaning; if needed, keep it to one very short sentence."
  }
};

function buildBatchExplanationPrompt(explanationLength: GlossaryExplanationLength): string {
  return renderExplanationPrompt(batchExplanationPrompt, explanationLength);
}

function buildFallbackExplanationPrompt(explanationLength: GlossaryExplanationLength): string {
  return renderExplanationPrompt(fallbackExplanationPrompt, explanationLength);
}

function renderExplanationPrompt(template: string, explanationLength: GlossaryExplanationLength): string {
  const variant = explanationPromptVariants[explanationLength] || explanationPromptVariants.standard;
  return template
    .replace("{{DEFINITION_REQUIREMENT}}", variant.definitionRequirement)
    .replace("{{CLUSTER_REQUIREMENT}}", variant.clusterRequirement);
}

const termDiscoverySchema: JsonSchema = {
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

const explainedClusterSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    usageNote: { type: "string" }
  },
  required: ["id", "usageNote"]
};

const explainedTermSchema: JsonSchema = {
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

const chosenSepEntrySchema: JsonSchema = {
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

const sepSummarySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" }
  },
  required: ["summary"]
};

const selectedKeySentenceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    paragraphId: { type: "string" },
    sentenceId: { type: "string" }
  },
  required: ["paragraphId", "sentenceId"]
};

const keySentenceSelectionSchema: JsonSchema = {
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

const batchExplanationSchema: JsonSchema = {
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

const fallbackExplanationSchema: JsonSchema = explainedTermSchema;
const sepEntrySelectionSchema: JsonSchema = chosenSepEntrySchema;

export function createLLMProvider(settings: PhilosophyReaderSettings): LLMProvider {
  if (settings.provider === "anthropic") {
    return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel, settings.glossaryExplanationLength);
  }
  return new OpenAIProvider(settings.openaiApiKey, settings.openaiModel, settings.glossaryExplanationLength);
}
