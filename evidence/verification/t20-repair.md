# t20 — repair round 2 (t8 findings F1–F8)

**Task:** t20 · **Attempt:** c2d92693-fc7b-42d2-8539-af7b5947d9d8 · **Repairer:** Junior Engineer
**Scope of this report:** every t8 finding is addressed with a command-level evidence line below.
One finding (F4) turned out to be **already resolved source-side** while this repair ran; the
measurement is recorded instead of a decision. §4 also executes the five re-check criteria that
`t6-port-fidelity.md` §9 pre-registered for the approved service rename — which **landed** during
this task (another task landed it), so the report records the verified result rather than a plan.

## 0. What changed, and why fidelity is now self-held

The root cause behind F1 (blocker) and F2 (high) was the same: both guards pointed at the **source
checkout** as their fidelity baseline, but the whole point of the split is that the source checkout
no longer contains the RTL corpus. The strip commit removed the three trees while `skills/` itself
survived (331 files), so the old "skip when the source is absent" fallback never fired and the gate
went red forever. Both guards now compare against a **committed baseline manifest** and treat the
source checkout as optional extra evidence.

## 1. F1 (blocker) — `scripts/verify-corpus.mjs` is now self-held

New artifact: `evidence/verification/corpus-baseline.json` — per tree, per file: relative path,
`sha256`, `bytes`; generated from the authoritative revision:

```bash
git -C <SRC_ROOT> archive 3d99718 skills/rtl-ip-flow skills/rtl-codestyle skills/rtl-verif | tar -x -C /tmp/t20-src
# then hash every file, and assert equality with the shipped corpus
```

Observed: `baseline written | files: 35 | source(3d99718)-vs-shipped mismatches: none`
(`rtl-ip-flow` 9, `rtl-codestyle` 6, `rtl-verif` 20).

How the check now works:

- **authoritative**: shipped tree vs manifest — file list and per-file sha256. Needs no source.
- **optional**: when `MPD_SOURCE_SKILLS` / `MPD_SOURCE_ROOT` resolves to a live checkout, an extra
  cross-check runs; **every absence is a printed `SKIP` line** (whole checkout absent, or a single
  tree absent), never a silent pass.
- **fails loudly** when the manifest itself is missing/unreadable (`fidelity baseline missing …`).

| scenario | command | observed |
|---|---|---|
| post-strip default (source trees gone) | `node scripts/verify-corpus.mjs` | **exit 0** — `PASS — 10 check(s) passed, 3 skipped`; the 3 skips are the per-tree source cross-check |
| no source checkout at all | `MPD_SOURCE_ROOT=/tmp/definitely-not-here node scripts/verify-corpus.mjs` | **exit 0** — `PASS — 10 check(s) passed, 1 skipped` |
| source recovered from history | `MPD_SOURCE_SKILLS=/tmp/t20-cross/skills node scripts/verify-corpus.mjs` | **exit 0** — `PASS — 13 check(s) passed, 0 skipped` (all three trees byte-identical to the source) |
| self-test | `node scripts/verify-corpus.mjs --self-test` | **exit 0** — `self-test: PASS (8 negative controls caught, 2 healthy controls clean)` |

The tampered-byte control now runs on the self-held baseline (`differ from the committed
baseline`), and two controls were added for the exact failure mode of F1: **a whole tree removed**
must be caught (`not present in the shipped corpus`), and **a missing baseline** must fail loudly.
Both are falsifiable guards, not permanently-green assertions.

## 2. F2 (high) — the skills test no longer self-disables

`packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts`:

- the hard-coded `/root/dshProj/my-power-dsh/skills` is gone: `MPD_SOURCE_SKILLS` wins, then
  `<MPD_SOURCE_ROOT>/skills`, then the sibling checkout `../my-power-dsh/skills`;
- fidelity is asserted against the same committed baseline (`sha256` + `bytes` per file), **always**,
  with no `continue`;
- the optional source cross-check is a separate test using `test.skipIf(...)`, so an absent source
  shows up in bun's own skip count instead of hiding assertions.

| scenario | command | observed |
|---|---|---|
| post-strip default | `bun test packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts` | `10 pass / 1 skip / 0 fail`, **273 expect()** |
| source cross-check enabled | `MPD_SOURCE_SKILLS=/tmp/t20-cross/skills bun test …` | `11 pass / 0 skip / 0 fail`, **311 expect()** |

Before the repair the same file silently dropped 38 assertions (234 → 196 expects) while staying
green; it can no longer do that — the fidelity assertions run against the manifest in both modes.

## 3. F3 (high) — `docs/dependency-map.md` refreshed (and the facts moved again)

Corrected in `docs/dependency-map.md` (and mirrored 1:1 in `docs/dependency-map.zh-CN.md`):

- **§How to read** now separates *new-home* paths (checked with `test -e`) from *historical*
  source-side paths, explains the strip commit (`12291a7`, parent `3d99718`), and gives the
  `git show 3d99718:<path>` recovery command;
- **A1 / A2 source columns** carry `removed by t5; recover with git show 3d99718:<path>`;
- **ledger row 1** no longer claims "every path in §1 exists": it says the sweep was true *when
  written*, that the 33 source-side paths have since been stripped, and that the new-home paths
  still resolve. Ledger rows 5 / 9 / 10 were also stale (test totals and the two RTL QA cases) and
  now carry "then → now" values;
- **S1 row**: the previous text claimed the service rename was landed. That was wrong at the time
  (F3a) — and by the time this repair finished the rename **had** landed (see §4), so the row now
  states `landed` with the line-level evidence instead of a promise;
- **§4 pending table**: A6 is now `landed` (a separate task migrated the six RTL documents plus
  `docs/rtl-docs-port-record.md`); A7 points at its recorded follow-up owner; a new row records the
  F4 resolution; the closing note tells the reader that a non-resolving *source* path is the strip,
  not staleness.

Owner note: the acceptance asked for a "captain-assigned owner" to refresh the docs once t5 landed.
The refresh happened inside t20 because both facts (the strip commit and the rename) moved while
t20 ran; **no follow-up owner is needed for these rows** — they are current as of the ledger below.
Any further move of these assets must refresh the same rows (see `sync-policy.md` §2 rule 5).

## 4. F4 — resolved source-side (option ①), and the t6 §9 re-check

**t8's blocker asked the captain to choose between (1) re-pinning `VENDOR_LOCK.assets.skills` plus
repointing/marking the two RTL QA cases, and (2) explicitly exempting `verify-vendor` / `test:qa`.**
While t20 ran, the strip commit did **(1)**, so there is nothing left to decide:

| measurement (source repo, read-only) | observed |
|---|---|
| `VENDOR_LOCK.json` → `assets.skills` | `fileCount 331` / `treeSha 23e18d7c…e1597`, matching `git ls-tree -r HEAD -- skills` = **331** |
| `node scripts/verify-vendor.mjs` | **exit 0** (`PASS`) |
| `node scripts/verify-rows-parity.mjs` | **exit 0** (`ok: 21 row ids match …`) |
| `bun run test:qa` | **exit 0** — the two RTL cases are skipped by name with a reason: `SKIP … — known-stale until the t19 repoint`; the cases are neither deleted nor modified, and `test:qa:all` still runs them |
| follow-up owner | **t19** — named in the skip message, in `package.json`, and in `.silicon-extraction/removal.log` |

The silicon-side docs record this in the S3 row and the §4 table, and point at t19 for the repoint.

### 4b. t6 §9's five pre-registered criteria for the rename — executed

The approved divergence **landed** during this task (`grep -rn siliconDsh packages/*/src/index.ts`
→ 5 anchors across 3 files). All five criteria pass:

| # | criterion | evidence |
|---|---|---|
| 1 | only the service name / resolver lines differ | adapter vs source `3d99718`: **3 lines** (`:14` comment, `:445` doc comment, `:446 SERVICE_NAME = "siliconDsh"`); verif `src/` vs `3d99718`: **1 line** (`:35`); bootstrap vs its pre-divergence copy: **1 line** (`:348`) |
| 2 | `name = "mpd-dsh-adapter"` and `[mpd-dsh-adapter]` unchanged | `:20` and `:455` verified by grep |
| 3 | comment text that named the old service is listed separately | adapter `:14`, `:445` — updated to `siliconDsh`; within the captain's approved allowance for comment text |
| 4 | rebuild reproduces each shipped dist byte-for-byte | adapter `4bdc82ce2eaef496`, verif `180e68750f406e2b`, bootstrap `897dbd1b0d1c47c7` — all **IDENTICAL** (built in `/tmp`, repo untouched) |
| 5 | tests still green with no new skip | `bun test packages/` → `130 pass / 1 skip / 0 fail / 845 expect() / 131 tests / 12 files`; the single skip is the documented optional source cross-check |

## 5. F5 (medium) — the adapter suite and READMEs are now in this repo

Copied from the source revision and verified byte-identical (`git show HEAD:<path>` → sha256 match):

| file | source sha256 | silicon sha256 |
|---|---|---|
| `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` | `fa0629c055f0bbe1…` | `fa0629c055f0bbe1…` |
| `packages/mpd-dsh-adapter-plugin/README.md` | `76ed5d7520a5930f…` | `76ed5d7520a5930f…` |
| `packages/mpd-dsh-adapter-plugin/README.zh-CN.md` | `710745944eec128c…` | `710745944eec128c…` |

`bun test packages/mpd-dsh-adapter-plugin` → **22 pass / 0 fail / 60 expect()**. None of the three
files hard-codes a machine path (`grep -n '/root/dshProj\|/home/' …` → CLEAN). Net suite effect:
the adapter's 22 tests are now part of `bun test packages/`, so the "adapter is the only
harness-touching package and had zero tests here" gap is closed.

## 6. F6 (medium) — the t6 report's non-reproducible sub-claim

`evidence/verification/t6-port-fidelity.md` §2 now reads **"verif package only: 78 / 414 / 9"**,
states that a two-package copy actually yields `100 / 474 / 10`, and records that the source adapter
package carried a further **22 tests / 60 expect** that were not migrated at the time (F5, since
repaired). A `t20 repair note` at the top of that report marks the correction and the fact that its
§0 statements describe the state at verification time (the strip commit `12291a7` landed later).

## 7. F7 (medium) — machine paths are resolved, not hard-coded

| file | before | after |
|---|---|---|
| `scripts/verify-rows-disjoint.mjs` | `join("/root/dshProj", "my-power-dsh", …)`, no override | `MPD_SOURCE_PATCH` → `MPD_SOURCE_ROOT/packages/mpd-bundle/cordis.patch.yml` → sibling `../my-power-dsh/…`; ENOENT now prints an actionable hint about both env vars and `--mpd` |
| `scripts/verify-corpus.mjs` | hard-coded default | `MPD_SOURCE_SKILLS` → `MPD_SOURCE_ROOT/skills` → sibling `…/skills` |
| `packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts` | hard-coded | same three-step resolution |

Measured behaviour of the rows gate:

```bash
node scripts/verify-rows-disjoint.mjs                                   # exit 0 — PASS: silicon ∩ mpd = ∅
node scripts/verify-rows-disjoint.mjs --self-test                       # exit 0
MPD_SOURCE_ROOT=/tmp/definitely-not-here node scripts/verify-rows-disjoint.mjs
  → [rows-disjoint] FAIL(unusable): mpd patch not found at /tmp/definitely-not-here/packages/mpd-bundle/cordis.patch.yml
  → [rows-disjoint] hint: point the gate at the mpd checkout with MPD_SOURCE_ROOT … or MPD_SOURCE_PATCH …, or pass --mpd <path>.
  → exit 2
MPD_SOURCE_PATCH=<abs path> node scripts/verify-rows-disjoint.mjs        # exit 0
```

`README.md`, `README.zh-CN.md`, `presets/README.md` and `presets/README.zh-CN.md` already use the
sibling-`../my-power-dsh` + `MPD_SOURCE_ROOT` wording by the time this repair ran (another task
fixed them concurrently) — verified by re-grepping: no `/root/dshProj` remains in any script,
test, README or preset doc. `docs/dependency-map.md:13-15` and `docs/sync-policy.md` §6 now agree
with that convention.

## 8. F8 (low) — Erie / verilog-generator provenance

`LICENSE-NOTICES.md`, corpus section: a paragraph now states that the `rtl-codestyle` contract
follows the Erie / verilog-generator rule set, **style reference only — no code reused**, matching
`skills/rtl-codestyle/SKILL.md:9-10`, and points at the dual-channel diff ledger for the
byte-ported assets.

## 9. Scope declaration (read this before judging changedPaths)

The task's `inScope` enumerated `evidence/verification/`, `scripts/verify-corpus.mjs`,
`skills.test.ts`, `docs/dependency-map.md`, `packages/mpd-dsh-adapter-plugin/`,
`scripts/verify-rows-disjoint.mjs`, `LICENSE-NOTICES.md`. These acceptance criteria required edits
outside that enumeration, so the following extra files were touched **deliberately**, each named by
a criterion:

| extra file | required by |
|---|---|
| `docs/dependency-map.zh-CN.md` | the two documents are declared mirrors of one another; criterion 3 fixes facts that exist identically in both |
| `evidence/verification/corpus-baseline.json` | criterion 1 ("commit a corpus manifest") — placed in the in-scope `evidence/verification/` directory |
| `packages/mpd-silicon-bootstrap-plugin/test/skills.test.ts` (already in scope) | criteria 1–2 |
| `README.md`, `README.zh-CN.md`, `presets/README.md`, `presets/README.zh-CN.md` | criterion 7 ("README 类改用 `<SRC_ROOT>`") — found already fixed when reached; **not modified by this task** |
| `evidence/verification/t6-port-fidelity.md` | criteria 6 (correction) and 4b (re-check record) |

No implementation file outside those was changed; `skills/` and `cordis.patch.yml` were not touched.
The source repo was read only (`git show`, `git archive`, read-only gates) — never written.

## 10. Verification ledger (all commands executed)

| # | command | exit | observed |
|---|---|---|---|
| 1 | `cd <SILICON> && bun test packages/ 2>&1 \| tail -5` | 0 | `130 pass / 1 skip / 0 fail / 845 expect() calls / Ran 131 tests across 12 files` |
| 2 | `cd <SILICON> && test -f evidence/verification/t6-port-fidelity.md && echo EVIDENCE-OK` | 0 | `EVIDENCE-OK` |
| 3 | `node scripts/verify-corpus.mjs` | 0 | `PASS — 10 check(s) passed, 3 skipped` |
| 4 | `node scripts/verify-corpus.mjs --self-test` | 0 | `self-test: PASS (8 negative controls caught, 2 healthy controls clean)` |
| 5 | `node scripts/verify-rows-disjoint.mjs` | 0 | `PASS: silicon ∩ mpd = ∅` |
| 6 | `node scripts/verify-rows-disjoint.mjs --self-test` | 0 | all parser controls PASS |
| 7 | `node scripts/pack-silicon.mjs --check` | 0 | `check PASS: every committed file is readable by a non-root consumer` |
| 8 | `bun run verify:pack` | 0 | `self-test PASSED: package-set guards are falsifiable and mode normalization is proven` |
| 9 | rebuild 3 plugins in `/tmp` + `sha256sum` vs shipped | 0 | 3/3 byte-identical |
| 10 | `<SRC_ROOT>`: `verify-vendor.mjs` / `verify-rows-parity.mjs` / `bun run test:qa` | 0 / 0 / 0 | see §4 |
| 11 | `grep -rn '/root/dshProj' scripts packages/*/test README.md README.zh-CN.md presets/*.md docs/*.md` | 1 | **no hits** — no machine path remains in any script, test, README, preset doc or document. (`evidence/**` still contains historical boot logs with absolute paths; they are captured evidence, not configuration.) |

## 11. Notes for the reviewer

- The repo moved under this task: the strip commit (`12291a7`), the doc migration, the pack-silicon
  gate and the **service rename** all landed while t20 ran. Every fact asserted in §3/§4 was
  re-measured after those changes; nothing in this report is a prediction.
- `packages/mpd-dsh-adapter-plugin/src/index.ts` and its `dist/index.js` **changed during t20 but
  not by t20** — that is the rename landing task (§4b). The files this repair authored under
  `packages/mpd-dsh-adapter-plugin/` are the three migrated ones listed in §5.
- `docs/rtl-*.md` and `docs/rtl-docs-port-record.md` are the doc-migration task's output. They
  contain user-facing `~/.dsh` / `~/.codex` paths because they are *user guides*; the t4 hygiene
  rule ("no absolute home path") applies to the two mirror documents and the sync policy, which are
  CLEAN (`grep -n "/root\|/home/\|~/[a-z]\|password\|Bearer \|api[_-]key\|secret[=:]"
  docs/dependency-map.md docs/dependency-map.zh-CN.md docs/sync-policy.md` → no hits).
- `dist/silicon-package/` (the packer's output) is generated; it is regenerated by
  `node scripts/pack-silicon.mjs` and is not part of this repair.
- The remaining open item for this area is **t16** (HDL language-service assets + golden fixtures),
  unchanged by t20.
- Both documents' four tables (column counts) and the whole gate set were re-checked after every
  edit — see §10 rows 1, 3–8.
