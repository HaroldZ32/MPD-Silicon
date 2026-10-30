# silicon × mpd coexistence — measured collision classes and boot evidence

Status: **RESOLVED — both bundles now boot together.** All three collision classes that
originally made a shared profile fatal are closed: S1 (service name, captain-approved, fixed
here), B2 (t5 removed mpd's `mpd-verif` row), B3 (MCP `serverName`, fixed here). The current
both-bundles boot reaches the LLM call with both adapters mounted and both skill providers
registered, and zero occurrences of `has been registered` / `already in use` /
`already registered` / `plugin tree failed` / `Cannot find module`.
See §6 for the closing run and §7 for the deliberate divergence this required.

Historical record (kept because each class's evidence is the reason the guards exist):
three independent, FATAL collisions appeared the moment both bundles were mounted in one
profile — one mpd-side singleton, one tool-name overlap, one global MCP namespace.

All probes: `DSH_HOME=$(mktemp -d)`, real `~/.dsh` untouched, profile `probe` =
`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + both bundles installed with
`dsh plugin --profile probe add <repo>`. Raw logs: `coexistence-raw/`.

## 1. Row-id level: PASS

`dsh --profile probe --dump-config` with both bundles installed:

- composed rows: 4 × `silicon-*` + 22 × mpd insert rows + `agent-teams`, **each appearing
  exactly once**
- `duplicate loader entry id` occurrences: **0**
- the only warning is mpd's own, expected in a base-only profile:
  `dsh: [@mpd-dsh/mpd] patch: entry "agent-presets" not found` (the row is inserted by
  dsh-web-app's patch, which this probe profile does not include)

`node scripts/verify-rows-disjoint.mjs` → exit 0 (silicon 4 ids, mpd 23 ids, intersection ∅).

## 2. Boot level: three FATAL collision classes

Booting both bundles with NO override fails three ways in one run
(`coexistence-raw/boot-A-adapter-collision.log`, distinct failures extracted):

| # | Failure | Owner | Status |
|---|---------|-------|--------|
| **B1** | `service "mpdDsh" has been registered at <mpd-dsh-adapter>` | mpd + silicon adapter rows | **BLOCKER — needs mpd-side or t1-owned change** |
| **B2** | `tool "mpd_verif_venv" is already registered` | mpd-verif ↔ silicon-verif | expected pre-strip window; t5 removes mpd's row |
| **B3** | `mcp-client: serverName "lsp" is already in use by another mcp-client instance` | our `silicon-mcp-lsp` | **FIXED here** → `serverName: silicon_lsp` |

### B1 — the `mpdDsh` singleton (why it is a blocker)

`packages/mpd-dsh-adapter-plugin/src/index.ts` ends its `apply()` with
`ctx.provide(SERVICE_NAME, adapter)`, `SERVICE_NAME = "mpdDsh"`. Cordis services are
**single-provider**: the second `provide` of the same name aborts the whole plugin tree.
The silicon bundle must ship its own adapter (the standalone-install requirement —
`@mpd-dsh/silicon` must boot with no `@mpd-dsh/mpd` on disk, otherwise the bundle is a
sub-plugin in disguise), and that copy is currently **byte-identical** to mpd's
(`sha256 7045c652…f933` on both). Mounting both therefore always collides.

Fix options (t3's boundary stops at the silicon patch — the two `src/index.ts` files and
their dists are t1-owned):

- **(S1, recommended)** in the silicon copy only, rename the service
  `mpdDsh` → `siliconDsh`, and have `mpd-silicon-bootstrap-plugin` and
  `mpd-verif-plugin` prefer it:
  `ctx.get("siliconDsh") ?? ctx.get("mpdDsh") ?? createDshAdapter(ctx)`.
  Small, in-bundle, keeps standalone boot AND coexistence, no plugin-body change.
- **(S2)** silicon mounts no adapter row and hard-depends on mpd's service — rejected:
  breaks `@mpd-dsh/silicon` standalone install and the "no dependency on
  `@mpd-dsh/mpd`" coverage item.
- **(S3)** make the adapter idempotent (`if (ctx.get(SERVICE_NAME)) return`) — rejected:
  the second pack would then silently use the first bundle's copy and the two bundles
  could drift, hiding which adapter a plugin actually talks to.

### B2 — verif tool names (CLOSED by t5's strip)

Originally both bundles registered `mpd_verif_*` (required naming). In one profile the second
mount died on `tool "mpd_verif_venv" is already registered`
(`coexistence-raw/boot-G-verif-toolname-collision.log`). Row ids are disjoint, so
`verify-rows-disjoint.mjs` cannot see this — it is a tool-name collision.

**Status now: closed, because t5 removed mpd's `mpd-verif` row.** mpd's
`packages/mpd-verif-plugin/` is gone from the working tree and its patch claims no
`mpd-verif` row, so only silicon registers `mpd_verif_*` and there is nothing to collide with.
Two consequences worth stating precisely:

- The window is **closed**, not tolerated. While both rows existed, the duplicate
  registration was a **guaranteed fatal conflict**, not a survivable state. Re-creating that
  state (an mpd profile that still registers `mpd_verif_*` plus this bundle) is fatal again.
- The collision class is **still real and still reachable**, so it needs a control that does
  not depend on the strip having happened. Measured against the CURRENT tree: a second row
  whose plugin registers `mpd_verif_*` aborts the boot —
  `failed to apply loader entry fixture-dup-verif …: tool "mpd_verif_venv" is already registered`
  (`raw-probe-output.txt` → `coexistence-raw/boot-control-dup-verif.log`). That is the
  control group for this class: it proves the class is live even though today's composition
  does not trigger it.

### B3 — MCP `serverName` is a global namespace (fixed)

`dsh-mcp-client` rejects a duplicate `serverName`. mpd's `mcp-lsp` row already owns `lsp`,
so `silicon-mcp-lsp` now declares `serverName: silicon_lsp` (tools become
`mcp__silicon_lsp__*`). Verified fix: the boot that previously died on this line now
proceeds (`boot-B2` → `boot-E`, and again in the closing run of §6).

## 3. Missing `mpd-mcp-lsp` asset: NOT graceful (row made inert)

The first attempt kept `silicon-mcp-lsp` active so t16 would only have to add assets.
Measured: a `dsh-mcp-client` row whose stdio command cannot be resolved does not degrade —
it retry-storms `Cannot find module .../mpd-mcp-lsp/dist/cli.js` and the boot never
reaches the app (timeout; 12+ identical module errors in `boot-B2`). The row is therefore
declared with `disabled: true` and an explicit t16 enable note. The row, its id, its argv
contract and its `serverName` are pinned now; t16 flips one boolean in the same commit
that lands the assets. HDL LSP is **not** deleted.

## 4. What PASSES today

- **Silicon-only isolated install** (`base + silicon`, no mpd anywhere):
  `boot-F-silicon-only-PASS.log`
  ```
  [mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)
  [mpd-silicon-bootstrap] skill corpus served from /root/dshProj/my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
  dsh: AUTH: Authentication Fails, Your api key: ****ummy is invalid
  ```
  All rows mounted, the corpus provider registered, the boot reached the LLM call
  (the dummy key is the only failure). The hang seen in early runs was NOT silicon: a
  profile with no app bundle falls back to the web app and never exits; adding
  `@deepseek-ai/dsh-headless` gives the clean exit above.

- **Both bundles coexisting** with B1/B2 rows disabled by a throwaway `--patch` overlay
  (`boot-E-coexist-PASS.log`): both bundles' rows mount, and BOTH skill providers register
  independently — no provider-name clash:
  ```
  [mpd-silicon-bootstrap] skill corpus served from .../my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
  [mpd-bootstrap]         skill corpus served from .../my-power-dsh/skills         (provider mpd-bundle, bundle 0.3.2)
  dsh: AUTH: Authentication Fails, Your api key: ****ummy is invalid
  ```
  Zero `Cannot find module`, zero `already registered`, zero `already in use`, zero
  `duplicate loader entry id` in that run.

## 5. Blocked / not yet provable

- **rtl-ip profile visibility in a real `--dump-config`: blocked-by-t15.** The data file
  this repo ships for t15 is `presets/rtl-ip.profile.json` (7 members: Requirement
  Analyst, Spec Designer, RTL Code Engineer — Verilog/SV, RTL Code Engineer — SpinalHDL,
  Verification Engineer, Reviewer, Plan Reviewer; `taskPlanning: captain`; faithful
  copy of mpd's current rtl-ip block, verified byte-equal after YAML→JSON).
  Until t15's carrier lands, no dump shows `rtl-ip`, and that is expected — not a t3
  failure.
- **mcp-lsp tools (`mcp__silicon_lsp__*`): blocked-by-t16** (assets missing). The row is
  **not deleted**: its id, argv contract and `serverName` are pinned in the patch, with
  `disabled: true` and a comment saying t16 flips that one boolean when the assets land.
  HDL LSP is a user-required capability that travels with the RTL face; disabling is a
  boot-safety measure (a missing stdio command retry-storms — §3), not a scope cut.

## 6. Closing run — both bundles, no override (S1 + t5 + B3 all landed)

```
$ DSH_HOME=<tmp> DEEPSEEK_API_KEY=dummy dsh --profile probe "say OK"      # base+headless+silicon+mpd
[mpd-dsh-adapter] siliconDsh provided (harness seams resolved lazily, inject-free)
[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)
[mpd-codegraph] init status=marker ...
[mpd-silicon-bootstrap] skill corpus served from .../my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
[mpd-bootstrap] skill corpus served from .../my-power-dsh/skills (provider mpd-bundle, bundle 0.3.2)
CodeGraph MCP skipped: project excluded by OMO CodeGraph policy.

dsh: AUTH: Authentication Fails, Your api key: ****ummy is invalid
```

That is a clean run: **both adapters mounted under distinct service names**, both skill
providers registered, and the boot proceeded to the LLM call. Counted failures in the log:
`has been registered` 0, `already in use` 0, `already registered` 0, `plugin tree failed` 0,
`Cannot find module` 0. The only failure is the deliberate dummy key.

Staging note (why the earlier B2 clause still mattered): at the time this run was made, mpd's
`packages/mpd-verif-plugin/` had already been removed from the working tree and its patch
claimed no `mpd-verif` row, so silicon was the single registrant of `mpd_verif_*`. The
both-bundles test therefore passes **because the strip landed**, and the class stays guarded
by the fixture control in §2/B2 rather than by luck.

## 7. Deliberate divergence (captain-approved)

S1 renames the service in **silicon's copy only**, so silicon's adapter is no longer
byte-identical to the source project's. Exact exception list — these three source files and
their three built dists are the ONLY files allowed to differ; everything else must still
compare byte-for-byte:

| File | Line | Change | Old → New |
| --- | --- | --- | --- |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | 446 | `SERVICE_NAME` value (**code**) | `"mpdDsh"` → `"siliconDsh"` |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | 445 | the JSDoc line above it (comment only) | `` ctx.get("mpdDsh") `` → `` ctx.get("siliconDsh") `` |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | 14 | header-prose sentence (comment only) | `` ctx.get("mpdDsh") `` → `` ctx.get("siliconDsh") `` |
| `packages/mpd-silicon-bootstrap-plugin/src/index.ts` | 348 | resolution chain (**code**) | `ctx.get("mpdDsh")` → `(ctx.get("siliconDsh") ?? ctx.get("mpdDsh"))` |
| `packages/mpd-verif-plugin/src/index.ts` | 35 | resolution chain (**code**) | same as above |
| `packages/mpd-dsh-adapter-plugin/dist/index.js` | 247 | rebuilt (`var SERVICE_NAME = "siliconDsh";`) | — |
| `packages/mpd-silicon-bootstrap-plugin/dist/index.js` | 573 | rebuilt resolution chain | — |
| `packages/mpd-verif-plugin/dist/index.js` | 1807 | rebuilt resolution chain | — |
| `packages/mpd-silicon-bootstrap-plugin/test/bootstrap.test.ts` | +2 tests | pins siliconDsh-first and mpdDsh-fallback | — |

**Measured size of the whole divergence**, `diff -u` against the mpd baseline at commit
`3d99718` (the last commit containing both ported plugins):

- `mpd-dsh-adapter-plugin/src/index.ts` → **6 changed lines** in 2 hunks: `@@ -11,7 +11,7 @@`
  (one header-prose line) and `@@ -442,8 +442,8 @@` (the JSDoc line + the `SERVICE_NAME`
  value).
- `mpd-verif-plugin/src/index.ts` → **2 changed lines** (1 hunk: the chain expression).
- `mpd-silicon-bootstrap-plugin/src/index.ts` → **1 changed line** (the chain expression).
  This package has **no mpd baseline**: it is silicon-only code written for this bundle, so
  t6/t8 must compare it against the t1/t2 port record rather than an mpd checkout.
- No other line in any of the three files differs. The log prefix `[mpd-dsh-adapter]`,
  `export const name = "mpd-dsh-adapter"`, and the rest of the adapter header are byte-identical
  to the baseline.

**What is deliberately NOT part of the divergence:** no comment was added anywhere by S1. An
earlier revision of this change carried explanatory comment blocks in the adapter header and
above both resolution chains; they were removed on the captain's instruction, because the
exception list must be exactly the value + two expressions and nothing else. The rationale
lives here, in the evidence, not in the source.

**t6's per-file comparison and t8's migration-fidelity review must admit exactly the lines
above and treat any OTHER byte difference in these files as a real finding.** `ctx.get` was
measured to return `undefined` (not throw) for an unregistered service, so the `??` chain needs
no `try/catch` — measured behaviour in `raw-probe-output.txt`.

Scope of the divergence, stated once more because it is the whole point: it exists so that
`@mpd-dsh/silicon` remains independently installable (its own adapter, no `@mpd-dsh/mpd` on
disk) while no longer colliding with mpd's adapter when both are mounted.

