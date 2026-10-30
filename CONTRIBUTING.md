# Contributing to @mpd-dsh/silicon

[中文](./CONTRIBUTING.zh-CN.md)

## Overview

`@mpd-dsh/silicon` is the RTL capability bundle for DeepSeek Harness: RTL verification
tooling, the RTL skill corpus, the HDL language-service row, and the startup guard that
makes `@mpd-dsh/mpd` a hard requirement. This repository is hosted on **GitHub**
(`HaroldZ32/MPD-Silicon`) and its pipelines run on **GitHub Actions**; there is no mirror of the
source repository and no npm publish.

**Compatibility baseline:** DeepSeek Harness `0.2.1-rc.2`, `@mpd-dsh/mpd` `0.15.1`,
bun `1.4.3`, Node `24` in CI.

## 1. Setup

```bash
git clone https://github.com/HaroldZ32/MPD-Silicon.git
cd MPD-Silicon
bun install
```

`bun install` brings `@mpd-dsh/mpd@0.15.1`, which is a **hard runtime dependency**, not a
dev-only convenience. This bundle ships no adapter of its own: it consumes the `mpdDsh`
service that mpd provides. A profile that mounts silicon without mpd is refused at boot by
the inject-free `silicon-require-mpd` row with:

```text
silicon requires @mpd-dsh/mpd: the mpdDsh service is absent
```

Do not remove the dependency to simplify a profile, and do not install with production
dependencies omitted. The pinned toolchain is bun `1.4.3`; CI also runs
`bun install --frozen-lockfile`.

## 2. Local gates

Run these before every commit. `ci.yml` runs the static gates below; the same sequence runs
inside the docker image (`docker-verify.yml`) and in `release.yml`; the boot harness runs in
`boot-e2e.yml`.

| Gate | Command |
| --- | --- |
| Types | `node scripts/typecheck.mjs --require` |
| Tests | `bun test packages/` |
| Corpus | `node scripts/verify-corpus.mjs` |
| Row ids | `node scripts/verify-rows-disjoint.mjs` |
| LSP assets | `node scripts/build-lsp.mjs --check` |
| Packer guards | `node scripts/pack-silicon.mjs --self-test` |
| CI workflows | `node scripts/verify-github-workflows.mjs` |
| File modes | `node scripts/pack-silicon.mjs --check` |
| Package staging | `node scripts/pack-silicon.mjs` |
| Boot harness | `node scripts/ci-boot.mjs --require` |

The guard scripts also carry negative controls; run them when you touch the guard itself:

```bash
node scripts/typecheck.mjs --self-test
node scripts/verify-corpus.mjs --self-test
node scripts/verify-rows-disjoint.mjs --self-test
node scripts/build-lsp.mjs --self-test
node scripts/pack-silicon.mjs --self-test
node scripts/verify-github-workflows.mjs --self-test
node scripts/ci-boot.mjs --self-test
```

`node scripts/pack-silicon.mjs` stages `dist/silicon-package/`; `/dist/` is gitignored.
Never run `pack-silicon.mjs --fix` inside CI: CI runs `--check`, so a bad committed file
mode must fail the pipeline instead of being silently repaired.

`scripts/typecheck.mjs` is deliberately inert without `node_modules` (the bundle installs
from a clone without a package install). `--require` turns that environment skip into a
failure, which is why CI installs dependencies first.

### Boot harness

```bash
node scripts/ci-boot.mjs --self-test          # pure classify() controls, no boot
node scripts/ci-boot.mjs --require            # both modes; exit 3 without dsh/bun
node scripts/ci-boot.mjs --mode coexist --require
node scripts/ci-boot.mjs --mode no-mpd --require
```

The harness does **not** call `dsh plugin add`. It writes
`$DSH_HOME/profiles/<name>/package.json` in a fresh temp sandbox, runs `bun install` there,
and then boots `dsh --profile <name> --no-open --port 0`:

- **coexist** — base + mpd + silicon. Expected: the app stays alive to the 30 s bound,
  `timeout` reports exit `124`, the log contains
  `[mpd-silicon-bootstrap] skill corpus served`, and no `fatal` appears. The bootstrap line
  is only reachable after `mpdDsh` is ACTIVE, so this is a real mount check.
- **no-mpd** — base + silicon only. Expected: exit `1` and the exact guard line above. The
  profile manifest has no mpd dependency, but bun may materialize mpd transitively through
  silicon's own dependency; the harness removes that directory before boot so the negative
  is literal, not implied.

`HOME`, `DSH_HOME` and the workspace are all fresh temp directories. The real `~/.dsh` is
never read or written. Logs land in `dist/ci-boot-logs/` (`coexist.log`, `no-mpd.log`,
`result.json`); keep them on failure and copy the relevant lines into the PR.

`--require` exits `3` when `dsh` or `bun` is missing. Without it the harness skips with the
exact install commands and exits `0`. `--keep` preserves the temp sandboxes for debugging.

## 3. GitHub Actions pipelines

The YAML in `.github/workflows/` is the source of truth; nothing is created by hand in a
console. Four workflows ship:

| File | Trigger | What it does | Artifact |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | push to `main`; PR to `main`; manual dispatch | installs bun `1.4.3` and Node 24, runs the static gates below in order, stages `dist/silicon-package` | `silicon-package` |
| `.github/workflows/docker-verify.yml` | push to `main`; PR to `main`; manual dispatch | builds the repository `Dockerfile` (real iverilog / verilator / yosys), runs the full gate suite plus the EDA smoke and expects `DOCKER-VERIFY: PASS`; pushes `ghcr.io/haroldz32/mpd-silicon:edge` on non-PR runs | `docker-verify-log` |
| `.github/workflows/boot-e2e.yml` | push to `main` touching `packages/**`, `scripts/**`, `package.json`, `bun.lock` or `packages/mpd-bundle/cordis.patch.yml`; manual dispatch | installs bun `1.4.3` and dsh `0.2.1-rc.2`, runs both boot modes with `--require` | `ci-boot-logs` |
| `.github/workflows/release.yml` | tag push matching `v*` | asserts the tag equals `package.json.version` (accepts `vX.Y.Z` and `X.Y.Z`), runs the same gates, builds the `npm pack` tarball and `dist/silicon-package.tar.gz`, publishes a GitHub Release and pushes the image to GHCR | GitHub Release assets + GHCR image |

`ci.yml` and `docker-verify.yml` never publish a version; publishing belongs to the release
workflow. `release.yml` uses the repository-scoped `GITHUB_TOKEN` for both the Release and GHCR,
and does **not** run `npm publish`.

The release workflow reads the tag from `GITHUB_REF_NAME` and asserts `${GITHUB_REF_NAME#v}`
equals `node -p "require('./package.json').version"`. A mismatch fails before any gate runs, and
an empty tag fails loudly too. Do not hard-code the version in `release.yml`.

`boot-e2e.yml` has no PR trigger by design: it installs the harness and performs two real
boots, which is too slow for every PR. Run it manually with `workflow_dispatch` when you need
it; a push to `main` with the listed paths triggers it automatically.

## 4. Branch model and PR flow

| Branch | Purpose | Rules |
| --- | --- | --- |
| `main` | trunk | always green; the target of every pull request; annotated `vX.Y.Z` tags are cut here; never commit release-bump or feature work directly |
| `feature/<slug>`, `fix/<slug>` | short-lived work | branch from `main`; one logical change per branch; merged with `--no-ff` |
| `release/vX.Y.Z` | release bump | version bump + CHANGELOG; merged into `main` with `--no-ff`; the annotated `vX.Y.Z` tag is cut on `main` |

This is a deliberate divergence from the source repository: the GitHub port makes `main` the
trunk and does not introduce `dev`.

Protect `main` in GitHub so it requires a pull request and the gates.

**One git writer.** Exactly one agent or person pushes to `main` and tags at a time; every other change travels through a branch and a pull request. A tag is part of the release step.

The flow:

1. Branch from `main`: `git switch -c feature/<slug> main`.
2. Make the change, run the local gates, and add/refresh evidence.
3. Commit with the format below, push the branch.
4. Open a GitHub pull request targeting `main` and fill
   `.github/PULL_REQUEST_TEMPLATE.md` (summary, change type, gates table, evidence path,
   bounds/rollback, checklist).
5. Review, then merge with a merge commit (`--no-ff`) so the topic stays a unit.
6. When `main` is ready for release, create `release/vX.Y.Z` from `main` for the version bump
   and CHANGELOG; open `release/vX.Y.Z` -> `main`, merge `--no-ff`, then cut the annotated
   `vX.Y.Z` tag on `main`.

Never rebase or force-push a shared branch. History is not rewritten; a topic branch that
is kept as a unit is merged with `--no-ff`.

## 5. Commit format

```text
<type>(<scope>): <summary>
```

Types: `feat | fix | docs | test | evidence | chore | refactor`.

Examples: `feat(silicon): ...`, `docs(i18n): ...`, `evidence(review): ...`,
`test(smoke): ...`, `fix(guard): ...`. Commits are atomic: one logical change per commit,
with that change's gate evidence already on disk or in the PR.

## 6. Release

1. Create `release/vX.Y.Z` from `main` and set `package.json.version` plus the CHANGELOG to the version you intend to ship.
2. Merge `release/vX.Y.Z` into `main` with `--no-ff`.
3. Create an **annotated** tag on `main` and push it:

   ```bash
   git tag -a vX.Y.Z -m "@mpd-dsh/silicon vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. `.github/workflows/release.yml` runs. Its first real assertion checks `GITHUB_REF_NAME`
   (with or without a leading `v`) against `package.json.version`; a mismatch fails before any
   gate runs.
5. The workflow builds the `npm pack` tarball `mpd-dsh-silicon-<version>.tgz` and
   `dist/silicon-package.tar.gz`, publishes them as **GitHub Release assets** with generated
   release notes, and pushes the verification image to **GHCR** as
   `ghcr.io/haroldz32/mpd-silicon:vX.Y.Z` and `:latest`.
6. There is **no npm publish**. The GitHub Release assets and the GHCR image are the
   distribution channels.

If a tag was published with the wrong version, do not move or delete a shared tag silently;
cut a new patch version and tag. The pipeline's version assert is deliberately loud.

## 7. Dependency pin and upgrade (`@mpd-dsh/mpd`)

`@mpd-dsh/mpd` is pinned to an exact version (`0.15.1`), never a range. Silicon consumes
mpd's `mpdDsh` service and composes its patch beside mpd's; a version bump is a
compatibility change, not a lockfile refresh.

Procedure:

1. Read the mpd release notes/diff for the service name, patch row ids, tool names and MCP
   `serverName` changes. The three singleton classes are the ones that break a compose.
2. Change the exact version in the root `package.json`, run `bun install`, and commit the
   updated `bun.lock` with the manifest.
3. Run every local gate, then `node scripts/ci-boot.mjs --require` (both modes).
   `verify-rows-disjoint.mjs` must still report zero row-id intersection, and the coexist
   boot must still serve the corpus.
4. If mpd re-adds an RTL row (`mpd_verif_*` or a service/`serverName` silicon owns), stop:
   mounting both bundles would collide at registration. Resolve the ownership first.
5. Commit as `chore(deps): bump @mpd-dsh/mpd to X.Y.Z` with the gate output attached.

## 8. Evidence

A change without evidence is not done. For every PR, include:

- the commands you ran and their **observed** exit codes (not "tests pass");
- the gate output (or the path to it) for the affected rows;
- for a runtime change, the boot result: mode, exit code, and the decisive log line;
- the CI artifact name (`silicon-package`, `docker-verify-log`, `ci-boot-logs`) when the workflow produced it.

`dist/` is gitignored, so copy the relevant log lines into the PR. When a change warrants a
durable record, add it under `evidence/<domain>/<slug>/` in the same change. Never claim a
tool result you did not observe.

## 9. Security

- No tokens, keys, or `.credentials*` files in the repository, logs, or evidence.
- The workflows authenticate with the repository-scoped **`GITHUB_TOKEN`**, which GitHub
  supplies per run. No personal access token is stored in the repository, a workflow file, or
  an evidence artifact.
- The boot harness writes only to temp `HOME`/`DSH_HOME`/workspace directories; it never
  writes the real `~/.dsh`. Do not add a step that copies credentials into a sandbox.
- `npm config set registry` changes the CI job's `~/.npmrc`, not a repository file.
- Never put a secret in a `variables:` block or a command line that lands in a log.

## 10. Known bounds

- **`dsh plugin add` is not the supported install path here.** In the author's sandbox it is
  blocked by a read-only `$HOME/pnpm` store. `ci-boot` builds the profile manifest directly
  and runs `bun install`; CI does the same. Do not "fix" the harness by adding
  `dsh plugin add`.
- `ci-boot --require` exits `3` when `dsh`/`bun` is absent; without `--require` it skips.
  CI installs both explicitly.
- On a system without GNU `timeout`, the harness kills the boot with `SIGTERM` and
  synthesizes exit `124`; the classification is the same.
- The coexist log may contain an mpd-internal warning such as
  `preset-mpd ... pending (waiting for service: agentPresets)`. The gate rejects `fatal`
  and requires the bootstrap line; it does not require a warning-free log.
- `scripts/typecheck.mjs` is inert until `bun install` provides the type roots; that is why
  the gate is run with `--require` only after the install.
- No EDA backend (iverilog/verilator/vcs) is required for the CI gates or the boot harness.
