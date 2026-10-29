# mpd-verif-plugin

[中文](./README.zh-CN.md)

Unified RTL verification plugin for my-power-dsh (Plan A, verification side).
One plugin, three backends — **iverilog / verilator / vcs** — resolved from
`MPD_DSH_VERIF_*` env overrides, the two-layer silicon toolchain config, or `PATH`
(no binary is ever vendored), with a
**cocotb lane for the open-source backends** under a strict project-local venv
isolation rule, a **UVM methodology lane gated to VCS**, and **waveform-read
hooks** that call user-wired wave-mcp / TraceWeave MCP tools when present and
degrade gracefully (with exact setup commands) when they are not.

## Hard dependency on @mpd-dsh/mpd

This plugin is not standalone. The bundle root `package.json` pins `@mpd-dsh/mpd` to exactly
`0.15.1`, the adapter is imported through the package specifier
`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` (types from its `src/index.ts`),
and the row declares the hard inject dependency:

```ts
export const inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]
```

The adapter is read from `ctx.mpdDsh`; there is **no fallback**. A profile without mpd leaves this
row PENDING, and the bundle's `silicon-require-mpd` guard turns that into exit 1 within 15 s.
`bun install` is required before tests or a build, because the dist keeps the dependency
external instead of inlining it.

## Tools

| Tool | Purpose |
| --- | --- |
| `mpd_verif_venv` | Manage the project-local cocotb venv: `status` (default) / `create` / `info` |
| `mpd_verif_backends` | Probe iverilog/verilator/vcs availability (env → PATH), versions, vcs license hints |
| `mpd_verif_compile` | Full compile to a sim binary with best-effort diagnostics parsing `{file,line,severity,code,message}` |
| `mpd_verif_lint` | Standalone lint pass: iverilog `-g2012 -tnull -Wall` / verilator `--lint-only -Wall` / vcs `-lca -sverilog +lint=all` |
| `mpd_verif_sim` | cocotb simulation on iverilog/verilator via the **cocotb Makefile flow**: generated `Makefile`, `make` invoked with `$VENV/bin` first on PATH (then the resolved tool directory, then the inherited PATH), `SIM=icarus` for the iverilog backend, results.xml parsed into per-case statuses, waves collected, optional wave-mcp handoff. On oss-cad-suite the iverilog lane points `ICARUS_BIN_DIR` at a shim that runs the bundled loader with `env -u PYTHONHOME` (the `vvp` wrapper re-adds it) |
| `mpd_verif_coverage` | Standalone coverage merge/report: verilator `verilator_coverage --annotate <dir> --annotate-all <merged.dat>` (`--all` is invalid in 5.053) / vcs `urg -dir … -report …`; `.dat` collection excludes `<top>__verFiles.dat` (build metadata); iverilog refused (`VERIF_E_UNSUPPORTED`, no native coverage) |
| `mpd_verif_uvm` | UVM lane **for VCS only**: layout contract validation + compile/run/regress/wave/merge-cov/clean |
| `mpd_verif_regress` | Multi-case regression (both lanes), deterministic seeds, `results.json` + markdown report |
| `mpd_verif_toolchain` | Inspect and edit the silicon toolchain config (`silicon.jsonc`): `show` (default) / `set` / `unset` / `init` / `path` / `detect`. Writes one key with a comment-preserving surgical edit; atomic, refuses ambiguity |
| `mpd_verif_librelane` | Resolve and run LibreLane (open-source RTL-to-GDS flow): `status` (mode/path/source/version/command preview) / `run` (verbatim argv, workspace-confined cwd, 1 h default timeout, log under `.mpd/librelane/`) |

## Iron rule — cocotb venv isolation

1. Venv lives at `<workspace>/.venv-rtl` (or `MPD_DSH_VERIF_VENV`) — **never** system python.
2. Created **only** via `python3 -m venv <path>` (the single sanctioned use of the system interpreter).
3. Every pip install runs as `<venv>/bin/pip install ...` — **never** `--user`, `--system`, pipx, or system pip.
4. Every simulation runs the generated **Makefile** via `make` with `$VENV/bin` **prepended to PATH** (DP-6), so every nested cocotb python resolves to the venv python — never a bare `python`.
5. `mpd_verif_sim` refuses (`VERIF_E_NO_VENV` / `VERIF_E_COCOTB_ABSENT`) unless the venv exists **and** cocotb imports inside it. The refusal message carries the exact setup command:

```sh
python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"
```

or just call `mpd_verif_venv` with `action: "create"`.

## Backend resolution

| Backend | Env override | Toolchain config | PATH fallback |
| --- | --- | --- | --- |
| iverilog | `MPD_DSH_VERIF_IVERILOG` | `ossCadSuite.bin`, or `ossCadSuite.home` + `/bin` | `iverilog` |
| verilator | `MPD_DSH_VERIF_VERILATOR` | `ossCadSuite.bin`, or `ossCadSuite.home` + `/bin` | `verilator` |
| vcs | `MPD_DSH_VERIF_VCS` | — (VCS stays env/site-managed) | `vcs` |

Resolution is tiered: the env override still wins, then the toolchain config, then `PATH`.
`mpd_verif_backends` reports the tier it used as `source: "env" | "config" | "path"`.
`slangServer.bin` is not part of this resolution: it only feeds the HDL LSP launcher's `PATH`.

Work state lands under `<workspace>/.mpd/verif/` (or `MPD_DSH_VERIF_WORK`). The plugin never
writes `~/.dsh` **except** an explicit `mpd_verif_toolchain` user-scope `set`/`unset`/`init`,
which writes the user's own `silicon.jsonc` (see below) — configuration, not plugin state, and
never implicit.

## Toolchain configuration

Two JSONC layers, deep-merged with the project winning:

| Layer | Path |
| --- | --- |
| user | `$MPD_SILICON_CONFIG` when set, else `${DSH_HOME:-~/.dsh}/silicon.jsonc` |
| project | `<workspace>/.mpd/silicon.jsonc` |

Missing files are normal; a malformed file is reported (`show`) or refused (`set`/`unset`),
never a crash. Schema: `ossCadSuite { home?, bin? }`, `verible { home?, bin? }`,
`slangServer { bin? }`, and
`librelane { appimage?, mode?, appimageExtract?, bin?, home? }`. `.bin` is an executable **or**
a bin directory; `.home` is an install root. Paths are `~`-expanded; a user-scope value must be
absolute, a workspace-scope relative value resolves against the workspace. `slangServer.bin` only
feeds the HDL LSP launcher's `PATH`; it is not a verification backend.

`mpd_verif_toolchain` is the conversational entry point: `show` (effective config, per-key
source layer, resolved binaries with existence/executable/version, both file paths), `set`
(one key), `unset`, `init` (commented template), `path` (the two files), `detect` (probe
env/PATH/common roots and return suggestions only, never write). `set`/`unset` target the
layer that already defines the key, else the user layer; `scope: "user" | "workspace"`
overrides. Writes are **surgical** (comments, key order and whitespace preserved — the editor
is ported from `@mpd-dsh/mpd`'s `mpd-config-plugin` and is MIT here; see
[`LICENSE-NOTICES.md`](../../LICENSE-NOTICES.md) for upstream licensing) and **atomic** (sibling temp +
rename, mode 0644). An ambiguous or malformed document is refused byte-untouched. `init`
refuses an existing file unless `force: true`.

Full reference: [`docs/toolchain.md`](../../docs/toolchain.md).

### LibreLane

`mpd_verif_librelane status` resolves and probes; `run` executes. `librelane.mode` (default
`auto`) picks the tier, then the environment, then `PATH`:

| Mode | Resolves | Runs |
| --- | --- | --- |
| `binary` | `librelane.bin` (file or dir), `librelane.home` candidates, env `MPD_SILICON_LIBRELANE`, `PATH` | argv directly, no shell |
| `appimage` | `librelane.appimage`, env `MPD_SILICON_LIBRELANE_APPIMAGE` | `[appimage, ...args]`, no shell |
| `devshell` | the AppImage (auto when its basename contains `devshell`) | `[appimage, "librelane", ...args]` — argv passed straight to the wrapper (`devshell [--pure] <cmd> [...]`); no shell, no quoting |

`status` reports mode/configuredMode/path/source/reason, existence and executable bit, the
extract decision, the command preview, the parsed version and hints. When
`librelane.appimageExtract` is unset, extraction is auto: **on** when `/dev/fuse` is not
readable+writable, and the child gets `APPIMAGE_EXTRACT_AND_RUN=1`. `run` takes `args`
(verbatim), an optional workspace-confined `cwd` and `timeoutMs` (default 3600000), always
writes `.mpd/librelane/<UTC>-<slug>.log`, and returns exitCode/duration/logPath/tails. The
timeout kills the direct child only; the cwd guard is lexical.

The real devshell wrapper has no `--run` flag: the released 0.4.0 shape
`[appimage, "--run", "librelane <posix-quoted args>"]` exited 127 (`exec: --run: not found`).
Fixed against the real 3.0.16 AppImage on 2026-10-22 — `status` → `mode: "devshell"`, extract
true (`/dev/fuse` absent), command `[appimage, "librelane", "--version"]`; `run` exit 0 in
5429 ms with empty stderr. Evidence: `evidence/verification/openictool/20261022T145500Z/`
(repo-relative).

### Prompt section

The plugin registers a `silicon-toolchain` prompt section (order 30) telling the agent that
the toolchain is configurable — user `$DSH_HOME/silicon.jsonc`, project
`<workspace>/.mpd/silicon.jsonc`, project wins — and that `mpd_verif_toolchain` is how to
persist "oss-cad-suite lives at X" while `mpd_verif_librelane` runs the flow. It is wrapped in
`try`/`catch`, so a composition without the `systemPrompt` seam never breaks the boot.

## Error taxonomy

All structured refusals return `{ ok:false, error:{ code, message, hint } }`:
`VERIF_E_NO_BACKEND` · `VERIF_E_NO_VENV` · `VERIF_E_COCOTB_ABSENT` ·
`VERIF_E_UNSUPPORTED` · `VERIF_E_LICENSE` · `VERIF_E_ENV` · `VERIF_E_COMPILE` ·
`VERIF_E_RUN` · `VERIF_E_TIMEOUT` · `VERIF_E_TEMPLATE` · `VERIF_E_CONFIG`. Compile failures
attach parsed diagnostics; UVM compile failures are retry-capped (3 attempts) and
write an honest `work/unresolved.md` on exhaustion.

## Lane gating (owner decision)

- `mpd_verif_sim` = cocotb lane, **iverilog | verilator only**. `backend: "vcs"`
  → `VERIF_E_UNSUPPORTED` pointing at `mpd_verif_uvm` (hard gate both directions,
  per owner).
- `mpd_verif_uvm` = UVM methodology lane, **VCS only** (no backend parameter).
  It validates the template layout contract (`<ip>/{rtl,script,tb,top,test,work}`,
  `tb/tb_api_primitives.svh` shared-BFM source of truth, `test/<case>_test.sv`
  naming, mandatory `sanity_test` + `reg_access_test`) and orchestrates the
  makefile-style contract: `-ntb_opts uvm-1.2`, per-case `work/work_<case>_/`
  dirs, coverage `-cm line+cond+tgl` + `urg` merge, fsdb wave runs (gated on
  `VERDI_HOME`/`NOVAS_HOME`), plus the **fsdbreport non-GUI verification hook**
  (FSDB integrity/warning report after wave runs, resolved via
  `MPD_DSH_VERIF_FSDBREPORT` / `VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` / PATH).
  The plugin ships **no template content** — rich cocotb/UVM skeletons live in
  the `skills/rtl-verif` corpus. Methodology is grounded in gen-tb-skill
  **structure** and raysalemi/uvmprimer **patterns**; **no code is reused from
  either repository**.

## Waveform-read hooks

After a sim/regress/uvm run, the plugin hands produced waves to user-wired MCP
tools when their registrations exist, otherwise it degrades with an actionable
message:

- OSS lane (`.fst`/`.vcd`) → `mcp__wave_mcp__prepare_session` (wave-mcp;
  `out_dir`, `wave_path`, `top`). Session home = `$DSH_HOME/wave-mcp`
  (or `MPD_DSH_WAVE_MCP_SESSION`), per team decision DP-8.
- VCS lane (`.fsdb` + logs) → `mcp__traceweave__get_sim_paths` (TraceWeave;
  `verif_root`, `case_name`, `sim_log`, `wave_file`).

Suggested wiring (see the team docs for full notes; **no hand-made venv** — the
venv iron rule belongs to cocotb only). The two MCPs pin CONFLICTING mcp SDK
versions (wave-mcp needs mcp>=2 → `mcp.server.mcpserver`; TraceWeave pins
mcp==1.27.0), so each goes through pipx into its own isolated env:

```sh
pipx install wave-mcp            # FST/VCD lane; mcp>=2
pipx install traceweave-mcp      # VCS/FSDB lane; mcp==1.27.0
# or one-shot: node scripts/install-mcp.mjs --with-wave --activate-wave
export MPD_DSH_WAVE_MCP_BIN="$(command -v wave-mcp)"
export MPD_DSH_TRACEWEAVE_BIN="$(command -v traceweave-mcp)"
```

## Environment notes (the source project's 2026-08 environment)

These are historical notes from the environment the port came from, not a measurement of this
checkout. The 2026-10-22 `/opt/openictool` test **did** run `mpd_verif_sim` (cocotb 2.1.0 in the
project venv): PASS (1 case) on iverilog and on verilator, and `mpd_verif_regress` 1/1 PASS on both.
It also merged 4 coverage files into `merged.dat` (4,260 B) and produced an annotated report. The
oss-cad-suite `vvp` wrapper re-adds `PYTHONHOME`; the iverilog lane points `ICARUS_BIN_DIR` at a shim
(`env -u PYTHONHOME`) instead of the wrapper. Evidence:
`evidence/verification/openictool/20261022T145500Z/` (repo-relative).

- Verilator+cocotb roundtrip passes end-to-end (results.xml parsed, VCD dumped).
- Verilator FST is the owner's default (`traceFst` defaults to **true** →
  `--trace-fst --trace-structs`) but needs **liblz4 headers** at build time;
  on machines without them set `traceFst: false` for VCD (wave-mcp converts VCD
  on read anyway). A missing-lz4 FST build surfaces as `VERIF_E_COMPILE` with
  the log path.
- The oss-cad-suite Icarus binary bundles an older glibc; on this box the
  icarus+cocotb VPI lane can fail at `vvp` with a `GLIBC_2.38` linker error
  unless python and Icarus share one glibc family (distro iverilog works).
  Use the verilator lane or a distro Icarus here.
- `MPD_DSH_VERIF_PYTHON3_CMD` overrides the `python3` used only for venv
  bootstrap (`python3 -m venv`), e.g. when the default shim is an SDK python.
- Unit tests exercise every lane with **fake binaries (fake-vcs argv capture)**
  and fake project venvs; the real-tooling smoke lives under
  `evidence/smoke/` in the package (rerun with
  `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs`).

## Development

```sh
bun test packages/mpd-verif-plugin   # 169 tests / 16 files (fake tools, no real EDA needed)
bun run typecheck                    # repo gate
bun build src/index.ts --target node --format esm --outfile dist/index.js
```

External runtime dependency: `@mpd-dsh/mpd` 0.15.1 (imported, never inlined); the remaining
runtime imports are `node:` builtins. Agent-facing code is English-only per the repo language
policy.