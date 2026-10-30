# @mpd-dsh/silicon

[![CI — static gates](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/ci.yml/badge.svg)](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/ci.yml)
[![CI — docker real-machine verification](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/docker-verify.yml/badge.svg)](https://github.com/HaroldZ32/MPD-Silicon/actions/workflows/docker-verify.yml)
[![npm version](https://img.shields.io/npm/v/@mpd-dsh/silicon)](https://www.npmjs.com/package/@mpd-dsh/silicon)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[中文](./README.zh-CN.md)

RTL development capability bundle for DeepSeek Harness — the **RTL face** of
`@mpd-dsh/mpd`: RTL verification tooling, the RTL skill corpus, and the HDL
language-service row. It is a **companion bundle, not a standalone one**: it requires
`@mpd-dsh/mpd` `0.15.1` at runtime (pinned in `package.json`) and refuses to boot
without that bundle's `mpdDsh` service.

**Bundle version 0.7.0** · targets **DeepSeek Harness `0.2.1-rc.2`** and requires
**`@mpd-dsh/mpd` `0.15.1`**. The dependency-profile evidence is in
`evidence/verification/mpd-dependency/`; the earlier adaptation evidence is in
`evidence/verification/harness-0.2.1-rc.2/`.

## What it ships

| Row id | What it is |
| --- | --- |
| `silicon-require-mpd` | Startup guard: inject-free, polls `ctx.get("mpdDsh", true)` every 100 ms for up to 15 s and then throws, so a profile without `@mpd-dsh/mpd` exits 1 with an actionable message instead of booting with zero tools (see `packages/mpd-silicon-guard-plugin/`) |
| `silicon-bootstrap` | Serves `<bundle>/skills` through a `ctx.skills` provider (rank 600, provider name `silicon-bundle`). Nothing is copied into `$DSH_HOME`. Injects `["skills", "mpdDsh"]` |
| `silicon-verif` | The ten `mpd_verif_*` tools: iverilog / verilator / VCS resolution (env → the toolchain config → `PATH`), cocotb lane (project-local venv), VCS-only UVM lane, coverage merge/report, waveform handoff, the toolchain config (`mpd_verif_toolchain`) and the LibreLane runner (`mpd_verif_librelane`). Injects `dshSeamInject(DSH_SEAM_TOOLS)` plus `mpdDsh` |
| `silicon-docgen` | The four `mpd_docgen_*` tools (`register_xlsx`, `user_manual_docx`, `run`, `verify`): the spec-stage register Excel workbook and the bilingual Word user manual, written as OOXML with zero third-party runtime dependencies. `mpd_verif_*` stays at ten and the two tool namespaces never share a name. Injects `dshSeamInject(DSH_SEAM_TOOLS)` plus `mpdDsh` |
| `silicon-mcp-lsp` | HDL language service row (Verible / slang-server). **Enabled**; `serverName` `silicon_lsp`; 8 MCP tools (`status`, `diagnostics`, `goto_definition`, `find_references`, `symbols`, `prepare_rename`, `rename`, `install_decision`) |

Five patch rows in total. There is **no adapter row**: `@mpd-dsh/mpd`'s own
`mpd-dsh-adapter` row provides the `mpdDsh` service, and this bundle never registers it.

Bundled data:

- `skills/rtl-ip-flow` (10 files) — the four-swimlane RTL IP flow: stage gates, document
  templates (req-spec, user-manual + its `.en` twin, dfmea, verification-plan, detail-design,
  validation-report, defect-report), references
- `skills/rtl-codestyle` (6 files) — the Erie/verilog-generator style contract for
  synthesizable Verilog/SV
- `skills/rtl-verif` (20 files) — cocotb and VCS-UVM testbench templates, Makefile flows,
  regression workspace example, fixtures

There is **no `presets/` directory**: the `rtl-ip` team profile was retired — see
*rtl-ip retirement* below.

## Hard dependency on @mpd-dsh/mpd

`@mpd-dsh/mpd` is a **runtime dependency**, not an optional companion:

- `package.json` pins it **exactly** to `0.15.1` (no caret, no range).
- Plugin sources import the adapter through the package specifier
  `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`; nothing is copied into
  this repository and no local adapter port exists.
- The consumer rows use `inject: [...dshSeamInject(...), "mpdDsh"]` and read the adapter
  from `ctx.mpdDsh`. **There is no fallback** — a missing provider leaves the row
  PENDING by design, which is why the guard row exists.
- `silicon-require-mpd` is inject-free so it applies in every composition. When
  `mpdDsh` never becomes ACTIVE it throws, and the CLI turns that into exit 1 with:

  ```
  silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row
  ```

Why `mpdDsh` is not provided here: a Cordis service has exactly one provider. mpd's
`mpd-dsh-adapter` row owns `mpdDsh`; re-registering it here would abort the whole plugin
tree in any profile that mounts both bundles.

## Relationship to @mpd-dsh/mpd

This bundle is the RTL face that the mpd bundle shed: the same capability, owned here so
the MPD repo carries no RTL content. Concretely:

- **Row ids are silicon-owned and never collide with mpd's.** Every row id is prefixed
  `silicon-`, and this bundle's patch contains **no id-target of any kind** — a non-insert
  patch is a whole-value top-level assignment, not a deep merge.
- **One adapter, one service.** Both bundles use mpd's adapter contract; mpd provides
  `mpdDsh` and silicon consumes it. That is what makes the two bundles installable side
  by side in the same profile.
- **Both bundles in one profile work — measured on 0.2.1-rc.2.** A real boot with
  `dsh 0.2.1-rc.2`, `@mpd-dsh/mpd 0.15.1` and this bundle stayed alive to 50 s (timeout
  kill, exit 124) and logged `[mpd-silicon-bootstrap] skill corpus served`. The packed
  artifact was booted the same way to 45 s (exit 124). The three collision classes stay
  closed: the service singleton (mpd owns `mpdDsh`), the tool namespace (`mpd_verif_*`
  here, `mpd_verify_*` in mpd), and the MCP `serverName` (`silicon_lsp`; mpd's rows use
  their own names).
- **A silicon-only profile fails loudly — measured.** With no mpd on disk the boot exits
  1 after 18 s with the guard message above, and both consumer rows report
  `pending (waiting for service: mpdDsh)`.
- **The row-id gate reads the current mpd layout.** mpd v0.15.1 moved its patch to the
  repo root and added a second layer (`cordis.patch.yml` + `presets/mpd.patch.yml`,
  declared in `dsh.bundle.patch`). `verify-rows-disjoint.mjs` discovers every declared
  layer, reports per-layer counts, and finds 5 silicon ids ∩ 35 mpd ids = ∅.

## Install

Prerequisites:

- **DeepSeek Harness `>= 0.2.1-rc.2`** (`dsh --version`).
- **`@mpd-dsh/mpd` `0.15.1`** — silicon's hard runtime requirement; the command below
  installs it in the same run.
- **Node `>= 22.18`** (declared in `engines`).
- **pnpm on `PATH`** — `dsh plugin …` forwards its arguments to pnpm inside the profile.
  Measured with **pnpm 9.15.9**; see the pnpm note below.

### One command (recommended)

A silicon-only install is not enough: silicon's rows need the `mpdDsh` service, and an mpd
installed **transitively** is not auto-activated. Install **both bundles in one command**.

From the registry — `@mpd-dsh/silicon@0.7.0` **is published** (measured 2026-10-30:
`npm view @mpd-dsh/silicon@0.7.0` returns `0.7.0`, dist shasum
`01c5775d4559b6c452d3784da6b252ac81f651cb`, 86 files):

```bash
dsh plugin --profile <your-profile> add -w @mpd-dsh/mpd@0.15.1 @mpd-dsh/silicon@0.7.0
```

The registry **install** command above has not been re-measured on this host; the measured form
is the tarball command below. Later versions are published by `release.yml` on a `v*` tag through
npm Trusted Publishing (GitHub OIDC, provenance, no token).

From a tarball built in this repository (works without a publish):

```bash
npm pack
dsh plugin --profile <your-profile> add -w @mpd-dsh/mpd@0.15.1 ./mpd-dsh-silicon-0.7.0.tgz
```

Replace `<your-profile>` with the profile you boot (for example `dsh-tui`). `dsh plugin`
forwards everything after `--profile <name>` to pnpm verbatim, so `-w` is pnpm's
`--workspace-root` flag: a profile directory is a pnpm workspace root, and pnpm 9 refuses a
root install without it.

The install is self-registering: `dsh plugin add` appends every newly installed **direct
dependency** that declares `dsh.bundle.patch` to `dsh.profile.bundles`, so no manifest edit
is needed. It writes the profile's `package.json`, `pnpm-lock.yaml` and `node_modules` and
leaves the rest of `$DSH_HOME` alone.

**Measured on this host (2026-10-23, tarball form above)**: pnpm 9.15.9, dsh 0.2.1-rc.2,
isolated `DSH_HOME`. The install exited 0; the profile manifest ended with
`@mpd-dsh/mpd` and `@mpd-dsh/silicon` in `dependencies` and both in `dsh.profile.bundles`;
a real boot logged `[mpd-silicon-bootstrap] skill corpus served`. A **silicon-only**
profile installs the same way but exits 1 at boot with the `silicon-require-mpd` guard
message — that refusal is the honest floor, not a bug. Record (git checkout only):
`evidence/verification/plugin-install/20261023T022635Z/`.

> **pnpm note.** pnpm 9.15.9 completed the install above. The pnpm 12.15.0 that corepack
> resolved on the same host failed with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (the
> store-lock path landed on a read-only filesystem). If you hit that error, put a pnpm 9.x
> binary first on `PATH` and re-run the command.

### Update

Re-run the same tarball `add` with the new version (the measured form):

```bash
npm pack
dsh plugin --profile <your-profile> add -w @mpd-dsh/mpd@0.15.1 ./mpd-dsh-silicon-<new-version>.tgz
```

The registry form `dsh plugin … add -w @mpd-dsh/mpd@0.15.1 @mpd-dsh/silicon@<new-version>` is
**published from `0.7.0` onward**, but the registry *install* path was not re-measured on this
host — the tarball path above is the measured one.

Keep the mpd version at `0.15.1` unless this bundle's pin moves with it — the two are
released together.

### Uninstall

```bash
dsh plugin --profile <your-profile> remove @mpd-dsh/silicon
```

This removes the package from the profile and drops it from `dsh.profile.bundles` (the
harness reconciles that list after a successful run). The bundle's rows and skill corpus go
with it; nothing was ever copied into `$DSH_HOME`. Removing `@mpd-dsh/mpd` as well leaves a
silicon-only profile, which then stops at the guard.

### Manual path: edit the profile package.json

The profile-directory path still works when you want to control the files yourself:

1. Add both bundles to `$DSH_HOME/profiles/<your-profile>/package.json` under
   `dependencies`: `"@mpd-dsh/mpd": "0.15.1"` and `"@mpd-dsh/silicon": "0.7.0"` (or a
   `file:`/tarball spec).
2. Add both names to `dsh.profile.bundles` in the same file — this path does not reconcile
   that list, and a bundle missing from it contributes no patch layer.
3. Run `bun install` in the profile directory (this path needs **bun**).

This is the alternate/manual path; the measured path is the one command above.

The bundle targets `dsh >= 0.2.1-rc.2` and `@mpd-dsh/mpd 0.15.1` exactly; it does not
claim compatibility with older harness generations or other mpd versions.

## Build and test

Prerequisites: Node `>= 22.18`, **bun** (the build and the test runner; measured with
1.4.3), and git. `bun install` installs `@mpd-dsh/mpd` `0.15.1` and the type roots
(`bun-types`, `@types/node`) that the type gate needs.

```bash
node scripts/build.mjs                      # bun build per plugin -> dist/index.js (bun on PATH)
bun test packages/                          # 325 pass / 1 skip / 0 fail (326 tests, 25 files)
node scripts/typecheck.mjs --require        # fails instead of skipping when type roots are absent
```

Suite breakdown: `mpd-verif-plugin` 169 tests / 16 files, `mpd-silicon-bootstrap-plugin`
30 / 2, `mpd-silicon-guard-plugin` 11 / 2, `mpd-mcp-lsp` 10 / 1, `mpd-docgen-plugin`
106 / 4. The one skip is the corpus cross-check against the source checkout, which is
expected after the RTL strip (the three trees no longer exist there; the corpus is still
verified against its committed baseline).

## Gates

| Command | Meaning |
| --- | --- |
| `node scripts/typecheck.mjs --require` | zero diagnostics from the local tsgo; `--require` turns the missing-type-roots skip into a failure |
| `bun test packages/` | plugin unit suites (326 tests: 325 pass / 1 declared skip, 25 files) |
| `node scripts/verify-corpus.mjs` | the 3 RTL trees match the committed baseline (sha256 + size), LF-only UTF-8, and the provider loads all 3 skills |
| `node scripts/verify-rows-disjoint.mjs` | this bundle's row ids ∩ **every declared mpd patch layer** = ∅; discovers the layers from each manifest's `dsh.bundle.patch` (string or array), with root fallback |
| `node scripts/verify-rows-disjoint.mjs --self-test` | the same gate plus 6 parser, 2 gate and 6 discovery controls; exit 1 = fixture failed, 2 = input unreadable |
| `node scripts/build-lsp.mjs --check` | `dist/cli.js` matches `BUILD.lock` (sha256 + size), both HDL servers are inside, the overlay anchor and reference docs are present |
| `node scripts/pack-silicon.mjs --self-test` | prove the package-set guards are falsifiable (an unlisted package must fail; a fake source tree must trip the leak guard) |
| `node scripts/pack-silicon.mjs --check` | exit 1 if any committed file is unreadable by a non-root consumer |
| `node scripts/pack-silicon.mjs --fix` | repair those modes in place (idempotent); run before committing if another tool wrote a file |
| Boot check | two isolated `DSH_HOME` boots that really mount the rows: **coexist** (mpd + silicon, must stay alive and serve the corpus) and **no-mpd refusal** (silicon only, must exit 1 with the guard message) |
| `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` | package-local tool-surface smoke; an HDL/VCS check that cannot run prints SKIP with its reason |

`--dump-config` proves composition only, never that plugin code applied; `--help` is
produced before the plugin tree settles and is evidence in neither direction. A mount claim
comes from a real boot's exit code and stderr, and a tool claim from a real `tool/result`.

## Size and footprint (0.3.0 → 0.5.0)

The adapter port and its tests left the repository; `@mpd-dsh/mpd` is now externalized
from the built dists instead of inlined. The current dev tree carries the 0.5.0 dependency
profile plus the devshell, sim/regress and slang-server fixes.

| Artifact | 0.3.0 | 0.5.0 | Note |
| --- | --- | --- | --- |
| `mpd-verif-plugin/dist/index.js` | 226,463 B | 160,209 B | imports the mpd adapter instead of embedding it |
| `mpd-silicon-bootstrap-plugin/dist/index.js` | 80,793 B | 11,734 B | same externalization |
| `mpd-dsh-adapter-plugin/dist/index.js` | 77,563 B | — | package deleted |
| `mpd-silicon-guard-plugin/dist/index.js` | — | 1,420 B | new guard |
| **Committed JS dist total** | **384,819 B** | **173,363 B** | **−54.9 %** |
| **Packed bundle** | **919,281 B** | **700,120 B** | **−23.8 %** |

The removed in-repo adapter package accounted for 646,769 B; `bun.lock` is now about
57 KB; the new guard package's files total about 18 KB and its shipped dist is 1,420 B.

**Docgen addition (2026-10-22 measurement).** The `mpd-docgen` feature adds
`packages/mpd-docgen-plugin/dist/index.js` = **119,911 B**, so the committed JS dist total becomes
160,209 + 11,734 + 1,420 + 119,911 = **293,274 B**. The `du -sb dist/silicon-package` figure of
**843,280 B** is the 0.6.0-era staged artifact (whole-tree apparent size, measured before the
packaging change); 0.7.0 ships the LSP assets, docs, test fixtures and the prepack guard as well,
so the current staged artifact is **larger**. Its exact size, sha256 and file count are recorded in
`evidence/verification/plugin-install/20261023T022635Z/`, not on this page, so the figure here
cannot go stale. The 0.3.0 → 0.5.0 percentages in the table above stay historical and unchanged.

## EDA backends and prerequisites

The verif tools resolve a backend at call time: `MPD_DSH_VERIF_IVERILOG`,
`MPD_DSH_VERIF_VERILATOR`, `MPD_DSH_VERIF_VCS` are checked first, then the silicon
toolchain config (`ossCadSuite.bin`, or `ossCadSuite.home` + `/bin`), then `PATH`. Nothing is
vendored — no simulator is redistributed by this bundle.

- **Open-source lane** (iverilog and/or verilator + cocotb): cocotb runs strictly under the
  project-local venv rule — the venv is created with `python3 -m venv` and every install
  goes through that venv's own pip; system python/pip are never used. `mpd_verif_venv`
  (action `create`) bootstraps it.
- **VCS lane** (VCS + UVM 1.2): requires a commercial VCS license and `VCS_HOME` /
  `VERDI_HOME` / `NOVAS_HOME` exported in the launching shell. The bundle does not supply,
  activate, or check out licenses.
- **A machine with no backend is an honest refusal, not a crash.** `mpd_verif_backends`
  returns `ok: false` with a per-backend hint and a top-level note; the test suite detects
  the host and either asserts success (a backend is present) or asserts that refusal,
  printing `ENV-GATED: no HDL backend (iverilog/verilator) — install with apt install iverilog verilator`.
- **The open-source lane was measured for real on `/opt/openictool` (2026-10-22).**
  oss-cad-suite 20261021 provides iverilog 14.0 and verilator 5.053 (plus
  `verilator_coverage`); `mpd_verif_backends` resolved both with `source: "config"`, compile and
  lint returned `OK` on each, and both compiled binaries ran with exit 0. `mpd_verif_sim` passed
  1 case on each backend and `mpd_verif_regress` passed 1/1 on each; coverage merged 4 files into
  `merged.dat` (4,260 B) and produced an annotated report. VCS is absent (no license;
  `mpd_verif_uvm` returns the expected `VERIF_E_NO_BACKEND`). See
  `evidence/verification/openictool/20261022T145500Z/`.
- **Waveform reading**: the `silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` rows exist as
  commented examples only and are **not enabled by default**. They wrap external Python MCP
  servers (`pipx install wave-mcp`, `pipx install traceweave-mcp`) and are off because a
  missing or mismatched `mcp` SDK on the launching python crashes the MCP client at boot and
  takes the host with it. Uncomment and pin `MPD_DSH_WAVE_MCP_BIN` /
  `MPD_DSH_TRACEWEAVE_BIN` to enable. The verif tools degrade gracefully while they are off.

## Toolchain configuration

Where the external tools live is machine-specific, so it is read from a two-layer JSONC
config rather than hard-coded:

| Layer | Path |
| --- | --- |
| user | `$MPD_SILICON_CONFIG` when set, else `${DSH_HOME:-~/.dsh}/silicon.jsonc` |
| project | `<workspace>/.mpd/silicon.jsonc` (deep-merged over the user layer) |

Example, with the paths measured on the `/opt/openictool` host (comments and trailing commas
are allowed):

```jsonc
{
  // oss-cad-suite provides iverilog, verilator and verilator_coverage.
  "ossCadSuite": { "home": "/opt/openictool/oss-cad-suite" },
  // verible provides verible-verilog-ls (the HDL language server).
  "verible": { "bin": "/opt/openictool/verible" },
  // slang-server provides the SystemVerilog language server (.sv/.svh).
  "slangServer": { "bin": "/opt/openictool/slang-server" },
  // librelane is the RTL-to-GDS flow driver.
  "librelane": {
    "mode": "auto",
    "appimage": "/opt/openictool/librelane/librelane-devshell-x86_64.AppImage"
  }
}
```

On that host the four keys were written at **project** scope (`set`), and the
original comments survived; the removed leaves left blank lines (cosmetic). Project scope is
resolved per call by `mpd_verif_toolchain`, but the LSP launcher reads it only when the dsh
process cwd is the workspace — see the cwd caveat in [`docs/toolchain.md`](./docs/toolchain.md).

`mpd_verif_toolchain` shows the effective config and the resolved backends, and persists a
path with a comment-preserving surgical edit (`show` / `set` / `unset` / `init` / `path` /
`detect`). `MPD_DSH_VERIF_*` still wins at run time, then the config, then `PATH`. The same
files drive the HDL language-service launcher, so `verible.bin` and `slangServer.bin` set here
reach the LSP row.

`mpd_verif_librelane` resolves and runs LibreLane in `binary`, `appimage` or `devshell` mode
(`auto` uses a configured AppImage, and devshell when its basename contains `devshell`). The
devshell wrapper's real interface is `devshell [--pure] <cmd> [...]`, so the runner executes
`[appimage, "librelane", ...args]` directly (no shell, no quoting) and `status` probes
`[appimage, "librelane", "--version"]`. The 0.4.0 `[appimage, "--run", "librelane
<posix-quoted args>"]` shape was wrong: `--run` does not exist and exits 127
(`exec: --run: not found`). On a host without FUSE the runner sets
`APPIMAGE_EXTRACT_AND_RUN=1` automatically; `status` reports the resolved path, source,
version and command preview, and `run` keeps a log under `.mpd/librelane/`.

Full reference: [`docs/toolchain.md`](./docs/toolchain.md).

## HDL language service

The HDL server ships here as the canonical home: `packages/mpd-mcp-lsp/dist/cli.js` is
pinned by `dist/BUILD.lock` (sha256 `04b49f8c…`, 235271 bytes; overlay anchor
`mpd-rtl-overlay-v1`) and is built over the upstream `lsp-core`/`lsp-daemon` source with the
Verible/slang-server overlay. At mpd v0.15.1 that package was re-scoped to a cclsp
launcher, so the HDL half lives only in this bundle.

On the adaptation baseline the row mounted enabled, the MCP server negotiated protocol
`2025-06-18`, advertised the 8 tools above, and a real harness tool call returned the
configured-server status. That measurement predates the 0.4.0 dependency profile; the new
profile boots were not used to claim a live tool call. The `serverName` is `silicon_lsp`
because `serverName` is a process-global namespace and mpd's own MCP rows use their own names.

The 2026-10-22 `/opt/openictool` test exercised the row against both real servers: **44 configured
servers, 2 installed** — Verible `v0.0-4296` (`.v/.vh`) and slang-server `0.3.1+` (`.sv/.svh`).
Verible: a clean adder returned `No diagnostics found`, a broken file returned `error[verible]`
at `3:2` and `4:0`, and `verible-verilog-lint` exited 1. slang-server: a clean file returned
`No diagnostics found`, a broken file returned `error` at `2:22` and `3:12` plus
`warning (unused-port)`. A stale daemon lease can defer startup
(`DaemonStartupDeferredError: owner_pid_live_unreachable`); clearing `~/.mpd/lsp-daemon` and
`/tmp/mpd-lsp-*` recovers it. Evidence:
`evidence/verification/openictool/20261022T145500Z/`.

## rtl-ip retirement

The `rtl-ip` team profile data (`presets/rtl-ip.profile.json` and its carrier contract) was
**retired**, not moved:

- The team-profile plane it targeted is gone. `@deepseek-ai/dsh-experimental-agent-team`
  `0.2.1-rc.2` exposes only four limits (`maxMembers`, `maxTasks`, `maxMessageBytes`,
  `disposalTimeoutMs`); there is no `config.profiles` and no `resolveTeamProfile` to merge
  into. The old hook contract named a row that no longer exists.
- The replacement is the mpd **roster** (11 specialists, `mpd_role_spawn` /
  `mpd_role_persona`), **`teamModels.slot1..4`** routing in `mpd.jsonc`, and the **workmate
  library** (`~/.mpd/workmate`). Those express persona, provider/model and durable identity,
  which the old 7-member file could not express on this harness.
- The `rtl-ip-flow` **skill** remains: it is the domain procedure (four stages, gates,
  document templates). Only the `--profile rtl-ip` team-profile invocation is gone. Stage the
  team through the official Agent Teams tools and give the members the RTL roles from the
  skill.

No replacement data file is shipped, and this bundle still never id-targets an mpd row.

## Sync strategy with the source repository

The RTL assets are ported from the source project — the sibling directory `../my-power-dsh`,
overridable with the `MPD_SOURCE_ROOT` environment variable (see `docs/sync-policy.md`) — and
then **physically removed** from it (source-side task t5), after which this repo is the only
home for them. `skills/**` is verified against the committed
`evidence/verification/corpus-baseline.json`; the source checkout is an optional cross-check.
`@mpd-dsh/mpd` is consumed as a pinned external dependency; the pin and upgrade procedure are
recorded in [`docs/sync-policy.md`](./docs/sync-policy.md).

## CI and release

CI runs on **GitHub Actions** (`.github/workflows/`), four workflows:

- `ci.yml` — **static gates** on `main` (push and pull request): typecheck, tests, corpus, row ids,
  LSP assets, packer self-test, workflow check, `--self-test`/`--check` (`--fix` is local only),
  pack, package self-test and package verify; it uploads `dist/silicon-package` as the
  `silicon-package` artifact.
- `docker-verify.yml` — **docker real-machine verification**: builds the repository `Dockerfile`
  (real iverilog, verilator and yosys on Node 24 + bun `1.4.3`), runs the full gate suite and the
  EDA smoke, expects `DOCKER-VERIFY: PASS`, and uploads the `docker-verify.log` run log as the
  `docker-verify-log` artifact.
- `boot-e2e.yml` — the two real boots (coexist and no-mpd refusal) on path-filtered pushes to
  `main`, plus manual dispatch.
- `release.yml` — a `v*` tag asserts the tag version equals `package.json.version`, runs the gates,
  produces the `npm pack` tarball plus `dist/silicon-package.tar.gz`, **publishes
  `@mpd-dsh/silicon` to npm** with `npm publish --access public --provenance` through **npm
  Trusted Publishing**, publishes a **GitHub Release**, and pushes the verification image to
  **GHCR** (`ghcr.io/haroldz32/mpd-silicon:vX.Y.Z` and `:latest`).

npm Trusted Publishing uses the **GitHub OIDC token**: the workflow grants `id-token: write`, npm
exchanges that short-lived token with the registry itself, and the trusted publisher is bound to
this repository plus the `release.yml` filename — so there is **no `NPM_TOKEN` secret and no
`.npmrc`**. The publish step runs after the version assert and the whole gate chain, so a tag that
does not match `package.json.version` never reaches the registry, and `--provenance` attaches a
signed build attestation. The manifest is publishable by design (`files`, `engines`, `license`,
`repository`, `publishConfig.access: public`, and the `prepack` guard). `0.7.0` is on the registry
(measured 2026-10-30: `npm view @mpd-dsh/silicon@0.7.0` returns `0.7.0`, dist shasum
`01c5775d4559b6c452d3784da6b252ac81f651cb`, 86 files); it was published before the OIDC step
landed, and every later version publishes from `release.yml`. Branch model: `main` is the trunk
and the only pull-request target; `feature/*` / `fix/*` are short-lived; `release/vX.Y.Z` carries
the release bump (the annotated `vX.Y.Z` tag is cut on `main`). See
[`CONTRIBUTING.md`](./CONTRIBUTING.md), the PR template at
`.github/PULL_REQUEST_TEMPLATE.md`, [`CHANGELOG.md`](./CHANGELOG.md), and
[`docs/toolchain.md`](./docs/toolchain.md). `CONTRIBUTING.md`, `.github/`, `AGENTS.md` and the
`evidence/` records are **in the git checkout only** — they are not part of the npm tarball.

## License

MIT — see [`LICENSE`](./LICENSE). Third-party components keep their original licenses; see
[`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md). `@mpd-dsh/mpd` 0.15.1 is an external SUL-1.0
dependency and is **not redistributed** here.

## Status

`evidence/verification/mpd-dependency/` records the 0.4.0 dependency profile (boots, guard
refusal, the live 2-call session, size and test measurements). The 0.3.0 evidence under
`evidence/verification/harness-0.2.1-rc.2/`, `t7-install-boot.md` and `t3-*` is **historical**
and was not edited: it measured the standalone install that 0.4.0 removes. Limits are stated
there rather than hidden. The 2026-10-22 full `/opt/openictool` test adds the real open-source
lane end to end: config `set`/`show` (including `slangServer.bin`) → `show`/`backends`, compile
and lint on iverilog and verilator, `sim` PASS (1 case) and `regress` 1/1 PASS on both, coverage
merge/report, the expected UVM refusal, LibreLane devshell `status` + `run`, and both HDL
servers, with the whole gate suite green (the suite now measures 326 tests / 25 files;
typecheck `--require`, corpus, rows 5 ∩ 35 = ∅, LSP assets, GitHub workflows,
`ci-boot --require`). Recorded at `evidence/verification/openictool/20261022T145500Z/`.
Still open: any VCS lane (no license — `mpd_verif_uvm` is an expected refusal) and a full
PDK/RTL-to-GDS flow (`yosys`, `gtkwave` and the slang compiler are present but unused by the
bundle; the AppImage runs with `APPIMAGE_EXTRACT_AND_RUN=1` because `/dev/fuse` is absent).
