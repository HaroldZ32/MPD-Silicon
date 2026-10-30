# t6 — independent port-fidelity verification (mpd-verif / adapter / RTL corpus)

**Task:** t6 · **Attempt:** ee7da9bc-fa16-4df0-8648-f5e8d4a54c2e · **Verifier:** Junior Engineer
**Verdict:** every contract check **passes**; no blocking finding. Two notes and one pre-registered
re-check item are recorded in §8–§9.

> **t20 repair note (added later, does not rewrite the record above).** t8's review of this report
> found one non-reproducible sub-claim (§2, corrected below) and a test-surface loss (F5, repaired:
> the adapter suite now ships here). The corpus gate this report cited as green was red after the
> strip commit; §3's gate is now self-held (committed baseline manifest) and the repair is recorded
> in [`t20-repair.md`](./t20-repair.md). Statements in §0 about the source tree ("untouched,
> HEAD 3d99718") describe the state *at verification time*; the strip landed afterwards as commit
> `12291a7`.

## 0. Method, independence and environment

- I did not write any of the artifacts under test (t1 built the adapter/verif/bootstrap port, t2
  the corpus, t3 the bundle assembly). This verification only ran read-only commands plus builds
  in a scratch copy; the only file written is this report.
- **Read-only discipline held:** the source repository is untouched — `git -C <SRC_ROOT> status
  --porcelain` → 0 lines, `HEAD = 3d99718`. The build-consistency check (§6) was executed in a
  scratch copy so that no `dist/` in either repository was rewritten.
- `<SRC_ROOT>` = the source checkout, resolved as the sibling directory `../my-power-dsh`
  (this is `/root/dshProj/my-power-dsh` in this environment). Paths are not hard-coded in the
  commands below where avoidable; the report itself carries no absolute home path.
- The silicon checkout has **no VCS** (`git rev-parse` → fatal), so check 6 cannot use
  `git diff --stat`; it uses byte-level rebuild comparison instead (§6).
- Source files were **still present** at verification time (t5 had not run), so check 1 uses the
  direct `diff` method as primary and the `git show HEAD:<path>` method as an independent second
  opinion. Both agree.

## 1. Check 1 — per-file fidelity (13 verif src + 1 adapter)

Command (primary, working tree):

```bash
for f in <SILICON>/packages/mpd-verif-plugin/src/*.ts; do
  diff -q "<SRC_ROOT>/packages/mpd-verif-plugin/src/$(basename "$f")" "$f"; done
diff -q <SRC_ROOT>/packages/mpd-dsh-adapter-plugin/src/index.ts <SILICON>/packages/mpd-dsh-adapter-plugin/src/index.ts
```

Observed: `verif src files compared: 13 | differing: 0`; adapter → `IDENTICAL` (no output).

Per-file sha256 ledger (16 hex chars shown; source column = `<SRC_ROOT>/…`, silicon column = this repo):

| file | source sha256 | silicon sha256 |
|---|---|---|
| `packages/mpd-verif-plugin/src/backends.ts` | `ea5311cb6c9f8272` | `ea5311cb6c9f8272` |
| `packages/mpd-verif-plugin/src/compile.ts` | `17e62429efbe14cb` | `17e62429efbe14cb` |
| `packages/mpd-verif-plugin/src/coverage.ts` | `1d015bc634726a91` | `1d015bc634726a91` |
| `packages/mpd-verif-plugin/src/eda-tools.ts` | `3d97a05c0ea0cae9` | `3d97a05c0ea0cae9` |
| `packages/mpd-verif-plugin/src/env.ts` | `b7237b4d294fb385` | `b7237b4d294fb385` |
| `packages/mpd-verif-plugin/src/errors.ts` | `a081933bbe3aed63` | `a081933bbe3aed63` |
| `packages/mpd-verif-plugin/src/index.ts` | `282f4ca5fa947d9c` | `282f4ca5fa947d9c` |
| `packages/mpd-verif-plugin/src/regress.ts` | `efd078291817cf53` | `efd078291817cf53` |
| `packages/mpd-verif-plugin/src/run.ts` | `e04368284925c5f7` | `e04368284925c5f7` |
| `packages/mpd-verif-plugin/src/sim.ts` | `dbdf2a9dcd90ad14` | `dbdf2a9dcd90ad14` |
| `packages/mpd-verif-plugin/src/uvm.ts` | `27277b87566cbf2c` | `27277b87566cbf2c` |
| `packages/mpd-verif-plugin/src/venv.ts` | `c5ec78fcc1b1c169` | `c5ec78fcc1b1c169` |
| `packages/mpd-verif-plugin/src/wave.ts` | `4c3a7d5f863298e1` | `4c3a7d5f863298e1` |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | `7045c6527dfd8dfb` | `7045c6527dfd8dfb` |

Independent second opinion (committed revision, not the working tree):

```bash
git -C <SRC_ROOT> show HEAD:packages/mpd-verif-plugin/src/<file> | diff -q - <SILICON>/packages/mpd-verif-plugin/src/<file>
```

Observed: `rev=3d99718 | files matching committed content: 14 / 14`.

Extra fidelity evidence beyond the contract (same command shape):

| artifact | command | result |
|---|---|---|
| verif `test/` (10 `.ts`) | `diff -r <SRC_ROOT>/packages/mpd-verif-plugin/test <SILICON>/packages/mpd-verif-plugin/test` | exit 0, no output → **identical** |
| verif `README.md` + `README.zh-CN.md` | `diff -q` each | **identical** |

**Conclusion: pass.** The port is byte-faithful; the only tracked difference in the repository is
the (not yet landed) captain-approved service rename — see §8.

## 2. Check 2 — test strength

| command | observed | conclusion |
|---|---|---|
| `cd <SILICON> && bun test packages/` | `106 pass / 0 fail / 742 expect() calls / Ran 106 tests across 11 files`, exit 0 | pass (≥ 78 required) |
| independent source baseline — **verif package only**: copy `<SRC_ROOT>/packages/mpd-verif-plugin` (plus the adapter package it imports) to a scratch dir and run `bun test` there | `78 pass / 0 fail / 414 expect() calls / Ran 78 tests across 9 files`, exit 0 | pass — the ported verif suite is the same 78 tests. **Correction (t20, from t8 finding F6):** this line originally said "copy `{mpd-verif-plugin, mpd-dsh-adapter-plugin}` to a scratch dir" while quoting the verif-only numbers; the full two-package copy actually yields `100 pass / 474 expect / 10 files`, because the source adapter package carries a further **22 tests / 60 expect / 1 file** that were **not** migrated at the time — a real test-surface loss, recorded as F5 and repaired in t20 (the adapter suite is now in this repo; the suite totals below are current) |
| skip/xfail census: `grep -rho '\.skip\|\.only\|\.todo\|xit(\|xdescribe(' .../test/*.ts` | silicon verif `0`, silicon all packages `0`, source verif `0` | pass — nothing was skipped, disabled or marked todo to make the port green |
| assertion census: `grep -rho '\btest(' / 'expect('` | silicon verif `78 test(` / `326 expect(`; source verif `78` / `326` | pass — identical counts, no assertions removed or weakened |
| **current totals after the t20 repair** | `130 pass / 1 visible skip / 0 fail / 845 expect() calls / Ran 131 tests across 12 files`; the single skip is the optional source cross-check (`skills.test.ts`), which is skipped visibly when the source checkout is absent | pass — the skip is reported in bun's summary, and it replaces the previous silent `continue` that hid 38 assertions |

The suite was also re-run in a scratch copy of the **source** plugin, so this count does not
depend on t1's self-report.

**Conclusion: pass.**

## 3. Check 3 — tool surface (8 tools, names and registration)

Name sets, extracted from four independent sources:

```bash
grep -oh '"mpd_verif_[a-z_]*"' <dir>/packages/mpd-verif-plugin/src/*.ts | sort -u   # and …/dist/index.js
```

| source of truth | names found |
|---|---|
| silicon `src/` | `backends, compile, coverage, lint, regress, sim, uvm, venv` |
| source `src/` | identical set |
| silicon `dist/index.js` | identical set |
| source `dist/index.js` | identical set |

`src set == dist set (silicon)? YES`. Per-name occurrence count is exactly `1` in all four
sources for each of the eight names (silicon src, silicon dist, source src, source dist).

Registration parameters: because `src/` is byte-identical (§1), the descriptors are identical by
construction; independently, the `description: "…"` literals inside the **built** dists are also
identical — `silicon dist description literals: 43 | source: 43 | diff: 0 lines`.

Dynamic import / loadability of the shipped artifacts:

```bash
node -e "import('<SILICON>/packages/mpd-verif-plugin/dist/index.js').then(m=>console.log(m.name, typeof m.apply, Object.keys(m).sort().join(',')))"
```

Observed: `name = mpd-verif`, `apply is function: true`,
exports `apply, inject, name, probeAll, venvCreate, venvPath, venvStatus, verifCompile, verifCoverage, verifRegress, verifSim, verifUvm, workDir, workspaceRoot`.
The bootstrap dist also imports and reports `name = mpd-silicon-bootstrap`, `apply: function`.

**Conclusion: pass.**

## 4. Check 4 — RTL skill provider

| item | value | how observed |
|---|---|---|
| provider name | `silicon-bundle` | `export const PROVIDER_NAME = "silicon-bundle"` (bootstrap `src/index.ts:26`) and the live provider object's `name` |
| rank | `600` | `export const BUNDLED_SKILL_RANK = 600` (`src/index.ts:28`); every listed skill carries `rank=600` |
| corpus source | `bundled` | each listed candidate carries `source=bundled` |
| corpus root | `<bundle-root>/skills` | `bundleRoot()` + `/skills`; `corpus exists: true` |

Independent probe (drives the **shipped** provider source against the real corpus, not a stub):

```bash
cd <SILICON> && bun -e '
import * as m from "./packages/mpd-silicon-bootstrap-plugin/src/index.ts";
import { existsSync } from "node:fs";
const warns = [];
const ctx = { skills: {}, logger: { warn: s => warns.push(String(s)), info(){}, debug(){} }, on(){ return () => {} } };
const root = m.bundleRoot() + "/skills";
const provider = m.createProvider(root, ctx, () => {});
console.log(m.PROVIDER_NAME, m.BUNDLED_SKILL_RANK, provider.name, existsSync(root));
const listed = await provider.list();
console.log(listed.map(s => s.name + ":" + s.rank + ":" + s.source).join(" | "), "warns=" + warns.length);
'
```

Observed:

```
silicon-bundle 600 silicon-bundle true
rtl-codestyle:600:bundled | rtl-ip-flow:600:bundled | rtl-verif:600:bundled   warns=0
```

Note for downstream readers: `rank` and `source` live on each **candidate** the provider lists;
the provider object itself exposes only `name`/`list` (its `rank`/`source` read `undefined`). That
is the shape the harness consumes, and it matches what `scripts/verify-corpus.mjs` asserts.

Collision risk against the mpd bundle:

| bundle | runtime provider name | evidence |
|---|---|---|
| mpd | `mpd-bundle` | `<SRC_ROOT>/packages/mpd-bootstrap-plugin/src/index.ts:45` |
| silicon | `silicon-bundle` | this repo `packages/mpd-silicon-bootstrap-plugin/src/index.ts:26` |

The two strings differ, so the providers are distinguishable in one process. The only
`registerProvider` call site in this repo is the adapter seam
(`packages/mpd-dsh-adapter-plugin/src/index.ts:411`), i.e. silicon registers exactly one provider.

Corroborating gate: `node scripts/verify-corpus.mjs` → `PASS — 10 check(s) passed, 0 skipped`,
including `provider "silicon-bundle" loads all 3 skills: rtl-codestyle, rtl-ip-flow, rtl-verif`.

**Conclusion: pass.** (The residual risk is not the provider name but the still-pending service
singleton rename — §8.)

## 5. Check 5 — corpus fidelity (three RTL trees)

```bash
for tree in rtl-ip-flow rtl-codestyle rtl-verif; do
  (cd "<SRC_ROOT>/skills/$tree" && find . -type f | sort | xargs sha256sum | sha256sum)
  (cd "<SILICON>/skills/$tree"  && find . -type f | sort | xargs sha256sum | sha256sum)
done
```

| tree | source files | source bytes | silicon files | silicon bytes | aggregated sha256 (both sides) | verdict |
|---|---|---|---|---|---|---|
| `rtl-ip-flow` | 9 | 32 869 | 9 | 32 869 | `5b7065074fc98bf6…` | **match** |
| `rtl-codestyle` | 6 | 23 851 | 6 | 23 851 | `a8fdcc590fb83378…` | **match** |
| `rtl-verif` | 20 | 35 257 | 20 | 35 257 | `bd1247a4384ed76c…` | **match** |
| **total** | **35** | **91 977** | **35** | **91 977** | 3/3 trees | **match** |

The aggregated hash is over the sorted `sha256  relpath` list of each tree, so it proves both the
file set and the byte content, not just the count. File counts are the required 35.

**Conclusion: pass.**

## 6. Check 6 — dist / src build consistency

The contract suggests re-running the build and checking `git diff --stat`, but (a) this repo has no
VCS and (b) the task's read-only discipline forbids rewriting `dist/`. Instead the repo's own build
command was executed against a scratch copy and the produced bytes were compared with the shipped
artifacts:

```bash
cp -a <SILICON>/packages/<pkg> <SCRATCH>/packages/<pkg>     # for the 3 plugins
( cd <SCRATCH>/packages/<pkg> && bun build src/index.ts --target node --format esm --outfile dist/index.js )
sha256sum <SCRATCH>/packages/<pkg>/dist/index.js <SILICON>/packages/<pkg>/dist/index.js
```

| plugin | rebuilt sha256 (= shipped) | bytes | verdict |
|---|---|---|---|
| `mpd-dsh-adapter-plugin` | `2d84f75cb9ca92dd…` | 10 488 | **identical** |
| `mpd-verif-plugin` | `1766b604b9df51bc…` | 96 161 | **identical** |
| `mpd-silicon-bootstrap-plugin` | `44268603f7ba864f…` | 21 376 | **identical** |

So every shipped `dist/` is exactly what a fresh build of the current `src/` produces — dist is in
sync; no stale artifact. Because the rebuild is byte-identical, the "time-stamp-only difference"
caveat does not apply.

**Conclusion: pass.**

## 7. Summary

| # | check | verdict |
|---|---|---|
| 1 | per-file fidelity (13 verif src + adapter; 14/14 also vs committed rev) | pass |
| 2 | test strength (78 verif tests reproduced from an independent source baseline; 0 skip/only/todo; equal assertion counts) | pass |
| 3 | tool surface (8 names, identical sets in src/dist on both sides; dist description literals diff 0; `apply` loads) | pass |
| 4 | skill provider (`silicon-bundle`, rank 600, `bundled`, real corpus, 0 warnings; no clash with `mpd-bundle`) | pass |
| 5 | corpus fidelity (3 trees, 35 files, 91 977 bytes, per-tree aggregated hash match) | pass |
| 6 | dist/src build consistency (3/3 byte-identical rebuilds in a scratch copy) | pass |

## 8. Findings and notes

**Findings (blocking): none.** Nothing in the port misrepresents or degrades the source.

| # | severity | item | detail |
|---|---|---|---|
| N1 | note (already adjudicated) | contract/description mismatch | The task text says "verif src 12 files"; the tree has **13** `.ts` files (`wave.ts` was missing from the enumeration). Content is complete — the directory was copied wholesale, no file is missing. Recorded per the captain's instruction that this is a non-defect. |
| N2 | note | no VCS in this repo | `git rev-parse` → `fatal: not a git repository`, so check 6 could not use `git diff --stat` and no commit hash can be cited for the silicon side. Byte comparison was used instead; first commit is task t5/t10 territory. |

## 9. Captain-approved deliberate divergence — status: NOT LANDED (re-check required)

The captain pre-registered an approved minimum divergence for coexistence (Cordis services are
single-provider; two bundles registering `mpdDsh` abort the plugin tree). **At verification time it
is not present anywhere in the repository**: `grep -rn siliconDsh packages/*/src packages/*/dist`
→ 0 files, and the three anchors still read the source values:

| file | anchor | current value |
|---|---|---|
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | `:446` | `export const SERVICE_NAME = "mpdDsh"` |
| `packages/mpd-silicon-bootstrap-plugin/src/index.ts` | `:348` | `… ctx.get("mpdDsh") … ?? createDshAdapter(ctx)` |
| `packages/mpd-verif-plugin/src/index.ts` | `:35` | `… ctx.get("mpdDsh") … ?? createDshAdapter(ctx)` |

Consequently **all 14 files above are currently byte-identical**, and this report's fidelity
verdict is unbiased by any exemption. Baseline captured before the divergence, for the later
delta (silicon copies, sha256): adapter `7045c6527dfd8dfb…`, bootstrap `ccb375e708f8f794…`,
verif `282f4ca5fa947d9c…`.

When it lands, re-run **this** check set and confirm exactly:

1. the only differences in those three files are the `SERVICE_NAME` value and the two resolver
   expressions (per-line `diff`, not "is there a diff");
2. `export const name = "mpd-dsh-adapter"` (adapter `:20`) and the log prefix `[mpd-dsh-adapter]`
   (adapter `:455`) are **unchanged** — a change there is a finding;
3. existing comment text still naming `ctx.get("mpdDsh")` (adapter `:14-15`) is a known, approved
   non-sync — list it separately, not as a finding;
4. the rebuild in §6 still reproduces each shipped `dist/` byte-for-byte;
5. `bun test packages/` still reports `106 pass / 0 fail` with 0 skip markers.

## 10. Reproducibility

Every path cited in this report exists on disk; every command above was executed in the order
shown. The scratch directories used (`/tmp/t6-srcbase`, `/tmp/t6-build`) are not part of either
repository and can be deleted freely. Re-run the whole verification with:

```bash
# 0) resolve the source checkout (sibling of this repo, overridable)
SRC_ROOT="${MPD_SOURCE_ROOT:-$(cd .. && pwd)/my-power-dsh}"

# 1) fidelity
for f in packages/mpd-verif-plugin/src/*.ts; do diff -q "$SRC_ROOT/packages/mpd-verif-plugin/src/$(basename "$f")" "$f" || echo "DIFF $f"; done
diff -q "$SRC_ROOT/packages/mpd-dsh-adapter-plugin/src/index.ts" packages/mpd-dsh-adapter-plugin/src/index.ts

# 2) corpus
for t in rtl-ip-flow rtl-codestyle rtl-verif; do
  a=$(cd "$SRC_ROOT/skills/$t" && find . -type f | sort | xargs sha256sum | sha256sum)
  b=$(cd "skills/$t"        && find . -type f | sort | xargs sha256sum | sha256sum)
  [ "$a" = "$b" ] && echo "$t MATCH" || echo "$t MISMATCH"; done

# 3) surface + tests + gates
grep -oh '"mpd_verif_[a-z_]*"' packages/mpd-verif-plugin/src/*.ts | sort -u
bun test packages/
node scripts/verify-corpus.mjs
```
