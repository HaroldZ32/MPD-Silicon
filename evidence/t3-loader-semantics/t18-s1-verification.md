# S1 / t18 verification record — service-name de-collision

> **READ THIS FIRST — one thing must not be misread by the t6/t8 re-check.**
>
> 1. **S1 is already applied to the working tree.** It was implemented when the captain
>    approved S1, before t18 became formally schedulable. t18's executor should therefore
>    **run the re-check**, not re-apply the edit (a second application is a no-op at best).
> 2. **t6's three frozen baseline hashes are PRE-S1 input values, not post-S1 expectations.**
>    t6 recorded them while all 14 files were still byte-identical and labelled them
>    "Baseline captured before the divergence"
>    (`evidence/verification/t6-port-fidelity.md`). After S1 the three files **must differ
>    from them**. The correct assertion is "current ≠ baseline, and the difference is exactly
>    the sanctioned lines" — proved by the reversal check in §①, which restores each baseline
>    byte-for-byte.
>
> Current silicon hashes: adapter `e4b0aa89664e4ce4…`, bootstrap `e80a6b6b69aa72ca…`,
> verif `63820d748f7d1ec0…`.
>
> 3. **Captain ruling (final): no further edits.** S1's work is complete — criteria ①–④ passed,
>    and ⑤ is satisfied under the adjudicated form recorded in §⑤. t18's dependency chain
>    includes `t5`, which is now terminal **failed** (root cause: a contract-scope defect, an
>    absolute-path pattern that never matched in `pathMatchesScope`) — so waiting on t18 gating
>    would block work for a status reason, not a content reason. If t18 is ever dispatched,
>    **re-run the checklist and post the conclusion; do not re-edit these files.** A second edit
>    at the same site would create pointless diff and a write race (this session already hit one
>    concurrent-write transient SyntaxError).

t18's contract describes the S1 change that is **already on disk** (implemented when the
captain approved S1; see `coexistence.md` §7). This file records the t18-era verification
against t6's five re-check criteria, with raw output. t18 could not be claimed as this record
was written: `claim_task t18` → `blocked by unfinished dependencies: t5, t9, t10, t11, t13,
t15, t16, t17`.

## Action (as specified) — current state

| Site | Required | On disk |
| --- | --- | --- |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | `SERVICE_NAME = "siliconDsh"` | line 446 ✔ |
| `packages/mpd-silicon-bootstrap-plugin/src/index.ts` | chain `siliconDsh ?? mpdDsh` | line 348 ✔ |
| `packages/mpd-verif-plugin/src/index.ts` | chain `siliconDsh ?? mpdDsh` | line 35 ✔ |
| three dists | rebuilt | ✔ (reproducible, criterion ④) |

**`ctx.get` measured, not assumed**: for an unregistered service name it returns `undefined`
and does **not** throw (`raw-probe-output.txt` → `collide4.mjs` harness; also re-measured:
`ctx.get('definitelyNotRegistered')` → `undefined`, no exception). The `??` chain is therefore
correct as written and **no `tryResolve` wrapper was needed**.

## t6's five re-check criteria

### ① Only the service name + resolution chains differ — PASS

`diff -u` against the mpd baseline at commit `3d99718` (last commit holding both ported
plugins):

| File | Changed lines | Hunks |
| --- | --- | --- |
| `mpd-dsh-adapter-plugin/src/index.ts` | 6 | 2 (`@@ -11,7 +11,7 @@`, `@@ -442,8 +442,8 @@`) |
| `mpd-verif-plugin/src/index.ts` | 2 | 1 |
| `mpd-silicon-bootstrap-plugin/src/index.ts` | 1 | 1 |

No other line differs in any of the three files.

**Stronger check — the reversal proof.** The source-side copies of bootstrap and verif are
gone (t5 strip), so a live `diff` cannot reach them. Instead, the sanctioned delta was
**mechanically reverted** from the current files and the result hashed. If the current files
were baseline-plus-anything-else, the restored text would not hash to t6's recorded pre-S1
baselines:

```
MATCH  packages/mpd-dsh-adapter-plugin/src/index.ts
      reverted=7045c6527dfd8dfb  t6-baseline=7045c6527dfd8dfb  differing lines=3
MATCH  packages/mpd-silicon-bootstrap-plugin/src/index.ts
      reverted=ccb375e708f8f794  t6-baseline=ccb375e708f8f794  differing lines=1
MATCH  packages/mpd-verif-plugin/src/index.ts
      reverted=282f4ca5fa947d9c  t6-baseline=282f4ca5fa947d9c  differing lines=1
```

All three reproduce t6's baselines **exactly**, proving the working tree is the baseline plus
precisely 3 differing lines in the adapter and 1 in each of the other two — no incidental
formatting, ordering, or comment drift. The revert substitutions were, per file: the
`SERVICE_NAME` value and its two comment mentions (adapter), and the resolver expression
(bootstrap, verif).

**Baseline semantics (important for t6/t8):** t6's three cited hashes are the **pre-S1 shared
baselines**, captured while all 14 files were still byte-identical
(`evidence/verification/t6-port-fidelity.md`). They are therefore the *input* to the delta, not
a post-S1 expected value — after S1 the three files **must** differ from them. Current silicon:
adapter `e4b0aa89…`, bootstrap `e80a6b6b…`, verif `63820d74…`.

### ② `export const name` and the `[mpd-dsh-adapter]` log prefix — PASS (untouched)

```
packages/mpd-dsh-adapter-plugin/src/index.ts:20:export const name = "mpd-dsh-adapter"
packages/mpd-dsh-adapter-plugin/src/index.ts:455:    console.log("[mpd-dsh-adapter] " + SERVICE_NAME + " provided (harness seams resolved lazily, inject-free)")
```

The prefix is byte-identical to mpd's; only the interpolated `SERVICE_NAME` value differs, which
is the sanctioned change.

### ③ The `mpdDsh` strings in the adapter's comment lines — known and approved

Three comment occurrences name `siliconDsh` on the new side (lines 14, 445, and the value line
446). t6 classifies the `:14-15` and `:445` comment mentions as a *known, approved
inconsistency* listed separately rather than as a finding. No engine behavior depends on them;
they are prose that tracks the renamed service.

### ④ Rebuilt dists must be byte-reproducible — PASS

Rebuilt in a `/tmp` copy using the repo's own command, then compared to the committed dists:

```
$ cp -a packages scripts package.json "$T/" && (cd "$T" && node scripts/build.mjs)
rebuild exit=0
REPRODUCIBLE 4bdc82ce…
REPRODUCIBLE 897dbd1b…
REPRODUCIBLE 180e68750…
```

All three dists reproduce byte-for-byte, so S1's rebuild preserved the property t6 proved.

### ⑤ `bun test packages/` — **adjudicated criterion (captain, adopted)**

The original `106 / 0 / 0` is **stale** and cannot hold. The captain ruled the criterion be
recorded in the "declared skip" form with the fingerprint route as its substance:

> **`130 pass / 0 fail / 1 declared skip`** — and the skip must be **explicitly declared and
> bound to the self-holding fingerprint manifest**, never turned into a silent empty check.
> Weakening the criterion to make it green is explicitly NOT accepted.

Measured: **130 pass / 0 fail / 1 skip**. Two independent causes, neither a regression from S1.
Per-suite attribution, measured — the extra files are **not** S1's:

| Suite | pass | skip | attribution |
| --- | --- | --- | --- |
| `mpd-dsh-adapter-plugin/test/adapter.test.ts` | 22 | 0 | added by t20 at 01:02 (not S1) |
| `mpd-silicon-bootstrap-plugin/test/skills.test.ts` | 10 | 1 | added by t20 at 01:02 (not S1); holds the one skip |
| `mpd-silicon-bootstrap-plugin/test/bootstrap.test.ts` | 20 | 0 | **S1's accountable suite**; includes the 2 S1 resolution-chain tests |
| `mpd-verif-plugin/test/*` (9 suites) | 78 | 0 | ported verif suite, unchanged by S1 |
| **total** | **130** | **1** | |

So the arithmetic reconciles cleanly: the suite S1 is accountable for is
`bootstrap.test.ts` = 20 pass / 0 skip, and S1 **added** 2 passing tests there. Directly after
S1 and before the t20 files landed, the total was 108 pass / 0 skip — i.e. 106 + the 2 S1 tests.

#### The declared skip, and why it is not a weakened check

The substance the captain chose — the **fingerprint route** — is already implemented and
already passing:

- `evidence/verification/corpus-baseline.json` (schema 1) fingerprints **35 files** across the
  three trees (rtl-ip-flow 9 · rtl-codestyle 6 · rtl-verif 20), each by relative path + sha256,
  generated from source rev `3d99718` via `git archive`.
- Its own `note` states the intent verbatim: *"compare the shipped corpus against THIS manifest
  … so the fidelity check stays meaningful after the source checkout is gone. The optional
  source cross-check (MPD_SOURCE_ROOT / MPD_SOURCE_SKILLS) is extra evidence only and is
  reported as a visible SKIP when absent."*
- The **passing** test in the same suite is
  `shipped RTL corpus > each tree matches the committed corpus baseline (relative path + sha256 per file)`.

So the corpus is still verified file-by-file against a committed manifest; only the redundant
live-source comparison skips, and it does so **visibly** (`SKIP`, with the reason
`expected after the RTL strip`), which is exactly the "declared, not silent" condition. The
skip is bound to the manifest by construction: remove the manifest and the fingerprint test
fails, so the skip cannot masquerade as coverage.


- **The single skip is not S1's and cannot pass any more**:
  ```
  (skip) shipped RTL corpus > cross-check: byte-identical to the source checkout at
         /root/dshProj/my-power-dsh/skills (0/3 trees present)
  ```
  and in the corpus gate:
  ```
  [verify-corpus] PASS — 10 check(s) passed, 3 skipped
    SKIP  fidelity cross-check: tree rtl-ip-flow is not present in the source checkout (expected after the RTL strip)
    SKIP  … rtl-codestyle …   SKIP  … rtl-verif …
  ```
  **t5 physically removed the source RTL trees, so the fidelity cross-check has no subject.**
  It skips gracefully by design ("expected after the RTL strip"), which is honest — but it means
  the ported corpus is no longer independently re-verifiable against the source, ever. That is a
  real, permanent loss of verification strength introduced by the strip, and criterion ⑤ as
  written ("0 skip") cannot be satisfied while it stands. t6/t8 should re-word the criterion to
  `130 pass / 0 fail / 1 known skip` or decide the skip should become an assertion against a
  recorded fingerprint (e.g. `VENDOR_LOCK.json` / the port record) instead of a live diff.

## Coexistence re-test (real mount, not dump-config)

Both bundles mounted in one throwaway profile, then booted:

```
$ DSH_HOME=<tmp> dsh plugin --profile probe add <silicon> && ... add <mpd>
$ DEEPSEEK_API_KEY=dummy dsh --profile probe "say OK"          # real mount

[mpd-dsh-adapter] siliconDsh provided (harness seams resolved lazily, inject-free)
[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)
[mpd-codegraph] init status=marker ...
[mpd-silicon-bootstrap] skill corpus served from .../my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
[mpd-bootstrap] skill corpus served from .../my-power-dsh/skills (provider mpd-bundle, bundle 0.3.2)
CodeGraph MCP skipped: project excluded by OMO CodeGraph policy.

dsh: AUTH: Authentication Fails, Your api key: ****ummy is invalid
```

- **B1 `service "mpdDsh" has been registered` → ABSENT (0 occurrences).** Eliminated; this is
  the task's purpose and it holds.
- **B2 `tool "mpd_verif_venv" is already registered` → ABSENT (0 occurrences).** The contract
  allows two cases and asks which one applied. Measured at this timestamp: **t5 has already
  landed** — `packages/mpd-verif-plugin/` no longer exists in the source project and its patch
  claims no `mpd-verif` row (`grep -c mpd-verif cordis.patch.yml` → 0). So the second case
  applies: B2 vanished because the duplicate registrant is gone, **not** because this task
  removed it. Ownership stays `t5`.
- Both adapters mounted concurrently under distinct service names, both skill providers
  registered, boot reached the LLM call; the only failure is the deliberate dummy key.

Raw log: `coexistence-raw/t18-coexist-retest.log`.

## Closing gates

```
node scripts/pack-silicon.mjs --fix     → exit 0 (130 files checked; forced 755: 4)
node scripts/pack-silicon.mjs --check   → exit 0 (every committed file readable)
node scripts/verify-corpus.mjs          → exit 0 (10 passed, 3 skipped — the strip skips above)
node scripts/verify-rows-disjoint.mjs   → exit 0
node scripts/verify-rows-disjoint.mjs --self-test → exit 0
bun test packages                       → 130 pass / 0 fail / 1 skip
find . -type f -perm 600                → 0
```
