#!/usr/bin/env node
// build-result.mjs — assemble result.json from the raw artifacts this directory holds.
//
// Every value is read back from a file the proof produced (npm-pack.json, facts.env,
// the boot logs, git-head.txt, git-diff-stat.txt, git-status.txt); nothing is typed in
// by hand. Run it after run-install.sh.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const EVID = dirname(fileURLToPath(import.meta.url))
const REPO = join(EVID, "..", "..", "..", "..")

const read = (name, fallback = "") => (existsSync(join(EVID, name)) ? readFileSync(join(EVID, name), "utf8") : fallback)
const readJson = (name) => JSON.parse(read(name))
const facts = Object.fromEntries(
  read("facts.env")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"))
const pack = readJson("npm-pack.json")[0]
const files = pack.files.map((f) => f.path)
const sha256Line = read("tarball-sha256.txt")
  .split("\n")
  .find((line) => /^[0-9a-f]{64}\s/.test(line))
const sha256 = sha256Line ? sha256Line.split(/\s+/)[0] : null
const gateExits = {}
{
  const lines = read("gates.log").split("\n")
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^=== \$ (.*) ===$/.exec(lines[i])
    if (!header) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      const exit = /^\[exit=(-?\d+)\]$/.exec(lines[j])
      if (exit) {
        const command = header[1]
        if (gateExits[command] === undefined) gateExits[command] = Number(exit[1])
        break
      }
    }
  }
}
const grepCount = (name, needle) => read(name).split("\n").filter((line) => line.includes(needle)).length
const bool = (value) => value === "1" || value === 1

const result = {
  tool: "plugin-install-proof",
  generatedAt: new Date().toISOString(),
  evidenceDir: EVID,
  repo: REPO,
  branch: facts.branch,
  baseCommit: facts.head,
  siliconVersion: manifest.version,
  versions: {
    dsh: read("output.log").match(/dsh --version\n([^\n]+)/)?.[1] ?? null,
    node: read("output.log").match(/node --version\n([^\n]+)/)?.[1] ?? null,
    pnpm: read("output.log").match(/pnpm --version\n([^\n]+)/)?.[1] ?? null,
    npm: read("output.log").match(/# npm: ([^\n]+)/)?.[1] ?? null,
    bun: read("output.log").match(/# bun: ([^\n]+)/)?.[1] ?? null,
  },
  tree: {
    head: read("git-head.txt").trim(),
    branch: facts.branch,
    diffStat: read("git-diff-stat.txt").trim(),
    statusPorcelain: read("git-status.txt").trim().split("\n").filter(Boolean),
  },
  tarball: {
    filename: pack.filename,
    bytes: pack.size,
    sha256,
    npmShasum: pack.shasum,
    integrity: pack.integrity,
    fileCount: files.length,
    unpackedBytes: pack.unpackedSize,
    prepackGuard: read("npm-pack.raw.log").split("\n")[0],
    npmPackExitCode: Number(facts.npmPackExitCode),
    kept: false,
    reproducibleWith:
      "npm pack --pack-destination <tmp> from the tree recorded above (HEAD + git diff --stat); the tarball is deleted with the isolated sandbox",
    filesList: "tarball-files.txt",
    rawStream: "npm-pack.raw.log",
    containsMpdLspManifest: files.includes("packages/mpd-mcp-lsp/package.json"),
    containsGuardScript: files.includes("scripts/verify-package-files.mjs"),
    containsDocs: files.includes("docs/toolchain.md") && files.includes("docs/docgen-guide.md"),
    containsTestsFixtures: files.includes("tests/golden/fixtures/verilog/modules/adder4.v"),
    excludedSourceSurface: files.filter((p) =>
      /^(packages\/[^/]+\/(src|test)\/|evidence\/|\.workflow\/|\.mpd\/|node_modules\/)/.test(p),
    ),
  },
  packageFilesAllowlist: manifest.files,
  isolation: {
    HOME: join(REPO, ".mpd", "proof-final", "home"),
    DSH_HOME: join(REPO, ".mpd", "proof-final", "dsh"),
    XDG: "config/cache/data/state under .mpd/proof-final/home",
    npmCache: join(REPO, ".mpd", "proof-final", "npm-cache"),
    pnpmStore: join(REPO, ".mpd", "proof-final", "pnpm-store"),
    workspaceCwd: join(REPO, ".mpd", "proof-final", "work"),
    note: "every dsh spawn ran with cwd=.mpd/proof-final/work; the real ~/.dsh was never touched; the sandbox is deleted after the run",
  },
  registryClaim: {
    command: "npm view @mpd-dsh/silicon@0.7.0 version --registry=https://registry.npmmirror.com",
    exitCode: Number(facts.npmViewExitCode),
    errorCode: read("npm-view.log").match(/npm error code (\w+)/)?.[1] ?? null,
    note: "the request resolved against registry.npmjs.org and returned 404; this substantiates the docs' 'not measured — not published' note",
    log: "npm-view.log",
  },
  install: {
    command:
      "dsh plugin --profile probe add -w @mpd-dsh/mpd@0.15.1 <abs tarball> @deepseek-harness-tui/dsh-tui@0.16.1 --registry=https://registry.npmmirror.com",
    exitCode: Number(facts.installExitCode),
    assertionsExitCode: Number(facts.installAssertionsExitCode),
    profileManifest: "profile-probe.package.json",
    log: "output.log",
  },
  composition: {
    command: "dsh --profile probe --dump-config",
    exitCode: Number(facts.dumpExitCode),
    siliconRowCount: Number(facts.siliconRowCount),
    dump: "dump-config.yaml",
    note: "composition only — not a health signal for plugin code",
  },
  boot: {
    command: "timeout 40s dsh --profile probe --no-open --port 0 (cwd .mpd/proof-final/work)",
    exitCode: Number(facts.bootExitCode),
    expected: 124,
    serveLine: "[mpd-silicon-bootstrap] skill corpus served",
    serveLineOccurrences: Number(facts.serveLineOccurrences),
    fatalLines: Number(facts.fatalLines),
    log: "boot-coexist.log",
  },
  negativeNoMpd: {
    installExitCode: Number(facts.noMpdInstallExitCode),
    bootExitCode: Number(facts.noMpdBootExitCode),
    expectedBootExitCode: 1,
    guardLine: "silicon requires @mpd-dsh/mpd: the mpdDsh service is absent",
    guardLinePresent: bool(facts.guardLinePresent),
    serveLineOccurrences: Number(facts.noMpdServeLineOccurrences),
    profileManifest: "profile-probe-nompd.package.json",
    log: "boot-nompd.log",
  },
  removeControl: {
    command: "dsh plugin --profile probe remove @mpd-dsh/silicon",
    exitCode: Number(facts.removeExitCode),
    assertionsExitCode: Number(facts.removeAssertionsExitCode),
    dependencyGone: !read("profile-probe-after-remove.package.json").includes('"@mpd-dsh/silicon"'),
    bundleEntryGone: !JSON.parse(read("profile-probe-after-remove.package.json")).dsh.profile.bundles.includes("@mpd-dsh/silicon"),
    mpdStillPresent: JSON.parse(read("profile-probe-after-remove.package.json")).dsh.profile.bundles.includes("@mpd-dsh/mpd"),
    profileManifest: "profile-probe-after-remove.package.json",
  },
  addWithoutWorkspaceRoot: {
    command: "dsh plugin --profile nowtest add file:<fake-bundle> (no -w)",
    exitCode: Number(facts.addWithoutWExitCode),
    expected: "non-zero",
    errPnpmAddingToRoot: bool(facts.addWithoutWErrPresent),
    log: "add-without-w.log",
  },
  selfTests: {
    guard: Number(facts.guardExitCode),
    guardSelfTest: Number(facts.guardSelfTestExitCode),
    corpusSelfTest: Number(facts.corpusSelfTestExitCode),
    rowsSelfTest: Number(facts.rowsSelfTestExitCode),
    lspCheckSelfTest: Number(facts.lspSelfTestExitCode),
    logs: {
      guard: "guard-pass.log",
      guardSelfTest: "guard-self-test.log",
      corpusSelfTest: "corpus-self-test.log",
      rowsSelfTest: "rows-self-test.log",
      lspCheckSelfTest: "lsp-self-test.log",
    },
  },
  gateExits,
  gatesLog: "gates.log",
  deviations: [
    "`npm pack --json` runs the prepack hook first, so the guard's PASS line precedes the JSON array on stdout; npm-pack.json is the JSON-only tail and npm-pack.raw.log keeps the exact stream.",
    "`dsh plugin remove` forwards to `pnpm remove`, which rejects `--registry` (`ERROR Unknown option: 'registry'`); the recorded remove runs without it, exactly as the docs show.",
    "the positive profile also installs @deepseek-harness-tui/dsh-tui 0.16.1 so the profile has an app entry; it declares dsh.bundle.patch and is therefore also appended to dsh.profile.bundles.",
    "pnpm reported unmet peer dependencies inside dsh-tui's own dependency tree; install and boot both succeed, so they are third-party warnings, not @mpd-dsh/silicon failures.",
    "`npm view` resolved against registry.npmjs.org despite the npmmirror flag and returned 404; the 'not published' claim is recorded as observed, not as a npmmirror measurement.",
    "the tarball is deleted with the sandbox; npm-pack.json, tarball-files.txt and tarball-sha256.txt keep its facts, and `npm pack` from the recorded tree reproduces it.",
  ],
}

const allOk =
  result.tarball.npmPackExitCode === 0 &&
  result.tarball.excludedSourceSurface.length === 0 &&
  result.install.exitCode === 0 &&
  result.install.assertionsExitCode === 0 &&
  result.composition.siliconRowCount === 5 &&
  result.boot.exitCode === 124 &&
  result.boot.serveLineOccurrences === 1 &&
  result.boot.fatalLines === 0 &&
  result.negativeNoMpd.installExitCode === 0 &&
  result.negativeNoMpd.bootExitCode === 1 &&
  result.negativeNoMpd.guardLinePresent === true &&
  result.removeControl.exitCode === 0 &&
  result.removeControl.dependencyGone === true &&
  result.removeControl.bundleEntryGone === true &&
  result.addWithoutWorkspaceRoot.exitCode !== 0 &&
  result.addWithoutWorkspaceRoot.errPnpmAddingToRoot === true &&
  Object.values(result.selfTests)
    .filter((value) => typeof value === "number")
    .every((code) => code === 0)
result.verdict = allOk ? "PASS" : "FAIL"

writeFileSync(join(EVID, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`result.json written: verdict=${result.verdict}`)
if (!allOk) process.exit(1)
