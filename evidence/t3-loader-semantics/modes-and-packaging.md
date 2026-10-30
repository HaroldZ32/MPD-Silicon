# File modes and packaging — measured results

Two closing items from the captain, both verified with executed commands. This file is the
raw record; the summary lives in the t3 completion report.

## 1. Mode normalization (working tree + artifact)

### What was wrong

The captain measured 9 files at mode 600 in `skills/` (all of `skills/rtl-ip-flow/`:
`SKILL.md` + the 8 template files). A deeper sweep found the problem was **wider than
`skills/`** — this repo's whole working tree carried 600 bits on files created by tooling
whose default mode is 600 (the files this task wrote: `README.md`, `README.zh-CN.md`,
`LICENSE*.md`, `package.json`, the scripts, the patch, the presets, and all of `evidence/`).

```
$ find . -type f -not -path './dist/*' -not -path './.git/*' -not -path './node_modules/*' -not -perm -044 | wc -l
20            # before
$ find . -type f ... ! -perm -111 -exec chmod 644 {} +
$ find . -type f -not -path './dist/*' -not -path './.git/*' -not -path './.mpd/*' -not -path './node_modules/*' -not -path './.toolchain/*' -not -perm -044 | wc -l
0             # after
$ find . -type f -not -path './dist/*' ... -not -path './.mpd/*' ... -printf '%m\n' | sort | uniq -c
    113 644    # every committed file; no 600, no stale execute bits
```

The captain's exact command reads 0 as well:

```
$ find skills -type f -perm 600 | wc -l
0
```

Two follow-on files appeared DURING this work — `docs/dependency-map.md`, then
`docs/dependency-map.zh-CN.md`, both written 600 by another task — and were normalized the
same way. That is exactly why `--check` walks the **whole tree** instead of a hand-listed
set of directories: the first version checked `skills/`, `presets/`, `packages/`, `scripts/`
and the root files, and would have gone green while `docs/` shipped unreadable.

The only non-644 modes left anywhere are inside `.mpd/` (32 × 444 git objects, 14 × 755 git
hooks) — ignored local plugin state, never committed.

Readability is measured as `mode & 0o044 === 0o044` (group **and** other read), which is
what a non-root clone consumer needs — not just "not 600". Execution bits were never
touched: any file carrying `0o111` was left alone (there are none in the committed tree).

### Content was not altered

`chmod` changes metadata only, and the three RTL skills are still byte-identical to their
source copies (whole-directory sha256 over sorted relative paths):

```
rtl-codestyle  1652a8961ff45ec506ace1726714ae80df55d7120971bd0f5c867f033ee5858b  both repos
rtl-verif      3b16877d516dd5200b4851ff044cf326065f205604edc01f8f15b94b2594e31b  both repos
rtl-ip-flow    864e4cf769911a2c259717a24f256c0883e74073c903a84a6081940bcb081c1d  both repos
```

### Executable bits: exactly four files

Every gate script carries a shebang, so the four directly-runnable scripts are set to 755
and the normalization preserves that bit instead of flattening it to 644:

```
$ find . -path ./.git -prune -o -path ./.mpd -prune -o -path ./node_modules -prune -o -path ./dist -prune -o -type f -perm -u+x -print | sort
./scripts/build.mjs
./scripts/pack-silicon.mjs
./scripts/verify-corpus.mjs
./scripts/verify-rows-disjoint.mjs
```

Only those four; the 15 other `u+x` files in a raw `find` are git hook samples inside the
ignored `.mpd/` local state (a linked repo), which is never committed.

### The default-mode trap and why the fix is a gate, not a one-off

The shell `umask` here is already `0022`, so the 600 modes were **not** a umask artifact:
the file-writing tool creates files 600 regardless. That is why normalizing once is not a
durable answer — every later file written by the same route starts at 600 again. Hence
`--fix` (idempotent) plus `--check` as a gate rather than a single chmod sweep.

### `scripts/pack-silicon.mjs`

Adopts the source project's `pack-mpd.mjs` `normalizeModes` precedent: **stat first, never
a blind chmod** — regular files become 644, anything already carrying an execute bit stays
755. Two modes:

```
$ node scripts/pack-silicon.mjs --check
[pack-silicon] check PASS: every committed file is readable by a non-root consumer   [exit 0]

$ node scripts/pack-silicon.mjs
[pack-silicon] modes normalized: 48 files (chmod 644: 0, kept/forced 755: 0, already 644: 48)
[pack-silicon] patch decoupled: 0 plugin path group(s) rewritten to @mpd-dsh/silicon/packages/...
[pack-silicon] staged package -> <repo>/dist/silicon-package                         [exit 0]
```

`--check` failed BEFORE the fix (it listed the 600-mode offenders and exited 1) and passes
after — so the gate is proven to bite, not a vacuous green. Re-proved directly by planting a
600-mode file in a scratch directory the checker had never been told about:

```
$ printf 'x\n' > probescratch/x.md && chmod 600 probescratch/x.md
$ node scripts/pack-silicon.mjs --check
[pack-silicon] UNREADABLE 0600 probescratch/x.md
[pack-silicon] FAIL: 1 file(s) above must be readable by a non-root consumer; fix with: ...   [exit 1]
```

The stage step additionally hard-fails on: a missing `packages/*/dist` (a bundle must never
ship a plugin-less row), a missing asset directory (`skills`/`presets`, which the rows serve
by reference), and any surviving checkout-absolute path in the packed patch
(`grep -c "/root/dshProj" dist/silicon-package/cordis.patch.yml` → 0).

### `--fix`: the concurrency-safe remediation

While this work ran, other tasks kept landing files in the same tree
(`docs/dependency-map.md`, `docs/dependency-map.zh-CN.md`, `docs/sync-policy.md`) with the
same 600 default mode, so a one-time chmod is not a durable answer. `--fix` normalizes the
committed tree and then re-runs the check, so any later task can repair the tree in one
command instead of discovering a red gate at commit time:

```
$ node scripts/pack-silicon.mjs --fix
[pack-silicon] fix: 111 files (chmod 644: 0, forced 755: 0, already 644: 111)
[pack-silicon] check PASS: every committed file is readable by a non-root consumer   [exit 0]
```

**Coordination note for t5/t10/t11/t13:** a file created by a tool defaults to mode 600 in
this environment, and `--check` (hence any commit-time gate) fails on any such file — not
only on `skills/`. Run `node scripts/pack-silicon.mjs --fix` before committing; it is
idempotent and never touches `.mpd/`, `dist/`, or `node_modules/`.

### The packed artifact installs and boots

`dist/silicon-package` (48 files, all 644) installed into a fresh `DSH_HOME`:

```
$ dsh plugin --profile silicon-packed add <repo>/dist/silicon-package    [exit 0]
$ dsh --profile silicon-packed --dump-config                             [exit 0, stderr empty]
- id: silicon-dsh-adapter
  name: '@mpd-dsh/silicon/packages/mpd-dsh-adapter-plugin/dist/index.js'
- id: silicon-bootstrap
  name: '@mpd-dsh/silicon/packages/mpd-silicon-bootstrap-plugin/dist/index.js'
- id: silicon-verif
  name: '@mpd-dsh/silicon/packages/mpd-verif-plugin/dist/index.js'
- id: silicon-mcp-lsp
```

Every path the patch names resolves inside the installed profile, and the corpus/preset
assets travel with it:

```
OK  packages/mpd-dsh-adapter-plugin/dist/index.js
OK  packages/mpd-silicon-bootstrap-plugin/dist/index.js
OK  packages/mpd-verif-plugin/dist/index.js
OK  skills/  (corpus served)
OK  presets/rtl-ip.profile.json  (t15 data file)
```

A real boot (base + headless + the PACKED bundle, no mpd) mounts and serves the corpus
**from the packed location**:

```
[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)
[mpd-silicon-bootstrap] skill corpus served from .../dist/silicon-package/skills (provider silicon-bundle, bundle 0.1.0)
dsh: AUTH: Authentication Fails, Your api key: ****ummy is invalid   # deliberate dummy key = the only failure
```

## 2. Root `.gitignore`

`t1` drafted one and removed it as out-of-bounds (`t5`'s scope does not include silicon root
dotfiles), so ownership moved here. The rule set is proven against a throwaway git repo —
the silicon repo itself is NOT initialized (that is t10's job):

```
committed packages/mpd-verif-plugin/dist/index.js     # bundle rows load dist directly
committed skills/rtl-verif/SKILL.md                   # corpus
committed packages/mpd-bundle/cordis.patch.yml        # the patch itself
committed presets/rtl-ip.profile.json                 # t15 data
committed scripts/verify-rows-disjoint.mjs            # shipped gate
committed README.md
IGNORED   node_modules/foo/index.js
IGNORED   dist/silicon-package/cordis.patch.yml       # packer staging
IGNORED   .mpd/team/mpd-default/team.json             # local plugin state
IGNORED   .tmp-cache/x
IGNORED   .venv-rtl/bin/python
IGNORED   .toolchain/node_modules/.bin/sg
IGNORED   .qa-tmp/a
```

The one non-obvious rule: `/dist/` is **anchored** (leading slash + trailing slash) so it
matches only the top-level packer output directory and never `packages/*/dist`, which must be
committed. An unanchored `dist/` would silently drop every plugin artifact and ship a bundle
whose rows cannot load. Verified above: `packages/.../dist/index.js` is not ignored.

## 3. Package-set guards — captain-authorized NEW guards

`Senior Engineer` found a false-green in the source packer's shape (which this packer
adopts): `main()` is `rmSync(outDir) → cpDist() → cpAssets()`, and `cpDist()` only checks
"a package ON THE LIST has no dist". It never checks the converse. A package that left the
list but stayed in the tree would be copied out and shipped inside a supposedly stripped
bundle while every other gate stayed green.

Two **new** guards were added (explicitly not a softening of an existing guard):

### Guard A — package-set guard (staging tree)

`packageSetViolations(stagingRoot)`: every listed package must have a `dist`, and the
staged `packages/` must contain **no directory outside the list**. The missing-dist half
keeps the source packer's behaviour; the extra-package half is the new one.

### Guard B — source-leak guard (source tree) — added after measurement changed the design

Guard A alone cannot fire for the leading indicator. Measured: with a stray package planted
in the **source** `packages/`, the real `stage()` exited **0** and produced a clean payload —
because `cpDists()` copies one listed name at a time and never enumerates `packages/*`. So
the leftover a strip leaves behind (plugin removed from the list, directory not removed) is
inert today and would only ship after some future change made the copy step enumerate the
directory. Guard B asserts the source `packages/` holds exactly the listed plugins plus
`packages/mpd-bundle`, so the leftover fails loudly at pack time next to the change that
created it.

The first version of Guard B used `PLUGIN_PKGS` as its allow-list and immediately flagged
`packages/mpd-bundle` — a legitimate directory that holds the bundle patch but is not a
plugin package. The guard was corrected to the union `PLUGIN_PKGS ∪ {mpd-bundle}`. Worth
recording: the guard's first real run was a false positive that its own output made obvious.

### Evidence — normal pack (exit 0)

```
$ node scripts/pack-silicon.mjs
[pack-silicon] package set guard PASS: exactly 3 listed package(s), no extras (mpd-dsh-adapter-plugin, mpd-silicon-bootstrap-plugin, mpd-verif-plugin)
[pack-silicon] modes normalized: 48 files (chmod 644: 0, kept/forced 755: 0, already 644: 48)
[pack-silicon] patch decoupled: 0 plugin path group(s) rewritten to @mpd-dsh/silicon/packages/...
[pack-silicon] staged package -> <repo>/dist/silicon-package                       [exit 0]
```

### Evidence — control group FAILS (the guard is falsifiable)

Fixture control group (`--self-test`), which stages a payload that really contains an
unlisted package and asserts the guard rejects it:

```
$ node scripts/pack-silicon.mjs --self-test
[pack-silicon] self-test PASS: control group: an unlisted package (mpd-stripped-plugin) is caught
[pack-silicon] self-test PASS: control group: the guard reports the unlisted package as a violation
[pack-silicon] self-test PASS: control group: stage() would be rejected
[pack-silicon] self-test PASS: clean payload: no unlisted packages
[pack-silicon] self-test PASS: clean payload: no violations at all
[pack-silicon] self-test PASS: clean payload: stage() would be accepted
[pack-silicon] self-test PASS: missing-dist: a listed package without dist is caught
[pack-silicon] self-test PASS: control group: a source-tree leftover package is caught
[pack-silicon] self-test PASS: clean source tree: no leak reported
[pack-silicon] self-test PASSED: package-set guards are falsifiable                [exit 0]
```

Real-flow control group (not a fixture: a stray package planted in the actual source tree,
then the actual pack command):

```
$ ln -s mpd-verif-plugin packages/mpd-stripped-plugin
$ node scripts/pack-silicon.mjs
[pack-silicon] FAIL: source packages/ contains director(y/ies) outside the shipped list:
  mpd-stripped-plugin
  listed: mpd-dsh-adapter-plugin, mpd-silicon-bootstrap-plugin, mpd-verif-plugin
  a stripped package must be REMOVED from the source tree, not only from PLUGIN_PKGS
                                                                                   [exit 1]

$ rm -f packages/mpd-stripped-plugin && node scripts/pack-silicon.mjs
[pack-silicon] staged package -> <repo>/dist/silicon-package                       [exit 0]
```

One honest note on the control-group fixture: its first version planted `mpd-verif-plugin`
as the "unlisted" package. That is **listed** — silicon ships it — so the guard correctly
reported no offender and the fixture failed. The fixture was renamed rather than the guard
weakened, which is the right direction of fix: the listed set decides, not intuition. That
failure is also the proof that Guard A is not "always red".

## 4. Mode-normalization control group — captain-authorized NEW guard

The mode rule ("regular 644, keep an existing execute bit at 755") is only trustworthy if it
has been observed doing both things on a tree it did not build. `--self-test` therefore
constructs one in a temp dir and asserts the outcomes:

```
$ node scripts/pack-silicon.mjs --self-test
[pack-silicon] self-test PASS: control group: a 600 file is normalized to 644
[pack-silicon] self-test PASS: control group: a nested 600 file is normalized too
[pack-silicon] self-test PASS: control group: an existing 755 bit is preserved
[pack-silicon] self-test PASS: control group: a 700 executable is normalized to 755
[pack-silicon] self-test PASS: control group: the 600 fix is counted, not silently skipped
[pack-silicon] self-test PASS: control group: no file stays unreadable after normalization
```

The fixture writes one 600 file at the top level, one 600 file nested, one 755 script and one
**700** script (an odd execute mode, to prove the rule normalizes rather than merely
preserving). Both halves are asserted on purpose: checking only "600 → 644" would leave the
half that protects runnable scripts untested.

`--fix` also refuses to flatten those bits — the counters distinguish the two outcomes:

```
$ node scripts/pack-silicon.mjs --fix
[pack-silicon] fix: 112 files (chmod 644: 0, forced 755: 4, already 644: 108)
[pack-silicon] check PASS: every committed file is readable by a non-root consumer   [exit 0]
```

and the execute bit survives staging, so a consumer can run the shipped gate directly:

```
$ stat -c '%a %n' dist/silicon-package/scripts/verify-rows-disjoint.mjs
755 dist/silicon-package/scripts/verify-rows-disjoint.mjs
```


