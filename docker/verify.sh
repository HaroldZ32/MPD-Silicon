#!/usr/bin/env bash
# docker/verify.sh — the real-machine verification entrypoint.
#
# Runs inside the image built from ./Dockerfile (node:24-bookworm + bun 1.4.3
# + the Debian EDA packages). It executes the SAME 11-step gate sequence CI
# runs in .github/workflows/ci.yml (frozen contract §3) — no step is skipped
# or weakened inside the container — and then a REAL EDA smoke on the shipped
# golden RTL: an iverilog compile + vvp simulation of the self-checking adder4
# testbench, a compile-only pass over cnt8 (no testbench ships for it), a
# verilator lint and a yosys synthesis run.
#
# Contract: exit 0 and print `DOCKER-VERIFY: PASS` only when every step passed.
# A failure prints the failing step on stderr and propagates its exit code.
set -euo pipefail

cd /work

CURRENT_STEP="startup"

fail() {
  printf '\nDOCKER-VERIFY: FAIL (exit %s) at %s\n' "$1" "$CURRENT_STEP" >&2
  exit "$1"
}

# run_step <label> <command...> — run one step, report it, propagate its code.
# `set +e` is explicit so a failing gate is reported as a failing STEP rather
# than aborting the script with no context.
run_step() {
  local label="$1"
  shift
  CURRENT_STEP="$label"
  printf '\n=== %s ===\n' "$label"
  set +e
  "$@"
  local rc=$?
  set -e
  [ "$rc" -eq 0 ] || fail "$rc"
  printf -- '--- OK: %s\n' "$label"
}

GOLDEN=tests/golden/fixtures/verilog

eda_iverilog_sim() {
  local vvp_out=/tmp/adder4.vvp
  local sim_log=/tmp/adder4.sim.log
  iverilog -g2005 -o "$vvp_out" "$GOLDEN/tb/tb_adder4.v" "$GOLDEN/modules/adder4.v" || {
    echo "iverilog compile FAILED" >&2
    return 1
  }
  vvp "$vvp_out" >"$sim_log" 2>&1 || {
    echo "vvp FAILED" >&2
    cat "$sim_log"
    return 1
  }
  cat "$sim_log"
  # The testbench reports a mismatch count but still calls $finish, so its exit
  # code alone cannot prove correctness: the printed verdict is the assertion.
  grep -q "ALL TESTS PASSED" "$sim_log" || {
    echo "simulation never reached the 'ALL TESTS PASSED' verdict" >&2
    return 1
  }
}

eda_cnt8_compile_only() {
  # No testbench ships for cnt8 (tb/ holds tb_adder4.v only). This is a
  # compile/lint check and says so — it is NOT reported as a simulation.
  echo "note: no testbench for cnt8 — compile-only, not a simulation"
  iverilog -g2005 -t null -s cnt8 "$GOLDEN/modules/cnt8.v" || return 1
  verilator --lint-only -Wall --top-module cnt8 "$GOLDEN/modules/cnt8.v" || return 1
}

eda_verilator_lint() {
  verilator --lint-only -Wall --top-module adder4 "$GOLDEN/modules/adder4.v"
}

eda_yosys_synth() {
  yosys -p "read_verilog $GOLDEN/modules/adder4.v; synth -top adder4"
}

echo "=============================================================="
echo " @mpd-dsh/silicon — real-machine verification image"
echo "=============================================================="
echo "node      : $(node --version)"
echo "bun       : $(bun --version)"
echo "iverilog  : $(iverilog -V 2>&1 | head -n 1 || true)"
echo "verilator : $(verilator --version)"
echo "yosys     : $(yosys -V)"

# ---- build ---------------------------------------------------------------
run_step "build: node scripts/build.mjs" node scripts/build.mjs

# ---- §3 gate sequence (identical to .github/workflows/ci.yml) ------------
run_step "gate 1/11 typecheck          node scripts/typecheck.mjs --require" node scripts/typecheck.mjs --require
run_step "gate 2/11 tests              bun test packages/" bun test packages/
run_step "gate 3/11 corpus             node scripts/verify-corpus.mjs" node scripts/verify-corpus.mjs
run_step "gate 4/11 rows               node scripts/verify-rows-disjoint.mjs" node scripts/verify-rows-disjoint.mjs
run_step "gate 5/11 lsp assets         node scripts/build-lsp.mjs --check" node scripts/build-lsp.mjs --check
run_step "gate 6/11 packer self-test   node scripts/pack-silicon.mjs --self-test" node scripts/pack-silicon.mjs --self-test
run_step "gate 7/11 workflow gate      node scripts/verify-github-workflows.mjs" node scripts/verify-github-workflows.mjs
run_step "gate 8/11 pack check         node scripts/pack-silicon.mjs --check" node scripts/pack-silicon.mjs --check
run_step "gate 9/11 pack               node scripts/pack-silicon.mjs" node scripts/pack-silicon.mjs
run_step "gate 10/11 package self-test node scripts/verify-package-files.mjs --self-test" node scripts/verify-package-files.mjs --self-test
run_step "gate 11/11 package verify    node scripts/verify-package-files.mjs" node scripts/verify-package-files.mjs

# ---- real-machine EDA smoke ---------------------------------------------
run_step "eda 1/4 iverilog compile + vvp sim (tb_adder4, self-checking)" eda_iverilog_sim
run_step "eda 2/4 cnt8 compile-only (no testbench ships)" eda_cnt8_compile_only
run_step "eda 3/4 verilator --lint-only -Wall (adder4)" eda_verilator_lint
run_step "eda 4/4 yosys synth (adder4)" eda_yosys_synth

echo
echo "=============================================================="
echo " DOCKER-VERIFY: PASS"
echo " 11/11 gates + 4/4 EDA smoke steps, real tools, no skips"
echo "=============================================================="
