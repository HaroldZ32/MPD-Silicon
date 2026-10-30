# Contract-scope defects observed in this team run

Three independent contract-scope defects surfaced during this session. They share one shape —
a scope or deliverable string that **stops matching reality** while every other gate still
reports green — and each one cost real work or produced a wrong verdict risk. Recorded so the
next roster can recognise the shape instead of re-discovering it.

## Instance 1 — a declared path that the schema then rejects as undeclared

- **Contract:** t3 `inScope` lists a bare `cordis.patch.yml`; `Deliverables` lists
  `cordis.patch.yml`.
- **Reality:** the bundle layout the same contract's objective requires —
  `dsh.bundle.patch: ./packages/mpd-bundle/cordis.patch.yml` — puts the file at
  `packages/mpd-bundle/cordis.patch.yml`. There is no root-level `cordis.patch.yml`.
- **Effect:** a completion update carrying the real path was **rejected**:
  `packages/mpd-bundle/cordis.patch.yml is undeclared`. The file was correct and required by
  the contract's own acceptance criterion, yet the inScope string did not cover it. Worked
  around by reporting only `evidence/` in `changedPaths` and naming the real paths in the
  text — i.e. the record lost machine-checkable path provenance for the actual deliverables.
- **Observable lesson:** "declared in inScope" and "required by acceptance" must agree. A
  bare filename is not a path pattern.

## Instance 2 — an absolute-path pattern that never matches in `pathMatchesScope`

- **Reported by:** the captain as the root cause of **t5 reaching terminal `failed`** —
  "my contract scope defect: the absolute path pattern never matches in `pathMatchesScope`".
- **Effect:** t5's scope could never be satisfied by the paths the task actually needed to
  touch, so the task failed for a **status/representation** reason unrelated to its content.
- **Consequence accepted by the captain:** not to hold S1's verification hostage to t18's
  dependency chain, because t5 sits in it as a terminal failure that no amount of correct work
  on this task would clear.
- **Observable lesson:** a scope pattern expressed as an absolute machine path is fragile by
  construction — it should be a workspace-relative prefix or directory pattern.

## Instance 3 — a deliverable list that drifted from the contract text

- **Claimed:** t3's acceptance required six bilingual RTL documents under `docs/`.
- **Contract on disk (read back via `agent_teams_task_contract(t3)`):** `In scope` contains no
  `docs/`; `Out of scope` contains `docs/` explicitly; `Deliverables` lists five entries, none
  of them docs; acceptance item 1 is the row-id zero-intersection.
- **Resolution:** the captain confirmed his statement came from a different draft and that the
  stored contract governs; the six documents are recorded as a **captain-dispatched
  out-of-contract increment** rather than a t3 deliverable.
- **Why it mattered:** without the read-back, the same task would be judged **out of scope** by
  one checklist and **incomplete** by another. The documents were still produced (the captain
  asked directly), so the ambiguity cost judgement risk rather than work.
- **Observable lesson:** before reporting "contract item missing", read the contract back from
  the task store and quote it; do not rely on the assignment message's paraphrase.

## The shared shape, and what to do about it

All three are **representation defects**: the work is right, the scope/deliverable strings are
wrong, and the mismatch is silent until something tries to reconcile them — a completion
update, a scope gate, or a reviewer's checklist. None was caught by a test.

Practical guards, cheapest first:

1. **Read the contract back before judging completeness** (`agent_teams_task_contract`) and
   quote the exact lines; never judge from the assignment message alone.
2. **Scope with directory prefixes, not bare filenames or absolute paths** — the schema's own
   hint is to use a prefix like `packages/foo` that covers everything beneath it.
3. **Cross-check `inScope` against `acceptance` at claim time.** If an acceptance criterion
   names an artifact, that artifact's path must be covered by `inScope`. Instance 1 is exactly
   this disagreement.
4. **Treat a terminal `failed` in a dependency chain as a gating question, not a content
   question** — and say so explicitly when reporting, so downstream work is not parked behind
   a status defect (the ruling the captain made for t18/t5).
