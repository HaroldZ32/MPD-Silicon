#!/usr/bin/env bash
# ============================================================================
# run_regression.sh -- example regression driver (rtl-verif)
# ----------------------------------------------------------------------------
# VENV-first: sources the cocotb bootstrap (creates .venv-rtl once, installs
# cocotb inside the venv), then runs every golden-fixture cocotb suite through
# the standard Makefile flow. Results: results.xml (xUnit) per fixture.
#
# Usage:
#   ./run_regression.sh                # both fixtures, Icarus
#   SIM=verilator ./run_regression.sh  # switch backend
# ============================================================================
set -euo pipefail

SIM="${SIM:-icarus}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BOOTSTRAP="${SKILL_ROOT}/templates/cocotb/bootstrap_venv.sh"

# --- VENV-first bootstrap (never system python/pip) --------------------------
# shellcheck source=templates/cocotb/bootstrap_venv.sh
source "${BOOTSTRAP}"

FIXTURES=(
    "${SKILL_ROOT}/fixtures/adder4"
    "${SKILL_ROOT}/fixtures/cnt8"
)

status=0
for fx in "${FIXTURES[@]}"; do
    echo "== [regression] $(basename "${fx}") (SIM=${SIM}) =="
    if (cd "${fx}" && make sim SIM="${SIM}"); then
        echo "== [regression] $(basename "${fx}") PASSED (see ${fx}/results.xml) =="
    else
        echo "== [regression] $(basename "${fx}") FAILED (see ${fx}/results.xml) ==" >&2
        status=1
    fi
done

exit "${status}"
