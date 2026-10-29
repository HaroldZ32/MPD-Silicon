#!/usr/bin/env node
// build: bundle every plugin package in this repo into packages/<pkg>/dist/index.js.
//
// One command, one artifact per plugin, dist committed next to src: a source
// checkout is installable with `dsh plugin add` and needs no build step on the
// consumer side (the bundle patch references the dist files directly).
//
// Each plugin is built from its own entry file with the repo's canonical flags
// (`bun build src/index.ts --target node --format esm --outfile dist/index.js`).
// @mpd-dsh/mpd's adapter is a REAL runtime dependency and stays EXTERNAL: the
// specifier `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` is left
// in the output and resolved from node_modules when the bundle is installed. That
// keeps one adapter instance process-wide (the row that provides `mpdDsh`) and
// keeps this repo's dists small; it is not a fallback. Without the dependency
// installed, the row fails to load — which is the intended hard dependency.
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const PLUGINS = [
  "mpd-verif-plugin",
  "mpd-silicon-bootstrap-plugin",
  "mpd-silicon-guard-plugin",
  "mpd-docgen-plugin",
]

function build(plugin) {
  const pkgDir = join(repoRoot, "packages", plugin)
  const entry = join(pkgDir, "src", "index.ts")
  if (!existsSync(entry)) {
    console.error("[build] FAIL: missing entry " + entry)
    process.exit(1)
  }
  const outDir = join(pkgDir, "dist")
  mkdirSync(outDir, { recursive: true })
  execFileSync(
    "bun",
    ["build", "src/index.ts", "--target", "node", "--format", "esm", "--outfile", "dist/index.js", "--external", "@mpd-dsh/mpd/*"],
    {
      cwd: pkgDir,
      stdio: "inherit",
    },
  )
  // cpSync-style tools copy the SOURCE mode; a 600 working tree would ship an
  // artifact a non-root consumer cannot read. Normalize the built file (the
  // entry point is never meant to be executable).
  const out = join(outDir, "index.js")
  if ((statSync(out).mode & 0o777) !== 0o644) chmodSync(out, 0o644)
  return out
}

function main() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  const built = []
  for (const plugin of PLUGINS) built.push([plugin, build(plugin)])
  console.log("[build] ok: " + built.map(([plugin, out]) => plugin + " -> " + out.slice(repoRoot.length + 1)).join(", "))
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    console.error("[build] FAIL: repository package.json has no name")
    process.exit(1)
  }
}

main()
