import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  App,
  FileSystemAdapter,
  MarkdownView,
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
  buildContextClusters,
  buildGlossaryMarkdown,
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
  slugify,
  splitParagraphs,
  type ContextCluster,
  type GlossaryEntry,
  type MarkdownQualityReport,
  type TermCandidate
} from "./core.js";
import {
  createLLMProvider,
  type ExplainTermInput,
  type ExplainedTerm,
  type PdfImportBackend,
  type PhilosophyReaderSettings
} from "./llmProviders";

const execFileAsync = promisify(execFile);
const EXPLANATION_BATCH_SIZE = 2;
const MAX_EXPLANATION_OCCURRENCES = 5;
const EXPLANATION_EXCERPT_RADIUS = 350;
const MAX_EXPLANATION_CLUSTERS = 3;

const DEFAULT_SETTINGS: PhilosophyReaderSettings = {
  provider: "openai",
  openaiApiKey: "",
  anthropicApiKey: "",
  openaiModel: "gpt-5.4-mini",
  anthropicModel: "claude-sonnet-4-6",
  pdfImportBackend: "markitdown",
  markitdownCommand: "markitdown",
  markerCommand: "marker_single",
  maxPrecomputedTerms: 40,
  glossaryFolderName: "_glossary",
  hoverDelayMs: 350,
  windowSize: 4,
  windowOverlap: 1
};

interface GlossaryIndex {
  entries: GlossaryEntry[];
  byTerm: Map<string, GlossaryEntry>;
}

interface RebuildOptions {
  background?: boolean;
}

export default class PhilosophyReaderPlugin extends Plugin {
  settings: PhilosophyReaderSettings = { ...DEFAULT_SETTINGS };
  private statusEl: HTMLElement | null = null;
  private glossaryCache = new Map<string, GlossaryIndex>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("philosophy-reader-progress");
    this.setStatus("");

    this.addSettingTab(new PhilosophyReaderSettingTab(this.app, this));
    this.registerEditorExtension(this.buildHoverExtension());

    this.addCommand({
      id: "import-pdf-as-philosophy-paper",
      name: "Import PDF as Philosophy Paper",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && file.extension.toLowerCase() === "pdf";
        if (checking) {
          return canRun;
        }
        if (canRun) {
          void this.importPdfAsPaper(file);
        }
        return canRun;
      }
    });

    this.addCommand({
      id: "rebuild-glossary-for-current-paper",
      name: "Rebuild Glossary for Current Paper",
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
      id: "explain-term-now",
      name: "Explain Term Now",
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
    const pluginPath = this.getPluginDiskPath();
    return pluginPath ? path.join(pluginPath, ".venv", "bin", "marker_single") : null;
  }

  getLocalMarkitdownCommand(): string | null {
    const pluginPath = this.getPluginDiskPath();
    return pluginPath ? path.join(pluginPath, ".eval-venv", "bin", "markitdown") : null;
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
      this.settings.pdfImportBackend = "pdfjs";
      this.settings.markerCommand = DEFAULT_SETTINGS.markerCommand;
      void this.saveSettings();
    }

    const localMarkitdown = this.getLocalMarkitdownCommand();
    if (this.settings.markitdownCommand === DEFAULT_SETTINGS.markitdownCommand && localMarkitdown && fs.existsSync(localMarkitdown)) {
      this.settings.markitdownCommand = localMarkitdown;
      void this.saveSettings();
    }
  }

  private buildHoverExtension() {
    return hoverTooltip(
      async (view: EditorView, pos: number): Promise<Tooltip | null> => this.resolveHoverTooltip(view, pos),
      { hoverTime: this.settings.hoverDelayMs }
    );
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
    root.addClass("philosophy-reader-tooltip");

    const title = document.createElement("h4");
    title.setText(entry.term);
    root.appendChild(title);

    const definition = document.createElement("p");
    definition.setText(entry.definition || "No definition was generated.");
    root.appendChild(definition);

    if (entry.authorUsage) {
      const label = document.createElement("div");
      label.addClass("philosophy-reader-label");
      label.setText("Author usage");
      root.appendChild(label);

      const authorUsage = document.createElement("p");
      authorUsage.setText(entry.authorUsage);
      root.appendChild(authorUsage);
    }

    if (cluster?.usageNote) {
      const label = document.createElement("div");
      label.addClass("philosophy-reader-label");
      label.setText(cluster.label || "This passage");
      root.appendChild(label);

      const usage = document.createElement("p");
      usage.setText(cluster.usageNote);
      root.appendChild(usage);
    }

    if (entry.firstUse) {
      const label = document.createElement("div");
      label.addClass("philosophy-reader-label");
      label.setText("First use");
      root.appendChild(label);

      const firstUse = document.createElement("p");
      firstUse.setText(entry.firstUse);
      root.appendChild(firstUse);
    }

    return root;
  }

  private renderUnpreparedTooltip(word: string, file: TFile): HTMLElement {
    const root = document.createElement("div");
    root.addClass("philosophy-reader-tooltip");

    const title = document.createElement("h4");
    title.setText(word);
    root.appendChild(title);

    const message = document.createElement("p");
    message.addClass("philosophy-reader-empty");
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

  private async importPdfAsPaper(file: TFile): Promise<void> {
    try {
      if (this.settings.pdfImportBackend === "marker" && !this.settings.markerCommand.trim()) {
        new Notice("Set the Marker CLI path in Philosophy Reader settings first.");
        return;
      }
      if (this.settings.pdfImportBackend === "markitdown" && !this.settings.markitdownCommand.trim()) {
        new Notice("Set the MarkItDown CLI path in Philosophy Reader settings first.");
        return;
      }

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
          : await this.uniqueFolderPath(defaultPaperFolder);
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
        : this.settings.pdfImportBackend === "markitdown"
          ? await this.convertPdfWithMarkitdown(pdfAbsPath, paperFolder, baseName, pdfTarget, adapter)
        : await this.convertDigitalPdfWithPdfJs(pdfAbsPath, paperFolder, baseName, pdfTarget);
      const paperMarkdown = buildImportedPaperMarkdown(importedMarkdown, {
        title: baseName,
        sourcePdf: pdfTarget,
        importedAt: new Date().toISOString()
      });

      const mdTarget = await this.uniqueVaultPath(joinVaultPath(paperFolder, `${paperSlug}.md`));
      await this.app.vault.create(mdTarget, paperMarkdown);

      const markdownFile = this.app.vault.getAbstractFileByPath(mdTarget);
      if (markdownFile instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(markdownFile);
        new Notice("PDF imported. Glossary preprocessing is running in the background. Check _glossary/_status.md for progress.");
        void this.rebuildGlossary(markdownFile, { background: true });
      }
    } catch (error) {
      new Notice(`PDF import failed: ${toErrorMessage(error)}`);
      console.error(error);
    } finally {
      this.setStatus("");
    }
  }

  private async convertDigitalPdfWithPdfJs(
    pdfAbsPath: string,
    paperFolder: string,
    paperTitle: string,
    sourcePdfPath: string
  ): Promise<string> {
    this.setStatus("Philosophy Reader: extracting selectable PDF text...");
    new Notice("Extracting selectable PDF text...");

    const extracted = await extractPdfTextWithPdfJs(pdfAbsPath);
    if (extracted.totalChars < 800) {
      throw new Error("PDF.js found very little selectable text. This PDF may be scanned; use the Marker backend for now.");
    }

    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "raw-pages.json"),
      `${JSON.stringify({
        ...extracted,
        paperTitle,
        sourcePdf: sourcePdfPath
      }, null, 2)}\n`
    );

    return buildMarkdownFromExtractedPdfText(extracted, paperTitle);
  }

  private async convertPdfWithMarkitdown(
    pdfAbsPath: string,
    paperFolder: string,
    paperTitle: string,
    sourcePdfPath: string,
    adapter: FileSystemAdapter
  ): Promise<string> {
    this.setStatus("Philosophy Reader: converting PDF with MarkItDown...");
    new Notice("Converting PDF with MarkItDown...");

    const outputDir = path.join(adapter.getFullPath(paperFolder), ".markitdown-output");
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "markitdown.md");
    const logPath = path.join(outputDir, "import.log");
    const markitdownArgs = [
      pdfAbsPath,
      "-o",
      outputPath
    ];

    try {
      const result = await execFileAsync(this.settings.markitdownCommand, markitdownArgs, {
        maxBuffer: 1024 * 1024 * 80
      });
      fs.writeFileSync(logPath, formatMarkerLog(this.settings.markitdownCommand, markitdownArgs, result.stdout, result.stderr), "utf8");
    } catch (error) {
      const execError = error as Error & { stdout?: string; stderr?: string };
      fs.writeFileSync(logPath, formatMarkerLog(this.settings.markitdownCommand, markitdownArgs, execError.stdout || "", execError.stderr || toErrorMessage(error)), "utf8");
      throw new Error(`MarkItDown conversion failed. See ${logPath}`);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error("MarkItDown finished without producing a markdown file.");
    }

    const importedMarkdown = fs.readFileSync(outputPath, "utf8").trim();
    if (importedMarkdown.replace(/\s/g, "").length < 800) {
      throw new Error("MarkItDown found very little selectable text. This PDF may need OCR.");
    }

    const quality = analyzeMarkdownQuality(importedMarkdown);
    await this.writeVaultTextFile(joinVaultPath(paperFolder, "_source", "markitdown.md"), `${importedMarkdown}\n`);
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-quality.json"),
      `${JSON.stringify({
        backend: "markitdown",
        command: this.settings.markitdownCommand,
        paperTitle,
        sourcePdf: sourcePdfPath,
        importedAt: new Date().toISOString(),
        quality
      }, null, 2)}\n`
    );
    await this.writeVaultTextFile(
      joinVaultPath(paperFolder, "_source", "import-warnings.md"),
      buildImportWarningsMarkdown("MarkItDown", sourcePdfPath, quality)
    );

    fs.rmSync(outputDir, { recursive: true, force: true });
    if (quality.riskLevel === "high" || quality.riskLevel === "medium") {
      new Notice(`PDF imported with ${quality.riskLevel} extraction risk. Check _source/import-warnings.md before trusting formulas.`);
    }
    return importedMarkdown;
  }

  private async convertPdfWithMarker(pdfAbsPath: string, paperFolder: string, adapter: FileSystemAdapter): Promise<string> {
    this.setStatus("Philosophy Reader: converting PDF with Marker...");
    new Notice("Converting PDF with Marker...");
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
        this.setStatus(`Philosophy Reader: discovering terms ${index + 1}/${windows.length}`);
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

      for (const batch of batches) {
        this.setStatus(`Philosophy Reader: explaining terms ${completed + 1}-${completed + batch.length}/${inputs.length}`);
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
          await this.writeGlossaryEntry(file, this.toGlossaryEntry(file, provider.name, provider.model, input, explanation));
          completed += 1;
        }
      }

      this.glossaryCache.delete(file.path);
      await this.loadGlossaryIndex(file, true);
      await this.writeGlossaryStatus(file, "ready", [
        `Completed: ${new Date().toISOString()}`,
        `New terms prepared: ${completed}`,
        `Provider: ${provider.name}`,
        `Model: ${provider.model}`
      ]);
      new Notice(`Glossary prepared: ${completed} new term${completed === 1 ? "" : "s"}.`);
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
      firstUse: explanation.firstUse || "",
      definition: explanation.definition || "",
      authorUsage: explanation.authorUsage || "",
      clusters,
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
      await this.writeGlossaryEntry(file, this.toGlossaryEntry(file, provider.name, provider.model, input, explanation));
      this.glossaryCache.delete(file.path);
      new Notice(`Prepared glossary entry: ${explanation.term || selectedTerm}`);
    } catch (error) {
      new Notice(`Explain Term Now failed: ${toErrorMessage(error)}`);
      console.error(error);
    }
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

  private async uniqueFolderPath(basePath: string): Promise<string> {
    let candidate = basePath;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${basePath}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private async uniqueVaultPath(basePath: string): Promise<string> {
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

    containerEl.createEl("h2", { text: "Philosophy Reader" });
    containerEl.createEl("h3", { text: "PDF import" });

    new Setting(containerEl)
      .setName("PDF import backend")
      .setDesc("MarkItDown is the default digital-PDF path. PDF.js is a lightweight fallback; Marker is optional.")
      .addDropdown((dropdown) => dropdown
        .addOption("markitdown", "MarkItDown CLI")
        .addOption("pdfjs", "PDF.js text extraction")
        .addOption("marker", "Marker CLI")
        .setValue(this.plugin.settings.pdfImportBackend)
        .onChange(async (value) => {
          const backend: PdfImportBackend = value === "marker" ? "marker" : value === "pdfjs" ? "pdfjs" : "markitdown";
          this.plugin.settings.pdfImportBackend = backend;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("MarkItDown CLI path")
      .setDesc("Used when the backend is MarkItDown CLI. Outputs quality warnings under _source/.")
      .addText((text) => text
        .setPlaceholder("markitdown")
        .setValue(this.plugin.settings.markitdownCommand)
        .onChange(async (value) => {
          this.plugin.settings.markitdownCommand = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("Use local MarkItDown")
        .onClick(async () => {
          const localCommand = this.plugin.getLocalMarkitdownCommand();
          if (!localCommand || !fs.existsSync(localCommand)) {
            new Notice("Local markitdown was not found in this plugin's .eval-venv.");
            return;
          }
          this.plugin.settings.markitdownCommand = localCommand;
          await this.plugin.saveSettings();
          this.display();
          new Notice("MarkItDown CLI path set to local markitdown.");
        }));

    new Setting(containerEl)
      .setName("Marker CLI path")
      .setDesc("Optional. Only used when the backend is Marker CLI.")
      .addText((text) => text
        .setPlaceholder("marker_single")
        .setValue(this.plugin.settings.markerCommand)
        .onChange(async (value) => {
          this.plugin.settings.markerCommand = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("Use local Marker")
        .onClick(async () => {
          const localCommand = this.plugin.getLocalMarkerCommand();
          if (!localCommand || !fs.existsSync(localCommand)) {
            new Notice("Local marker_single was not found in this plugin's .venv.");
            return;
          }
          this.plugin.settings.markerCommand = localCommand;
          await this.plugin.saveSettings();
          this.display();
          new Notice("Marker CLI path set to local marker_single.");
        }));

    containerEl.createEl("h3", { text: "LLM" });

    new Setting(containerEl)
      .setName("LLM provider")
      .setDesc("Currently supports OpenAI and Anthropic.")
      .addDropdown((dropdown) => dropdown
        .addOption("openai", "OpenAI (GPT)")
        .addOption("anthropic", "Anthropic (Claude)")
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value === "anthropic" ? "anthropic" : "openai";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored in this plugin's Obsidian data.json.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("OpenAI model")
      .addText((text) => text
        .setValue(this.plugin.settings.openaiModel)
        .onChange(async (value) => {
          this.plugin.settings.openaiModel = value.trim() || DEFAULT_SETTINGS.openaiModel;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc("Stored in this plugin's Obsidian data.json.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Anthropic model")
      .addText((text) => text
        .setValue(this.plugin.settings.anthropicModel)
        .onChange(async (value) => {
          this.plugin.settings.anthropicModel = value.trim() || DEFAULT_SETTINGS.anthropicModel;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "Glossary" });

    new Setting(containerEl)
      .setName("Max precomputed terms")
      .setDesc("MVP default is 40. Higher values cost more and take longer.")
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

interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
  charCount: number;
}

interface ExtractedPdfText {
  backend: "pdfjs";
  extractedAt: string;
  numPages: number;
  totalChars: number;
  pages: ExtractedPdfPage[];
}

async function extractPdfTextWithPdfJs(pdfAbsPath: string): Promise<ExtractedPdfText> {
  const globalObject = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
  const previousPdfWorker = globalObject.pdfjsWorker;
  const hadPdfWorker = Object.prototype.hasOwnProperty.call(globalObject, "pdfjsWorker");

  try {
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as {
      getDocument: (options: Record<string, unknown>) => { promise: Promise<{
        numPages: number;
        getPage: (pageNumber: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
        destroy?: () => Promise<void>;
      }> };
    };
    const data = new Uint8Array(fs.readFileSync(pdfAbsPath));
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false
    });
    const pdf = await loadingTask.promise;
    const pages: ExtractedPdfPage[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContentToPageText(textContent.items);
        pages.push({
          pageNumber,
          text,
          charCount: text.replace(/\s/g, "").length
        });
      }
    } finally {
      if (pdf.destroy) {
        await pdf.destroy();
      }
    }

    return {
      backend: "pdfjs",
      extractedAt: new Date().toISOString(),
      numPages: pdf.numPages,
      totalChars: pages.reduce((sum, page) => sum + page.charCount, 0),
      pages
    };
  } finally {
    if (hadPdfWorker) {
      globalObject.pdfjsWorker = previousPdfWorker;
    } else {
      delete globalObject.pdfjsWorker;
    }
  }
}

function textContentToPageText(items: unknown[]): string {
  const lines: string[] = [];
  let currentLine = "";

  for (const rawItem of items) {
    const item = rawItem as { str?: unknown; hasEOL?: unknown };
    const text = typeof item.str === "string" ? item.str.normalize("NFKC") : "";
    if (text) {
      currentLine += text;
    }
    if (item.hasEOL === true) {
      lines.push(cleanPdfLine(currentLine));
      currentLine = "";
    }
  }

  if (currentLine.trim()) {
    lines.push(cleanPdfLine(currentLine));
  }

  return collapseBlankLines(lines).join("\n");
}

function buildMarkdownFromExtractedPdfText(extracted: ExtractedPdfText, title: string): string {
  const sections = [`# ${title}`];
  for (const page of extracted.pages) {
    const markdown = pageTextToMarkdown(page.text);
    sections.push(`<!-- page: ${page.pageNumber} -->${markdown ? `\n\n${markdown}` : ""}`);
  }
  return `${sections.join("\n\n").trim()}\n`;
}

function pageTextToMarkdown(pageText: string): string {
  const paragraphs: string[] = [];
  let current = "";

  const flush = () => {
    const paragraph = current.trim();
    if (paragraph) {
      paragraphs.push(paragraph);
    }
    current = "";
  };

  for (const line of pageText.split(/\n/)) {
    const cleaned = cleanPdfLine(line);
    if (!cleaned) {
      flush();
      continue;
    }

    if (!current) {
      current = cleaned;
    } else if (current.endsWith("-") && !current.endsWith("--")) {
      current = `${current.slice(0, -1)}${cleaned}`;
    } else {
      current = `${current} ${cleaned}`;
    }
  }

  flush();
  return paragraphs.join("\n\n");
}

function cleanPdfLine(line: string): string {
  return line
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseBlankLines(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      continue;
    }
    output.push(line);
  }
  while (output.length > 0 && output[output.length - 1] === "") {
    output.pop();
  }
  return output;
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
