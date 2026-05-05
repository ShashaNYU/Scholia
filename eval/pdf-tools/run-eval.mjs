import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const scholarMdSrc = path.join(repoRoot, "tools", "scholar-md", "src");
const manifestPath = path.join(__dirname, "manifest.json");
const outputRoot = path.join(__dirname, "output", new Date().toISOString().replace(/[:.]/g, "-"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const selectedDocumentIds = new Set((process.env.PDF_EVAL_DOCS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const runMineruTools = process.env.PDF_EVAL_MINERU === "1";

mkdirSync(outputRoot, { recursive: true });

const commands = {
  pdfinfo: findCommand("pdfinfo"),
  pdffonts: findCommand("pdffonts"),
  pdfimages: findCommand("pdfimages"),
  pdftotext: findCommand("pdftotext"),
  markitdown: findCommand("markitdown"),
  scholarMdPython: findScholarMdPython(),
  mineru: findCommand("mineru"),
  magicPdf: findCommand("magic-pdf")
};

const summary = {
  generatedAt: new Date().toISOString(),
  outputRoot,
  selectedDocumentIds: [...selectedDocumentIds],
  runMineruTools,
  commands,
  documents: []
};

for (const doc of manifest.documents.filter((item) => selectedDocumentIds.size === 0 || selectedDocumentIds.has(item.id))) {
  const docOut = path.join(outputRoot, doc.id);
  mkdirSync(docOut, { recursive: true });

  const entry = {
    id: doc.id,
    path: doc.path,
    notes: doc.notes,
    exists: existsSync(doc.path),
    profile: {},
    tools: {}
  };

  if (!entry.exists) {
    entry.error = "Source PDF does not exist.";
    summary.documents.push(entry);
    continue;
  }

  entry.profile.pdfinfo = runTextTool(commands.pdfinfo, [doc.path]);
  entry.profile.fonts = summarizeFonts(runTextTool(commands.pdffonts, [doc.path]).stdout);
  entry.profile.images = summarizeImages(runTextTool(commands.pdfimages, ["-list", doc.path]).stdout);

  entry.tools.pdftotextLayout = runPdftotext(doc.path, path.join(docOut, "pdftotext-layout.txt"));
  entry.tools.markitdown = runMarkitdown(doc.path, path.join(docOut, "markitdown.md"));
  entry.tools.scholarMd = runScholarMd(doc.path, path.join(docOut, "scholar-md.md"));
  entry.tools.mineru = runMineruTools
    ? runMineru(doc.path, path.join(docOut, "mineru"))
    : { status: "skipped", reason: "set PDF_EVAL_MINERU=1 to run MinerU" };

  summary.documents.push(entry);
}

const summaryPath = path.join(outputRoot, "summary.json");
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(summaryPath);

function findCommand(command) {
  const localPath = path.join(repoRoot, ".eval-venv", "bin", command);
  if (existsSync(localPath)) {
    return localPath;
  }

  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findScholarMdPython() {
  const candidates = [
    path.join(repoRoot, "tools", "scholar-md", ".venv", "bin", "python"),
    path.join(repoRoot, ".eval-venv", "bin", "python"),
    "python3"
  ];
  for (const candidate of candidates) {
    if (candidate !== "python3" && !existsSync(candidate)) {
      continue;
    }
    const result = spawnSync(candidate, [
      "-c",
      "import scholar_md, fitz"
    ], {
      encoding: "utf8",
      env: scholarMdEnv()
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function scholarMdEnv() {
  return {
    ...process.env,
    PYTHONPATH: process.env.PYTHONPATH
      ? `${scholarMdSrc}${path.delimiter}${process.env.PYTHONPATH}`
      : scholarMdSrc
  };
}

function runTextTool(commandPath, args, options = {}) {
  if (!commandPath) {
    return { status: "skipped", reason: "command not found", stdout: "", stderr: "" };
  }
  const result = spawnSync(commandPath, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80,
    ...options
  });
  return {
    status: result.status === 0 ? "ok" : "failed",
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function runPdftotext(pdfPath, outputPath) {
  if (!commands.pdftotext) {
    return { status: "skipped", reason: "pdftotext not found" };
  }
  const result = spawnSync(commands.pdftotext, ["-layout", pdfPath, outputPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  return summarizeToolRun(result, outputPath);
}

function runMarkitdown(pdfPath, outputPath) {
  if (!commands.markitdown) {
    return { status: "skipped", reason: "markitdown not found" };
  }

  const stdoutRun = spawnSync(commands.markitdown, [pdfPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80
  });
  if (stdoutRun.status === 0 && stdoutRun.stdout.trim()) {
    writeFileSync(outputPath, stdoutRun.stdout, "utf8");
    return summarizeToolRun(stdoutRun, outputPath);
  }

  const outputRun = spawnSync(commands.markitdown, [pdfPath, "-o", outputPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80
  });
  return summarizeToolRun(outputRun, outputPath, stdoutRun);
}

function runScholarMd(pdfPath, outputPath) {
  if (!commands.scholarMdPython) {
    return {
      status: "skipped",
      reason: "scholar-md or PyMuPDF not available; install with `pip install -e tools/scholar-md`"
    };
  }
  const diagnosticsPath = outputPath.replace(/\.md$/i, ".diagnostics.json");
  const result = spawnSync(commands.scholarMdPython, [
    "-m",
    "scholar_md",
    pdfPath,
    "-o",
    outputPath,
    "--emit-diagnostics",
    "--diagnostics-output",
    diagnosticsPath
  ], {
    encoding: "utf8",
    env: scholarMdEnv(),
    maxBuffer: 1024 * 1024 * 80
  });
  const summary = summarizeToolRun(result, outputPath);
  summary.diagnosticsPath = existsSync(diagnosticsPath) ? diagnosticsPath : null;
  summary.stdout = truncate(result.stdout || "");
  return summary;
}

function runMineru(pdfPath, outputDir) {
  mkdirSync(outputDir, { recursive: true });

  if (commands.mineru) {
    const result = spawnSync(commands.mineru, [
      "-p",
      pdfPath,
      "-o",
      outputDir,
      "-m",
      "txt",
      "-b",
      "pipeline",
      "-l",
      "en",
      "-f",
      "true",
      "-t",
      "false"
    ], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 80
    });
    return summarizeDirectoryRun(result, outputDir, "mineru");
  }

  if (commands.magicPdf) {
    const result = spawnSync(commands.magicPdf, ["-p", pdfPath, "-o", outputDir, "-m", "auto"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 80
    });
    return summarizeDirectoryRun(result, outputDir, "magic-pdf");
  }

  return { status: "skipped", reason: "mineru and magic-pdf not found" };
}

function summarizeToolRun(result, outputPath, previousAttempt = null) {
  const exists = existsSync(outputPath);
  const text = exists ? readFileSync(outputPath, "utf8") : "";
  return {
    status: result.status === 0 && exists ? "ok" : "failed",
    exitCode: result.status,
    outputPath,
    stderr: truncate(result.stderr || ""),
    previousAttempt: previousAttempt ? {
      exitCode: previousAttempt.status,
      stderr: truncate(previousAttempt.stderr || "")
    } : undefined,
    metrics: summarizeText(text)
  };
}

function summarizeDirectoryRun(result, outputDir, commandName) {
  const markdownFiles = listFiles(outputDir).filter((file) => file.toLowerCase().endsWith(".md"));
  const largestMarkdown = markdownFiles
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .sort((a, b) => b.text.length - a.text.length)[0];
  return {
    status: result.status === 0 && Boolean(largestMarkdown) ? "ok" : "failed",
    commandName,
    exitCode: result.status,
    outputDir,
    markdownPath: largestMarkdown?.file || null,
    stdout: truncate(result.stdout || ""),
    stderr: truncate(result.stderr || ""),
    metrics: summarizeText(largestMarkdown?.text || "")
  };
}

function summarizeText(text) {
  const controlMatches = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || [];
  const mojibakeMatches = text.match(/(?:â.|Ã.|Â.|ð|Ñ|ă|ĺ|ď|§|¶)/g) || [];
  const replacementMatches = text.match(/\uFFFD/g) || [];
  const mathSymbolMatches = text.match(/[□◇◻⊢⊨→↔¬∧∨∀∃λβηφψΓΣ≤≥≠∈∉⊂⊆⊥]/g) || [];
  const cidMatches = text.match(/\(cid:\d+\)/g) || [];
  const suspiciousFormulaMatches = text.match(/\b6=|ConT p|gp\(|Ñ|ðñ||\(cid:\d+\)/g) || [];
  const alphaRunMatches = text.match(/[A-Za-z]{24,}/g) || [];
  const lines = text.split(/\r?\n/);
  const markdownTableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;

  return {
    chars: text.length,
    lines: text ? lines.length : 0,
    controlChars: controlMatches.length,
    mojibakeMarks: mojibakeMatches.length,
    replacementChars: replacementMatches.length,
    cidRefs: cidMatches.length,
    mathSymbols: mathSymbolMatches.length,
    suspiciousFormulaMarks: suspiciousFormulaMatches.length,
    longAlphaRuns: alphaRunMatches.length,
    markdownTableLines,
    avgLineLength: averageLineLength(text)
  };
}

function averageLineLength(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return 0;
  }
  return Math.round(lines.reduce((sum, line) => sum + line.length, 0) / lines.length);
}

function summarizeFonts(stdout) {
  const lines = stdout.split(/\r?\n/).slice(2).filter((line) => line.trim());
  return {
    total: lines.length,
    withoutUnicodeMap: lines.filter((line) => /\sno\s+\d+\s+\d+\s*$/.test(line)).length,
    raw: stdout
  };
}

function summarizeImages(stdout) {
  const lines = stdout.split(/\r?\n/).slice(2).filter((line) => line.trim());
  return {
    total: lines.length,
    raw: stdout
  };
}

function listFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = spawnSync("find", [current, "-type", "f"], { encoding: "utf8" });
    if (entries.status === 0) {
      return entries.stdout.split(/\r?\n/).filter(Boolean);
    }
  }
  return files;
}

function truncate(value, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
