# Scholar-MD Extraction Plan

This document describes how to split `scholar-md` out of the Scholia
plugin repo into its own GitHub project while keeping the current Obsidian
integration working.

## Short answer

`scholar-md` source code is mostly already isolated under:

- `tools/scholar-md/src/scholar_md/`
- `tools/scholar-md/tests/`
- `tools/scholar-md/README.md`
- `tools/scholar-md/pyproject.toml`
- `tools/scholar-md/bootstrap.sh`
- `tools/scholar-md/requirements.txt`
- `tools/scholar-md/requirements-dev.txt`

But it is not fully isolated yet, because the plugin repo still contains:

- plugin-side runtime integration in `src/main.ts`
- plugin-side build artifact in `main.js`
- plugin-side test and bootstrap scripts in `package.json`
- eval harness references in `eval/pdf-tools/run-eval.mjs`
- eval harness docs in `eval/pdf-tools/README.md`

So the split is straightforward, but not just a folder move.

## What belongs in the new repo

Move these into the new `scholar-md` repository:

- `tools/scholar-md/src/scholar_md/`
- `tools/scholar-md/tests/`
- `tools/scholar-md/examples/`
- `tools/scholar-md/README.md`
- `tools/scholar-md/pyproject.toml`
- `tools/scholar-md/requirements.txt`
- `tools/scholar-md/requirements-dev.txt`

Do not move these generated or local-only artifacts:

- `tools/scholar-md/src/scholar_md.egg-info/`
- `tools/scholar-md/tests/__pycache__/`

The new repo should also add:

- `.gitignore`
- `LICENSE`
- GitHub Actions workflows
- release build scripts for standalone binaries

## Target repo structure

Recommended target layout:

```text
scholar-md/
  .github/
    workflows/
  src/
    scholar_md/
  tests/
  examples/
  README.md
  LICENSE
  pyproject.toml
  requirements.txt
  requirements-dev.txt
```

Use the same Python package name and CLI entrypoint:

- package name: `scholar_md`
- CLI command: `scholar-md`

Do not rename these in the first extraction pass. Keeping them stable reduces
the plugin-side change to "where do we fetch/install it from" instead of "what
is the tool called now".

## Separation of responsibilities

After extraction, responsibilities should be:

### `scholar-md` repo

- digital PDF parsing
- layout reconstruction
- footnote handling
- formula handling
- markdown rendering
- diagnostics JSON generation
- binary/runtime packaging

### `scholia` repo

- Obsidian commands and settings
- locating or downloading the `scholar-md` runtime
- calling the CLI
- copying outputs into `<paper>/_source/`
- term discovery
- term explanation
- glossary caching
- hover UX

The plugin should treat `scholar-md` as an external tool with a stable command
contract, not as internal source code.

## Stable interface contract

The extraction should preserve this CLI contract:

```sh
scholar-md input.pdf \
  -o output.md \
  --emit-diagnostics \
  --diagnostics-output output.diagnostics.json
```

Required behavior:

- exit code `0` on success
- non-zero exit code on failure
- markdown file must exist on success
- diagnostics file must exist when diagnostics were requested

This contract is what the Obsidian plugin should depend on.

## Migration steps

### Phase 1: create the new repo

1. Create a new local folder and git repo, for example `~/Documents/scholar-md`.
2. Copy the source/test/docs files listed above from `tools/scholar-md/`.
3. Remove `egg-info` and `__pycache__`.
4. Confirm the new repo can run:
   - `python -m venv .venv`
   - `pip install -r requirements.txt`
   - `pip install -e .`
   - `python -m unittest discover -s tests`

### Phase 2: make the new repo independently releasable

1. Add `LICENSE`.
2. Add `.gitignore` for:
   - `.venv/`
   - `dist/`
   - `build/`
   - `*.spec`
   - `__pycache__/`
   - `*.pyc`
3. Add CI for:
   - unit tests
   - smoke conversion test
4. Add release automation for platform builds.

### Phase 3: convert Scholia into a consumer

In the plugin repo:

1. Remove `tools/scholar-md/` source ownership from long-term development.
2. Keep only the plugin-side invocation code.
3. Replace local bootstrap assumptions with one of these:
   - a downloaded standalone runtime
   - a developer override path for local builds
4. Update eval harness references so they target the standalone repo or its
   released binary instead of `tools/scholar-md/src`.

## Recommended release model

For end-user distribution, do not assume Python is installed and do not ship a
raw virtual environment.

Recommended model:

1. Build one standalone binary per platform.
2. Attach those binaries to GitHub releases in the `scholar-md` repo.
3. Let Scholia download the correct asset on first use.

Suggested platform targets:

- macOS arm64
- macOS x64
- Windows x64
- Linux x64

This is the cleanest user experience for a community plugin.

## Packaging options

### Recommended first attempt: PyInstaller

Pros:

- simplest path to a single executable
- common for Python CLI packaging
- good enough for a first shipping experiment

Cons:

- binary size is not tiny
- platform-specific builds required

### Alternative: Nuitka

Pros:

- can produce tighter native-feeling binaries

Cons:

- more moving parts
- slower build/debug cycle

Recommendation: start with `PyInstaller`, measure artifact size and startup
behavior, and only reconsider if the results are clearly unacceptable.

## Plugin changes required after extraction

These files in the plugin repo will need follow-up work:

- `src/main.ts`
  - keep CLI invocation
  - replace local-source assumptions with runtime resolution/download
- `package.json`
  - drop `test:scholar-md` and `bootstrap:scholar-md` once the tool is fully external
- `eval/pdf-tools/run-eval.mjs`
  - replace `tools/scholar-md/src` assumptions
- `eval/pdf-tools/README.md`
  - update setup instructions

The plugin should eventually expose only:

- a runtime status view
- install/update runtime actions
- optional advanced override path for development

It should not expose Python-specific setup to normal users.

## Acceptance criteria

The extraction is done when:

1. `scholar-md` lives in its own git repo.
2. The new repo can run tests without depending on the plugin repo.
3. The new repo can produce a releasable standalone executable.
4. Scholia can invoke the released runtime without vendoring source.
5. A user can install Scholia and run PDF conversion without manually
   creating a Python venv.

## Immediate next actions

Recommended order:

1. Create the new local repo.
2. Copy `tools/scholar-md` source/test/doc files into it.
3. Clean generated files.
4. Make tests pass in the new repo.
5. Add release automation for one platform first, ideally macOS arm64.
6. After that works, switch the plugin to consume the released runtime.
