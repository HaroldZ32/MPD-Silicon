# t13 — manual command verification (`AGENTS.md` §4 and its prose)

- Task: t13, executed outside the task system at the captain's request (its deps contained a
  terminal task, so it could never be scheduled). **No task was claimed.**
- Verified artifact: `/root/dshProj/my-power-dsh-silicon/AGENTS.md` §4 Gates table and every
  command its prose declares.
- Reviewer independence: the captain ran these gates once while delivering the manual; **every
  result below is my own re-run**, with raw output. I did not reuse the captain's results. The
  two errors found in §6 come from **another** member's session — I reproduce them and add
  evidence rather than citing them.
- Environment: `dsh 0.1.5-rc.1`, node v24.16.0, bun 1.3.14; iverilog 14.0 + verilator 5.051 under
  `/opt/osscad/oss-cad-suite/bin`; **`vcs` absent** (evidenced skip); provider key read at runtime
  from `~/.bashrc` (never written to any file).
- Isolation: every boot ran with a throwaway `DSH_HOME` **and** `HOME` **and** workspace
  (`/tmp/t13-qa/...`). The real `~/.dsh` was not touched.
- Deliverable discipline: this report is the only file written.

## Verdict

**pass with findings** — every command the manual declares exists, runs, and produces the
conclusion the manual attributes to it; two prose-accuracy findings (§6) and three newly measured
behaviours (§7) should be folded into the next manual edit. Nothing blocks the manual's core
claims: they all reproduced.

## 1. Gates table — command-by-command

| # | Command (as declared) | exit | Key output | Verdict |
|---|---|---|---|---|
| 1 | `bun test packages/` | 0 | `Ran 131 tests across 12 files` — **130 pass / 1 skip / 0 fail**, 845 expect() calls | **pass** (matches README's "131 / 130 / 1 declared skip") |
| 2 | `node scripts/verify-corpus.mjs` | 0 | `PASS — 10 check(s) passed, 3 skipped`; the 3 skips are the source-checkout cross-checks (`expected after the RTL strip`); `skills/` holds exactly the three trees | **pass** |
| 3 | `node scripts/verify-rows-disjoint.mjs` | 0 | silicon 4 ids (insert 4, id-target 0) vs mpd 22 ids (insert 21, id-target 1 = `agent-presets`); `PASS: silicon ∩ mpd = ∅` | **pass** |
| 4a | `node scripts/pack-silicon.mjs --fix` | 0 | `fix: 160 files (chmod 644: 0, forced 755: 4, already 644: 156)` | **pass** |
| 4b | `node scripts/pack-silicon.mjs --check` | 0 | `check PASS: every committed file is readable by a non-root consumer` | **pass** |
| 5 | `node scripts/pack-silicon.mjs --self-test` | 0 | 4 control groups PASS + `self-test PASSED` (mode normalization and package-set guards falsifiable) | **pass** |
| 6 | `node scripts/pack-silicon.mjs` | 0 | `package set guard PASS: exactly 3 listed package(s), no extras`; `modes normalized: 53 files`; `staged package -> dist/silicon-package` | **pass** |
| 7 | Boot check (MOUNT) — declared as a *concept*, verified as a runnable recipe (§4) | 0 | see §4 | **pass** |

Extra (declared in README §Gates, not in the manual's table, run anyway):
`node scripts/verify-rows-disjoint.mjs --self-test` → exit 0.

## 2. Assertion: `--dump-config` proves COMPOSITION ONLY — reproduced decisively

Constructed a profile whose rows compose identically but whose **entry cannot resolve at load**:
a /tmp copy of this repo with `packages/mpd-verif-plugin/dist/` renamed, installed into a
throwaway profile. The repository was not modified (the copy is under `/tmp`).

```
# (A) composition
$ dsh --profile missing --dump-config
exit=0    fatal keywords: 0

# (B) loading — same profile, same revision
$ dsh --profile missing --no-open --port 0
exit=1
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
       failed to import loader entry silicon-verif (@mpd-dsh/silicon/packages/mpd-verif-plugin/dist/index.js):
       Cannot find module '…/profiles/missing/node_modules/@mpd-dsh/silicon/packages/mpd-verif-plugin/dist/index.js'
```

**The manual's claim holds exactly**: the same rows, exit 0 on compose and exit 1 on load.

## 3. Assertion: "`--help` is a FALSE GREEN" — **not reproduced on this build** (finding, §6 F1)

Using the same already-proven-broken profile:

```
$ dsh --profile missing --help        → exit 1, 5 fatal-signature hits, 60 stderr lines
$ dsh --profile missing --no-open --port 0 → exit 1, 5 fatal-signature hits
```

`--help` did **not** return 0 with fatal output hidden; it surfaced the failure. What I *did*
observe instead, and what the manual does not say, is a **hang**: on a **valid** profile
`dsh --profile c3 --help` ran past 40 s without exiting (exit 124 from my timeout), i.e. `--help`
behaves like the app boot rather than a usage dump.

**What I tried**: the entry-resolution failure class (§2 profile), on two independent profiles,
with and without `--patch` overlays. I could not construct the "exit 0 + no fatal text" state on
`dsh 0.1.5-rc.1`. I therefore report the claim as **unverified on this build** rather than
falsified — the captain and another member both report the false green from their own runs, and
the practical guidance (never use `--help` as a mount signal; judge by a real boot) stays correct
and is in fact reinforced by the hang.

## 4. Assertion: coexistence and standalone boot (real boots, not dumps)

**Both bundles, one throwaway `DSH_HOME`** — `dsh --profile c3 --no-open --port 0`:

```
[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)
[mpd-dsh-adapter] siliconDsh provided (harness seams resolved lazily, inject-free)
[mpd-bootstrap] skill corpus served from …/my-power-dsh/skills (provider mpd-bundle, bundle 0.3.2)
[mpd-silicon-bootstrap] skill corpus served from …/my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
```

- services: **2** (`mpdDsh`, `siliconDsh`) · skill providers: **2** (`mpd-bundle`, `silicon-bundle`)
- `failed to apply loader entry` **0** · `already registered` **0** · `plugin tree failed to load` **0**
- exit 124 = my 100 s timeout killing a healthy long-running app; the load signals are all in the
  first seconds.

**Silicon alone (no mpd installed)** — `dsh --profile solo --no-open --port 0`:

```
[mpd-dsh-adapter] siliconDsh provided (harness seams resolved lazily, inject-free)
[mpd-silicon-bootstrap] skill corpus served from …/my-power-dsh-silicon/skills (provider silicon-bundle, bundle 0.1.0)
```

- one service, one provider, **0** fatal signatures, and **no `mpdDsh`/`mpd-bundle`** anywhere.

The manual's §4 "Boot check (MOUNT)" row is a *concept* rather than a literal command; I verified
it is executable as written, in this minimal isolation form:

```sh
DSH_HOME=$(mktemp -d); export HOME=$DSH_HOME
dsh plugin --profile P add <bundle paths…>
dsh --profile P --no-open --port 0        # judge by this exit code + stderr, never by --dump-config
```

## 5. Bundled smoke script (README §Gates:94)

```
$ PYTHONDONTWRITEBYTECODE=1 bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs
PASS mpd_verif_backends probes the toolchain — iverilog=Icarus Verilog version 14.0 …; verilator=Verilator 5.051 …; vcs=absent
PASS mpd_verif_venv status answers — verdict=missing
PASS mpd_verif_lint via verilator — exit 0, diagnostics=[]
SKIP mpd_verif_sim: no project venv carrying cocotb (verdict=missing); …
SKIP mpd_verif_uvm / vcs-coverage lane: no VCS on PATH (command -v vcs is empty) — evidenced skip, not a pass
[smoke] PASS — 3 check(s), 2 skip(s)
exit 0, 0 FAIL
```

Both skips print their premise; state went to `/tmp/mpd-verif-smoke-*`; the worktree stayed clean.

## 6. Findings (manual/prose accuracy)

**F1 (medium) — the "`--help` is a FALSE GREEN" section is not reproducible as worded on this
build, and omits a real hazard.** Measured: on a genuinely broken profile `--help` exited **1**
with 5 fatal-signature hits (it did not hide the failure), while on a valid profile it **did not
exit** within 40 s. The manual asserts the opposite exit behaviour as fact. *Required fix*: reword
to the measured behaviour — "`--help` is **not** a mount signal: on this build it either surfaces
the failure (exit 1) or hangs like a boot; a `--help` exit code must never be read as health" —
and keep the (correct) instruction to judge by a real boot. If the exit-0 manifestation is
version-specific, say so and pin the version where it was observed.

**F2 (low) — `scripts/build-lsp.mjs` exists, gates real assets, and is documented nowhere.**
Neither `AGENTS.md` nor `README.md` references it, yet it is the only check covering the HDL LSP
assets that t16 landed:

```
$ node scripts/build-lsp.mjs --check
[build-lsp] check PASS: dist/cli.js sha256 04b49f8c192d03b5… (235271 bytes) matches BUILD.lock,
            both HDL registry entries present, overlay anchor present, 2 reference docs and 4 fixtures in place
exit 0
```

*Required fix*: add it to the §4 table (when: any `packages/mpd-mcp-lsp/**` or LSP dist change).
Otherwise an edit to that overlay can pass every documented gate while the LSP dist silently
diverges from `BUILD.lock`.

## 7. Newly measured behaviours worth recording in the manual (beyond the requested checks)

1. **A plugin whose entry fails to load for a *cross-package* name is skipped silently.** With a
   `--patch` overlay rewriting a row to a non-existent dist path, both `--dump-config` (exit 0) and
   a real boot (exit 0, no error text) came up clean — yet that plugin's tools were simply absent,
   because the loader could not resolve the bare package name from the profile root. **The
   dangerous state is "green dump AND green-looking boot" from a cross-process perspective**, not
   only the `--help` case the manual warns about. Worth one sentence in §4 next to the
   composition-only warning.
2. **Disabling `silicon-dsh-adapter` no longer produces the service collision.** With that row
   `disabled: true`, both bundles still booted cleanly (3 services present, 0 fatal signatures) —
   the S1 rename makes the collision class unreachable from this direction. The collision story in
   §4's table remains correct as history, but it is no longer reproducible as a failure.
3. **`README.md:86` overstates script modes.** It claims "All four `scripts/*.mjs` files are
   directly runnable (755)". There are now **five** scripts and `build-lsp.mjs` is `644`
   (`build.mjs`, `pack-silicon.mjs`, `verify-corpus.mjs`, `verify-rows-disjoint.mjs` are 755).
   `node scripts/…` still works either way, so this is cosmetic — but it is a false statement about
   the tree, and it is the kind of sentence a future reviewer will trust.

## 8. Scope statement

Read-only verification: every command above was run with throwaway state under `/tmp/t13-qa`; the
only file written is this report; no repository content, gate, or guard was modified; the real
`~/.dsh` and `~/.bashrc` were not written to; the provider key was only read into a process-local
environment variable for boots that need it. The worktree differences after this task are this
report (mode-normalized to 644 by the packager's own `--fix`) plus files authored by other members
in their own sessions.
