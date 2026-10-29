# RTL Verification Guide (Phase 1)

[中文](./rtl-verif-guide.zh-CN.md)

This guide covers the RTL development phase-1 capabilities shipped by the mpd-dsh
bundle: HDL language-server support (Verible + slang-server), coding templates in
the verilog-generator style, the built-in **mpd-verif** plugin (iverilog / Verilator /
Synopsys VCS unified verification flow, cocotb lane for the open-source backends,
VCS-only UVM lane), and the **waveform-read MCP wiring** (wave-mcp + TraceWeave).
It ends with the **engineering-flow recommendations** (owner-confirmed, see
notice in §6) and the **deferred to-do list** (§7).

## 1. What ships

| Piece | Form | Notes |
| --- | --- | --- |
| LSP for Verilog | builtin `verible` server (`.v`/`.vh`, runs `verible-verilog-ls`) | Ships inside the shipped `mcp-lsp` CLI; resolve the binary from `PATH` (prebuilt release binaries: <https://github.com/chipsalliance/verible/releases>) |
| LSP for SystemVerilog | builtin `slang-server` server (`.sv`/`.svh`, runs `slang-server`) | Real slang shallow-compilation diagnostics on keystroke; static binaries: <https://github.com/hudson-trading/slang-server/releases> |
| Coding templates | `skills/rtl-codestyle` | verilog-generator style: port prefixes `i_/o_/io_`, param prefix `C_`, state prefix `ST_`, internal `_o` + assign bridge, ANSI header, hard 3-process FSM templates (`.vinc`) |
| Verification plugin | `mpd-verif` bundle row | Ten built-in tools `mpd_verif_venv/backends/compile/lint/sim/coverage/uvm/regress` + `mpd_verif_toolchain` + `mpd_verif_librelane` (§2) |
| Verification scaffolds | `skills/rtl-verif` | cocotb TB/Makefile templates + golden fixtures + VCS-UV-M skeleton tree |
| Waveform MCP rows | `mcp-wave-mcp` (wave-mcp) + `mcp-traceweave` (TraceWeave) — **optional, NOT mounted by default** (commented example rows) | Install with pipx or any Python — **no venv required**; the venv iron rule applies to cocotb only (§3) |

Binary policy: **nothing is vendored**. Tool binaries resolve env-first via
`MPD_DSH_*` overrides, then `PATH`. QA always boots in an isolated `DSH_HOME`.

## 2. Verification flow (three backends, two lanes)

### 2.1 Backends

| Backend | Used for | Resolution |
| --- | --- | --- |
| `iverilog` | lint/compile + cocotb sim | `MPD_DSH_VERIF_IVERILOG` → `PATH` |
| `verilator` | lint/compile + cocotb sim | `MPD_DSH_VERIF_VERILATOR` → `PATH` |
| `vcs` | UVM lane only | `MPD_DSH_VERIF_VCS` → `PATH` (license via `VCS_HOME` / `LM_LICENSE_FILE` / `SNPSLMD_LICENSE_FILE` inherited from the shell) |

Lane gating (owner decision, hard refusals with `{code,message,hint}`):

- `mpd_verif_sim` (cocotb lane): `iverilog | verilator` only. `backend: "vcs"`
  → `VERIF_E_UNSUPPORTED`, pointing at `mpd_verif_uvm`.
- `mpd_verif_uvm` (UVM lane): **VCS only** (no backend parameter; the lane is
  fixed). Any open-source backend + UVM request → `VERIF_E_UNSUPPORTED`.
- `mpd_verif_coverage`: verilator (`verilator_coverage` merge + annotate) or vcs
  (`urg` merge + report); iverilog → `VERIF_E_UNSUPPORTED` (no native coverage).

All work state lands under `<workspace>/.mpd/verif/` (override
`MPD_DSH_VERIF_WORK`); the plugin never touches `~/.dsh`.

### 2.2 The cocotb VENV IRON RULE

For the open-source lane, cocotb lives in a **project-local venv** — never in
system Python. The plugin enforces this; violations are refused, not warned.

1. Venv = `<workspace>/.venv-rtl` (or `MPD_DSH_VERIF_VENV`).
2. Creation **only** via `python3 -m venv <path>` — the single sanctioned use of
   the system interpreter (`MPD_DSH_VERIF_PYTHON3_CMD` can override which
   `python3` does the bootstrap).
3. **Every** pip install runs as `<venv>/bin/pip install ...` — never
   `--user`, `--system`, pipx, or system pip.
4. **Every** simulation runs the generated `Makefile` through `make` with
   `$VENV/bin` prepended to `PATH` — never a bare `python`.
5. `mpd_verif_sim` refuses unless the venv exists **and** cocotb imports inside
   it: `VERIF_E_NO_VENV` / `VERIF_E_COCOTB_ABSENT`, each carrying the exact fix.
6. One-shot setup, either form:

   ```sh
   python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"
   # or, in an agent session:
   mpd_verif_venv(action: "create")
   ```

7. The venv is workspace-local only (never `~/.dsh`, never global).
8. QA acceptance: after runs, system Python must still fail `import cocotb`
   (zero global pollution — this is asserted by the `rtl-verif` dsh-qa case).

### 2.3 Open-source lane walk-through (cocotb)

1. Probe: `mpd_verif_backends(backend: "all")` — binary presence + versions,
   vcs license checklist when relevant.
2. Lint: `mpd_verif_compile(backend, sources[], target: "lint")` (or
   `mpd_verif_lint`) — iverilog `-g2012 -tnull -Wall` / verilator `--lint-only -Wall`,
   diagnostics parsed as `{file,line,severity,code,message}`.
3. Simulate: `mpd_verif_sim(backend: "verilator", top, sources[], tbModules[],
   seed, waves: true, traceFst?)`:

   - generates `Makefile` + runner (cocotb ≥ 2.0, `cocotb.runner` API),
   - parses `results.xml` into per-case `pass/fail/error/skip` with failure
     messages (self-closing `<failure/>` handled correctly),
   - collects waves: FST by default (`traceFst: true` →
     `--trace-fst --trace-structs`); set `traceFst: false` for VCD when the
     machine lacks liblz4 headers for the FST build.
4. Regression: `mpd_verif_regress(backend, cases, seedBase, ...)` — per-case
   work dirs, deterministic seeds (`seedBase + idx`), writes
   `<work>/results.json` + a markdown report.

Known machine notes (see the plugin README): oss-cad-suite Icarus can hit a
`GLIBC_2.38` VPI linker mismatch on some distros — prefer the verilator lane
or a distro Icarus there; a missing-lz4 FST build fails as `VERIF_E_COMPILE`
with the log path attached.

### 2.4 UVM lane on VCS

`mpd_verif_uvm(action: compile|run|regress|wave|merge-cov|clean, top, filelist,
test, uvmVer: "1.2", seed, coverage, waveFmt, verbosity)` — **VCS only**.

- **Layout contract** (validated before compiling; missing pieces →
  `VERIF_E_TEMPLATE` listing the expected files):
  `<ip>/{rtl,script,tb,top,test,work}`, `tb/tb_api_primitives.svh` (single-BFM
  source of truth), `test/<case>_test.sv` naming, mandatory `sanity_test` +
  `reg_access_test`. Skeletons live in `skills/rtl-verif/templates/uvm/` —
  the plugin ships **no template content**.
- **Makefile-style contract**: `-ntb_opts uvm-1.2`; seed default
  `date +%N`; per-case `work/work_<case>_/` dirs; coverage
  `-cm line+cond+tgl` + `urg` merge; FSDB waves gated on
  `VERDI_HOME`/`NOVAS_HOME` (plus the `fsdbreport` non-GUI verification hook,
  resolved via `MPD_DSH_VERIF_FSDBREPORT` / `VCS_HOME` / `VERDI_HOME` /
  `NOVAS_HOME` / `PATH`).
- **Honesty rule**: UVM compile is retried at most 3 attempts; on exhaustion
  the plugin writes an honest `work/unresolved.md` instead of claiming success.
- Methodology is grounded in `gokeshenzhen/gen-tb-skill` **structure** and
  `raysalemi/uvmprimer` **patterns only** — no code is reused from either
  project. Real VCS runs are owner-side (no VCS on the QA box); QA covers the
  refusal paths + exact argv construction (fake-vcs capture).

### 2.5 Toolchain configuration

Where the external tools live comes from a two-layer JSONC config, not this guide: user
`$MPD_SILICON_CONFIG` (else `${DSH_HOME:-~/.dsh}/silicon.jsonc`) and project
`<workspace>/.mpd/silicon.jsonc`, with the project layer deep-merged over the user one.
`MPD_DSH_VERIF_*` still wins at run time, then the config, then `PATH` — so the §2.1
resolution table gains a middle tier.

Use `mpd_verif_toolchain` to inspect and persist a path (`show` / `set` / `unset` / `init` /
`path` / `detect`), and `mpd_verif_librelane` to resolve and run LibreLane (binary / AppImage /
devshell; on a host without FUSE it sets `APPIMAGE_EXTRACT_AND_RUN=1` automatically). Full
reference: [`docs/toolchain.md`](./toolchain.md).

## 3. Coding side quick pointers

- Opening any `.v`/`.vh` (Verible) or `.sv`/`.svh` (slang-server) file resolves
  the builtin LSP automatically once the binary is on `PATH`; install hints are
  served by the LSP tooling itself (release-binary URLs in §1). In-project
  details: `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md`.
- **Escape hatch** for hand-built binaries: the example user-config
  `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` (silicon-owned; the
  MCP-LSP assets ship in this bundle and the `silicon-mcp-lsp` row is enabled —
  merge/copy it into `~/.codex/lsp-client.json`). Verify the shipped binary
  offline with `node scripts/build-lsp.mjs --check`; the measured MCP handshake
  negotiates protocol `2025-06-18`, advertises 8 tools, and a real
  `mcp__silicon_lsp__status` call reports 44 configured servers. Note: the loader drops **project-config**
  entries with non-builtin ids, so custom commands belong in the *user*
  config; the bundle deliberately does **not** auto-pin `LSP_TOOLS_MCP_USER_CONFIG`
  (it would shadow an existing app LSP config).
- New code follows `skills/rtl-codestyle` (verilog-generator style). Compose
  the scaffold: `skills/rtl-codestyle/templates/{module_skeleton,fsm_3process,
  parameterized_counter}.vinc`; the golden fixtures under
  `skills/rtl-verif/fixtures/{adder4,cnt8}` show verbatim ladder RTL + cocotb
  testbenches.

## 4. Waveform-read MCP wiring

**The bundle does NOT mount these rows by default.** They wrap external Python
MCP servers (wave-mcp / TraceWeave) with **conflicting `mcp` SDK pins** — wave-mcp
needs `mcp>=2` (module `mcp.server.mcpserver`), TraceWeave pins `mcp==1.27.0` —
so each tool MUST live in its own isolated install (NO venv required; a plain
`pip --target` dir is enough, the venv iron rule belongs to cocotb only, §3). A
missing or mismatched `mcp` SDK on the launching python crashes the MCP client
at boot (`ModuleNotFoundError: mcp.server.mcpserver`), so the rows ship as
COMMENTED examples in this bundle's `packages/mpd-bundle/cordis.patch.yml`
(boot-safety).

**Quickest fix — the installer** (pipx install + SDK verify + env + overlay in one shot):

```sh
node scripts/install-mcp.mjs --with-wave --activate-wave
source ~/.mpd/mcp.env
# then boot dsh (web GUI: merge ~/.mpd/mcp-wave.patch.yml rows, or --patch it)
```

Manual equivalent — each tool via pipx (each gets its own isolated env + mcp SDK):

```sh
pipx install wave-mcp            # brings mcp>=2 (mcp.server.mcpserver)
pipx install traceweave-mcp      # brings mcp==1.27.0
export MPD_DSH_WAVE_MCP_BIN="$HOME/.local/bin/wave-mcp"
export MPD_DSH_TRACEWEAVE_BIN="$HOME/.local/bin/traceweave-mcp"
```

Then enable the rows (uncomment in `cordis.patch.yml`, or boot with
`dsh --profile web --patch ~/.mpd/mcp-wave.patch.yml`), re-install the bundle
profile and restart dsh.

`mpd_verif_*` only calls these tools when they are wired; otherwise the
waveform hooks degrade silently. After a run with waves (`.fst`/`.vcd`, or
`.fsdb` + logs in the VCS lane), the plugin hands off:

- OSS lane → `mcp__wave_mcp__prepare_session` (`out_dir`, `wave_path`, `top`);
  session dir = `$DSH_HOME/wave-mcp` (override `MPD_DSH_WAVE_MCP_SESSION`).
- VCS lane → `mcp__traceweave__get_sim_paths` (`verif_root`, `case_name`,
  `sim_log`, `wave_file`).

Row resolution (env-first, `PATH` second — never vendored):

| Row | Command | Extra |
| --- | --- | --- |
| `mcp-wave-mcp` | `MPD_DSH_WAVE_MCP_BIN` or `wave-mcp` | **no `--session` at startup** (wave-mcp 0.1.1 dies on a missing session manifest); the session is created by the `prepare_session` hook after a sim run; `toolCallTimeoutMs: 120000` |
| `mcp-traceweave` | `MPD_DSH_TRACEWEAVE_BIN` or `traceweave-mcp` | no `env` block: `VERDI_HOME`/`NOVAS_HOME`/`VCS_HOME` + license vars inherit from the dsh launching shell |

**Install policy** (documented; the bundle never installs for you — no hand-made
venv; pipx gives each tool its own isolated env so the two `mcp` SDK pins can
never clash):

```sh
pipx install wave-mcp            # FST/VCD lane; brings mcp>=2 (mcp.server.mcpserver)
pipx install traceweave-mcp      # VCS/FSDB lane; brings mcp==1.27.0
# point the rows at the pipx bins (export before starting dsh):
export MPD_DSH_WAVE_MCP_BIN="$(command -v wave-mcp)"
export MPD_DSH_TRACEWEAVE_BIN="$(command -v traceweave-mcp)"
# sanity (wave-mcp must see mcp.server.mcpserver):
#   pipx runpip wave-mcp python -c "import mcp.server.mcpserver"
# TraceWeave additionally needs the EDA env in the same shell:
#   export VERDI_HOME=... NOVAS_HOME=... VCS_HOME=... (plus license vars)
```

## 5. Verification-flow how-to summary

1. `mpd_verif_backends` — know your binaries.
2. One-time per workspace: `mpd_verif_venv(action: "create")` (iron rule).
3. Iterate: lint → VCD/FST sim (`mpd_verif_sim`) → open waves (wave-mcp) →
   fix → repeat.
4. Batch: `mpd_verif_regress` — seeds, per-case dirs, `results.json` + report.
5. On VCS IPs: scaffold from `skills/rtl-verif/templates/uvm/`, compile the
   layout contract with `mpd_verif_uvm(compile)`, run `sanity_test` +
   `reg_access_test`, merge coverage, review waves via TraceWeave.

## 6. Engineering-flow recommendations — **confirmed by the owner (2026-08-30)**

> ✅ **Owner-confirmed.** All seven items below were reviewed with the owner and
> confirmed as feasible; they are the settled engineering-flow recommendations
> for phase-1 RTL work.

1. **Lint in the loop** — LSP diagnostics plus `mpd_verif_compile(..., lint)`
   as the pre-commit gate.
2. **cocotb-first open-source TBs** — one `@cocotb.test()` per case;
   `results.xml` feed CI.
3. **UVM only on VCS, with escalation criteria** — start cocotb/OSS; move a
   block to UVM-on-VCS only when enumerated criteria (register model,
   constrained-random coverage closure, cross-language reuse) are met.
4. **Waveform review gate** — FST/via wave-mcp after each regression;
   discuss fix-before-merge rather than paper over.
5. **Golden RTL flow** — C-model → verilog-generator-style templates → lint →
   sim → regress → wave review → merge.
6. **Environment hygiene** — `MPD_DSH_*` overrides, per-project `.venv-rtl`,
   VCS license env exported in the launching shell only.
7. **Regression hygiene** — deterministic seed rule (`seedBase + idx`),
   per-case work dirs, archive `results.json`.

Currently deferred to a later phase (P1 backlog, not shipped): VCS coverage
merge automation polish, deeper TraceWeave EDA wiring, `verible.filelist`
auto-generation, `.slang/server.json` template generation, regression
parallelization, zh translations of the lsp-setup references.

## 7. DEFERRED TO-DO (record only — no implementation planned now)

- **ast-grep Verilog support** — add Verilog/SystemVerilog language handling to
  the adopted ast-grep MCP (structural search/rewrite for RTL).
- **SpinalHDL / Chisel coding support** — Scala-based HDL front-ends
  (beyond the phase-1 scope; recorded for a future phase).

## 8. QA evidence

The phase-1 deliverable is gated by the `dsh-qa` case `rtl-verif`
(`skills/dsh-qa/scripts/rtl-verif.mjs`): isolated-boot mount of the
`mpd-verif` + `mcp-wave-mcp` + `mcp-traceweave` + `mcp-lsp` rows, dual-HDL
LSP registry on the shipped CLI, and a real verilator/cocotb golden-adder flow
with the venv iron rule and system-python cleanliness asserted. Evidence lives
under `evidence/dsh-qa/rtl-verif/`; plugin smoke under
`packages/mpd-verif-plugin/evidence/smoke/` (this repository).
