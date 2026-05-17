import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  App,
  FileSystemAdapter,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath
} from "obsidian";
import {
  analyzeMarkdownQuality,
  applySentenceHighlights,
  buildContextClusters,
  buildGlossaryMarkdown,
  buildKeySentenceParagraphs,
  buildParagraphWindows,
  chooseClusterForOffset,
  excerptAround,
  findPreparedTermAtPosition,
  findTermOccurrences,
  findWordAtPosition,
  getBaseName,
  getParentPath,
  mergeTermCandidates,
  normalizeTerm,
  parseGlossaryMarkdown,
  removeManagedSentenceHighlights,
  slugify,
  splitParagraphs,
  type ContextCluster,
  type GlossaryEntry,
  type KeySentenceParagraph,
  type MarkdownQualityReport,
  type SepEntryData,
  type SentenceSpan,
  type TermCandidate
} from "./core.js";
import {
  createLLMProvider,
  type ChosenSepEntry,
  type ExplainTermInput,
  type ExplainedTerm,
  type KeySentenceParagraphInput,
  type KeySentenceDensity,
  type LLMProvider,
  type PdfImportBackend,
  type PhilosophyReaderSettings,
  type SepSummary
} from "./llmProviders";
import {
  fetchSepEntry,
  pickSepCandidateHeuristically,
  searchSep,
  type ParsedSepEntry,
  type RankedSepCandidate,
  type SepSearchCandidate
} from "./sep.js";

const execFileAsync = promisify(execFile);
const EXPLANATION_BATCH_SIZE = 2;
const KEY_SENTENCE_BATCH_SIZE = 6;
const MAX_EXPLANATION_OCCURRENCES = 5;
const EXPLANATION_EXCERPT_RADIUS = 350;
const MAX_EXPLANATION_CLUSTERS = 3;
const SEP_CANDIDATE_LIMIT = 5;

const DEFAULT_SETTINGS: PhilosophyReaderSettings = {
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

interface GlossaryIndex {
  entries: GlossaryEntry[];
  byTerm: Map<string, GlossaryEntry>;
}

interface RebuildOptions {
  background?: boolean;
}

interface ImportPdfOptions {
  precomputeGlossary?: boolean;
}

interface SepEnrichmentOptions {
  background?: boolean;
  provider?: LLMProvider;
  requestedTerms?: string[];
  writeStatus?: boolean;
}

interface SepEnrichmentSummary {
  attempted: number;
  matched: number;
  notFound: number;
  failed: number;
  skipped: number;
}

interface ResolvedCommand {
  command: string;
  source: "local" | "path";
}

interface HighlightKeySentencesOptions {
  background?: boolean;
  silentSuccess?: boolean;
}

interface KeySentenceSidecarRecord {
  paragraphId: string;
  paragraphIndex: number;
  sentenceId: string;
  text: string;
}

interface KeySentenceSidecar {
  version: number;
  paper: string;
  provider: string;
  model: string;
  density: KeySentenceDensity;
  updated: string;
  highlights: KeySentenceSidecarRecord[];
}

export default class PhilosophyReaderPlugin extends Plugin {
  settings: PhilosophyReaderSettings = { ...DEFAULT_SETTINGS };
  private statusEl: HTMLElement | null = null;
  private glossaryCache = new Map<string, GlossaryIndex>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("scholia-progress");
    this.setStatus("");

    this.addSettingTab(new PhilosophyReaderSettingTab(this.app, this));
    this.registerEditorExtension(this.buildHoverExtension());
    this.registerContextMenuActions();

    this.addCommand({
      id: "import-pdf-as-philosophy-paper",
      name: "Import PDF and prepare for reading",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "pdf";
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
      name: "Convert current PDF to Markdown only",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "pdf";
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
      name: "Rebuild glossary for current paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "md";
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
      name: "Extract terms and explain from current Markdown",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "md";
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
      name: "Enrich glossary with sep for current paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "md";
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
      name: "Highlight key sentences for current paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "md";
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
      name: "Explain term now",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        const selection = editor.getSelection().trim();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "md" && selection.length > 0;
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

  onunload(): void {
    this.setStatus("");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.migrateStaleImportSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.glossaryCache.clear();
  }

  getLocalMarkerCommand(): string | null {
    return this.findLocalToolCommand("marker_single");
  }

  getLocalScholarMdCommand(): string | null {
    return this.findLocalToolCommand("scholar-md");
  }

  getLocalPaper2mdViaLlmCommand(): string | null {
    return this.findLocalToolCommand("paper2mdviallm");
  }

  private findLocalToolCommand(executableBaseName: string): string | null {
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

  private resolveScholarMdCommand(): ResolvedCommand {
    const localScholarMd = this.getLocalScholarMdCommand();
    if (localScholarMd && fs.existsSync(localScholarMd)) {
      return { command: localScholarMd, source: "local" };
    }

    return { command: "scholar-md", source: "path" };
  }

  private resolvePaper2mdViaLlmCommand(): ResolvedCommand {
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

  private getPluginDiskPath(): string | null {
    const adapter = this.app.vault.adapter;
    const pluginDir = this.manifest.dir;
    if (!(adapter instanceof FileSystemAdapter) || !pluginDir) {
      return null;
    }

    return path.join(adapter.getBasePath(), pluginDir);
  }

  private migrateStaleImportSettings(): void {
    const markerCommand = this.settings.markerCommand || "";
    const pointsAtDeletedLocalMarker = markerCommand.includes(`${path.sep}.venv${path.sep}bin${path.sep}marker_single`) && !fs.existsSync(markerCommand);
    if (pointsAtDeletedLocalMarker) {
      this.settings.pdfImportBackend = DEFAULT_SETTINGS.pdfImportBackend;
      this.settings.markerCommand = DEFAULT_SETTINGS.markerCommand;
      void this.saveSettings();
    }

    if ((this.settings.pdfImportBackend as string) === "markitdown" || (this.settings.pdfImportBackend as string) === "pdfjs") {
      this.settings.pdfImportBackend = DEFAULT_SETTINGS.pdfImportBackend;
      void this.saveSettings();
    }

    const raw = this.settings as unknown as Record<string, unknown>;
    if (raw.paper2mdCommand !== undefined && raw.paper2mdviallmCommand === undefined) {
      raw.paper2mdviallmCommand = raw.paper2mdCommand;
      delete raw.paper2mdCommand;
      void this.saveSettings();
    }
    if (raw.paper2mdModel !== undefined && raw.paper2mdviallmModel === undefined) {
      raw.paper2mdviallmModel = raw.paper2mdModel;
      delete raw.paper2mdModel;
      void this.saveSettings();
    }
    if (raw.paper2mdConcurrency !== undefined && raw.paper2mdviallmConcurrency === undefined) {
      raw.paper2mdviallmConcurrency = raw.paper2mdConcurrency;
      delete raw.paper2mdConcurrency;
      void this.saveSettings();
    }
    if ((this.settings.pdfImportBackend as string) === "paper2md") {
      this.settings.pdfImportBackend = "paper2mdviallm";
      void this.saveSettings();
    }
    if (raw.markitdownCommand !== undefined) {
      delete raw.markitdownCommand;
      void this.saveSettings();
    }
    if (raw.scholarMdCommand !== undefined) {
      delete raw.scholarMdCommand;
      void this.saveSettings();
    }
  }

  private buildHoverExtension() {
    return hoverTooltip(
      async (view: EditorView, pos: number): Promise<Tooltip | null> => this.resolveHoverTooltip(view, pos),
      { hoverTime: this.settings.hoverDelayMs }
    );
  }

  private registerContextMenuActions(): void {
    this.registerEvent(this.app.workspace.on("file-menu", (menu, abstractFile) => {
      if (!(abstractFile instanceof TFile)) {
        return;
      }

      const extension = abstractFile.extension.toLowerCase();
      if (extension === "pdf") {
        menu.addItem((item) => item
          .setTitle("Import PDF and prepare for reading")
          .setIcon("sparkles")
          .onClick(() => {
            void this.importPdfAsPaper(abstractFile, { precomputeGlossary: true });
          }));

        menu.addItem((item) => item
          .setTitle("Convert PDF to Markdown only")
          .setIcon("file-text")
          .onClick(() => {
            void this.importPdfAsPaper(abstractFile, { precomputeGlossary: false });
          }));
      }

      if (extension === "md") {
        menu.addItem((item) => item
          .setTitle("Highlight key sentences")
          .setIcon("highlighter")
          .onClick(() => {
            void this.highlightKeySentences(abstractFile, { background: false });
          }));

        menu.addItem((item) => item
          .setTitle("Extract terms and explain")
          .setIcon("brain")
          .onClick(() => {
            void this.extractTermsAndExplain(abstractFile);
          }));

        menu.addItem((item) => item
          .setTitle("Enrich glossary with sep")
          .setIcon("book-open")
          .onClick(() => {
            void this.enrichGlossaryWithSepForPaper(abstractFile, { background: false });
          }));
      }
    }));
  }

  private async resolveHoverTooltip(view: EditorView, pos: number): Promise<Tooltip | null> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
      return null;
    }

    const line = view.state.doc.lineAt(pos);
    const relativePosition = pos - line.from;
    const index = await this.loadGlossaryIndex(file);
    const prepared = findPreparedTermAtPosition(line.text, relativePosition, index.entries);

    if (prepared) {
      const cluster = chooseClusterForOffset(prepared.entry, pos);
      return {
        pos: line.from + prepared.from,
        end: line.from + prepared.to,
        above: true,
        create: () => ({ dom: this.renderPreparedTooltip(prepared.entry, cluster) })
      };
    }

    const word = findWordAtPosition(line.text, relativePosition);
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

  private renderPreparedTooltip(entry: GlossaryEntry, cluster: ContextCluster | null): HTMLElement {
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

  private renderUnpreparedTooltip(word: string, file: TFile): HTMLElement {
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

  private async importPdfAsPaper(file: TFile, options: ImportPdfOptions = {}): Promise<void> {
    try {
      const precomputeGlossary = options.precomputeGlossary !== false;
      if (this.settings.pdfImportBackend === "marker" && !this.settings.markerCommand.trim()) {
        new Notice("Set the marker CLI path in settings first.");
        return;
      }
      const scholarMdCommand = this.resolveScholarMdCommand();
      const paper2mdViaLlmCommand = this.resolvePaper2mdViaLlmCommand();

      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) {
        new Notice("PDF import requires a local filesystem vault.");
        return;
      }

      const baseName = getBaseName(file.path);
      const paperSlug = slugify(baseName, "paper");
      const parentPath = getParentPath(file.path);
      const parentBaseName = parentPath ? getBaseName(parentPath) : "";
      const defaultPaperFolder = joinVaultPath(parentPath, paperSlug);
      const existingDefaultFolder = this.app.vault.getAbstractFileByPath(defaultPaperFolder);
      const paperFolder = parentBaseName === paperSlug
        ? parentPath
        : !existingDefaultFolder || existingDefaultFolder instanceof TFolder
          ? defaultPaperFolder
          : this.uniqueFolderPath(defaultPaperFolder);
      await this.ensureFolder(paperFolder);

      let pdfTarget = joinVaultPath(paperFolder, `${paperSlug}.pdf`);
      if (file.path !== pdfTarget) {
        const existingPdfTarget = this.app.vault.getAbstractFileByPath(pdfTarget);
        if (!existingPdfTarget) {
          await this.app.vault.createBinary(pdfTarget, await this.app.vault.readBinary(file));
        } else if (!(existingPdfTarget instanceof TFile)) {
          throw new Error(`${pdfTarget} exists and is not a PDF file.`);
        }
      }
      const movedPdf = this.app.vault.getAbstractFileByPath(pdfTarget);
      if (!(movedPdf instanceof TFile)) {
        throw new Error("PDF import copy could not be found in the vault.");
      }

      await this.ensureFolder(joinVaultPath(paperFolder, this.settings.glossaryFolderName));
      await this.ensureFolder(joinVaultPath(paperFolder, "_source"));

      const pdfAbsPath = adapter.getFullPath(pdfTarget);
      const importedMarkdown = this.settings.pdfImportBackend === "marker"
        ? await this.convertPdfWithMarker(pdfAbsPath, paperFolder, adapter)
        : this.settings.pdfImportBackend === "paper2mdviallm"
          ? await this.convertPdfWithPaper2MDViaLLM(pdfAbsPath, paperFolder, baseName, pdfTarget, adapter, paper2mdViaLlmCommand)
          : await this.convertPdfWithScholarMd(pdfAbsPath, paperFolder, baseName, pdfTarget, adapter, scholarMdCommand);
      const paperMarkdown = buildImportedPaperMarkdown(importedMarkdown, {
        title: baseName,
        sourcePdf: pdfTarget,
        importedAt: new Date().toISOString()
      });

      const mdTarget = this.uniqueVaultPath(joinVaultPath(paperFolder, `${paperSlug}.md`));
      await this.app.vault.create(mdTarget, paperMarkdown);

      const markdownFile = this.app.vault.getAbstractFileByPath(mdTarget);
      if (markdownFile instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(markdownFile);
        if (precomputeGlossary) {
          if (this.settings.autoHighlightKeySentences) {
            new Notice("PDF imported. Key sentence highlighting and glossary preprocessing are running in the background.");
            void this.preparePaperForReading(markdownFile, { background: true });
          } else {
            new Notice("PDF imported. Glossary preprocessing is running in the background. Check _glossary/_status.md for progress.");
            void this.rebuildGlossary(markdownFile, { background: true });
          }
        } else {
          new Notice("The file was converted. Run the extract command when you are ready.");
        }
      }
    } catch (error) {
      new Notice(`PDF import failed: ${toErrorMessage(error)}`);
      console.error(error);
    } finally {
      this.setStatus("");
    }
  }

  private async convertPdfWithPaper2MDViaLLM(
    pdfAbsPath: string,
    paperFolder: string,
    paperTitle: string,
    sourcePdfPath: string,
    adapter: FileSystemAdapter,
    resolvedCommand: ResolvedCommand
  ): Promise<string> {
    const model = this.resolvePaper2mdViaLlmModel();
    const concurrency = Math.max(1, Math.round(this.settings.paper2mdviallmConcurrency || DEFAULT_SETTINGS.paper2mdviallmConcurrency));
    const usingOpenAI = isOpenAIModel(model);
    if (usingOpenAI && !this.settings.openaiApiKey.trim()) {
      throw new Error("Paper2MDViaLLM is configured with an OpenAI model, but the OpenAI API key is empty.");
    }
    if (!usingOpenAI && !this.settings.anthropicApiKey.trim()) {
      throw new Error("Paper2MDViaLLM is configured with an Anthropic model, but the Anthropic API key is empty.");
    }

    this.setStatus("Converting PDF with paper2mdviallm...");
    const commandLabel = resolvedCommand.source === "local" ? "local Paper2MDViaLLM" : "Paper2MDViaLLM";
    new Notice(`Converting PDF with ${commandLabel}...`);

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
      const execError = error as Error & { stdout?: string; stderr?: string };
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

    const quality = analyzeMarkdownQuality(importedMarkdown);
    await this.writeVaultTextFile(joinVaultPath(paperFolder, "_source", "paper2mdviallm.md"), `${importedMarkdown}\n`);
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
        importedAt: new Date().toISOString(),
        quality
      }, null, 2)}\n`
    );
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-warnings.md"),
      buildImportWarningsMarkdown("Paper2MDViaLLM", sourcePdfPath, quality)
    );

    fs.rmSync(outputDir, { recursive: true, force: true });
    if (quality.riskLevel === "high" || quality.riskLevel === "medium") {
      new Notice(`PDF imported with ${quality.riskLevel} extraction risk. Check _source/import-warnings.md before trusting formulas.`);
    }
    return importedMarkdown;
  }

  private async convertPdfWithScholarMd(
    pdfAbsPath: string,
    paperFolder: string,
    paperTitle: string,
    sourcePdfPath: string,
    adapter: FileSystemAdapter,
    resolvedCommand: ResolvedCommand
  ): Promise<string> {
    this.setStatus("Converting PDF with scholar-md...");
    const commandLabel = resolvedCommand.source === "local" ? "local Scholar-MD" : "Scholar-MD";
    new Notice(`Converting PDF with ${commandLabel} (beta)...`);

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
      const execError = error as Error & { stdout?: string; stderr?: string };
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

    const quality = analyzeMarkdownQuality(importedMarkdown);
    await this.writeVaultTextFile(joinVaultPath(paperFolder, "_source", "scholar-md.md"), `${importedMarkdown}\n`);
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
        importedAt: new Date().toISOString(),
        quality
      }, null, 2)}\n`
    );
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-warnings.md"),
      buildImportWarningsMarkdown("Scholar-MD", sourcePdfPath, quality)
    );

    fs.rmSync(outputDir, { recursive: true, force: true });
    if (quality.riskLevel === "high" || quality.riskLevel === "medium") {
      new Notice(`PDF imported with ${quality.riskLevel} extraction risk. Check _source/import-warnings.md before trusting formulas.`);
    }
    return importedMarkdown;
  }

  private async convertPdfWithMarker(pdfAbsPath: string, paperFolder: string, adapter: FileSystemAdapter): Promise<string> {
    this.setStatus("Converting PDF with Marker...");
    new Notice("Converting PDF with marker...");
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
      const execError = error as Error & { stdout?: string; stderr?: string };
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

  private resolvePaper2mdViaLlmModel(): string {
    const override = this.settings.paper2mdviallmModel.trim();
    if (override) {
      return override;
    }
    return DEFAULT_SETTINGS.paper2mdviallmModel;
  }

  private buildPaper2mdEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.settings.openaiApiKey.trim()) {
      env.OPENAI_API_KEY = this.settings.openaiApiKey.trim();
    }
    if (this.settings.anthropicApiKey.trim()) {
      env.ANTHROPIC_API_KEY = this.settings.anthropicApiKey.trim();
    }
    return env;
  }

  private async preparePaperForReading(file: TFile, options: { background?: boolean } = {}): Promise<void> {
    if (this.settings.autoHighlightKeySentences) {
      await this.highlightKeySentences(file, {
        background: options.background,
        silentSuccess: true
      });
    }
    await this.rebuildGlossary(file, { background: options.background });
  }

  private async highlightKeySentences(file: TFile, options: HighlightKeySentencesOptions = {}): Promise<boolean> {
    try {
      const provider = createLLMProvider(this.settings);
      const originalMarkdown = await this.app.vault.read(file);
      const existingSidecar = await this.loadKeySentenceSidecar(file);
      const cleanedMarkdown = removeManagedSentenceHighlights(originalMarkdown, existingSidecar.highlights);
      const paragraphs = splitParagraphs(cleanedMarkdown);
      const candidates = buildKeySentenceParagraphs(cleanedMarkdown, paragraphs);

      if (candidates.length === 0) {
        if (cleanedMarkdown !== originalMarkdown) {
          await this.writeVaultTextFile(file.path, cleanedMarkdown);
        }
        await this.writeKeySentenceSidecar(file, this.buildKeySentenceSidecar(file, provider.name, provider.model, this.settings.keySentenceDensity, []));
        if (!options.silentSuccess) {
          new Notice("No multi-sentence prose paragraphs were eligible for key-sentence highlighting.");
        }
        return true;
      }

      const selectedByParagraph = new Map<string, SentenceSpan>();
      let processed = 0;
      for (const batch of chunk(candidates, KEY_SENTENCE_BATCH_SIZE)) {
        const rangeStart = processed + 1;
        const rangeEnd = processed + batch.length;
        processed += batch.length;
        this.setStatus(`Selecting key sentences ${rangeStart}-${rangeEnd}/${candidates.length}`);

        const selections = await provider.selectKeySentences({
          paperTitle: getBaseName(file.path),
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
      const highlightedMarkdown = applySentenceHighlights(cleanedMarkdown, highlights);
      if (highlightedMarkdown !== originalMarkdown) {
        await this.writeVaultTextFile(file.path, highlightedMarkdown);
      }
      await this.writeKeySentenceSidecar(file, this.buildKeySentenceSidecar(file, provider.name, provider.model, this.settings.keySentenceDensity, highlights));

      if (!options.silentSuccess) {
        if (highlights.length === 0) {
          new Notice("No key sentences were selected for highlighting.");
        } else {
          new Notice(`Highlighted key sentences: ${highlights.length} paragraph${highlights.length === 1 ? "" : "s"}.`);
        }
      }
      return true;
    } catch (error) {
      new Notice(`Key sentence highlighting failed: ${toErrorMessage(error)}`);
      console.error(error);
      return false;
    } finally {
      this.setStatus("");
    }
  }

  private toKeySentenceParagraphInput(paragraph: KeySentenceParagraph): KeySentenceParagraphInput {
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

  private async rebuildGlossary(file: TFile, options: RebuildOptions): Promise<void> {
    try {
      const provider = createLLMProvider(this.settings);
      const markdown = await this.app.vault.read(file);
      const paragraphs = splitParagraphs(markdown);
      await this.ensureFolder(this.glossaryFolderPath(file));
      await this.writeGlossaryStatus(file, "running", [
        `Started: ${new Date().toISOString()}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`,
        `Paper: ${file.path}`
      ]);
      if (paragraphs.length === 0) {
        new Notice("No readable paragraphs found in this paper.");
        await this.writeGlossaryStatus(file, "failed", [
          "No readable paragraphs found in this paper."
        ]);
        return;
      }

      const windows = buildParagraphWindows(paragraphs, this.settings.windowSize, this.settings.windowOverlap);
      const discovered: TermCandidate[] = [];

      for (let index = 0; index < windows.length; index += 1) {
        this.setStatus(`Discovering terms ${index + 1}/${windows.length}`);
        const terms = await provider.discoverTerms({
          paperTitle: getBaseName(file.path),
          sourcePaper: file.path,
          window: windows[index]
        });
        discovered.push(...terms);
      }

      const topTerms = mergeTermCandidates(discovered, this.settings.maxPrecomputedTerms);
      await this.writeGlossaryStatus(file, "running", [
        `Discovered candidate terms: ${topTerms.length}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`,
        "Explaining terms now."
      ]);
      const existingIndex = await this.loadGlossaryIndex(file, true);
      const pendingTerms = topTerms.filter((term) => !existingIndex.byTerm.has(normalizeTerm(term.term)));

      if (pendingTerms.length === 0) {
        new Notice("Glossary is already prepared for the top discovered terms.");
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
      const writtenTerms = new Set<string>();

      for (const batch of batches) {
        this.setStatus(`Explaining terms ${completed + 1}-${completed + batch.length}/${inputs.length}`);
        const explanations = await provider.explainTerms({
          paperTitle: getBaseName(file.path),
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
          writtenTerms.add(normalizeTerm(entry.term));
          completed += 1;
        }
      }

      this.glossaryCache.delete(file.path);
      await this.loadGlossaryIndex(file, true);
      let sepSummary: SepEnrichmentSummary | null = null;
      if (this.settings.sepEnrichmentEnabled && writtenTerms.size > 0) {
        sepSummary = await this.enrichGlossaryWithSepForPaper(file, {
          background: true,
          provider,
          requestedTerms: Array.from(writtenTerms),
          writeStatus: false
        });
      }
      await this.writeGlossaryStatus(file, "ready", [
        `Completed: ${new Date().toISOString()}`,
        `New terms prepared: ${completed}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`,
        ...this.buildSepStatusLines(sepSummary)
      ]);
      new Notice(buildGlossaryReadyNotice(completed, sepSummary));
    } catch (error) {
      await this.writeGlossaryStatus(file, "failed", [
        `Failed: ${new Date().toISOString()}`,
        toErrorMessage(error)
      ]);
      new Notice(`Glossary preprocessing failed: ${toErrorMessage(error)}`);
      console.error(error);
      if (!options.background) {
        throw error;
      }
    } finally {
      this.setStatus("");
    }
  }

  private async extractTermsAndExplain(file: TFile): Promise<void> {
    await this.rebuildGlossary(file, { background: false });
  }

  private buildExplainTermInput(markdown: string, paragraphs: ReturnType<typeof splitParagraphs>, term: TermCandidate): ExplainTermInput {
    const aliases = Array.isArray(term.aliases) ? term.aliases : [];
    const occurrences = findTermOccurrences(markdown, term.term, aliases)
      .slice(0, MAX_EXPLANATION_OCCURRENCES)
      .map((occurrence) => ({
        start: occurrence.start,
        end: occurrence.end,
        alias: occurrence.alias,
        excerpt: excerptAround(markdown, occurrence.start, occurrence.end, EXPLANATION_EXCERPT_RADIUS)
      }));
    const clusters = buildContextClusters(markdown, paragraphs, term, MAX_EXPLANATION_CLUSTERS);
    return {
      term: term.term,
      aliases,
      reason: term.reason,
      importance: term.importance,
      occurrences,
      clusters
    };
  }

  private toGlossaryEntry(
    file: TFile,
    provider: string,
    model: string,
    input: ExplainTermInput,
    explanation: ExplainedTerm
  ): GlossaryEntry {
    const notes = new Map((explanation.clusters || []).map((cluster) => [cluster.id, cluster.usageNote]));
    const clusters = input.clusters.map((cluster) => ({
      ...cluster,
      usageNote: notes.get(cluster.id) || ""
    }));
    const now = new Date().toISOString();
    const aliases = Array.from(new Set([...(input.aliases || []), ...(explanation.aliases || [])].filter(Boolean)));

    return {
      term: explanation.term || input.term,
      normalizedTerm: normalizeTerm(explanation.term || input.term),
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

  private async explainSelectedTerm(file: TFile, selectedTerm: string): Promise<void> {
    try {
      const provider = createLLMProvider(this.settings);
      const markdown = await this.app.vault.read(file);
      const paragraphs = splitParagraphs(markdown);
      const candidate: TermCandidate = {
        term: selectedTerm,
        aliases: [],
        importance: 5,
        paragraphIndexes: []
      };
      const input = this.buildExplainTermInput(markdown, paragraphs, candidate);
      const explanation = await provider.explainTermFallback({
        paperTitle: getBaseName(file.path),
        sourcePaper: file.path,
        terms: [input]
      });
      await this.ensureFolder(this.glossaryFolderPath(file));
      const entry = this.toGlossaryEntry(file, provider.name, provider.model, input, explanation);
      await this.writeGlossaryEntry(file, entry);
      this.glossaryCache.delete(file.path);
      let sepSummary: SepEnrichmentSummary | null = null;
      if (this.settings.sepEnrichmentEnabled) {
        sepSummary = await this.enrichGlossaryWithSepForPaper(file, {
          background: true,
          provider,
          requestedTerms: [normalizeTerm(entry.term)],
          writeStatus: false
        });
      }
      new Notice(buildPreparedTermNotice(explanation.term || selectedTerm, sepSummary));
    } catch (error) {
      new Notice(`Explain term now failed: ${toErrorMessage(error)}`);
      console.error(error);
    }
  }

  private async enrichGlossaryWithSepForPaper(file: TFile, options: SepEnrichmentOptions = {}): Promise<SepEnrichmentSummary> {
    const provider = options.provider || createLLMProvider(this.settings);
    const writeStatus = options.writeStatus !== false;
    const requestedTerms = new Set((options.requestedTerms || [])
      .map((term) => normalizeTerm(term))
      .filter(Boolean));
    const summary: SepEnrichmentSummary = {
      attempted: 0,
      matched: 0,
      notFound: 0,
      failed: 0,
      skipped: 0
    };

    try {
      const index = await this.loadGlossaryIndex(file, true);
      const matchingEntries = index.entries.filter((entry) => (
        requestedTerms.size === 0 || requestedTerms.has(normalizeTerm(entry.term))
      ));
      const targets = matchingEntries.filter((entry) => (
        entry.sep?.status !== "matched" && entry.sep?.status !== "not_found"
      ));
      summary.skipped = matchingEntries.length - targets.length;

      if (writeStatus) {
        await this.writeGlossaryStatus(file, "running", [
          `SEP enrichment started: ${new Date().toISOString()}`,
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
          new Notice("Sep enrichment is already cached for the selected glossary entries.");
        }
        return summary;
      }

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        summary.attempted += 1;
        this.setStatus(`Enriching glossary with SEP ${index + 1}/${targets.length}`);

        try {
          const sep = await this.buildSepDataForEntry(file, target, provider);
          await this.writeGlossaryEntry(file, {
            ...target,
            updated: new Date().toISOString(),
            sep,
            sep_enabled: sep.status === "matched"
          });

          if (sep.status === "matched") {
            summary.matched += 1;
          } else if (sep.status === "not_found") {
            summary.notFound += 1;
          } else {
            summary.failed += 1;
          }
        } catch (error) {
          summary.failed += 1;
          const sep = this.buildFailedSepData(target.term, target.term, error);
          await this.writeGlossaryEntry(file, {
            ...target,
            updated: new Date().toISOString(),
            sep,
            sep_enabled: false
          });
        }
      }

      this.glossaryCache.delete(file.path);
      await this.loadGlossaryIndex(file, true);

      if (writeStatus) {
        await this.writeGlossaryStatus(file, "ready", [
          `SEP enrichment completed: ${new Date().toISOString()}`,
          ...this.buildSepStatusLines(summary)
        ]);
      }

      if (!options.background) {
        new Notice(buildSepNotice(summary));
      }

      return summary;
    } catch (error) {
      if (writeStatus) {
        await this.writeGlossaryStatus(file, "failed", [
          `SEP enrichment failed: ${new Date().toISOString()}`,
          toErrorMessage(error)
        ]);
      }
      if (!options.background) {
        new Notice(`SEP enrichment failed: ${toErrorMessage(error)}`);
      }
      console.error(error);
      return summary;
    } finally {
      this.setStatus("");
    }
  }

  private async buildSepDataForEntry(file: TFile, entry: GlossaryEntry, provider: LLMProvider): Promise<SepEntryData> {
    const now = new Date().toISOString();
    const queries = Array.from(new Set([entry.term, ...(entry.aliases || [])]
      .map((term) => String(term || "").trim())
      .filter(Boolean)));
    let usedQuery = entry.term;
    let candidates: SepSearchCandidate[] = [];

    for (const query of queries) {
      usedQuery = query;
      candidates = (await searchSep(query)).slice(0, SEP_CANDIDATE_LIMIT);
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

    const heuristic = pickSepCandidateHeuristically(candidates, entry.term, entry.aliases);
    let chosenCandidate = heuristic.candidate;

    if (!chosenCandidate) {
      const choice = await provider.chooseSepEntry({
        paperTitle: getBaseName(file.path),
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

    const sepEntry = await fetchSepEntry(chosenCandidate.url);
    if (!sepEntry.preamble.trim()) {
      return this.buildFailedSepData(entry.term, usedQuery, new Error("SEP entry did not include a readable preamble."));
    }
    const summary = await provider.summarizeSepEntry({
      paperTitle: getBaseName(file.path),
      sourcePaper: file.path,
      term: entry.term,
      definition: entry.definition,
      entryTitle: sepEntry.title || chosenCandidate.title,
      entryUrl: chosenCandidate.url,
      preamble: sepEntry.preamble
    });
    return this.buildMatchedSepData(usedQuery, chosenCandidate, sepEntry, summary, now);
  }

  private resolveChosenSepCandidate(choice: ChosenSepEntry, candidates: RankedSepCandidate[]): RankedSepCandidate | null {
    if (!choice.matched) {
      return null;
    }

    const byUrl = candidates.find((candidate) => candidate.url === choice.url);
    if (byUrl) {
      return byUrl;
    }

    const normalizedTitle = normalizeTerm(choice.title);
    const byTitle = candidates.find((candidate) => normalizeTerm(candidate.title) === normalizedTitle);
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

  private buildMatchedSepData(
    query: string,
    candidate: RankedSepCandidate,
    sepEntry: ParsedSepEntry,
    summary: SepSummary,
    fetchedAt: string
  ): SepEntryData {
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

  private buildFailedSepData(term: string, query: string, error: unknown): SepEntryData {
    return {
      status: "failed",
      query: query || term,
      entryTitle: "",
      entryUrl: "",
      summary: "",
      sourceExcerpt: "",
      revised: "",
      fetchedAt: new Date().toISOString(),
      error: toErrorMessage(error)
    };
  }

  private buildSepStatusLines(summary: SepEnrichmentSummary | null): string[] {
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

  private async writeGlossaryEntry(file: TFile, entry: GlossaryEntry): Promise<void> {
    const folderPath = this.glossaryFolderPath(file);
    await this.ensureFolder(folderPath);
    const notePath = joinVaultPath(folderPath, `${slugify(entry.term, "term")}.md`);
    const markdown = buildGlossaryMarkdown(entry);
    await this.writeVaultTextFile(notePath, markdown);
  }

  private async writeGlossaryStatus(file: TFile, status: "running" | "ready" | "failed", lines: string[]): Promise<void> {
    const folderPath = this.glossaryFolderPath(file);
    await this.ensureFolder(folderPath);
    const markdown = [
      "---",
      `status: ${JSON.stringify(status)}`,
      `paper: ${JSON.stringify(file.path)}`,
      `updated: ${JSON.stringify(new Date().toISOString())}`,
      "---",
      "",
      `# Glossary ${status}`,
      "",
      ...lines.map((line) => `- ${line}`),
      ""
    ].join("\n");
    await this.writeVaultTextFile(joinVaultPath(folderPath, "_status.md"), markdown);
  }

  private buildKeySentenceSidecar(
    file: TFile,
    provider: string,
    model: string,
    density: KeySentenceDensity,
    highlights: SentenceSpan[]
  ): KeySentenceSidecar {
    return {
      version: 1,
      paper: file.path,
      provider,
      model,
      density,
      updated: new Date().toISOString(),
      highlights: highlights.map((sentence) => ({
        paragraphId: sentence.paragraphId,
        paragraphIndex: sentence.paragraphIndex,
        sentenceId: sentence.id,
        text: sentence.text
      }))
    };
  }

  private async loadKeySentenceSidecar(file: TFile): Promise<KeySentenceSidecar> {
    const sidecarPath = this.keySentenceSidecarPath(file);
    const existing = this.app.vault.getAbstractFileByPath(sidecarPath);
    if (!(existing instanceof TFile)) {
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
      const parsed = JSON.parse(await this.app.vault.read(existing)) as Partial<KeySentenceSidecar>;
      return {
        version: Number(parsed.version) || 1,
        paper: typeof parsed.paper === "string" ? parsed.paper : file.path,
        provider: typeof parsed.provider === "string" ? parsed.provider : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
        density: parsed.density === "sparse" ? "sparse" : "medium",
        updated: typeof parsed.updated === "string" ? parsed.updated : "",
        highlights: Array.isArray(parsed.highlights)
          ? parsed.highlights
            .filter((item): item is KeySentenceSidecarRecord => !!item && typeof item === "object")
            .map((item) => ({
              paragraphId: typeof item.paragraphId === "string" ? item.paragraphId : "",
              paragraphIndex: Number(item.paragraphIndex),
              sentenceId: typeof item.sentenceId === "string" ? item.sentenceId : "",
              text: typeof item.text === "string" ? item.text : ""
            }))
            .filter((item) => item.paragraphId && item.sentenceId && Number.isFinite(item.paragraphIndex) && item.text)
          : []
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

  private async writeKeySentenceSidecar(file: TFile, sidecar: KeySentenceSidecar): Promise<void> {
    await this.ensureFolder(this.sourceFolderPath(file));
    await this.writeVaultTextFile(
      this.keySentenceSidecarPath(file),
      `${JSON.stringify(sidecar, null, 2)}\n`
    );
  }

  private async writeVaultTextFile(vaultPath: string, text: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, text);
    } else {
      await this.app.vault.create(vaultPath, text);
    }
  }

  private async loadGlossaryIndex(file: TFile, force = false): Promise<GlossaryIndex> {
    const cached = this.glossaryCache.get(file.path);
    if (cached && !force) {
      return cached;
    }

    const folder = this.app.vault.getAbstractFileByPath(this.glossaryFolderPath(file));
    const entries: GlossaryEntry[] = [];
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension.toLowerCase() === "md") {
          const markdown = await this.app.vault.read(child);
          const entry = parseGlossaryMarkdown(markdown);
          if (entry && (!entry.sourcePaper || entry.sourcePaper === file.path)) {
            entries.push(entry);
          }
        }
      }
    }

    const byTerm = new Map<string, GlossaryEntry>();
    for (const entry of entries) {
      byTerm.set(normalizeTerm(entry.term), entry);
      for (const alias of entry.aliases || []) {
        byTerm.set(normalizeTerm(alias), entry);
      }
    }

    const index = { entries, byTerm };
    this.glossaryCache.set(file.path, index);
    return index;
  }

  private glossaryFolderPath(file: TFile): string {
    return joinVaultPath(getParentPath(file.path), this.settings.glossaryFolderName);
  }

  private sourceFolderPath(file: TFile): string {
    return joinVaultPath(getParentPath(file.path), "_source");
  }

  private keySentenceSidecarPath(file: TFile): string {
    return joinVaultPath(this.sourceFolderPath(file), "key-sentences.json");
  }

  private uniqueFolderPath(basePath: string): string {
    let candidate = basePath;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${basePath}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private uniqueVaultPath(basePath: string): string {
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

  private async ensureFolder(vaultPath: string): Promise<void> {
    const normalized = normalizePath(vaultPath);
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
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`${current} exists and is not a folder.`);
      }
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) {
      this.statusEl.setText(text);
    }
  }
}

class PhilosophyReaderSettingTab extends PluginSettingTab {
  private readonly plugin: PhilosophyReaderPlugin;

  constructor(app: App, plugin: PhilosophyReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("General")
      .setHeading();

    new Setting(containerEl)
      .setName("Markdown generation")
      .setHeading();

    new Setting(containerEl)
      .setName("PDF import backend")
      .setDesc("Paper2mdviallm is the default path. Scholar-md stays available as a lighter beta path. Marker remains optional and not recommended.")
      .addDropdown((dropdown) => dropdown
        .addOption("paper2mdviallm", "Paper2mdviallm (default)")
        .addOption("scholar-md", "Scholar-md (beta)")
        .addOption("marker", "Marker CLI (not recommended)")
        .setValue(this.plugin.settings.pdfImportBackend)
        .onChange(async (value) => {
          const backend: PdfImportBackend = value === "marker"
            ? "marker"
            : value === "paper2mdviallm"
              ? "paper2mdviallm"
              : "scholar-md";
          this.plugin.settings.pdfImportBackend = backend;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("CLI path for paper2mdviallm")
      .setDesc("Optional. Resolution order: explicit setting, plugin .venv local tool, then shell PATH. You can paste either the executable itself or an environment root such as a conda env. The plugin resolves `bin/paper2mdviallm` or `Scripts/paper2mdviallm.exe` inside it.")
      .addText((text) => text
        .setPlaceholder("Enter command path")
        .setValue(this.plugin.settings.paper2mdviallmCommand)
        .onChange(async (value) => {
          this.plugin.settings.paper2mdviallmCommand = value.trim() || DEFAULT_SETTINGS.paper2mdviallmCommand;
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("Use local paper2mdviallm")
        .onClick(async () => {
          const localCommand = this.plugin.getLocalPaper2mdViaLlmCommand();
          if (!localCommand || !fs.existsSync(localCommand)) {
            new Notice("Local paper2mdviallm was not found in this plugin's .venv.");
            return;
          }
          this.plugin.settings.paper2mdviallmCommand = localCommand;
          await this.plugin.saveSettings();
          this.display();
          new Notice("CLI path for paper2mdviallm set to the local tool.");
        }));

    new Setting(containerEl)
      .setName("Markdown generation model")
      .setDesc("Used by paper2mdviallm. The provider is inferred from the model name, so API keys stay global and only need to be filled once.")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.paper2mdviallmModel)
        .setValue(this.plugin.settings.paper2mdviallmModel)
        .onChange(async (value) => {
          this.plugin.settings.paper2mdviallmModel = value.trim() || DEFAULT_SETTINGS.paper2mdviallmModel;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Concurrency for paper2mdviallm")
      .setDesc("Only used when the backend is paper2mdviallm. Higher values are faster but cost more API work in parallel.")
      .addSlider((slider) => slider
        .setLimits(1, 6, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.paper2mdviallmConcurrency)
        .onChange(async (value) => {
          this.plugin.settings.paper2mdviallmConcurrency = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("CLI path for marker")
      .setDesc("Optional. Only used when the backend is marker CLI, which is not recommended.")
      .addText((text) => text
        .setPlaceholder("Enter command path")
        .setValue(this.plugin.settings.markerCommand)
        .onChange(async (value) => {
          this.plugin.settings.markerCommand = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("Use local marker")
        .onClick(async () => {
          const localCommand = this.plugin.getLocalMarkerCommand();
          if (!localCommand || !fs.existsSync(localCommand)) {
            new Notice("Local marker_single was not found in this plugin's .venv.");
            return;
          }
          this.plugin.settings.markerCommand = localCommand;
          await this.plugin.saveSettings();
          this.display();
          new Notice("CLI path for marker set to the local command.");
        }));

    new Setting(containerEl)
      .setName("API keys")
      .setHeading();

    new Setting(containerEl)
      .setName("Openai key")
      .setDesc("Stored in this plugin's Obsidian data.json for compatibility with older supported Obsidian versions.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Paste key here")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Anthropic key")
      .setDesc("Stored in this plugin's Obsidian data.json for compatibility with older supported Obsidian versions.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Paste key here")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Reading prep")
      .setHeading();

    new Setting(containerEl)
      .setName("Reading prep provider")
      .setDesc("Used for key-sentence highlighting plus term discovery and explanation after Markdown import.")
      .addDropdown((dropdown) => dropdown
        .addOption("openai", "Openai (gpt models)")
        .addOption("anthropic", "Anthropic (claude models)")
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value === "anthropic" ? "anthropic" : "openai";
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Reading prep model")
      .setDesc("This can differ from the Markdown generation model above. One-click import and reading prep stays available either way.")
      .addText((text) => text
        .setPlaceholder(this.plugin.settings.provider === "anthropic" ? DEFAULT_SETTINGS.anthropicModel : DEFAULT_SETTINGS.openaiModel)
        .setValue(getReadingModel(this.plugin.settings))
        .onChange(async (value) => {
          if (this.plugin.settings.provider === "anthropic") {
            this.plugin.settings.anthropicModel = value.trim() || DEFAULT_SETTINGS.anthropicModel;
          } else {
            this.plugin.settings.openaiModel = value.trim() || DEFAULT_SETTINGS.openaiModel;
          }
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Auto highlight key sentences after import")
      .setDesc("When enabled, import runs key-sentence highlighting before glossary preprocessing.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoHighlightKeySentences)
        .onChange(async (value) => {
          this.plugin.settings.autoHighlightKeySentences = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Key sentence density")
      .setDesc("Medium matches the current behavior. Sparse highlights only structurally important sentences.")
      .addDropdown((dropdown) => dropdown
        .addOption("medium", "Medium")
        .addOption("sparse", "Sparse")
        .setValue(this.plugin.settings.keySentenceDensity)
        .onChange(async (value) => {
          this.plugin.settings.keySentenceDensity = value === "sparse" ? "sparse" : "medium";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Glossary")
      .setHeading();

    new Setting(containerEl)
      .setName("Max precomputed terms")
      .setDesc("The default is 40. Higher values cost more and take longer.")
      .addSlider((slider) => slider
        .setLimits(10, 120, 5)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.maxPrecomputedTerms)
        .onChange(async (value) => {
          this.plugin.settings.maxPrecomputedTerms = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Glossary folder name")
      .addText((text) => text
        .setValue(this.plugin.settings.glossaryFolderName)
        .onChange(async (value) => {
          this.plugin.settings.glossaryFolderName = value.trim() || DEFAULT_SETTINGS.glossaryFolderName;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Glossary explanation length")
      .setDesc("Controls newly generated glossary entries. Standard stores a fuller contextual definition plus cluster notes. Concise stores a 30-50 word definition plus cluster notes. Rebuild glossary entries to refresh existing cache.")
      .addDropdown((dropdown) => dropdown
        .addOption("standard", "Standard (current)")
        .addOption("brief", "Concise (30-50 words)")
        .setValue(this.plugin.settings.glossaryExplanationLength)
        .onChange(async (value) => {
          this.plugin.settings.glossaryExplanationLength = value === "brief" ? "brief" : "standard";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Enable sep enrichment")
      .setDesc("After glossary entries are prepared, fetch matching Stanford encyclopedia introductions and cache a short supplement for hover.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.sepEnrichmentEnabled)
        .onChange(async (value) => {
          this.plugin.settings.sepEnrichmentEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Hover delay")
      .setDesc("Milliseconds before the hover tooltip appears. Reload Obsidian after changing this.")
      .addSlider((slider) => slider
        .setLimits(100, 1000, 50)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.hoverDelayMs)
        .onChange(async (value) => {
          this.plugin.settings.hoverDelayMs = value;
          await this.plugin.saveSettings();
        }));
  }
}

function buildGlossaryReadyNotice(completed: number, sepSummary: SepEnrichmentSummary | null): string {
  const base = `Glossary prepared: ${completed} new term${completed === 1 ? "" : "s"}.`;
  if (!sepSummary || sepSummary.attempted === 0) {
    return base;
  }
  return `${base} SEP matched ${sepSummary.matched}/${sepSummary.attempted}.`;
}

function buildPreparedTermNotice(term: string, sepSummary: SepEnrichmentSummary | null): string {
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

function buildSepNotice(summary: SepEnrichmentSummary): string {
  if (summary.attempted === 0) {
    return "SEP enrichment is already cached for the selected glossary entries.";
  }
  return `SEP enrichment complete: ${summary.matched} matched, ${summary.notFound} not found, ${summary.failed} failed, ${summary.skipped} skipped.`;
}

function joinVaultPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

function buildImportedPaperMarkdown(markdown: string, metadata: { title: string; sourcePdf: string; importedAt: string }): string {
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
  return `${frontmatter}${content}\n`;
}

function buildImportWarningsMarkdown(backend: string, sourcePdfPath: string, quality: MarkdownQualityReport): string {
  const lines = [
    "---",
    `backend: ${JSON.stringify(backend)}`,
    `source_pdf: ${JSON.stringify(sourcePdfPath)}`,
    `risk_level: ${JSON.stringify(quality.riskLevel)}`,
    `risk_score: ${quality.riskScore}`,
    `updated: ${JSON.stringify(new Date().toISOString())}`,
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
  return `${lines.join("\n")}\n`;
}

function findLargestMarkdownFile(folder: string): string | null {
  const files: string[] = [];
  const visit = (current: string) => {
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
  return files
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0] || null;
}

function looksLikeLocalPath(command: string): boolean {
  return command.includes("/") || command.includes("\\") || command.startsWith(`.${path.sep}`) || command.startsWith("~/") || command.startsWith("~\\");
}

function resolveConfiguredToolCommand(configured: string, executableBaseName: string): string {
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

function expandUserHome(inputPath: string): string {
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

function getReadingModel(settings: PhilosophyReaderSettings): string {
  if (settings.provider === "anthropic") {
    return settings.anthropicModel.trim() || DEFAULT_SETTINGS.anthropicModel;
  }
  return settings.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel;
}

function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-|o4-)/.test(String(model || "").trim());
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function findSelectedKeySentence(paragraphs: KeySentenceParagraph[], paragraphId: string, sentenceId: string): SentenceSpan | null {
  for (const paragraph of paragraphs) {
    if (paragraph.id !== paragraphId) {
      continue;
    }
    return paragraph.sentences.find((sentence) => sentence.id === sentenceId) || null;
  }
  return null;
}

function findMatchingInput(inputs: ExplainTermInput[], explanation: ExplainedTerm): ExplainTermInput | null {
  const normalized = normalizeTerm(explanation.term);
  return inputs.find((input) => normalizeTerm(input.term) === normalized) || inputs[0] || null;
}

function formatMarkerLog(command: string, args: string[], stdout: string | Buffer, stderr: string | Buffer): string {
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
