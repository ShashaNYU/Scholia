import { requestUrl } from "obsidian";
import batchExplanationPrompt from "../prompts/batch-explanation.md";
import fallbackExplanationPrompt from "../prompts/fallback-explanation.md";
import termDiscoveryPrompt from "../prompts/term-discovery.md";
import { parseJsonFromText, parseLooseJsonFromText, type ContextCluster, type ParagraphWindow, type TermCandidate } from "./core.js";

export type ProviderName = "openai" | "anthropic";
export type PdfImportBackend = "pdfjs" | "markitdown" | "marker";

export interface PhilosophyReaderSettings {
  provider: ProviderName;
  openaiApiKey: string;
  anthropicApiKey: string;
  openaiModel: string;
  anthropicModel: string;
  pdfImportBackend: PdfImportBackend;
  markitdownCommand: string;
  markerCommand: string;
  maxPrecomputedTerms: number;
  glossaryFolderName: string;
  hoverDelayMs: number;
  windowSize: number;
  windowOverlap: number;
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

export interface ExplainedCluster {
  id: string;
  usageNote: string;
}

export interface ExplainedTerm {
  term: string;
  aliases: string[];
  definition: string;
  authorUsage: string;
  firstUse: string;
  clusters: ExplainedCluster[];
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  discoverTerms(request: DiscoverTermsRequest): Promise<TermCandidate[]>;
  explainTerms(request: ExplainTermsRequest): Promise<ExplainedTerm[]>;
  explainTermFallback(request: ExplainTermsRequest): Promise<ExplainedTerm>;
}

type JsonSchema = Record<string, unknown>;

abstract class BaseProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract readonly model: string;

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
    const json = await this.callJsonModel(batchExplanationPrompt, userPrompt, 5000, batchExplanationSchema);
    return readTermsArray<ExplainedTerm>(json, "Batch explanation response");
  }

  async explainTermFallback(request: ExplainTermsRequest): Promise<ExplainedTerm> {
    const userPrompt = JSON.stringify({
      paperTitle: request.paperTitle,
      sourcePaper: request.sourcePaper,
      term: request.terms[0]
    }, null, 2);
    const json = await this.callJsonModel(fallbackExplanationPrompt, userPrompt, 1800, fallbackExplanationSchema) as ExplainedTerm;
    if (!json || !json.term || !json.definition) {
      throw new Error("Fallback explanation response did not include a term definition.");
    }
    return json;
  }
}

function readTermsArray<T>(json: unknown, context: string): T[] {
  if (Array.isArray(json)) {
    return json as T[];
  }
  if (!json || typeof json !== "object") {
    throw new Error(`${context} did not include a terms array.`);
  }

  const terms = (json as { terms?: unknown }).terms;
  if (Array.isArray(terms)) {
    return terms as T[];
  }
  if (typeof terms === "string" && terms.trim()) {
    const parsed = parseLooseJsonFromText(terms);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { terms?: unknown }).terms)) {
      return (parsed as { terms: T[] }).terms;
    }
  }

  throw new Error(`${context} did not include a terms array.`);
}

class OpenAIProvider extends BaseProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    super();
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

  constructor(apiKey: string, model: string) {
    super();
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
        throw new Error(`Anthropic model is not available for this API key: ${this.model}. Change the model in Philosophy Reader settings.`);
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
        throw new Error(`Anthropic model is not available for this API key: ${this.model}. Try claude-3-5-sonnet-latest or change the model in Philosophy Reader settings.`);
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
    authorUsage: { type: "string" },
    firstUse: { type: "string" },
    clusters: { type: "array", items: explainedClusterSchema }
  },
  required: ["term", "aliases", "definition", "authorUsage", "firstUse", "clusters"]
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

export function createLLMProvider(settings: PhilosophyReaderSettings): LLMProvider {
  if (settings.provider === "anthropic") {
    return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel);
  }
  return new OpenAIProvider(settings.openaiApiKey, settings.openaiModel);
}
