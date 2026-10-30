# t5 corpus-gate cross-check — independent verification of the silicon skill-corpus gate

**This is an INDEPENDENT cross-check, not the script's own self-report.** Every number
below was recomputed outside `verify-corpus.mjs` — the manifest was re-hashed with a
standalone Python reader, and the gate's exit codes were read from real process exits.

- Date: 2026-09-13
- Repo checked: `/root/dshProj/my-power-dsh-silicon` (not yet a git repo; `.git` belongs to t10)
- Gate under check: `scripts/verify-corpus.mjs`
- Context: this repo is the receiving side of the RTL strip from
  `/root/dshProj/my-power-dsh` (commit `12291a7`, the amended `f2dd7d7`).
- Authorization: captain, this session — "请写那份独立核验报告 … 明确授权你写 silicon 侧的
  `evidence/verification/t5-corpus-gate-crosscheck.md`（只写这一个文件）".

---

## 1. Why this check exists

The strip deletes the same three RTL trees (`rtl-ip-flow`, `rtl-codestyle`, `rtl-verif`,
35 files) from the **source** repo that this repo holds as its corpus. Before the fix, the
gate's fidelity check consulted the source checkout as its only baseline, so the strip
turned this repo's own corpus gate red — permanently, because the source trees are gone on
purpose. A gate that can never go green carries no information; a gate repaired by simply
skipping the check would carry none either. The repair therefore had to move the baseline
**inside this repo** while keeping the check falsifiable, and that is what this document
verifies.

## 2. Independent verification of the pinned baseline

The baseline lives at `evidence/verification/corpus-baseline.json`
(`scripts/verify-corpus.mjs:46`, overridable with `MPD_CORPUS_BASELINE`).
The following reader does **not** import the gate — it re-reads the manifest and re-hashes
the bytes on disk:

```python
import json, hashlib, os
m = json.load(open("evidence/verification/corpus-baseline.json", encoding="utf-8"))
trees = m.get("trees", m)
bad, n, per_tree = [], 0, {}
for tree, entries in trees.items():
    files = entries.get("files", entries) if isinstance(entries, dict) else entries
    per_tree[tree] = len(files)
    for rel, meta in files.items():
        want = meta.get("sha256") if isinstance(meta, dict) else meta
        path = os.path.join("skills", tree, rel)
        got = hashlib.sha256(open(path, "rb").read()).hexdigest()
        n += 1
        if got != want:
            bad.append(f"{tree}/{rel}")
print(f"manifest entries: {n} | mismatches: {len(bad)}")
print("per-tree:", per_tree)
print("top-level keys:", list(m.keys()))
print("OK: every manifest sha256 matches the bytes on disk" if not bad else "MISMATCH: " + ", ".join(bad))
```

Output (verbatim):

```
manifest entries: 35 | mismatches: 0
per-tree: {'rtl-ip-flow': 9, 'rtl-codestyle': 6, 'rtl-verif': 20}
top-level keys: ['schema', 'note', 'generatedFrom', 'trees']
OK: every manifest sha256 matches the bytes on disk
```

- **35 manifest entries, 0 mismatches** — the pinned baseline matches the shipped bytes
  exactly, checked outside the gate.
- Per-tree counts 9 / 6 / 20 = 35. (A figure of "28 or 29" appeared in one captain message;
  the captain has since confirmed **35** is correct and recorded the miscount as his own.)
- Manifest structure: top-level `schema`, `note`, `generatedFrom`, `trees`; `trees.<name>.files.<relpath>.sha256`.

## 3. Gate outputs (raw, with exit codes)

`node scripts/verify-corpus.mjs` → **exit 0**

```
[verify-corpus] root: /root/dshProj/my-power-dsh-silicon | corpus: .../skills | files: 35
[verify-corpus] fidelity baseline: .../evidence/verification/corpus-baseline.json | source cross-check: /root/dshProj/my-power-dsh/skills
  PASS  skills/ holds exactly the three RTL trees (rtl-codestyle, rtl-ip-flow, rtl-verif)
  PASS  rtl-ip-flow: all 9 required files present
  PASS  rtl-codestyle: all 6 required files present
  PASS  rtl-verif: all 20 required files present
  PASS  corpus file count 35 >= 35
  PASS  rtl-ip-flow: 9 files match the committed baseline (sha256, source rev 3d99718)
  PASS  rtl-codestyle: 6 files match the committed baseline (sha256, source rev 3d99718)
  PASS  rtl-verif: 20 files match the committed baseline (sha256, source rev 3d99718)
  PASS  text hygiene: all 35 files are LF-only UTF-8
  PASS  provider "silicon-bundle" loads all 3 skills: rtl-codestyle, rtl-ip-flow, rtl-verif
  SKIP  fidelity cross-check: tree rtl-ip-flow is not present in the source checkout at /root/dshProj/my-power-dsh/skills (expected after the RTL strip)
  SKIP  fidelity cross-check: tree rtl-codestyle is not present in the source checkout at ... (expected after the RTL strip)
  SKIP  fidelity cross-check: tree rtl-verif is not present in the source checkout at ... (expected after the RTL strip)
[verify-corpus] PASS — 10 check(s) passed, 3 skipped
```

`node scripts/verify-corpus.mjs --self-test` → **exit 0**

```
  self-test: PASS (8 negative controls caught, 2 healthy controls clean)
[verify-corpus] PASS — 10 check(s) passed, 3 skipped
```

The two modes are distinguishable in the output itself: the self-held baseline is reported
as `match the committed baseline (sha256, source rev 3d99718)`, while the source cross-check
degrades to an explicit `SKIP … (expected after the RTL strip)` per tree. A green run can
therefore never be mistaken for "cross-checked against the source" when the source is absent.

## 4. Line-level evidence for the three repair requirements

- **(a) per-tree judgement instead of whole-directory skip** —
  `scripts/verify-corpus.mjs:232`:
  `skipped.push(`fidelity cross-check: tree ${tree} is not present in the source checkout at ${SOURCE_SKILLS} (expected after the RTL strip)`)`.
  Each tree is decided on its own; the run stays green and says why.
- **(b) in-repo pinned baseline, self-proving when the source is absent** —
  `:46` `const BASELINE_PATH = process.env.MPD_CORPUS_BASELINE || join(repoRoot, "evidence", "verification", "corpus-baseline.json")`;
  `:206` baseline file-list comparison; `:209-213` per-file sha256 against the baseline and the
  success line `:213` `… files match the committed baseline (sha256, source rev …)`;
  the source cross-check remains as an additional layer (`:240`, `:243-244`).
- **(c) semantic matching instead of a frozen substring** — `:377`
  `problem.includes("differ from the committed baseline")` for the tampered-byte control;
  the same pattern is used by the two controls added on top of the original design:
  `:387` (whole tree missing) and `:392` (baseline missing/unreadable).

## 5. Falsifiability: 8 negative controls, not 7

Control groups, by source line: `:345` healthy corpus (must pass) · `:353` missing required
file · `:361` stray foreign corpus dir · `:369` tampered byte (self-held baseline) ·
`:380` whole tree missing (self-held baseline) · `:390` absent baseline must fail loudly ·
`:395` CRLF file · `:404` frontmatter outside the provider subset · `:420` skill loses
`description` · `:434` healthy provider lists all three skills.

That is **8 negative controls + 2 healthy controls** in the reported total. The count rose
from the 7 shipped with the original script, and the two additions (`:380`, `:390`) guard
exactly the failure mode this repair introduces — a baseline that is missing or that has
silently lost a tree. **The gate was strengthened, not loosened**: no assertion was removed,
no case was skipped, and a green run still requires all 35 files to hash-match.

## 6. File-mode normalization (environment: new files default to 600)

The environment writes new files with mode 600 regardless of `umask` (0022), so the write of
this very report needed the repo's idempotent fixer. Sequence, run in this order:

```
$ node scripts/pack-silicon.mjs --fix
[pack-silicon] fix: 128 files (chmod 644: 0, forced 755: 4, already 644: 124)
[pack-silicon] check PASS: every committed file is readable by a non-root consumer
$ node scripts/pack-silicon.mjs --check
[pack-silicon] check PASS: every committed file is readable by a non-root consumer
$ node scripts/pack-silicon.mjs --self-test
[pack-silicon] self-test PASS: control group: a 700 executable is normalized to 755
[pack-silicon] self-test PASS: control group: the 600 fix is counted, not silently skipped
[pack-silicon] self-test PASS: control group: no file stays unreadable after normalization
[pack-silicon] self-test PASSED: package-set guards are falsifiable and mode normalization is proven (600 -> 644, 755 preserved)
```

`--fix` is idempotent and `--check` passes immediately afterwards; `--self-test` proves the
normalizer is falsifiable (700 → 755, 600 counted, nothing left unreadable).

## 7. Corrections recorded against the transit chain (not against this repo)

Two figures used in earlier planning messages do not match the repository state. They are
recorded here so the final ledger (t10) and the follow-up tasks start from measurements:

1. **The corpus file count is 35** (9 + 6 + 20), not 28/29 — captain-confirmed.
2. **`VENDOR_LOCK.json` in the SOURCE repo is currently `331`, not `366`.** Commit
   `12291a7` (the amended `f2dd7d7`) already carries re-pin #1 of 2 under the captain's F4
   ruling: `assets.skills.fileCount 366 → 331`, `treeSha 3259d07a… → 23e18d7c…`, measured and
   independently recomputed, with `node scripts/verify-vendor.mjs` exiting 0 afterwards.
   Consequently the follow-up convergence (`t17`: delete the 2 orphan lsp-setup HDL READMEs
   and re-pin) computes from the **current lock value 331**, i.e. **331 − 2 = 329**, and not
   from the pre-re-pin 366 (`366 − 37 − 2 = 327`). The gate value must again come from the
   script's own output, never from a hand-written number.

## 8. Scope statement

This document is the only file written by the cross-check. It contains no implementation
change to this repo (no package, patch, corpus, or script edit beyond the mode normalization
described in §6), and the source repo `/root/dshProj/my-power-dsh` was not modified by it.
`scripts/pack-silicon.mjs` was **not** run against the source repo — it exists only here, and
its package-set manifest does not describe the source repo's 22 package directories.
