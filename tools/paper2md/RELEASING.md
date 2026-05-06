# Releasing paper2md

This package is intended to be published independently from the Scholia
Obsidian plugin.

## Before first release

1. Confirm the package name `paper2md` is available on PyPI.
2. Review the dependency licensing, especially `PyMuPDF`.
3. Bump the version in:
   - `pyproject.toml`
   - `paper2md/__init__.py`
4. Make sure tests pass:

```sh
python -m pytest tests
```

## Build and validate

From `tools/paper2md/`:

```sh
python -m pip install -r requirements-dev.txt
python -m build
python -m twine check dist/*
```

This should produce:

- `dist/paper2md-<version>.tar.gz`
- `dist/paper2md-<version>-py3-none-any.whl`

## Upload

For a real release:

```sh
python -m twine upload dist/*
```

For a dry run against TestPyPI first:

```sh
python -m twine upload --repository testpypi dist/*
```

## User-facing install flow

After a PyPI release, Scholia users should be able to do:

```sh
conda create -n scholia python=3.11
conda activate scholia
pip install paper2md
```

Then set Scholia's `Paper2MD CLI path` to either:

- the environment root, or
- the concrete executable such as `.../envs/scholia/bin/paper2md`
