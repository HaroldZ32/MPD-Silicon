# AGENTS.md — my-power-dsh-silicon Repository Manual

This document is the binding operating manual for this repository. It is read by both humans and
agents. Where this document and habit disagree, this document wins.

**Language policy (binding):**
- Agent-facing content (this manual, code comments, gate scripts/logs) stays **English-only**.
  `evidence/**` records the language they were produced in (the source manual's rule): new records
  are English by default, and a record may carry a summary block in another language. Records
  already committed in another language keep it — they are evidence of what was measured, not a
  style surface.
- **Human-facing documentation is BILINGUAL**: every document a person reads — `README.md`,
  `docs/*.md`, and every `packages/*/README.md` — ships BOTH an English file and a **简体中文**
  (`*.zh-CN.md`) translation. Both versions must exist and stay in sync **in the same commit**.
- **Every bilingual doc carries a language switch link directly under its title**: the English file
  links `[中文](./<name>.zh-CN.md)`, the Chinese file links `[English](./<name>.md)`.
- **Exemptions** (none may be invented locally; a new one is recorded here): (a) a document may be
  bilingual *within one file* (two clearly titled sections) instead of shipping a twin —
  `docs/sync-policy.md` does this; (b) internal QA reference artifacts (`docs/adder4.md`,
  `docs/cnt8.md`) are exempt and say so in their own header.

---

## 1. Overview & Provenance

**@mpd-dsh/silicon** is the RTL development capability of the my-power-dsh project, extracted into
its own repository so the RTL surface lives in one place and `@mpd-dsh/mpd` no longer carries it.

- **Relationship**: this bundle is the RTL companion of `@mpd-dsh/mpd` and has a **hard runtime
  dependency** on it. Standalone install was removed in 0.4.0: `package.json` pins
  `@mpd-dsh/mpd` to exactly `0.15.1`, the consumer rows inject `mpdDsh`, and a profile without
  that service **refuses to boot** through the `silicon-require-mpd` guard. §4 lists the
  singleton rows that still make coexistence delicate.
- **Install path**: one command installs both bundles —
  `dsh plugin --profile <profile> add -w @mpd-dsh/mpd@0.15.1 <silicon-spec>` — because a
  transitively installed mpd is **not** auto-activated. `<silicon-spec>` is the tarball built by
  `npm pack` (`./mpd-dsh-silicon-0.7.0.tgz`); the registry form `@mpd-dsh/silicon@0.7.0` is
  **not measured — 0.7.0 is not published (`npm view` returns 404)**. `dsh plugin add` reconciles
  `dsh.profile.bundles` itself, so no manifest edit is needed. Measured 2026-10-23 (pnpm 9.15.9);
  §9 carries the environment bounds.
- **What ships**: the `mpd-verif` plugin (**10** `mpd_verif_*` tools: venv/backends/compile/
  lint/sim/coverage/uvm/regress plus `mpd_verif_toolchain` and `mpd_verif_librelane`), the
  two-layer `silicon.jsonc` toolchain configuration and the LibreLane runner, the three RTL
  skill trees (`rtl-ip-flow`, `rtl-codestyle`, `rtl-verif`), the HDL language-service package
  (`packages/mpd-mcp-lsp`, with the `launch.mjs` PATH-priming launcher), the waveform-MCP
  example rows, the `silicon-require-mpd` guard (package
  `packages/mpd-silicon-guard-plugin`: inject-free, polls `mpdDsh` for up to 15 s, then throws),
  and the `mpd-docgen` plugin (`packages/mpd-docgen-plugin`: **4** `mpd_docgen_*` tools —
  `register_xlsx` / `user_manual_docx` / `run` / `verify` — producing the spec-stage register
  Excel workbook and the bilingual Word user manual; `mpd_verif_*` stays **10**, and the two
  tool namespaces never share a name).
  There is **no adapter port and no local adapter copy**.
- **Compatibility baseline**: DeepSeek Harness `0.2.1-rc.2` and `@mpd-dsh/mpd` `0.15.1`
  (**required**, pinned exactly). The adaptation evidence is under
  `evidence/verification/harness-0.2.1-rc.2/`; the dependency profile is under
  `evidence/verification/mpd-dependency/`.
- **Naming stays stable**: plugin ids, tool names (`mpd_verif_*`), the skill provider name
  (`silicon-bundle`), the row-id prefix (`silicon-`), the Cordis service name (`mpdDsh`, owned
  by `@mpd-dsh/mpd` and **never registered here**), and the state root (`.mpd/`) are contract and
  must not be renamed without a migration.
- **License**: MIT (`LICENSE`); the repository was ported to GitHub
  (`HaroldZ32/MPD-Silicon`) and relicensed to MIT. Provenance (derived from the upstream
  project through `@mpd-dsh/mpd`, with the extraction recorded in git history) is declared in
  `README.md` and `LICENSE-NOTICES.md`; `@mpd-dsh/mpd` stays an external SUL-1.0 dependency.

---

## 2. Principles

1. **The agent is the worker.** Everything here optimizes for an agent that reads the repo cold and
   behaves correctly: explicit conventions, executable gates, evidence on disk.
2. **Plugin form.** Every delivered capability is a cordis plugin (self-written) or an official
   plugin instance configured in the bundle patch. No logic in profiles, scripts, or the user home.
3. **Evidence without evidence is incomplete.** A change without gate evidence is not done.
4. **Isolation.** Verification never touches the real `~/.dsh`. Everything boots in a temp
   `DSH_HOME` with a sandboxed `HOME` **and a sandboxed workspace**.
5. **Minimal diffs.** Prefer the smallest change that satisfies the requirement; no speculative
   refactors. When a deliberate divergence from a source artifact is unavoidable, it is listed
   line-by-line in the evidence, not left implicit.
6. **External dependency, pinned.** The harness adapter is not ported here; it comes from
   `@mpd-dsh/mpd` at an exact version. A consumer row declares `mpdDsh` in `inject` and reads
   `ctx.mpdDsh` with no fallback. Changing the pin is a dependency upgrade with its own gate run,
   not a copy-and-edit.

---

## 3. Repository Layout

```
packages/
  mpd-verif-plugin/             # the 10 mpd_verif_* tools (src + test + dist + evidence/smoke)
                                #   src/silicon/*: config, jsonc, jsonc-edit, tool, librelane
  mpd-silicon-bootstrap-plugin/ # ctx.skills provider "silicon-bundle" over <root>/skills
  mpd-silicon-guard-plugin/     # `silicon-require-mpd`: inject-free mpdDsh guard (15 s, then throw)
  mpd-docgen-plugin/            # the 4 mpd_docgen_* tools: register xlsx + bilingual docx
                                #   (src + test + fixtures + dist; zero third-party runtime deps)
  mpd-mcp-lsp/                  # HDL language service: launch.mjs + dist/cli.js + BUILD.lock
                                #   + references/ + templates/
  mpd-bundle/cordis.patch.yml   # the bundle patch: additive rows, zero id-targets
skills/                         # the RTL corpus — EXACTLY three trees (see §4)
  rtl-ip-flow/ rtl-codestyle/ rtl-verif/
scripts/                        # build.mjs, build-lsp.mjs, typecheck.mjs, pack-silicon.mjs,
                                # verify-corpus.mjs, verify-rows-disjoint.mjs,
                                # verify-package-files.mjs (the prepack guard),
                                # verify-github-workflows.mjs (the CI workflow gate)
.github/                        # GitHub Actions: ci, docker-verify, boot-e2e, release + templates
tests/                          # golden Verilog fixtures the rtl-verif Makefiles reference
docs/                           # bilingual user documentation + the asset map + the sync policy
evidence/                       # gate evidence, verification reports, re-reviews, baselines
```

Three layout constraints are load-bearing:

- **The adapter is an npm dependency.** Plugin sources import it through the package specifier
  `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` (types from the `src/index.ts`
  specifier). There is no local adapter package and no relative import into one. `bun install`
  must be run before tests or a build, because the dependency is no longer inlined.
- **`skills/` holds exactly three trees.** The corpus gate asserts it. Additional HDL
  language-service documentation belongs under `packages/mpd-mcp-lsp/references/…` — **not** a
  fourth skill tree.
- **`dist/` is committed** for every plugin and for `mpd-mcp-lsp`. `.gitignore` anchors `/dist/`
  so it cannot swallow `packages/*/dist`. The dists keep `@mpd-dsh/mpd` **external**: the consumer
  bundles must still contain the package-specifier import, and `pack-silicon.mjs` fails if they
  inline it.

---

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Types | `node scripts/typecheck.mjs` (`--require` to forbid the env skip, `--self-test` for its own control) | every `src`/`test` change |
| Tests | `bun test packages/` — **326 tests across 25 files** (325 pass / 1 declared skip) | every plugin change |
| Corpus | `node scripts/verify-corpus.mjs` (`--self-test`) | every corpus/script change |
| Row ids | `node scripts/verify-rows-disjoint.mjs` (`--self-test`) | every patch change |
| LSP assets | `node scripts/build-lsp.mjs --check` (`--self-test`) | every `packages/mpd-mcp-lsp/**` change |
| Modes | `node scripts/pack-silicon.mjs --fix` then `--check` | before every commit |
| Packer guards | `node scripts/pack-silicon.mjs --self-test` | every packer change |
| Pack | `node scripts/pack-silicon.mjs` then `node scripts/verify-package-files.mjs` (the `prepack` guard; `--self-test` has 6 controls) | before release, and before any `npm pack`/`npm publish` |
| CI workflows | `node scripts/verify-github-workflows.mjs` | every `.github/**` or manifest-script change; GitHub Actions (`.github/workflows/{ci,docker-verify,boot-e2e,release}.yml`) is the CI |
| Boot check (MOUNT) | two boots that really apply the rows in an isolated `DSH_HOME`: **coexist** (mpd + silicon; must stay alive and log `[mpd-silicon-bootstrap] skill corpus served`) and **no-mpd refusal** (silicon only; must exit 1 with the guard message). `scripts/ci-boot.mjs --require` is the CI wrapper | any patch/preset/row change, and **required** for any tool-schema change |
| QA real cases | the two RTL probes live in the `@mpd-dsh/mpd` repo (`skills/dsh-qa/scripts/rtl-verif.mjs`, `rtl-ip-profile.mjs`) and are repointed at this bundle — run them with `MPD_SILICON_ROOT=<this repo>`. `rtl-ip-profile.mjs` now reports the carrier as retired (an evidenced skip), not as pending | runtime-behaviour changes |

`--self-test` is expected on **every** guard, not only the packer: seven carry negative controls
today (typecheck, packer, corpus, rows, LSP, GitHub workflows, ci-boot).

### `--dump-config` proves COMPOSITION ONLY

`dsh --profile X --dump-config` only composes rows — it never executes plugin code, so an
apply/schema abort that takes the whole plugin tree down is invisible to it. Measured
(`evidence/verification/t13-manual-commands.md`): a profile whose plugin `dist` is missing dumps
`exit 0` with zero fatal keywords while the real boot exits 1 with
`plugin tree failed to load … Cannot find module`. Use the dump to check that rows are composed;
**never** as a health signal for plugin code.

### Do not treat `--help` as a mount signal

`--help` output is produced **before the plugin tree settles**, so it is evidence in neither
direction. On the build measured for this manual it exited 1 on a provably broken profile and
**hung past 40 s** on a valid one — it neither confirms nor denies a mount. Use the Boot check row;
any mount/coexistence conclusion must come from a real app boot's exit code and stderr.

### Row-id zero intersection ≠ coexistable

`verify-rows-disjoint.mjs` compares **loader row ids only**. It reads every patch layer declared by
each manifest's `dsh.bundle.patch` (string or array) — for mpd v0.15.1 that is the repo-root
`cordis.patch.yml` plus `presets/mpd.patch.yml` — and reports per-layer counts.
Measured today: **5 silicon row ids** (all inserts, one layer) ∩ 35 mpd ids = ∅. The gate cannot see
collisions in **service names, tool names, or MCP serverNames**. All three classes are **closed
between the two bundles as they stand today** (the service singleton by mpd owning `mpdDsh`, tool names by
`mpd_verif_*` vs mpd's `mpd_verify_*`, MCP serverName by `silicon_lsp`) — the taxonomy below is what
to check when a **third plugin** joins, or when this bundle meets an **older mpd** that still
carries the RTL rows:

| Class | Symptom |
|---|---|
| service | `service "mpdDsh" has been registered at <owner>` — Cordis services are single-provider |
| tool | `tool "mpd_verif_venv" is already registered` |
| MCP serverName | `serverName "lsp" is already in use` — the MCP client namespace is global |

Therefore: the row-id gate is a **cheap offline pre-gate, not proof of coexistence** — it stays
blind to those three classes whatever their current state. Coexistence evidence comes from a real
boot with both bundles installed.

### A green gate must be falsifiable

Every guard ships a self-test with **negative controls** (a tampered byte must be caught and named,
an unlisted package must be rejected, a missing baseline must fail loudly). A check that cannot fail
is not a check.

---

## 5. Git Model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | trunk | the only pull-request target and where annotated `vX.Y.Z` tags are cut; must stay green; never commit release-bump or feature work directly |
| `feature/<slug>`, `fix/<slug>` | short-lived work | branch from `main`; one logical change per branch; merged with `--no-ff` |
| `release/vX.Y.Z` | release bump | version bump + CHANGELOG; merged into `main` with `--no-ff`; the annotated tag is cut on `main` |

The GitHub port makes `main` the trunk — a deliberate divergence from the source repository, which
used `master` + `dev`. `dev` is not introduced here.

**One git writer.** Exactly one agent or person pushes to `main` and tags at a time; every
other change travels through a branch and a pull request. A tag is part of the release step.

**History before 0.4.0 was master-only** — one line, pushed directly, no merge commits. That is a
recorded historical exception, not the template: new work follows the table above.

**Commit format** — `<type>(<scope>): <summary>`, with types
`feat | fix | docs | test | evidence | chore | refactor`; this repository's own history follows it
(e.g. `feat(silicon): …`, `docs(i18n): …`, `evidence(review): …`, `test(smoke): …`,
`feat(lsp): …`). Three early commits were written without a scope (`docs: …` = `37b93cf`,
`evidence: …` = `b35a141`, `docs+gate: …` = `07b92ce`); they are history, not the template.

Commits are atomic: one logical change per commit, with that change's gate evidence already on
disk. Never mix an unrelated `chmod` sweep into a removal commit. History is not rewritten: a topic
branch is merged as an ordinary merge (`--no-ff` when it is kept as a unit), and shared branches are
never rebased or force-pushed.

---

## 6. Plugin Authoring

- A plugin exports `name`, optional `inject`, and `apply(ctx, config)`.
- **Zero writes to the harness home.** State belongs under the session workspace's `.mpd/`.
- **The one recorded exception**: an explicit `mpd_verif_toolchain` **user-scope**
  `set`/`unset`/`init` writes the user's own `$DSH_HOME/silicon.jsonc`. That file is *user
  configuration*, not plugin state; the write is atomic (sibling temp + rename, mode 0644) and
  happens only on an explicit action — never at boot, never implicitly. Any new writer of the
  harness home is a contract change, not an implementation detail.
- **Every harness seam goes through mpd's adapter** — `@mpd-dsh/mpd`'s
  `packages/mpd-dsh-adapter-plugin`, imported by package specifier
  (`@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js`; types from its `src/index.ts`).
  It is the only code allowed to touch `ctx.tools` / `ctx.subagents` / `ctx.skills` /
  `ctx.agentPresets` directly. Do not copy it here and do not reach around it.
- **The dependency is declared, not probed.** A consumer row declares
  `inject: [...dshSeamInject(...), "mpdDsh"]` and reads `ctx.mpdDsh`. There is **no fallback
  adapter**, no local copy, and no `ctx.get(...) ?? createDshAdapter(ctx)` chain: a missing
  provider is a hard startup failure surfaced by the guard.
- **Registration contract**: tool definitions use object-rooted `parameters`, an `output.render`, and
  the always-object `(args, exec)` call shape; the adapter supplies the defaults. Guards,
  post-execute waterfalls, subagent spawns and internal tool calls all have wrapped forms — do not
  reach around them.
- **Workspace-scoped state resolves per call** (`dsh.workspaceRoot(exec)`), never from a
  module-level cache: one process serves several sessions.
- **The bundle patch is additive**: this repository's rows carry `silicon-`-prefixed ids and
  **zero id-targets**. Never patch a row owned by `@mpd-dsh/mpd` — a same-id patch replaces the
  whole config object (there is no deep merge) and would silently destroy the other bundle's
  teams/preset configuration.
- **Provider and service names are process-global**: the skill provider is `silicon-bundle`, the
  row ids are `silicon-`-prefixed, and the Cordis service `mpdDsh` is owned by `@mpd-dsh/mpd`.
  Never register `mpdDsh` or any `mpd-*` row id here.
- **The guard is a row, not a check.** `silicon-require-mpd` is inject-free, polls
  `ctx.get("mpdDsh", true)` every 100 ms up to `timeoutMs` (default 15 s), then throws from a timer
  so the CLI exits 1. Do not convert it to `inject: ["mpdDsh"]`: it would stay PENDING exactly like
  the rows it protects.
- **Dependency pin and upgrade.** The pin is exact (`"@mpd-dsh/mpd": "0.15.1"`). An upgrade bumps
  the pin, runs `bun install`, re-runs every gate in §4, and re-boots both modes (coexist + no-mpd
  refusal). Never vendor, copy, or patch the dependency in place.
- **Externalized dists.** Delivered packages import `@mpd-dsh/mpd` instead of inlining it; the only
  other runtime imports are `node:` builtins. The build is `bun build --target node --format esm`
  via `scripts/build.mjs`.

---

## 7. QA Discipline

- **Three-layer isolation**: sandbox `DSH_HOME`, `HOME`, **and the workspace**. `DSH_HOME`/`HOME`
  do not isolate workspace-scoped state, so every spawned command carries an explicit sandbox cwd.
- **Provability**: assert a real tool result, never "it ran". For behaviour questions use a boot
  that mounts the rows, or a real tool call — not a composed config dump.
- **Evidence path**: `evidence/<domain>/<slug>/<timestamp>/{result.json,output.log}`.
- **A skip is a claim**: an environment-gated check must print its reason and its enabling command,
  and must stay bound to something that still bites (a committed manifest, a byte-exact lock). A
  skip that no longer has teeth is a hole.
- **Verify on settled hashes**: pin the revision by hash, confirm it is stable, then run the
  contract; anchor every verdict to the hashes you measured.
- **File modes**: file-writing tools here land files at mode `600`, so run
  `node scripts/pack-silicon.mjs --fix` before committing; `--check` is the gate. Keep the
  executable bit only on scripts meant to be run directly.
- **Credentials**: a provider key may live in a shell profile (`~/.bashrc`) and therefore be absent
  from a non-interactive environment. Read it at runtime when a case genuinely needs a model call —
  `export DEEPSEEK_API_KEY=$(grep -m1 '^export DEEPSEEK_API_KEY=' ~/.bashrc | sed -E 's/^export DEEPSEEK_API_KEY=//')`
  — and never write it to a file, a log, or an evidence artifact.

---

## 8. Security & Privacy

- **No credentials in the repository**: no tokens, keys, or `.credentials*` files, ever — including
  in git config, logs, and evidence.
- Pushing to a remote authenticates at runtime from an external credential source; the token is
  never written into a remote URL or any file.
- Nothing is written to the real `~/.dsh` by tests, gates, or QA runs.
- **GitHub Actions authenticates with the repository-scoped `GITHUB_TOKEN`**, which GitHub supplies
  per run; no token is written to a file, a remote URL, a log, or an evidence artifact.

---

## 9. Known Limitations

- The corpus fidelity **cross-check against a live source checkout** is skipped when the source RTL
  trees are absent (they were removed from `@mpd-dsh/mpd`). The shipped corpus is still verified
  file-by-file against the committed baseline in `evidence/verification/corpus-baseline.json`, so a
  regression **in the corpus** is still caught. What is not automated is a regression **in the
  baseline itself**; an independent oracle remains available on demand:
  `git archive 3d99718 skills/rtl-*` in the source repo reconstructs all 36 files, and comparing that
  reconstruction against the manifest entry-by-entry (sha256 **and** byte size) is the cold check.
- `mpd_verif_*` UVM/coverage lanes require a VCS license; without one the lane is an **evidenced
  skip** (`command -v vcs` empty), never a silent pass.
- **`scripts/typecheck.mjs` is inert without `node_modules`** — a clone must run `bun install` for
  the runtime dependency and the type roots (`bun-types`, `@types/node`). The
  gate decides that from the filesystem *before* invoking any checker and then skips loudly (exit 0
  with the `bun install` command printed); `--require` turns that into a failure. **The gate is
  therefore only real after a dependency install** — it does not run the checker and then filter
  results, by design, because a cold `bunx` call would resolve the roots itself and hide the
  condition.
- **Only `@mpd-dsh/mpd` 0.15.1 is supported.** Installing this bundle next to an older mpd that
  still carries the RTL rows re-introduces duplicate `mpd_verif_*` registrations; the three
  singleton classes are in §4. The exact pin exists to keep that window closed.
- **`rtl-ip` is retired**: the team-profile plane (`config.profiles` on the old agent-teams row) was
  removed by mpd v0.10.0, and `@deepseek-ai/dsh-experimental-agent-team` `0.2.1-rc.2` exposes only
  four limits. There is no profile data file and no carrier in this repo. The replacement is the mpd
  roster (`mpd_role_spawn` / `mpd_role_persona`) + `teamModels.slot1..4` + the workmate library; the
  `rtl-ip-flow` skill remains as the domain procedure.
- **Standalone install is removed.** 0.3.0 booted with no `@mpd-dsh/mpd` on disk; 0.4.0 refuses.
  The old `t7` / `t3` evidence is historical and must not be cited as current capability.
- **The guard timeout is configurable** (`timeoutMs`, default 15000 ms). A slow host may raise it;
  lowering it races the loader and is not supported.
- **`dsh plugin add` is the measured install path** (2026-10-23, pnpm 9.15.9, dsh `0.2.1-rc.2`,
  isolated `DSH_HOME`): `dsh plugin --profile <p> add -w @mpd-dsh/mpd@0.15.1 <silicon-spec>` exits
  0, writes the profile `package.json` + `pnpm-lock.yaml` + `node_modules`, and auto-reconciles
  `dsh.profile.bundles` from the newly installed direct dependencies that declare
  `dsh.bundle.patch` (no manifest edit). `<silicon-spec>` is the `npm pack` tarball
  (`./mpd-dsh-silicon-0.7.0.tgz`); the registry form `@mpd-dsh/silicon@0.7.0` is **not measured —
  0.7.0 is not published (`npm view` returns 404)**. The resulting boot logs
  `[mpd-silicon-bootstrap] skill corpus served`; a silicon-only profile installs and then exits 1
  with the `silicon-require-mpd` guard message. `remove` drops both the dependency and the bundle
  entry (measured in the same record). Evidence:
  `evidence/verification/plugin-install/20261023T022635Z/`. Environment caveat:
  on this host **pnpm 12.15.0** failed with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (the
  store-lock path landed on a read-only filesystem), while **pnpm 9.15.9** worked; pnpm 9 also
  needs `-w` because a profile is a pnpm workspace root. The profile `package.json` +
  `bun install` path remains the documented manual alternative.
- **A live 2-call session is measured in the 0.4.0 profile**: `mpd_verif_toolchain show` and
  `mpd_verif_librelane status` (2/2 completed, LibreLane 3.0.16), recorded under
  `evidence/verification/mpd-dependency/` alongside the coexist and no-mpd boots. That session
  did not exercise an HDL language-server call (the older MCP handshake measurement stays under
  `evidence/verification/harness-0.2.1-rc.2/`); the 2026-10-22 full test does, for both HDL
  servers (see the LSP bounds below).
- **The build needs `bun` on `PATH`** (`scripts/build.mjs` spawns `bun`), and `bun install`
  (`--frozen-lockfile` in CI) is required before tests, the build, or the type gate can run — the
  adapter is no longer inlined.
- **The real `/opt/openictool` test measured the open-source lane end to end (2026-10-22)**:
  oss-cad-suite 20261021 (iverilog 14.0, verilator 5.053, `verilator_coverage`, slang 12.0.0
  compiler, yosys 0.70, gtkwave), Verible `v0.0-4296`, **slang-server 0.3.1+**, cocotb 2.1.0 in a
  project venv, and the LibreLane devshell AppImage **3.0.16**. The full tool surface ran: config
  `set`/`show` (including the new `slangServer.bin`) → `show`/`backends` resolved the open-source
  backends from the project config; `compile` + `lint` on iverilog and verilator; `sim` **PASS
  (1 case)** on both; `regress` **1/1 PASS** on both; `coverage` merged 4 files into
  `merged.dat` 4,260 B and annotated a report; `uvm` returned the expected
  `VERIF_E_NO_BACKEND` (no VCS); LibreLane `status` + `run` (`mode: "devshell"`, extract true
  because `/dev/fuse` is absent, 5429 ms, empty stderr). The project config carried
  `ossCadSuite.home=/opt/openictool/oss-cad-suite`, `verible.bin=/opt/openictool/verible`,
  `slangServer.bin=/opt/openictool/slang-server`,
  `librelane.appimage=/opt/openictool/librelane/librelane-devshell-x86_64.AppImage`. Evidence:
  `evidence/verification/openictool/20261022T145500Z/`.
- **The devshell invocation was wrong in released 0.4.0**: the wrapper's real interface is
  `devshell [--pure] <cmd> [...]`, so `[appimage, "--run", "librelane <posix-quoted args>"]`
  exits 127 (`exec: --run: not found`). The fix runs `[appimage, "librelane", ...args]` and
  probes `[appimage, "librelane", "--version"]`, with argv passed directly (no shell, no
  quoting).
- **The icarus cocotb lane needs the `ICARUS_BIN_DIR` shim**: the oss-cad-suite `vvp` wrapper
  re-adds `PYTHONHOME`, which breaks the venv interpreter. The plugin points `ICARUS_BIN_DIR` at a
  shim that runs the bundled loader with `env -u PYTHONHOME`; cocotb's `SIM` variable is `icarus`
  (not `iverilog`), and the make `PATH` is `venv/bin` → the resolved tool directory → the
  inherited `PATH`.
- **LSP bounds**: both HDL servers are installed on the measured host (44 configured, **2
  installed**): Verible `v0.0-4296` for `.v/.vh` and slang-server `0.3.1+` for `.sv/.svh`. Verible:
  clean adder `No diagnostics found`; broken file `error[verible]` at 3:2 / 4:0;
  `verible-verilog-lint` exits 1. slang-server: clean file `No diagnostics found`; broken file
  `error` at 2:22 / 3:12 plus `warning (unused-port)`. The launcher's `PATH` order is
  ossCadSuite → verible → slangServer → inherited, and `slangServer.bin` is the config key that
  feeds it. A stale daemon lease can defer startup
  (`DaemonStartupDeferredError: owner_pid_live_unreachable`); clear `~/.mpd/lsp-daemon` and
  `/tmp/mpd-lsp-*`.
- **The docgen capability's bounds** (`mpd_docgen_*`, spec stage): it carries **zero third-party
  runtime dependencies** and writes the OOXML directly, so its fidelity is bounded by structural
  assertions rather than a Word/Excel round-trip. By design the docx has **no TOC, cover page,
  header or footer**, and the register chapter is always rendered **last**. A zh/en skeleton
  mismatch (different registers or field spans between the two manuals) is a **hard refusal**
  (`DOCGEN_E_LANG_MISMATCH`), never a merge. It emits `.xlsx` + `.docx` only — **no PDF**; convert
  with an external tool when one is required.
- **Still unmeasured**: any VCS lane (no license — `mpd_verif_uvm` returns the expected
  `VERIF_E_NO_BACKEND`; yosys/gtkwave and the slang compiler are present but unused by the bundle)
  and a full PDK/RTL-to-GDS flow.
- **The LibreLane runner's bounds**: the timeout kills the **direct child only** (a grandchild is not
  reaped), the cwd guard is **lexical** (it does not resolve symlinks out of the workspace), and no
  full RTL-to-GDS flow has been run here — only the version probe and the `--version` run above.
- **The surgical JSONC editor's bounds**: inserting a new **object member** keeps a trailing
  line/block comment attached to its preceding member (covered by the F3 regression tests), but the
  analogous **array-element** insertion can still reattach such a comment. It is unreachable through
  `mpd_verif_toolchain` because the config schema has only string/boolean/enum leaves.
- **HDL pages are owned here**: the Verilog/SystemVerilog reference pages live at
  `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md`, and the `@mpd-dsh/mpd` repo
  keeps only the routing rows that point at them (`skills/lsp-setup/SKILL.md`, whose language-gate
  table does list `.v/.vh` and `.sv/.svh`). What deliberately gains **no** HDL rows is that repo's
  `skills/lsp-setup/scripts/lsp-server-table.ts` — HDL support is owned by this bundle's MCP server,
  and registering it there would create a second source of truth (so `detect-lsp.ts` will not report
  `.v/.sv`; that is intended).
- **A cross-package entry-resolution failure is silent**: pointing a row at a nonexistent `dist`
  leaves both `--dump-config` and the real boot looking green while the plugin's tools simply do
  not exist (`evidence/verification/t13-manual-commands.md`). Verify a new or changed row's tools by
  **calling one**, not by reading the composition.

## 10. Provenance of this manual

This manual is adapted from the source repository's `AGENTS.md` — same binding rules, rewritten for
this repository's facts, with the mpd-specific inventory removed (§1 lists what actually ships here).
Its equivalence was verified independently in `evidence/review/t12-manual-review.md`, and every
command in §4 was re-run from scratch in `evidence/verification/t13-manual-commands.md`.

The 2026-10-21 adaptation to DeepSeek Harness `0.2.1-rc.2` / `@mpd-dsh/mpd` `0.15.1` re-ran every
gate in §4 and is recorded in `evidence/verification/harness-0.2.1-rc.2/` (adapter parity diff,
gate logs, isolated and coexistence boots, MCP handshake, real tool calls).

The 0.3.0 **toolchain-config / LibreLane** feature records its evidence under
`evidence/verification/toolchain-config/` (two-layer config, comment-preserving writes, LSP
launcher, LibreLane status/run, and the gate logs). The bounds that evidence stated — no real
AppImage/FUSE/Verible, fake-covered devshell/appimage, direct-child-only timeout, lexical cwd
guard, no full flow — were the limits of *that* measurement, not gaps hidden from it. The
2026-10-22 `/opt/openictool` test later exercised the real AppImage, Verible and the open-source
backends, recorded the devshell `--run` defect and its fix, then measured the rest of the
open-source lane (sim/regress/coverage), a real slang-server for `.sv/.svh`, and the full gate
suite. That record lives under
`evidence/verification/openictool/20261022T145500Z/` and supersedes the no-real-tool bounds above,
including the earlier claim that `mpd_verif_sim` could not be exercised here.

The 0.4.0 **mpd dependency** change removes the adapter port, pins `@mpd-dsh/mpd` `0.15.1`, adds
the `silicon-require-mpd` guard, and externalizes the dists. Its evidence lives under
`evidence/verification/mpd-dependency/` (coexist and no-mpd boots, size deltas, the gate run at
that revision). The 0.3.0 standalone-install evidence stays as history and was not edited.
