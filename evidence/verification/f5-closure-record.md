# F5 closure record — adapter suite + READMEs migrated (for the t22 ledger)

Captured at the captain's request so t22's ledger carries: **who did it, when, and against
which evidence**. Written by Deep Worker (t3/t18 executor); the F5 finding itself is t8's.

## What F5 was (t8, severity medium)

`evidence/review/t8-port-review.md` §F5: the ported `packages/mpd-dsh-adapter-plugin/` was
missing three files the source package carries — `test/adapter.test.ts` (22 tests / 60
expect), `README.md`, `README.zh-CN.md`. Not a contract acceptance item (hence recorded as a
blind spot rather than a `fail`), but material: the adapter is the bundle's **only** contact
surface with the harness seams, and in this repository it had **zero tests**.

## Closure status — all three files present and byte-identical

| File | sha256 (16) | Source | Silicon |
| --- | --- | --- | --- |
| `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` | `fa0629c055f0bbe1` | ✔ | ✔ |
| `packages/mpd-dsh-adapter-plugin/README.md` | `76ed5d7520a5930f` | ✔ | ✔ |
| `packages/mpd-dsh-adapter-plugin/README.zh-CN.md` | `710745944eec128c` | ✔ | ✔ |

All three hashes **match t20's recorded values exactly**, and a direct `cmp` against the
source checkout reports IDENTICAL for each. The port is complete, not partial.

## Timing — this is the part that must not be misread

The suite landed ~4 minutes **after** S1, in a different round:

| Time | Event | Evidence |
| --- | --- | --- |
| 00:46–00:55 | this task's mode normalization + `pack-silicon.mjs` + `.gitignore` | file mtimes |
| **00:58** | **S1**: `SERVICE_NAME → siliconDsh` + 2 resolution-chain tests added to `bootstrap.test.ts` | `bootstrap.test.ts:267` "S1 (captain-approved divergence)" |
| **01:02** | **t20 repair**: `adapter.test.ts` + the two READMEs copied in | file mtimes = 01:02 (all three identical) |

So the count moved in two independent steps: **106 → 108** (S1's two chain tests) → **130**
(t20's 22 adapter tests). **t8's review predates both**, which is why F5 reads as an open gap
there. `F5 已修` therefore means "a later repair closed a t8 blind spot" — **not** "t8 reported
a defect that never existed". t8's finding was accurate at the time it was written.

## The single skip — not a silent downgrade (and a correction to my own earlier note)

```
(skip) shipped RTL corpus > cross-check: byte-identical to the source checkout at
       <SRC_ROOT>/skills (0/3 trees present)
```

- **Cause:** t5 physically removed the source RTL trees, so the *live-diff* cross-check has no
  comparison subject. It skips rather than fails, which is the intended behaviour after a
  strip (`verify-corpus.mjs` prints the same three skips with "expected after the RTL strip").
- **It is not the corpus integrity gate.** That gate is a *different, passing* test in the same
  suite:
  ```
  (pass) shipped RTL corpus > ships exactly the three RTL trees, and no mpd general-purpose corpus
  (pass) shipped RTL corpus > each tree matches the committed corpus baseline (relative path + sha256 per file)
  ```
  The corpus is still checked file-by-file against a **committed fingerprint**, so a mutated,
  added, or missing corpus file is still caught. Only the redundant live-source comparison is
  skipped.

**Correction to my earlier report:** I previously wrote that this skip means "the ported
corpus can never again be independently re-verified against the source — a permanent loss of
verification strength." That overstated it. The fingerprint check remains live and enforcing;
what is lost is only the *second, independent* confirmation against a live checkout. The
remaining value of the live check, if wanted, is the ability to detect a **faulty fingerprint**
rather than a faulty corpus — a narrower gap than I described.

## Residual risk: narrowed again — an independent oracle DOES survive

The captain adopted the correction above and asked for the remaining minimal gap to be recorded
as a known residual risk: *"the self-holding baseline can only detect a wrong fingerprint, not a
corpus that was already wrong when the baseline was generated"*, on the premise that manifest and
corpus both come from the same `git archive 3d99718` and the source has been stripped, leaving no
alternative.

**Measured — the premise is wrong on its last clause.** Commit `3d99718` still exists in the
source repository's object database, even though the task-strip deleted the *working-tree* files:

```
$ git -C <SRC_ROOT> cat-file -e 3d99718 && echo EXISTS
EXISTS
$ git -C <SRC_ROOT> ls-tree -r --name-only 3d99718 skills/rtl-ip-flow skills/rtl-codestyle skills/rtl-verif | wc -l
35
$ git -C <SRC_ROOT> archive 3d99718 skills/rtl-* | tar -x   # 35 files reconstructed
```

Comparing that reconstruction against `corpus-baseline.json`, entry by entry (sha256 **and**
byte size, since each manifest value is `{sha256, bytes}`):

```
checked: 35 | sha mismatches: 0 | byte-size diffs: 0
```

So the archived revision **independently corroborates the manifest in full**. Consequences:

- The "same-generation blind spot" is real in principle *only* if the manifest and the corpus
  were both produced from the same **already-wrong** input; the archive check shows the input
  was the committed revision, and the shipped corpus matches it exactly.
- A **concrete alternative means exists** and is cheap: any operator can re-verify by
  `git archive 3d99718 <trees>` + the same comparison. It is not a substitute for the skipped
  *automated* test, but it refutes "no alternative remains".
- The skip could be retired outright by having the cross-check consume `3d99718` via
  `git archive` instead of a live checkout path — a small change to the t20-owned test
  (`skills.test.ts`), not made here because that file is not this task's to edit.

**Remaining residual risk, stated narrowly:** the automated suite no longer performs the live
comparison, so a regression in the *manifest* alone (not the corpus) would not be caught by an
independent source. The manual/cold-check route above covers it whenever someone runs it.

## A process note worth keeping: I made this same class of error twice

While measuring the above I compared each manifest **string** against a **`{sha256, bytes}`
object** and got `35 / 35 MISMATCH`. The temptation was to report "the corpus does not match its
baseline". Inspecting one entry first (`{"sha256": …, "bytes": …}`) showed the comparison was
malformed — the manifest was correct and the result said nothing about the corpus. That is the
same failure mode as the earlier `my-power-dsh` literal comparison (a check that cannot
distinguish its outcomes, reported as if it could). **Rule: before believing a surprising
result, prove the check can produce the other outcome.** Both incidents were caught by that rule
rather than by luck; the second one only because the first had already taught it.
