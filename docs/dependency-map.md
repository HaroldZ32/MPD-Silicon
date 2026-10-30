# RTL asset dependency map

**English** | [中文](./dependency-map.zh-CN.md)

What was stripped out of the source project, where it lives now, what it depends on, and how to
prove each item is real. This is the auditable record behind the "RTL face leaves the MPD repo"
split; read it together with [`sync-policy.md`](./sync-policy.md), which fixes the authority and
change rules between the two repositories.

> **Updated 2026-10-22** for the full `/opt/openictool` verification (oss-cad-suite 20261021,
> Verible `v0.0-4296`, slang-server `0.3.1+`, LibreLane devshell 3.0.16, cocotb 2.1.0) on the
> adaptation baseline DeepSeek Harness `0.2.1-rc.2` + `@mpd-dsh/mpd` `0.15.1`. Every status, count
> and command below was re-measured on that baseline; §5 reproduces each number from a checkout.
> Counts kept from an earlier measurement stay inline with the date they were measured.
>
> The **document-generation package** (§1 S5) and the corpus growth to **36 files** are a later
> change on the same baseline; those rows carry their own measurement date and verification command.
>
> The **packaging + one-command install** row (§1 S6) is a later change on the same baseline; it
> carries its own measurement date and verification command.

## How to read this document

- **This repository** = the silicon bundle checkout. All "new home" paths are relative to its root.
- **`<SRC_ROOT>`** = the source project checkout the assets are being stripped from. Resolve it as
  the sibling directory `../my-power-dsh` of this repo, or from the `MPD_SOURCE_ROOT` environment
  variable when the checkouts are not siblings.
  No absolute path is hard-coded anywhere in this file on purpose: the document stays correct when
  either checkout moves, and it carries no machine-specific home path.
- Every **new-home** path below was checked to exist (`test -e`), and every command in the
  verification column was actually executed. The ledger in §3 records the commands, their exit
  codes, and the observed output.
- **Source-side paths are historical.** The RTL surface was physically removed from the source
  project by the strip commit `12291a7` (parent revision `3d99718`); those paths no longer exist on
  disk. They are kept in the table as provenance and are recoverable from history, for example
  `git -C <SRC_ROOT> show 3d99718:packages/mpd-verif-plugin/src/index.ts`. Rows whose source side
  has been removed say so inline; the corpus itself is guarded by the committed baseline manifest
  (`evidence/verification/corpus-baseline.json`), not by the source checkout.
- Assets that are **not on disk yet** are marked `pending` with the task that lands them. They are
  never written as if they already existed.
- Identifiers of the form `t<n>` are entries in the migration ledger; the evidence for each is
  recorded in the shared task list and in the commit message that lands it.

## 1. Asset map

One row per stripped asset class.

| # | Asset class | Source (`<SRC_ROOT>/…`) | New home (this repo) | Status | Coupling / dependency | Verification |
|---|---|---|---|---|---|---|
| **A1** | `mpd-verif` plugin and its **10** `mpd_verif_*` tools | `packages/mpd-verif-plugin/` — `src/` (13 `.ts`), `test/` (16 suites + fixtures), `README.md`, `README.zh-CN.md`, `package.json`, `evidence/smoke/smoke.mjs` — **removed by t5; recover with `git show 3d99718:<path>`** | `packages/mpd-verif-plugin/` — same `src/`/`test/`/READMEs + `package.json` (`@mpd-dsh/verif`) + built `dist/index.js` | landed | **Hard dependency on `@mpd-dsh/mpd` 0.15.1**: `src/index.ts` imports the adapter by package specifier (`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`) and declares `inject: [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]`, reading the live adapter from `ctx.mpdDsh`. No fallback and no local copy; every tool registers through that adapter's `ctx.tools` seam. The built dist keeps the specifier external (160,209 B; it was 226,463 B before externalization) | `bun test packages` (220 tests / 21 files: 219 pass / 1 skip; verif 169 / 16); `grep -c '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/mpd-verif-plugin/dist/index.js` → non-zero; 10 tool names present in both `src/` and `dist/` |
| **A2** | RTL skill corpus — 3 trees, 36 files | `skills/rtl-ip-flow/` (10), `skills/rtl-codestyle/` (6), `skills/rtl-verif/` (20) — **removed by t5; recover with `git show 3d99718:<path>`** | `skills/rtl-ip-flow/`, `skills/rtl-codestyle/`, `skills/rtl-verif/` | landed | Served by the `silicon-bootstrap` row through a `ctx.skills` provider (provider name `silicon-bundle`, rank 600); the corpus is read from `<bundle-root>/skills` at runtime and is never copied into `DSH_HOME`. Each `SKILL.md` frontmatter must stay inside the provider's YAML subset | `node scripts/verify-corpus.mjs` (10 checks pass, 36 files, provider loads all 3 skills; the source cross-check reports a visible SKIP now that the source trees are gone) |
| **A3** | `rtl-ip` team profile | `packages/mpd-bundle/cordis.patch.yml` — the `rtl-ip:` block at line 320, inline in the `agent-teams` row's `config.profiles` | **none — RETIRED** (no `presets/` directory and no `./presets/*` export in this bundle) | **RETIRED** — the team-profile plane was removed by mpd v0.10.0 and nothing replaces it on the harness side | mpd v0.10.0 deleted the team-profile plane (`config.profiles` on the old `agent-teams` row), and `@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` exposes only `maxMembers` / `maxTasks` / `maxMessageBytes` / `disposalTimeoutMs` — there is no profile slot left, so no carrier hook and no `MAX_TEAM_PROFILES` budget can exist. Replacement: the mpd roster (`mpd_role_spawn` / `mpd_role_persona`) + `teamModels.slot1..4` + the workmate library; the `rtl-ip-flow` skill stays as the domain procedure | `node scripts/verify-rows-disjoint.mjs` (exit 0: 5 silicon ids, 35 mpd ids across 2 layers, zero intersection); `test ! -d presets` (no profile data to carry) |
| **A4** | HDL language service (Verible / slang-server) | `packages/mpd-mcp-lsp/` — `overlay/lsp/server-definitions.ts`, `overlay/lsp/language-mappings.ts`, `templates/rtl-lsp-client.json`, `dist/cli.js`, `dist/BUILD.lock`; plus the HDL knowledge layer `skills/lsp-setup/references/verilog/README.md`, `skills/lsp-setup/references/systemverilog/README.md` | `packages/mpd-mcp-lsp/` — `overlay/`, `templates/`, `dist/`, plus `references/verilog/README.md`, `references/systemverilog/README.md` | **landed (t16); row `silicon-mcp-lsp` enabled** | The offline build applies the overlay over a freshly copied upstream `lsp-core`/`lsp-daemon` checkout and fails loudly on drift (`mpd-rtl-overlay-v1` anchor); both HDL servers are inside the built `dist/cli.js`. This package is now the **canonical HDL home**: `@mpd-dsh/mpd` v0.15.1 re-scoped its own package to a cclsp launcher and no longer carries the HDL registry entries. Source-side, `skills/lsp-setup/SKILL.md:46-47` routes `.v/.vh` and `.sv/.svh` to those two READMEs (source-side task t17) | `node scripts/build-lsp.mjs --check` (exit 0: `dist/cli.js` sha256 **and** byte size match `BUILD.lock`, both HDL registry entries present, 2 reference docs + 4 golden fixtures in place); a real boot negotiates MCP protocol `2025-06-18` and advertises 8 tools; a real `mcp__silicon_lsp__status` call reports 44 configured servers; the 2026-10-22 `/opt/openictool` test exercised both real HDL servers — Verible `.v/.vh` (clean `No diagnostics found`, broken file `error[verible]` at 3:2/4:0, `verible-verilog-lint` exit 1) and slang-server `.sv/.svh` (clean `No diagnostics found`, broken file `error` at 2:22/3:12 + `warning (unused-port)`) — so `status` reports 44 configured / **2 installed**, and `slangServer.bin` is the config key that feeds the launcher's `PATH` |
| **A5** | Waveform-read MCP rows (`wave-mcp` / `TraceWeave`) and their install path | `packages/mpd-bundle/cordis.patch.yml:92-118` (commented `mcp-wave-mcp` / `mcp-traceweave` rows); installer `scripts/install-mcp.mjs` (`--with-wave`, `--activate-wave`, `pipx`) | `packages/mpd-bundle/cordis.patch.yml:89-114` — the same two rows as commented, default-off `silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` | rows **landed (default-off)**; equivalent installer **not present / unassigned** | Both rows wrap *external* Python MCP servers resolved from `MPD_DSH_WAVE_MCP_BIN` / `MPD_DSH_TRACEWEAVE_BIN` (env first, `PATH` second). They stay commented because a missing or mismatched `mcp` SDK crashes the client at boot. The two packages disagree on the SDK (`wave-mcp` needs `mcp>=2`, `TraceWeave` needs `mcp==1.27.0`), so they must be installed into **isolated** environments. The `mpd_verif_*` waveform handoff degrades gracefully while they are off | `grep -n 'silicon-mcp-wave-mcp\|silicon-mcp-traceweave' packages/mpd-bundle/cordis.patch.yml` → lines 99 / 109; `packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` asserts the graceful-degrade hook |
| **A6** | Six RTL documents | `docs/rtl-gap-assessment.md`, `docs/rtl-gap-assessment.zh-CN.md`, `docs/rtl-ip-flow-guide.md`, `docs/rtl-ip-flow-guide.zh-CN.md`, `docs/rtl-verif-guide.md`, `docs/rtl-verif-guide.zh-CN.md` — **removed by t5; recover with `git show 3d99718:<path>`** | `docs/` (same filenames) + `docs/rtl-docs-port-record.md` for provenance | landed (separate task) | `rtl-verif-guide.md` is the documented home of the waveform install strategy; the commented `silicon-mcp-wave-mcp` / `silicon-mcp-traceweave` rows in `packages/mpd-bundle/cordis.patch.yml` carry the enable recipe, so the guide and the rows are on the same side of the split. The port record lists the corrections applied and the references that have since landed | `ls docs/rtl-*.md` (6 files + the record); `test -e docs/rtl-verif-guide.md` |
| **A7** | QA cases covering the RTL surface | `skills/dsh-qa/SKILL.md` (case rows 59 `rtl-verif`, 63 `rtl-ip-profile`), `skills/dsh-qa/scripts/rtl-verif.mjs`, `skills/dsh-qa/scripts/rtl-ip-profile.mjs`, `skills/dsh-qa/scripts/dual-track-smoke.mjs` | Stays in the mpd repo (`skills/dsh-qa/` is not one of this bundle's three RTL trees), but the two RTL cases must be **repointed at the silicon bundle** | **landed (t19: repointed at the silicon bundle)** | The cases boot the real `dsh` CLI in an isolated temporary `DSH_HOME` and assert the mounted rows; `rtl-verif` additionally drives a real open-source backend on a golden fixture. **t19 repointed both**: root = sibling `../my-power-dsh-silicon` (or `MPD_SILICON_ROOT`), and the patch/corpus assertions now read silicon's `packages/mpd-bundle/cordis.patch.yml` (5 additive rows, zero id-targets) and the three RTL trees; `rtl-ip-profile` reports the rtl-ip carrier as **retired** (an evidenced skip). The HDL LSP assets ship here and the row is enabled (A4). Real passes print a SKIP reason (exit 0) when silicon or `dsh` is absent | `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test` (exit 0); `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-verif.mjs --self-test` (exit 0) — real passes: `rtl-verif.mjs` → `ok=true` (composed 4 rows at that run, before the `silicon-docgen` row landed, lint+sim+regress), `rtl-ip-profile.mjs` → `skipped-rtl-ip-carrier` (exit 0) |

### Supporting assets (not separate capability classes, but they carry the map)

| # | Asset | Source (`<SRC_ROOT>/…`) | New home (this repo) | Status | Coupling | Verification |
|---|---|---|---|---|---|---|
| S1 | `@mpd-dsh/mpd` — external runtime dependency | `@mpd-dsh/mpd` v0.15.1: `packages/mpd-dsh-adapter-plugin/` (the adapter and the `mpdDsh` service) | **none — not copied here.** The root `package.json` pins `"@mpd-dsh/mpd": "0.15.1"`; `bun install` provides it, and the in-repo adapter package is deleted (646,769 B removed) | **externalized** — imports use the package specifier, never a relative path | The adapter is the only code allowed to touch the harness seams; this bundle consumes it and never registers `mpdDsh` itself (single-provider service, owned by mpd's `mpd-dsh-adapter` row). A consumer reads `ctx.mpdDsh` with no fallback; absence is a startup refusal, not a degraded mode | `grep -rn '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/*/src packages/*/dist/index.js` → verif + bootstrap; `stat -c '%s' packages/{mpd-verif,mpd-silicon-bootstrap,mpd-silicon-guard}-plugin/dist/index.js`; `bun test packages` (220 / 21) |
| S2 | Golden Verilog fixtures | `tests/golden/fixtures/verilog/modules/adder4.v`, `tests/golden/fixtures/verilog/modules/cnt8.v`, `tests/golden/fixtures/verilog/tb/tb_adder4.v`, `tests/golden/fixtures/verilog/README.md` | `tests/golden/fixtures/verilog/…` (same layout) | **landed with t16** (commit `da3693c`) — the earlier "pending / unassigned" tracking is closed | `skills/rtl-verif/fixtures/adder4/Makefile:25` and `skills/rtl-verif/fixtures/cnt8/Makefile:25` (plus `skills/rtl-verif/templates/cocotb/Makefile:47`) set `RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules`, i.e. they resolve to this repo's root; the four files are present | `node scripts/build-lsp.mjs --check` asserts the four fixture paths (exit 0); `find tests/golden/fixtures/verilog -type f` → 4 files |
| S3 | Build and gate scripts | `scripts/build-mcp.mjs`, `scripts/pack-mpd.mjs`, `scripts/install-profile.mjs`, `scripts/verify-rows-parity.mjs`; `VENDOR_LOCK.json` (`assets.skills`) | `scripts/build.mjs` (plugin dists), `scripts/verify-corpus.mjs` (corpus gate), `scripts/verify-rows-disjoint.mjs` (row-id gate), `scripts/pack-silicon.mjs` (package-set + mode gate), `evidence/verification/corpus-baseline.json` (the corpus fidelity baseline) | landed | The source repo's `VENDOR_LOCK.json` was **re-pinned in the strip commit**: `assets.skills` = `fileCount 331` / `treeSha 23e18d7c…e1597`, matching `git ls-tree -r HEAD -- skills` = 331. `scripts/pack-mpd.mjs` dropped `mpd-verif-plugin` from `PLUGIN_PKGS`. On the silicon side the corpus baseline is committed, so `verify-corpus.mjs` runs offline and its source cross-check is optional | `node scripts/build.mjs`; `node scripts/verify-corpus.mjs`; `node scripts/verify-rows-disjoint.mjs`; `node scripts/pack-silicon.mjs --check` |
| S4 | `silicon-require-mpd` startup guard | new package (no source-side counterpart) | `packages/mpd-silicon-guard-plugin/` — `src/index.ts`, `test/` (2 suites, 11 cases), `dist/index.js` (1,420 B), `README.md`, `README.zh-CN.md`, `package.json` | **landed (0.4.0)** | Inject-free; polls `ctx.get("mpdDsh", true)` every 100 ms for up to `timeoutMs` (default 15 s), then throws so the CLI exits 1 with `silicon requires @mpd-dsh/mpd: …`. It does not import the adapter, so it applies in any composition | `bun test packages/mpd-silicon-guard-plugin` (11 tests / 2 files); silicon-only boot → exit 1 after ~18 s with both consumer rows `pending (waiting for service: mpdDsh)` |
| S5 | `mpd-docgen` package — document generation for the spec stage | new package (no source-side counterpart); the artifact format is ported from eCap's `tools/reg2excel.py` + `tools/xlsx2docx.py`, which are not copied | `packages/mpd-docgen-plugin/` — `src/` (15 `.ts`), `test/` (4 suites + 3 fixtures), `README.md`, `README.zh-CN.md`, `package.json` (`@mpd-dsh/docgen`) | **landed; row `silicon-docgen` enabled** | **Zero third-party runtime dependencies**: only `node:` builtins plus the mpd adapter, through the same hard `mpdDsh` dependency as A1. Writes the three spec-stage artifacts into the target project's `docs/` (`<ip>_regExcel_full.xlsx`, `<ip>_reg_user_manual.zh-CN.docx`, `<ip>_reg_user_manual.en.docx`) and is deterministic: fixed DOS timestamp 1980-01-01, sorted ZIP entries, no clock or random ids | `bun test packages/mpd-docgen-plugin` (106 tests / 4 files, 0 fail); `find packages/mpd-docgen-plugin/src -name '*.ts'` → 15; `grep -c '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/mpd-docgen-plugin/src/index.ts` → non-zero |
| S6 | Package manifest + one-command install path | new (no source-side counterpart; the source repo shipped `scripts/install-profile.mjs`) | root `package.json` — `files` (the four plugin dists, `packages/mpd-bundle/cordis.patch.yml`, `packages/mpd-mcp-lsp/{package.json,launch.mjs,dist,references,templates}`, `skills`, `tests`, `docs`, both READMEs, `LICENSE`, `LICENSE-NOTICES.md`, `CHANGELOG.md`, and the guard `scripts/verify-package-files.mjs`), `engines.node >= 22.18`, `license`, `repository`, `publishConfig.access: public`, `prepack` | **landed (0.7.0, 2026-10-23)** | `dsh.bundle.patch` points at `packages/mpd-bundle/cordis.patch.yml`, which is what makes `dsh plugin add` register the bundle; `tests/` must travel because the `rtl-verif` Makefiles default `RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules` (i.e. `<package>/tests`), and the LSP assets must travel because the `silicon-mcp-lsp` row addresses them by package-relative path (`package.json` included, so `resolveDaemonVersion()` reads the real version instead of falling back to `"0"`) | `node scripts/verify-package-files.mjs` → exit 0 (PASS; the full output and both self-test exit codes are in the evidence dir); `npm pack --dry-run --json` → the file list carries `tests/golden/fixtures/verilog/modules/adder4.v`, `packages/mpd-mcp-lsp/package.json` and the LSP asset paths, with no `src`/`test`/`evidence` entries; the tarball's file count, byte size and sha256 are recorded in `evidence/verification/plugin-install/20261023T022635Z/`; ledger rows 15–16 carry the install/boot and add/remove measurements |

## 2. Dependency edges between the mapped assets

- **A1 → S1 (hard dependency)** — the verif plugin imports the adapter through the
  `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` package specifier, declares
  `mpdDsh` in `inject`, and reads `ctx.mpdDsh`. There is no relative import, no local port, and no
  fallback: the bundle is **not** installable on its own.
- **A2 → S1 (hard dependency)** — the bootstrap row resolves the harness `skills` service through
  the same adapter, reads `ctx.mpdDsh`, and contributes the corpus by reference.
- **S4 → S1 (guard)** — `silicon-require-mpd` does not import the adapter; it watches the
  `mpdDsh` service and converts its absence into a startup failure, so the two consumer rows can
  stay PENDING-safe instead of serving an empty surface.
- **S5 → S1 (hard dependency)** — the docgen plugin imports the adapter through the same package
  specifier and declares `inject: [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]`. It reads the two
  manuals from the project and writes the three spec-stage artifacts into the project's `docs/`; the
  `rtl-ip-flow` Stage 2 / 规格评审 gate is what makes those artifacts mandatory.
- **A3 → retired, no seam** — the team-profile plane is gone (removed in mpd v0.10.0; harness
  `0.2.1-rc.2`'s experimental agent-team exposes only four limits), so there is no cross-repo
  carrier to keep in sync. The replacement is the mpd roster + `teamModels` + the workmate
  library; the `rtl-ip-flow` skill remains the procedure.
- **A4 → the offline LSP build + the skill routing** — the overlay only has meaning applied over
  the upstream `lsp-core` source, and the routing lines in the skill point at the two READMEs
  that now ship here, so this package is the canonical HDL home.
- **A5 → A1** — the verif tools hand waveforms to `mcp-wave-mcp` / `mcp-traceweave` when they are
  wired and degrade gracefully when they are not.
- **A7 → everything above** — the QA cases are the end-to-end evidence that the rows mount and the
  tools answer; they therefore have to be repointed whenever a row id or a bundle path changes.

## 3. Verification ledger

Executed on 2026-09-13 in the silicon checkout; every command below ran and its result is quoted
verbatim. Re-measured on 2026-10-21 on DeepSeek Harness `0.2.1-rc.2` + `@mpd-dsh/mpd` `0.15.1`, again
on 2026-10-22 for the 0.4.0 dependency profile (adapter port removed, mpd externalized), and once
more for the full `/opt/openictool` verification (sim/regress/coverage, both HDL servers, the whole
gate suite); rows whose value moved carry the new value inline, marked with the measurement date.
The packaging and one-command install were measured on 2026-10-23 (rows 15–16).

| # | Command | Exit | Observed |
|---|---|---|---|
| 1 | `test -e` sweep over the mapped paths (33 source + 19 new-home paths; the docgen source joined after this row was written) | 0 | every path existed **at that time**, except the explicitly-marked pending homes (`packages/mpd-mcp-lsp/`, `tests/golden/fixtures/verilog/`, the six `docs/rtl-*.md` files). The 33 source-side paths have since been **removed by the strip commit `12291a7`** — they are historical now (§How to read) and recoverable with `git show 3d99718:<path>`; the 19 new-home paths still resolve |
| 2 | `node scripts/verify-rows-disjoint.mjs` | 0 | at the time: `silicon: 4 row id(s) — insert 4, id-target 0`; `mpd: 23 row id(s) — insert 22, id-target 1`; `PASS: silicon ∩ mpd = ∅`. **2026-10-21** (the gate now discovers every declared mpd layer): `silicon total: 4 row id(s) — insert 4, id-target 0, across 1 layer(s)`; `mpd total: 35 row id(s) — insert 35, id-target 0, across 2 layer(s)` (root `cordis.patch.yml` 34 + `presets/mpd.patch.yml` 1); `PASS: silicon ∩ mpd = ∅`. **2026-10-22** (the `silicon-docgen` row landed): `silicon total: 5 row id(s) — insert 5, id-target 0, across 1 layer(s)`; `mpd total: 35 row id(s) — insert 35, id-target 0, across 2 layer(s)`; `PASS: silicon ∩ mpd = ∅` |
| 3 | `node scripts/verify-corpus.mjs` | 0 | `PASS — 10 check(s) passed, 0 skipped`; 35 files; `provider "silicon-bundle" loads all 3 skills`. **2026-10-22**: the corpus is **36 files** — `templates/user-manual.en.md` was added (rtl-ip-flow 9 → 10) and the gate floor is `MIN_FILES = 36`; the corpus lane owns that gate run |
| 4 | `node -e "import('./packages/mpd-verif-plugin/dist/index.js').then(m=>console.log('plugin ok', m.name))"` | 0 | `plugin ok mpd-verif` |
| 5 | `bun test packages` | 0 | at the time: `106 pass / 0 fail / 742 expect() calls / Ran 106 tests across 11 files`. After the t20 repair: `130 pass / 1 visible skip / 0 fail / 845 expect() calls / Ran 131 tests across 12 files`. **2026-10-21** (adapter re-ported from mpd v0.15.1): `282 pass / 1 skip / 0 fail / 1620 expect() calls / Ran 283 tests across 23 files` — the adapter suite alone is 174. **2026-10-22** (adapter port removed, mpd externalized; re-measured after the full `/opt/openictool` fixes): `Ran 220 tests across 21 files` — 219 pass / 1 skip / 0 fail; verif 169 / 16, bootstrap 30 / 2, guard 11 / 2, LSP 10 / 1. **2026-10-22** (V11 zh/en offset+width repair; 3 regression tests added): `Ran 326 tests across 25 files` — 325 pass / 1 skip / 0 fail; docgen 106 / 4, verif 169 / 16, bootstrap 30 / 2, guard 11 / 2, LSP 10 / 1 |
| 6 | `grep -oh '"mpd_verif_[a-z_]*"' packages/mpd-verif-plugin/src/*.ts \| sort -u` | 0 | the **10** tool names: `backends, compile, coverage, librelane, lint, regress, sim, toolchain, uvm, venv` — identical list from `dist/index.js` |
| 7 | `grep -o 'verible-verilog-ls\|slang-server' <SRC_ROOT>/packages/mpd-mcp-lsp/dist/cli.js \| sort \| uniq -c` | 0 | `1 verible-verilog-ls`, `4 slang-server` — the shipped LSP dist carries both HDL servers |
| 8 | `grep -n 'silicon-mcp-wave-mcp\|silicon-mcp-traceweave' packages/mpd-bundle/cordis.patch.yml` | 0 | lines 99 and 109, both commented out (default-off by design) |
| 9 | `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test` | 0 then, 1 after the strip, **0 again after the t19 repoint** | at the time: `ok: profile + 7 members + swimlane/flow markers + skill + 8 templates + bilingual guide verified`. After the strip it failed by design (`FAIL: rtl-ip profile missing in bundle patch`) and `test:qa` skipped it as known-stale. t19 repointed it at the silicon bundle: now `ok: silicon preset (7 members + taskPlanning + STAGE 0/IP01/STAGE 4) + 4 additive rows / id-target-free patch + skill + 8 templates + bilingual guide`, and `test:qa` runs it live again. **2026-10-21**: with the team-profile plane removed, the case reports the rtl-ip carrier as **retired** (an evidenced skip), not as pending |
| 10 | `node <SRC_ROOT>/skills/dsh-qa/scripts/rtl-verif.mjs --self-test` | 0 then, 1 after the strip, **0 again after the t19 repoint** | at the time: `ok: bundle wiring (mpd-verif active + wave rows commented) + golden fixture + eight-tool dist surface + iron-rule strings + devPatch operand guard`. After the strip it failed by design (`FAIL: cordis.patch.yml must ship exactly one ACTIVE mpd-verif row`) and `test:qa` skipped it. t19 repointed it at the silicon bundle: now `ok: golden fixture + silicon patch (4 additive rows, no id-target, no absolute path) + eight-tool dist surface + iron-rule strings + three corpus trees + preset profile`, with the HDL LSP registry group skipped until t16. **2026-10-21**: the HDL LSP assets it used to skip now ship here and the `silicon-mcp-lsp` row is enabled (A4). **0.3.0**: the dist surface is now **ten** tools — the quoted probe strings above are the historical eight-tool record; the additions are `mpd_verif_toolchain` and `mpd_verif_librelane` |
| 11 | `grep -rn '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin' packages/*/src packages/*/dist/index.js` | 0 | **2026-10-22**: verif (`src/index.ts`, `src/env.ts`, `src/silicon/*`, `dist/index.js`) and bootstrap (`src/index.ts`, `dist/index.js`) — the dependency is imported through the package specifier; no relative adapter import remains |
| 12 | `stat -c '%s' packages/{mpd-verif,mpd-silicon-bootstrap,mpd-silicon-guard}-plugin/dist/index.js` | 0 | **2026-10-22**: `160209`, `11734`, `1420` — committed JS dist total **173,363 B**, down from 384,819 B (−54.9 %); the deleted adapter dist alone was 77,563 B. Packed bundle 700,120 B, down from 919,281 B (−23.8 %); the removed in-repo adapter package accounted for 646,769 B |
| 13 | real boots (dsh `0.2.1-rc.2`, isolated `DSH_HOME`) | 124 / 124 / 1 | **2026-10-22**: coexist repo profile alive to 50 s (exit 124) with `[mpd-silicon-bootstrap] skill corpus served`; packed artifact alive to 45 s (exit 124); silicon-only profile exits 1 after 18 s with the guard message and both consumer rows `pending (waiting for service: mpdDsh)` |
| 14 | real `/opt/openictool` end-to-end test | 0 | **2026-10-22**: the full open-source lane — config `set`/`show` (incl. `slangServer.bin`) → `show`/`backends` (iverilog 14.0, verilator 5.053, `verilator_coverage`; `source: "config"`), compile + lint on both, `sim` PASS (1 case) on both, `regress` 1/1 PASS on both, coverage merge (4 files → `merged.dat` 4,260 B) + `--annotate-all` report, UVM expected `VERIF_E_NO_BACKEND` (no VCS), LibreLane devshell `status`/`run` (mode devshell, extract true, 3.0.16, 5429 ms, empty stderr), and both HDL servers (Verible `.v/.vh` clean / broken 3:2/4:0; slang-server `.sv/.svh` clean / broken 2:22/3:12 + `warning (unused-port)`). Evidence: `evidence/verification/openictool/20261022T145500Z/` |
| 15 | `dsh plugin --profile <p> add -w @mpd-dsh/mpd@0.15.1 <tarball>` (isolated `DSH_HOME`; pnpm 9.15.9, dsh `0.2.1-rc.2`) | 0 | **2026-10-23**: both bundles installed and auto-registered — profile `dependencies` = `@mpd-dsh/mpd` + `@mpd-dsh/silicon`, `dsh.profile.bundles` = `… @mpd-dsh/mpd, @mpd-dsh/silicon`; boot exit **124** (timeout kill) with `[mpd-silicon-bootstrap] skill corpus served`. A silicon-only profile installs (exit 0) but boots to exit **1** with `silicon requires @mpd-dsh/mpd: the mpdDsh service is absent`. Evidence: `evidence/verification/plugin-install/20261023T022635Z/` |
| 16 | `dsh plugin --profile rmtest add -w file:<fake-bundle>` then `dsh plugin --profile rmtest remove <name>`, plus the same `add` without `-w` (isolated `DSH_HOME`, temp `HOME`, pnpm 9.15.9) | 0 / 0, non-zero without `-w` | **2026-10-23**: the control that isolates the reconcile step from silicon-specific behaviour. `add` → `dsh.profile.bundles` = `["fake-bundle"]` with no manifest edit; `remove` (no `-w`) → the dependency and the bundle entry are both gone (`bundles` = `[]`), i.e. reconciliation is not add-only; `add` **without** `-w` exits non-zero with `ERR_PNPM_ADDING_TO_ROOT`. Recorded in `evidence/verification/plugin-install/20261023T022635Z/` |

Items 4–6, 9 and 10 are the ones that require an actual toolchain (Bun, Node, Verilator fixtures);
items 1–3, 7, 8 and 11 are offline and cheap to re-run. Items 12–13 need the built dists and a
real `dsh` binary respectively; item 14 needs the real `/opt/openictool` installation; items 15–16
need pnpm 9.15.9 on `PATH` and an isolated `DSH_HOME`.

## 4. Pending and unlanded items

| Item | Blocked on | What is already true | What is missing |
|---|---|---|---|
| A5 installer parity | no task assigned yet | the two rows exist here (commented), with the enable recipe inline | the source installer (`scripts/install-mcp.mjs --with-wave/--activate-wave`) has no counterpart here |
| A7 QA repointing | **closed — t19 repointed both cases at the silicon bundle** | the two cases boot the real `dsh` CLI in an isolated temporary `DSH_HOME` and assert the mounted rows: `rtl-verif` asserts the silicon patch (4 additive rows, zero id-targets) + the three corpus trees, and `rtl-ip-profile` now reports the rtl-ip carrier as **retired** (an evidenced skip, not pending); a real pass prints a SKIP reason (exit 0) when silicon or `dsh` is absent | nothing for the repoint itself; the HDL LSP registry group is no longer skipped, because A4 landed |
| **Source-side gate conflict (F4)** | **resolved** — option (1), executed in the strip commit; follow-up owner **t19** | the strip commit `12291a7` re-pinned `VENDOR_LOCK.assets.skills` (`331` / `23e18d7c…e1597`) and marks the two RTL QA cases known-stale inside `test:qa`. Measured on the source repo: `node scripts/verify-vendor.mjs` → exit 0, `node scripts/verify-rows-parity.mjs` → exit 0, `bun run test:qa` → exit 0 (`2 RTL cases skipped: known-stale until t19`) | nothing for the strip commit itself; the remaining work — repointing the two cases at the silicon bundle — is owned by **t19** (recorded in the skip message and `.silicon-extraction/removal.log`) |

Two items left this table with t16 (commit `da3693c`): the HDL language service (**A4**) and the four
golden Verilog fixtures (**S2**) are in the tree, and §1 records their landed state.

## 5. How to re-verify this map

```bash
# 0) resolve the source checkout (no absolute path is needed)
SRC_ROOT="${MPD_SOURCE_ROOT:-$(cd .. && pwd)/my-power-dsh}"   # run from this repo's root

# 1) every NEW-HOME path in §1 must exist (source-side paths are historical by design)
for p in packages/mpd-verif-plugin/src packages/mpd-docgen-plugin/src \
         skills/rtl-ip-flow skills/rtl-codestyle skills/rtl-verif \
         packages/mpd-mcp-lsp/dist/cli.js packages/mpd-bundle/cordis.patch.yml \
         tests/golden/fixtures/verilog/modules/adder4.v; do test -e "$p" || echo "MISSING $p"; done

# 2) the offline gates: types, corpus, row ids, LSP assets, modes, package contents
node scripts/typecheck.mjs --require      # real only after `bun install`; otherwise it skips loudly
node scripts/verify-corpus.mjs
node scripts/verify-rows-disjoint.mjs     # discovers every mpd patch layer the manifest declares
node scripts/build-lsp.mjs --check
node scripts/pack-silicon.mjs --check
node scripts/verify-package-files.mjs     # the prepack guard: allowlist, required files, patch rows

# 3) the ported plugins still load and the whole suite still passes
bun test packages
node -e "import('./packages/mpd-verif-plugin/dist/index.js').then(m=>console.log('plugin ok',m.name))"
```

If a **new-home** path above stops resolving, the map is stale: update this file in the same change
that moved the asset. The source-side paths are expected not to resolve any more — that is the
strip, not staleness (see §How to read). See [`sync-policy.md`](./sync-policy.md) for who is
allowed to move what.
