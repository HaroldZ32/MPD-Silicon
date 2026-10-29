#!/usr/bin/env bash
# ============================================================================
# bootstrap_venv.sh -- VENV-FIRST cocotb bootstrap (template)
# ----------------------------------------------------------------------------
# Owner decision DP-6 / iron rule: cocotb ALWAYS runs inside a project-local
# Python venv.  The ONLY sanctioned use of system python is `python3 -m venv`
# to CREATE the venv; everything else (pip install, running cocotb) happens
# inside the venv.  NEVER use system python/pip/pipx/--user/--system to
# install or run cocotb.
#
# Usage (from a cocotb workspace, e.g. skills/rtl-verif/fixtures/adder4):
#   source ../../templates/cocotb/bootstrap_venv.sh
#   make sim SIM=icarus        # or SIM=verilator
#
# The script is idempotent: existing venv is reused, missing bits installed.
# ============================================================================
set -euo pipefail

# --- Locate this script (works when sourced or executed) ----------------------
SCRIPT_SRC="${BASH_SOURCE[0]:-$0}"
TEMPLATE_DIR="$(cd "$(dirname "${SCRIPT_SRC}")" && pwd)"
# Default venv root: <workspace>/.venv-rtl.  Override with VENV=/path/to/venv.
DEFAULT_VENV="$(cd "${TEMPLATE_DIR}/../.." 2>/dev/null && pwd)/.venv-rtl"
VENV="${VENV:-${DEFAULT_VENV}}"

# --- Create the venv (ONLY sanctioned system-python use) ----------------------
if [ ! -x "${VENV}/bin/python" ]; then
    echo "[bootstrap] creating venv at ${VENV}"
    # IRON RULE: `python3 -m venv` is the ONLY system-python call here.
    python3 -m venv "${VENV}"
fi

# --- Install cocotb INSIDE the venv (never system pip) ------------------------
# The venv's own pip (pip 24+) rejects the externally-managed Python env
# check, so installing inside the venv is both safe and the intended path.
"${VENV}/bin/pip" install --quiet --upgrade pip
"${VENV}/bin/pip" install --quiet "cocotb~=2.0"

# --- Verify the installed cocotb inside the venv ------------------------------
if ! "${VENV}/bin/cocotb-config" --version >/dev/null 2>&1; then
    echo "[bootstrap] ERROR: cocotb-config not found in ${VENV}/bin" >&2
    return 1 2>/dev/null || exit 1
fi
echo "[bootstrap] cocotb: $("${VENV}/bin/cocotb-config" --version) (venv: ${VENV})"

# --- Prepend the venv bin dir to PATH (current shell only) --------------------
export PATH="${VENV}/bin:${PATH}"
export COCOTB_VENV="${VENV}"
echo "[bootstrap] PATH now starts with ${VENV}/bin -- system python untouched."
