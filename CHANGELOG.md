# Changelog

All notable changes to `@mpd-dsh/silicon`. Versions follow the bundle version in `package.json`;
the version moves independently of `@mpd-dsh/mpd`.

## Unreleased

## 0.7.2 — 2026-10-30

### Changed

- **Infrastructure-only release: the release pipeline now stages the npm publish. No plugin or API
  behaviour change.** `.github/workflows/release.yml` runs
  `npm stage publish --access public --provenance` via **npm Trusted Publishing** (GitHub OIDC, no
  `NPM_TOKEN` secret, provenance attestation): a `v*` tag run stages the npm version and, in that
  same run, creates the GitHub Release and pushes the GHCR image. A maintainer **then** approves the
  staged version with 2FA, and only after that approval does it become live. The `v0.7.1` tag's
  direct `npm publish` was denied with `E403 "OIDC permission denied for this action"` because the
  trusted publisher allows staged publishing only — **0.7.1 was never published**; its entry below
  stays as history.
- **`@mpd-dsh/silicon@0.7.2` is live on npm** (approved 2026-10-30 after staging): `npm view
  @mpd-dsh/silicon@0.7.2` returns `0.7.2`, dist shasum
  `36d96f048bd5d0c49d8eaaac461b67d65ce1482e`, 86 files, with a signed SLSA provenance attestation.
  GitHub Release `v0.7.2` and GHCR `v0.7.2`/`latest` are published by the same tag run.

## 0.7.1 — 2026-10-30

### Changed

- **Infrastructure-only patch release: the npm Trusted Publishing pipeline and its documentation.**
  No plugin or API behaviour change.
- **`@mpd-dsh/silicon@0.7.0` is published to npm, and the release pipeline now publishes it.**
  The package is on the registry (measured 2026-10-30: `npm view @mpd-dsh/silicon@0.7.0` returns
  `0.7.0`, dist shasum `01c5775d4559b6c452d3784da6b252ac81f651cb`, 86 files; MIT), superseding the
  0.7.0 note that the registry form was **not measured — 0.7.0 is not published (`npm view`
  returns 404)**. `.github/workflows/release.yml` now grants
  `id-token: write` and, after the pack/package steps and before the GitHub Release, runs
  `npm publish --access public --provenance` through **npm Trusted Publishing**: the npm CLI
  exchanges the GitHub OIDC token itself, so there is no `NPM_TOKEN` secret and no `.npmrc`, and
  `--provenance` attaches a signed build attestation. The step runs after the tag/version assert
  and the full §3 gate chain, and the trusted publisher binds this repository, the package and the
  `release.yml` filename — which therefore stays unchanged.
- **Ported to GitHub (`HaroldZ32/MPD-Silicon`) with a complete GitHub Actions CI/CD.** Four
  workflows ship under `.github/workflows/`: `ci.yml` (the static gate suite on Node 24 +
  bun `1.4.3`), `docker-verify.yml` (the same suite plus a real EDA smoke — iverilog / verilator /
  yosys — inside the repository image, expecting `DOCKER-VERIFY: PASS`), `boot-e2e.yml` (the two
  real harness boots) and `release.yml` (a `v*` tag asserts `package.json.version`, then publishes
  a GitHub Release with the `npm pack` tarball + staged package and pushes the verification image
  to GHCR). The CI workflow gate is `node scripts/verify-github-workflows.mjs`; the previous
  hosting-specific workflow gate and its pipeline files are removed, and the issue/pull-request
  templates moved to `.github/`.
- **Relicensed to MIT.** This repository's own code is MIT (`LICENSE`); the Sustainable Use
  License 1.0 file is removed, every `package.json` (root and each package) declares
  `"license": "MIT"`, and `LICENSE-NOTICES.md` records that third-party components and the
  external `@mpd-dsh/mpd` 0.15.1 dependency keep their own licenses — the latter stays SUL-1.0 and
  is not redistributed.
- **Branch model: `main` is the trunk.** It is the only pull-request target and where annotated
  `vX.Y.Z` tags are cut; `feature/*` / `fix/*` are short-lived and `release/vX.Y.Z` carries the
  release bump. No `dev` or `master` line is introduced — a deliberate divergence from the source
  repository.
- **Metadata**: `repository` points at `https://github.com/HaroldZ32/MPD-Silicon`, with `bugs`,
  `homepage` and `packageManager: bun@1.4.3` added; `files` ships `LICENSE` instead of the removed
  license file.

## 0.7.0 — 2026-10-23

### Added

- **Installable as a proper dsh bundle.** The manifest is publishable — `files` (the four plugin
  dists, `packages/mpd-bundle/cordis.patch.yml`, `packages/mpd-mcp-lsp/{package.json,launch.mjs,dist,references,templates}`,
  `skills`, `tests`, `docs`, both READMEs, `LICENSE.md`, `LICENSE-NOTICES.md`, `CHANGELOG.md`
  and `scripts/verify-package-files.mjs`), `engines.node >= 22.18`, `license`, `repository` and
  `publishConfig.access: public` — and `prepack` runs `node scripts/verify-package-files.mjs`,
  which checks the allowlist, the required files and trees (including the docs and the LSP
  manifest the CLI's `resolveDaemonVersion()` reads), and the patch's insert rows before a
  tarball is produced.
- **One-command install, measured.** `dsh plugin --profile <p> add -w @mpd-dsh/mpd@0.15.1
  ./mpd-dsh-silicon-0.7.0.tgz` (the `npm pack` tarball) exits 0 on pnpm 9.15.9 + dsh 0.2.1-rc.2 in
  an isolated `DSH_HOME`, auto-reconciles `dsh.profile.bundles` to both bundles (no manifest
  edit), and the resulting boot logs `[mpd-silicon-bootstrap] skill corpus served`. The registry
  form `@mpd-dsh/silicon@0.7.0` is **not measured — 0.7.0 is not published (`npm view` returns
  404)**. A silicon-only profile installs but exits 1 at boot with the `silicon-require-mpd`
  guard message; `remove` drops the dependency and the bundle entry again. Evidence:
  `evidence/verification/plugin-install/20261023T022635Z/`.

### Fixed

- **`tests/` ships in the tarball.** The `rtl-verif` Makefiles default
  `RTL_DIR ?= ../../../../tests/golden/fixtures/verilog/modules` — i.e. `<package>/tests` — so the
  packaged bundle must carry the golden fixtures; `pack-silicon.mjs` now asserts that
  `tests/golden/fixtures/verilog/modules/adder4.v` really travelled, and the tarball's file list
  confirms the fixtures are inside. The tarball's exact file count, byte size and sha256 are
  recorded in the evidence directory above, not here, so this entry cannot go stale.
- **LSP assets ship.** `packages/mpd-mcp-lsp/{package.json,launch.mjs,dist,references,templates}`
  are in `files`, so the HDL language-service row has its launcher, built CLI, reference docs and
  the real `version` that `resolveDaemonVersion()` reads (instead of falling back to `"0"`). Both
  additions were checked on the tarball's file list; no other packaging claim is made here.

## 0.6.0 — 2026-10-23

### Added

- **`mpd-docgen-plugin` (`@mpd-dsh/docgen`)** — document generation for the `rtl-ip-flow` spec
  stage, with **zero third-party runtime dependencies** (only `node:` builtins and the mpd adapter).
  The internal user manual is the single machine-readable source: `docs/user-manual.md` plus its
  `docs/user-manual.en.md` twin produce the three spec-stage artifacts in the project's `docs/` —
  `<ip>_regExcel_full.xlsx`, `<ip>_reg_user_manual.zh-CN.docx` and
  `<ip>_reg_user_manual.en.docx`. The workbook follows the eCap format (`Sheet1`, nine columns, the
  Reg/field row model, fills/borders/fonts/widths); the docx pair follows the eCap register-chapter
  layout (two rows per register at 902/278 twips, a 6 × 16 bit table with 420-twip field-name rows,
  a detail table on the 830/1659/5807 grid) and deliberately ships **no TOC, cover, header or
  footer**. Both writers are deterministic — a rerun is byte-identical.
- **Four tools**: `mpd_docgen_register_xlsx`, `mpd_docgen_user_manual_docx`, `mpd_docgen_run` and
  `mpd_docgen_verify`. `run` produces all three artifacts under one `<ip>` and refuses a zh/en
  register-skeleton mismatch (`DOCGEN_E_LANG_MISMATCH`) before writing anything; `verify` is the
  gate oracle over the produced files (V1–V9, V11, V12; the byte-identical rerun V10 stays in
  `bun:test`). The `mpd_verif_*` surface stays at **10** tools.
- **Spec-stage gate**: `rtl-ip-flow` Stage 2 (规格设计 IP01) now writes the manual pair and runs
  `mpd_docgen_run`, and the 🔴 **规格评审** gate requires the three artifacts in `docs/` **and**
  `mpd_docgen_verify` returning ok. New English twin template
  `skills/rtl-ip-flow/templates/user-manual.en.md`; the corpus grows **35 → 36 files**
  (`skills/rtl-ip-flow/` 9 → 10) and the gate floor `MIN_FILES` moves 35 → 36.
- **Bilingual documentation**: `docs/docgen-guide.md` + `docs/docgen-guide.zh-CN.md`, and the package
  READMEs `packages/mpd-docgen-plugin/README.md` + `README.zh-CN.md`.

### Notes

- New package suite: `bun test packages/mpd-docgen-plugin` → **106 tests / 4 files, 0 failures**
  (parser/canonicalisation, xlsx, docx, run/verify), including the byte-identical rerun.
- Bounds: no PDF output; no third-party OOXML library; the register chapter is always rendered last;
  an access code with no Word mapping pair is emitted verbatim; a zh/en register-skeleton mismatch
  is a hard refusal.

## 0.5.0 — 2026-10-22

### Added

- **`slangServer.bin`** in the two-layer `silicon.jsonc` schema, and slang-server in the HDL LSP
  launcher's `PATH` order: **ossCadSuite → verible → slangServer → inherited**. The key only feeds
  the launcher; it is not a verification backend.
- **Full `/opt/openictool` verification**: oss-cad-suite 20261021 (iverilog 14.0, verilator 5.053,
  `verilator_coverage`), Verible `v0.0-4296`, slang-server `0.3.1+`, cocotb 2.1.0 in a project
  venv, and the LibreLane devshell AppImage 3.0.16. `mpd_verif_sim` PASS (1 case) on both
  backends, `mpd_verif_regress` 1/1 PASS on both, coverage merged 4 files into `merged.dat`
  (4,260 B) and produced an annotated report. LSP: 44 configured / **2 installed**; Verible
  `.v/.vh` clean `No diagnostics found` and broken `error[verible]` at 3:2 / 4:0; slang-server
  `.sv/.svh` clean `No diagnostics found` and broken `error` at 2:22 / 3:12 + `warning
  (unused-port)`. Evidence: `evidence/verification/openictool/20261022T145500Z/`.

### Fixed

- **LibreLane devshell invocation.** Released 0.4.0 ran the devshell AppImage as
  `[appimage, "--run", "librelane <posix-quoted args>"]`. The real wrapper's interface is
  `devshell [--pure] <cmd> [...]`, and it execs its argv, so `--run` exited **127**
  (`exec: --run: not found`). The runner now executes `[appimage, "librelane", ...args]` and
  `status` probes `[appimage, "librelane", "--version"]`; argv is passed directly, with no shell
  and no POSIX quoting.
- **cocotb `SIM` / `PATH` / `PYTHONHOME`.** The Makefile flow now passes `SIM=icarus` (not
  `iverilog`) and gives `make` the PATH `venv/bin` → the resolved tool directory → the inherited
  PATH. The oss-cad-suite `vvp` wrapper re-adds `PYTHONHOME`; the iverilog lane points
  `ICARUS_BIN_DIR` at a shim that runs the bundled loader with `env -u PYTHONHOME`.
- **Coverage report/action.** `report` now runs
  `[verilator_coverage, "--annotate", <dir>, "--annotate-all", <merged.dat>]` (`--all` is invalid
  in 5.053), the action echoes the merge/report result, and `collectDatFiles` excludes
  `<top>__verFiles.dat` (build metadata, not coverage).
- Per artifact: `mpd-verif-plugin/dist/index.js` → **160,209 B** (committed JS dist total →
  **173,363 B**); packed bundle → **700,120 B** (−23.8 % against the 919,281 B 0.3.0 artifact).
  Tests: **220 / 21 files** (219 pass / 1 skip; verif 169 / 16, LSP 10 / 1).

### Notes

- No VCS license: `mpd_verif_uvm` is an **expected** `VERIF_E_NO_BACKEND` refusal, not a pass.
  yosys 0.70, gtkwave and the slang 12.0.0 compiler are present but unused by the bundle. No PDK
  and no full RTL-to-GDS flow; on this host the AppImage runs with `APPIMAGE_EXTRACT_AND_RUN=1`
  because `/dev/fuse` is absent. A stale LSP daemon lease
  (`DaemonStartupDeferredError: owner_pid_live_unreachable`) is cleared by removing
  `~/.mpd/lsp-daemon` and `/tmp/mpd-lsp-*`.

## 0.4.0 — 2026-10-22

### Breaking

- **Standalone install removed.** The bundle no longer boots without `@mpd-dsh/mpd`. The root
  `package.json` pins `@mpd-dsh/mpd` to exactly `0.15.1`, consumer rows declare
  `inject: [...dshSeamInject(...), "mpdDsh"]`, and read the adapter from `ctx.mpdDsh`. There is no
  fallback: a profile without the `mpdDsh` service stops at the guard with exit code 1 instead of
  booting with zero tools.

### Added

- `silicon-require-mpd` startup guard (`packages/mpd-silicon-guard-plugin`, 1,420 B dist,
  11 tests / 2 files): inject-free, polls `ctx.get("mpdDsh", true)` every 100 ms for up to
  `timeoutMs` (default 15 s), then throws so the CLI exits 1 with
  `silicon requires @mpd-dsh/mpd: the mpdDsh service is absent; install @mpd-dsh/mpd@0.15.1 and enable the mpd-dsh-adapter row`.

### Changed

- The bundle patch now has **4 rows** (`silicon-require-mpd`, `silicon-bootstrap`,
  `silicon-verif`, `silicon-mcp-lsp`); the adapter row is gone because mpd's own
  `mpd-dsh-adapter` row provides `mpdDsh`.
- The adapter port is replaced by a package-specifier import
  (`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`); the built dists keep it external.
- Committed JS dist total: **384,819 B → 170,766 B** (−55.6 %). Per artifact: verif
  226,463 → 157,612 B, bootstrap 80,793 → 11,734 B, adapter 77,563 B deleted, guard 1,420 B.
  Packed bundle: **919,281 B → 690,185 B** (−24.9 %).
- Tests: **212 / 21 files — 211 pass / 1 skip** (verif 162 / 16, bootstrap 30 / 2, guard 11 / 2,
  LSP 9 / 1).
- CI/release moved to **Gitee Go** (`.workflow/{ci,boot-e2e,release}.yml`). A `v*` tag publishes
  the packed artifact to the Gitee Go artifact/release repository; there is **no npm publish**.

### Removed

- `packages/mpd-dsh-adapter-plugin/` (source, tests, dist, two READMEs) — 646,769 B of repository
  content, and the `siliconDsh` service it provided.

## 0.3.0 — 2026-10-21

- Added `mpd_verif_toolchain`: a two-layer `silicon.jsonc` configuration (user over
  `${DSH_HOME:-~/.dsh}`, project override at `<workspace>/.mpd/silicon.jsonc`) with
  comment-preserving, atomic, refuse-first edits (`show` / `set` / `unset` / `init` / `path` /
  `detect`).
- Added `mpd_verif_librelane`: resolves and runs LibreLane in `binary`, `appimage`, `devshell` or
  `auto` mode, with `APPIMAGE_EXTRACT_AND_RUN=1` on hosts without FUSE and logs under
  `.mpd/librelane/`. The verif surface grew to **10 tools**.
- Added the HDL language-service launcher (`packages/mpd-mcp-lsp/launch.mjs`), which primes `PATH`
  from the same two config layers and spawns the pinned `dist/cli.js`.

## 0.2.0 — 2026-10-21

- Adapted the bundle to DeepSeek Harness `0.2.1-rc.2` and `@mpd-dsh/mpd` `0.15.1`: an adapter
  fidelity port (the `siliconDsh` service, removed in 0.4.0), the RTL skill provider
  `silicon-bundle`, the ten `mpd_verif_*` tools, and the HDL language-service row.
- Evidenced the isolated boot, the coexistence boot with mpd `0.15.1`, the MCP handshake and real
  tool calls under `evidence/verification/harness-0.2.1-rc.2/`.
