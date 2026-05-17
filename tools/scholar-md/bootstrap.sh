#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "Bootstrapping scholar-md into ${VENV_DIR}"
"${PYTHON_BIN}" -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"
"${VENV_DIR}/bin/pip" install -e "${SCRIPT_DIR}"

echo
echo "Installed scholar-md:"
echo "  ${VENV_DIR}/bin/scholar-md"
echo
echo "Set Scholia -> Scholar-MD CLI path to that executable if needed."
