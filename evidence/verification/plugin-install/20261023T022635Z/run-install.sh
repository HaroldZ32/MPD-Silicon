#!/usr/bin/env bash
# Final isolated install/boot/remove proof for @mpd-dsh/silicon 0.7.0.
#
# This record describes the FINAL tree of the packaging repair: it is executed with
# every content edit already on disk, so the tarball facts and the boot results below
# belong to the same revision that `git rev-parse HEAD` / `git diff --stat` capture.
#
# Isolation: HOME, DSH_HOME, every XDG dir, the npm cache, the pnpm store and the
# workspace cwd live under <repo>/.mpd/proof-final (workspace-local, gitignored). The
# real ~/.dsh is never read or written. PATH puts the repo's pnpm 9 first: the pnpm
# 12.x on this host dies with ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK in this sandbox.
#
# Reproducibility: the tarball is deleted with the sandbox; `npm pack` from the tree
# recorded here (HEAD + the diff) reproduces it. Facts are in npm-pack.json,
# tarball-files.txt and result.json.
#
# Usage: bash run-install.sh 2>&1 | tee output.log
set -u

REPO="/home/haroldzhao/localProj/dshProj/my-power-dsh-silicon"
EVID="$REPO/evidence/verification/plugin-install/20261023T022635Z"
SB="$REPO/.mpd/proof-final"
REGISTRY="https://registry.npmmirror.com"
MPD_SPEC="@mpd-dsh/mpd@0.15.1"
TUI_SPEC="@deepseek-harness-tui/dsh-tui@0.16.1"
TGZ="$SB/pack/mpd-dsh-silicon-0.7.0.tgz"

export HOME="$SB/home"
export DSH_HOME="$SB/dsh"
export XDG_CONFIG_HOME="$SB/home/.config"
export XDG_CACHE_HOME="$SB/home/.cache"
export XDG_DATA_HOME="$SB/home/.local/share"
export XDG_STATE_HOME="$SB/home/.local/state"
export npm_config_cache="$SB/npm-cache"
export npm_config_store_dir="$SB/pnpm-store"
export PNPM_HOME="$SB/pnpm-home"
export PATH="$REPO/.toolchain/pnpm/node_modules/.bin:$REPO/.toolchain/bin:$PATH"
export CI=1 NO_COLOR=1 DO_NOT_TRACK=1

rm -rf "$SB"
mkdir -p "$HOME" "$DSH_HOME" "$SB/work" "$SB/pack" "$SB/npm-cache" "$SB/pnpm-store" "$SB/pnpm-home" "$SB/fake-bundle"
: > "$EVID/facts.env"

fact() { echo "$1=$2" >> "$EVID/facts.env"; }

run() {
  echo
  echo "\$ $*"
  "$@"
  local code=$?
  echo "[exit=$code]"
  return $code
}

echo "# final isolated install/boot/remove proof — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# repo:    $REPO"
echo "# sandbox: $SB"
echo "# evidence:$EVID"
echo "# dsh:     $(command -v dsh)"
echo "# pnpm:    $(command -v pnpm)"

# ── 0. tool facts + tree state ──────────────────────────────────────────────
echo
echo "# ── 0. tool facts and the exact tree being measured ──"
run node --version
run dsh --version
run pnpm --version
echo "# npm: $(npm --version)"
echo "# bun: $(bun --version)"
git -C "$REPO" rev-parse HEAD | tee "$EVID/git-head.txt"
git -C "$REPO" rev-parse --abbrev-ref HEAD | sed 's/^/branch: /'
git -C "$REPO" diff --stat | tee "$EVID/git-diff-stat.txt"
git -C "$REPO" status --porcelain | tee "$EVID/git-status.txt"
fact "head" "$(git -C "$REPO" rev-parse HEAD)"
fact "branch" "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"

# ── 1. npm pack (prepack runs scripts/verify-package-files.mjs) ─────────────
echo
echo "# ── 1. npm pack --pack-destination $SB/pack (prepack guard runs first) ──"
echo "\$ ( cd $REPO && npm pack --pack-destination $SB/pack --json )"
( cd "$REPO" && npm pack --pack-destination "$SB/pack" --json > "$EVID/npm-pack.raw.log" 2> "$SB/pack/npm-pack.err" )
PACK_CODE=$?
echo "[exit=$PACK_CODE]"
# `npm pack --json` runs the prepack hook first, so its stdout (the guard's PASS line)
# precedes the JSON array. Keep the raw stream, and hand the JSON document on alone.
sed -n '/^\[$/,$p' "$EVID/npm-pack.raw.log" > "$EVID/npm-pack.json"
echo "# npm pack stderr:"
cat "$SB/pack/npm-pack.err" | sed 's/^/  /'
echo "# prepack guard line:"
head -1 "$EVID/npm-pack.raw.log" | sed 's/^/  /'
echo "# npm pack exit: $PACK_CODE"
fact "npmPackExitCode" "$PACK_CODE"
node - "$EVID/npm-pack.json" "$EVID/tarball-files.txt" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs"
const [packJson, outList] = process.argv.slice(2)
const entry = JSON.parse(readFileSync(packJson, "utf8"))[0]
writeFileSync(outList, entry.files.map((f) => f.path).join("\n") + "\n")
console.log(`# tarball: ${entry.filename}`)
console.log(`# fileCount: ${entry.files.length}`)
console.log(`# size: ${entry.size} B`)
console.log(`# unpackedSize: ${entry.unpackedSize} B`)
console.log(`# shasum(sha1): ${entry.shasum}`)
console.log(`# integrity: ${entry.integrity}`)
NODE
run sha256sum "$TGZ" | tee "$EVID/tarball-sha256.txt"
run shasum -a 256 "$TGZ" | tee -a "$EVID/tarball-sha256.txt"
run shasum "$TGZ" | tee -a "$EVID/tarball-sha256.txt"
run stat -c '%s %n' "$TGZ"
node - "$EVID/npm-pack.json" <<'NODE'
import { readFileSync } from "node:fs"
const entry = JSON.parse(readFileSync(process.argv[2], "utf8"))[0]
const files = entry.files.map((f) => f.path)
const must = [
  "packages/mpd-verif-plugin/dist/index.js",
  "packages/mpd-silicon-bootstrap-plugin/dist/index.js",
  "packages/mpd-silicon-guard-plugin/dist/index.js",
  "packages/mpd-docgen-plugin/dist/index.js",
  "packages/mpd-bundle/cordis.patch.yml",
  "skills/rtl-ip-flow/SKILL.md",
  "skills/rtl-codestyle/SKILL.md",
  "skills/rtl-verif/SKILL.md",
  "tests/golden/fixtures/verilog/modules/adder4.v",
  "tests/golden/fixtures/verilog/modules/cnt8.v",
  "packages/mpd-mcp-lsp/package.json",
  "packages/mpd-mcp-lsp/launch.mjs",
  "packages/mpd-mcp-lsp/dist/cli.js",
  "packages/mpd-mcp-lsp/dist/BUILD.lock",
  "packages/mpd-mcp-lsp/references/verilog/README.md",
  "packages/mpd-mcp-lsp/templates",
  "docs/toolchain.md",
  "docs/docgen-guide.md",
  "scripts/verify-package-files.mjs",
  "README.md",
  "README.zh-CN.md",
  "LICENSE.md",
  "CHANGELOG.md",
]
let bad = 0
for (const path of must) {
  const hit = files.includes(path) || files.some((p) => p.startsWith(path + "/"))
  console.log(`[tarball ${hit ? "PASS" : "FAIL"}] ${path}`)
  if (!hit) bad += 1
}
const forbidden = files.filter((p) => /^(packages\/[^/]+\/(src|test)\/|evidence\/|\.workflow\/|\.mpd\/|node_modules\/|scripts\/(?!verify-package-files\.mjs))/.test(p))
console.log(`[tarball ${forbidden.length === 0 ? "PASS" : "FAIL"}] no src/test/evidence/state entries${forbidden.length ? ": " + forbidden.join(", ") : ""}`)
process.exit(bad === 0 && forbidden.length === 0 ? 0 : 1)
NODE
fact "tarballChecksExitCode" "$?"

# ── 1b. the registry spec is not published (substantiates the "not measured" note)
echo
echo "# ── 1b. npm view @mpd-dsh/silicon@0.7.0 (expected 404) ──"
run npm view @mpd-dsh/silicon@0.7.0 version "--registry=$REGISTRY" > "$EVID/npm-view.log" 2>&1
NPM_VIEW_CODE=$?
echo "# npm view exit: $NPM_VIEW_CODE"
cat "$EVID/npm-view.log" | sed 's/^/  /'
fact "npmViewExitCode" "$NPM_VIEW_CODE"

# ── 2. the ONE install command ──────────────────────────────────────────────
echo
echo "# ── 2. dsh plugin add -w (one command) ──"
run dsh plugin --profile probe add -w "$MPD_SPEC" "$TGZ" "$TUI_SPEC" "--registry=$REGISTRY"
INSTALL_CODE=$?
echo "# install exit: $INSTALL_CODE"
fact "installExitCode" "$INSTALL_CODE"

PROFILE="$DSH_HOME/profiles/probe"
cp "$PROFILE/package.json" "$EVID/profile-probe.package.json"

echo
echo "# ── 2a. assertions on the installed profile and its assets ──"
node - "$PROFILE" <<'NODE'
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
const [profileDir] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"))
const installed = JSON.parse(readFileSync(join(profileDir, "node_modules", "@mpd-dsh", "silicon", "package.json"), "utf8"))
const bundles = manifest.dsh?.profile?.bundles ?? []
const deps = manifest.dependencies ?? {}
let bad = 0
const check = (name, ok, detail) => { console.log(`[assert ${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`); if (!ok) bad += 1 }

check("profile dependency @mpd-dsh/mpd present", deps["@mpd-dsh/mpd"] !== undefined, JSON.stringify(deps))
check("profile dependency @mpd-dsh/silicon present", deps["@mpd-dsh/silicon"] !== undefined)
check("installed @mpd-dsh/silicon version is 0.7.0", installed.version === "0.7.0", installed.version)
check("dsh.profile.bundles contains @mpd-dsh/mpd", bundles.includes("@mpd-dsh/mpd"), JSON.stringify(bundles))
check("dsh.profile.bundles contains @mpd-dsh/silicon", bundles.includes("@mpd-dsh/silicon"))
const root = join(profileDir, "node_modules", "@mpd-dsh", "silicon")
for (const rel of [
  "packages/mpd-verif-plugin/dist/index.js",
  "packages/mpd-silicon-bootstrap-plugin/dist/index.js",
  "packages/mpd-silicon-guard-plugin/dist/index.js",
  "packages/mpd-docgen-plugin/dist/index.js",
  "packages/mpd-bundle/cordis.patch.yml",
  "skills/rtl-ip-flow/SKILL.md",
  "skills/rtl-codestyle/SKILL.md",
  "skills/rtl-verif/SKILL.md",
  "tests/golden/fixtures/verilog/modules/adder4.v",
  "tests/golden/fixtures/verilog/modules/cnt8.v",
  "packages/mpd-mcp-lsp/launch.mjs",
  "packages/mpd-mcp-lsp/dist/cli.js",
  "packages/mpd-mcp-lsp/dist/BUILD.lock",
  "packages/mpd-mcp-lsp/references/verilog/README.md",
  "packages/mpd-mcp-lsp/templates",
  "packages/mpd-mcp-lsp/package.json",
  "scripts/verify-package-files.mjs",
  "docs/toolchain.md",
  "LICENSE.md",
]) check(`installed asset ${rel}`, existsSync(join(root, rel)))
const lspManifest = JSON.parse(readFileSync(join(root, "packages", "mpd-mcp-lsp", "package.json"), "utf8"))
check('installed LSP manifest version is not the "0" fallback', typeof lspManifest.version === "string" && lspManifest.version !== "0", lspManifest.version)
if (bad > 0) { console.error(`[assert] FAILED (${bad})`); process.exit(1) }
console.log("[assert] ALL PASS")
NODE
ASSERT_CODE=$?
echo "[assert exit: $ASSERT_CODE]"
fact "installAssertionsExitCode" "$ASSERT_CODE"

# ── 3. composition (dump-config; composition only, never health) ────────────
echo
echo "# ── 3. dsh --profile probe --dump-config ──"
dsh --profile probe --dump-config > "$EVID/dump-config.yaml" 2> "$EVID/dump-config.err"
DUMP_CODE=$?
echo "[exit=$DUMP_CODE]"
cat "$EVID/dump-config.err" | sed 's/^/  stderr: /'
SILICON_ROWS=$(grep -oE 'id: silicon-[a-z0-9-]+' "$EVID/dump-config.yaml" | sort -u)
echo "# silicon rows:"
echo "$SILICON_ROWS" | sed 's/^/  /'
SILICON_ROW_COUNT=$(echo "$SILICON_ROWS" | grep -c 'id: silicon-' || true)
echo "# silicon row count: $SILICON_ROW_COUNT (expected 5)"
echo "# mpd rows (any id starting with mpd-):"
grep -oE 'id: mpd-[a-z0-9-]+' "$EVID/dump-config.yaml" | sort -u | tr '\n' ' '; echo
fact "dumpExitCode" "$DUMP_CODE"
fact "siliconRowCount" "$SILICON_ROW_COUNT"

# ── 4. real boot (coexist) ─────────────────────────────────────────────────
echo
echo "# ── 4. real boot: timeout 40 dsh --profile probe --no-open --port 0 ──"
( cd "$SB/work" && timeout 40s dsh --profile probe --no-open --port 0 > "$EVID/boot-coexist.log" 2>&1 )
BOOT_CODE=$?
echo "[exit=$BOOT_CODE]  (124 = the app stayed alive to the deadline)"
SERVE_COUNT=$(grep -c '\[mpd-silicon-bootstrap\] skill corpus served' "$EVID/boot-coexist.log" || true)
FATAL_COUNT=$(grep -ciE '\bfatal\b' "$EVID/boot-coexist.log" || true)
echo "# serve line occurrences: $SERVE_COUNT (expected exactly 1)"
echo "# fatal lines: $FATAL_COUNT (expected 0)"
echo "# boot log tail:"
tail -12 "$EVID/boot-coexist.log" | sed 's/^/  /'
fact "bootExitCode" "$BOOT_CODE"
fact "serveLineOccurrences" "$SERVE_COUNT"
fact "fatalLines" "$FATAL_COUNT"

# ── 5. negative probe: silicon only (NO @mpd-dsh/mpd bundle) ───────────────
echo
echo "# ── 5. negative: profile probe-nompd (silicon only, no mpd bundle) ──"
run dsh plugin --profile probe-nompd add -w "$TGZ" "--registry=$REGISTRY"
NEG_INSTALL_CODE=$?
echo "# negative install exit: $NEG_INSTALL_CODE"
fact "noMpdInstallExitCode" "$NEG_INSTALL_CODE"
NPROFILE="$DSH_HOME/profiles/probe-nompd"
cp "$NPROFILE/package.json" "$EVID/profile-probe-nompd.package.json"
node - "$NPROFILE" <<'NODE'
import { readFileSync } from "node:fs"
import { join } from "node:path"
const [profileDir] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"))
const bundles = manifest.dsh?.profile?.bundles ?? []
console.log(`[assert ${bundles.includes("@mpd-dsh/mpd") ? "FAIL" : "PASS"}] negative profile has NO @mpd-dsh/mpd bundle — ${JSON.stringify(bundles)}`)
console.log(`[assert ${bundles.includes("@mpd-dsh/silicon") ? "PASS" : "FAIL"}] negative profile has @mpd-dsh/silicon bundle`)
process.exit(bundles.includes("@mpd-dsh/mpd") || !bundles.includes("@mpd-dsh/silicon") ? 1 : 0)
NODE
echo "[assert exit: $?]"

( cd "$SB/work" && timeout 40s dsh --profile probe-nompd --no-open --port 0 > "$EVID/boot-nompd.log" 2>&1 )
NEG_BOOT_CODE=$?
echo "[exit=$NEG_BOOT_CODE]  (expected 1)"
if grep -q "silicon requires @mpd-dsh/mpd: the mpdDsh service is absent" "$EVID/boot-nompd.log"; then
  echo "  OK   silicon requires @mpd-dsh/mpd: the mpdDsh service is absent"
  GUARD_LINE=1
else
  echo "  MISS guard line"
  GUARD_LINE=0
fi
NEG_SERVE=$(grep -c '\[mpd-silicon-bootstrap\] skill corpus served' "$EVID/boot-nompd.log" || true)
echo "# bootstrap line occurrences: $NEG_SERVE (expected 0)"
echo "# boot log tail:"
tail -12 "$EVID/boot-nompd.log" | sed 's/^/  /'
fact "noMpdBootExitCode" "$NEG_BOOT_CODE"
fact "guardLinePresent" "$GUARD_LINE"
fact "noMpdServeLineOccurrences" "$NEG_SERVE"

# ── 6. remove control: dependency AND bundle entry both gone ───────────────
echo
echo "# ── 6. dsh plugin --profile probe remove @mpd-dsh/silicon ──"
run dsh plugin --profile probe remove @mpd-dsh/silicon
REMOVE_CODE=$?
echo "# remove exit: $REMOVE_CODE"
cp "$PROFILE/package.json" "$EVID/profile-probe-after-remove.package.json"
node - "$PROFILE" <<'NODE'
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
const [profileDir] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"))
const bundles = manifest.dsh?.profile?.bundles ?? []
const deps = manifest.dependencies ?? {}
let bad = 0
const check = (name, ok, detail) => { console.log(`[assert ${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`); if (!ok) bad += 1 }
check("@mpd-dsh/silicon dependency is gone", deps["@mpd-dsh/silicon"] === undefined, JSON.stringify(deps))
check("@mpd-dsh/silicon bundle entry is gone", !bundles.includes("@mpd-dsh/silicon"), JSON.stringify(bundles))
check("@mpd-dsh/mpd dependency is still present (remove targeted silicon)", deps["@mpd-dsh/mpd"] !== undefined)
check("@mpd-dsh/mpd bundle entry is still present", bundles.includes("@mpd-dsh/mpd"))
check("installed silicon package directory is gone", !existsSync(join(profileDir, "node_modules", "@mpd-dsh", "silicon")))
if (bad > 0) { console.error(`[assert] FAILED (${bad})`); process.exit(1) }
console.log("[assert] ALL PASS")
NODE
REMOVE_ASSERT_CODE=$?
echo "[assert exit: $REMOVE_ASSERT_CODE]"
fact "removeExitCode" "$REMOVE_CODE"
fact "removeAssertionsExitCode" "$REMOVE_ASSERT_CODE"

# ── 7. add without -w must be refused (profile is a pnpm workspace root) ───
echo
echo "# ── 7. dsh plugin add WITHOUT -w (expected rejection) ──"
cat > "$SB/fake-bundle/package.json" <<'JSON'
{ "name": "fake-bundle", "version": "0.0.1", "private": true, "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
JSON
printf -- "- insert:\n    id: fake-row\n" > "$SB/fake-bundle/cordis.patch.yml"
run dsh plugin --profile nowtest add "file:$SB/fake-bundle" "--registry=$REGISTRY" > "$EVID/add-without-w.log" 2>&1
NOW_CODE=$?
echo "# add-without-w exit: $NOW_CODE (expected non-zero)"
grep -m1 'ERR_PNPM_ADDING_TO_ROOT' "$EVID/add-without-w.log" | sed 's/^/  /'
if grep -q 'ERR_PNPM_ADDING_TO_ROOT' "$EVID/add-without-w.log"; then NOW_ERR=1; else NOW_ERR=0; fi
echo "# ERR_PNPM_ADDING_TO_ROOT present: $NOW_ERR"
fact "addWithoutWExitCode" "$NOW_CODE"
fact "addWithoutWErrPresent" "$NOW_ERR"

# ── 8. self-test exits recorded beside the proof ───────────────────────────
echo
echo "# ── 8. guard + self-test exits on the same tree ──"
run node "$REPO/scripts/verify-package-files.mjs" > "$EVID/guard-pass.log" 2>&1
GUARD_CODE=$?
echo "# verify-package-files exit: $GUARD_CODE"
cat "$EVID/guard-pass.log" | sed 's/^/  /'
run node "$REPO/scripts/verify-package-files.mjs" --self-test > "$EVID/guard-self-test.log" 2>&1
GUARD_SELF_CODE=$?
echo "# verify-package-files --self-test exit: $GUARD_SELF_CODE"
tail -1 "$EVID/guard-self-test.log" | sed 's/^/  /'
run node "$REPO/scripts/verify-corpus.mjs" --self-test > "$EVID/corpus-self-test.log" 2>&1
CORPUS_SELF_CODE=$?
echo "# verify-corpus --self-test exit: $CORPUS_SELF_CODE"
tail -1 "$EVID/corpus-self-test.log" | sed 's/^/  /'
run node "$REPO/scripts/verify-rows-disjoint.mjs" --self-test > "$EVID/rows-self-test.log" 2>&1
ROWS_SELF_CODE=$?
echo "# verify-rows-disjoint --self-test exit: $ROWS_SELF_CODE"
tail -1 "$EVID/rows-self-test.log" | sed 's/^/  /'
run node "$REPO/scripts/build-lsp.mjs" --check --self-test > "$EVID/lsp-self-test.log" 2>&1
LSP_SELF_CODE=$?
echo "# build-lsp --check --self-test exit: $LSP_SELF_CODE"
tail -1 "$EVID/lsp-self-test.log" | sed 's/^/  /'
fact "guardExitCode" "$GUARD_CODE"
fact "guardSelfTestExitCode" "$GUARD_SELF_CODE"
fact "corpusSelfTestExitCode" "$CORPUS_SELF_CODE"
fact "rowsSelfTestExitCode" "$ROWS_SELF_CODE"
fact "lspSelfTestExitCode" "$LSP_SELF_CODE"

# ── 9. summary ─────────────────────────────────────────────────────────────
echo
echo "# ── summary ──"
echo "# npm pack exit:            $PACK_CODE"
echo "# install exit:             $INSTALL_CODE"
echo "# coexist boot exit:        $BOOT_CODE (expected 124)"
echo "# negative install exit:    $NEG_INSTALL_CODE (expected 0)"
echo "# negative boot exit:       $NEG_BOOT_CODE (expected 1)"
echo "# remove exit:              $REMOVE_CODE (expected 0)"
echo "# add without -w exit:      $NOW_CODE (expected non-zero)"
echo "# guard exit:               $GUARD_CODE"
echo "# guard self-test exit:     $GUARD_SELF_CODE"
echo "# corpus self-test exit:    $CORPUS_SELF_CODE"
echo "# rows self-test exit:      $ROWS_SELF_CODE"
echo "# lsp self-test exit:       $LSP_SELF_CODE"
echo "# tarball:                  $TGZ (deleted with the sandbox; reproducible via npm pack from the recorded tree)"
