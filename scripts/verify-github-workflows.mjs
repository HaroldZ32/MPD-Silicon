#!/usr/bin/env node
// verify-github-workflows: structural gate for .github/workflows/*.yml.
//
// GitHub Actions only reports a broken workflow when a run reaches it; a typo in a step
// key, a missing permissions block, a gate command dropped from the chain, a release
// job that no longer asserts the tag version or a leftover reference to the retired CI
// provider is invisible to every TypeScript/test gate. This gate parses the workflows
// and checks the shape this repository relies on (ported from the retired CI-provider
// workflow gate, retargeted at GitHub Actions):
//
//   name/on/permissions/jobs | runs-on + non-empty steps | known step keys
//   push/pull_request/workflow_dispatch trigger shapes
//   the AGENTS.md §3 gate sequence, in order, in ci.yml and release.yml
//   ci.yml is read-only and uploads the staged package
//   docker-verify.yml builds the repository Dockerfile and runs the image
//   release.yml asserts tag == package version, stages the npm publish with Trusted
//   Publishing (OIDC + provenance, tokenless: the step's run is exactly the staged command
//   and the step carries no if/env/with/continue-on-error), keeps every release job
//   unconditionally enabled (no literal `if: false`), creates a Release and pushes to GHCR
//   no tabs | every referenced scripts/*.mjs exists | no retired CI references
//
// YAML parsing is delegated to a real parser, never re-implemented:
//   - python3 + PyYAML (the verifier's oracle), else
//   - bun + Bun.YAML.parse (the pinned CI toolchain ships it)
// Without either parser the structural pass SKIPS with a loud reason; --require turns
// that skip into exit 3. Raw checks (tabs, script references, retired references)
// always run.
//
// Usage:
//   node scripts/verify-github-workflows.mjs [--dir <workflow-dir>] [--require]
//   node scripts/verify-github-workflows.mjs --self-test
//
// Exit codes: 0 pass/skip, 1 a workflow (or a self-test fixture) failed, 2 usage
// error, 3 --require without a YAML parser (or --self-test without one).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const selfTest = argv.includes("--self-test")
const requireOracle = argv.includes("--require")
const dirOption = readOption(argv, "--dir")
if (dirOption === "") {
  console.error("verify-github-workflows: --dir needs a path")
  process.exit(2)
}
const workflowDir = dirOption === null ? join(repoRoot, ".github", "workflows") : resolve(dirOption)
const scanRoot = dirOption === null ? join(repoRoot, ".github") : workflowDir

const REQUIRED_WORKFLOWS = ["ci.yml", "docker-verify.yml", "boot-e2e.yml", "release.yml"]

// AGENTS.md §3, in order. Both gate-bearing workflows must carry the whole chain; the
// statement-boundary match in matchCommand keeps a bare invocation from being satisfied
// by a longer one (`node scripts/pack-silicon.mjs` must not be answered by `--check`).
const GATE_COMMANDS = [
  "node scripts/typecheck.mjs --require",
  "bun test packages/",
  "node scripts/verify-corpus.mjs",
  "node scripts/verify-rows-disjoint.mjs",
  "node scripts/build-lsp.mjs --check",
  "node scripts/pack-silicon.mjs --self-test",
  "node scripts/verify-github-workflows.mjs",
  "node scripts/pack-silicon.mjs --check",
  "node scripts/pack-silicon.mjs",
  "node scripts/verify-package-files.mjs --self-test",
  "node scripts/verify-package-files.mjs",
]

const TRIGGER_KEYS = new Set(["push", "pull_request", "workflow_dispatch"])
const STEP_KEYS = new Set([
  "continue-on-error",
  "env",
  "id",
  "if",
  "name",
  "run",
  "shell",
  "timeout-minutes",
  "uses",
  "with",
  "working-directory",
])
const PUBLISH_ACTIONS = ["docker/login-action", "docker/build-push-action", "softprops/action-gh-release"]

// Trusted Publishing must be EFFECTIVE and STAGED, not merely mentioned. The publish step's
// run is compared to the staged command after trim(), so a plain `npm publish` (a direct
// publish, which the trusted publisher denies), `--dry-run`, an echo, an `if:` guard and a
// `true || npm publish` chain all stop being a publish at once; the step itself may carry
// no modifier that disables it (if/continue-on-error) or injects a credential (env/with).
const NPM_STAGE_PUBLISH_COMMAND = "npm stage publish --access public --provenance"
const NPM_PUBLISH_PATTERN = /\bnpm\s+(?:stage\s+)?publish\b/
const NPM_PUBLISH_SHAPE_KEYS = ["if", "continue-on-error"]
const NPM_PUBLISH_TOKEN_KEYS = ["env", "with"]
// Semantic values only (the parse drops comments), so release.yml's explanatory comment may
// name the legacy tokens without tripping the gate. `_auth` covers `_authToken` and the
// `_password`/`//registry.npmjs.org/:` rows cover a shell-written legacy `.npmrc`.
const NPM_TOKENLESS_DENY = [
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "_authToken",
  ".npmrc",
  "npm config set",
  "_auth",
  "_password",
  "//registry.npmjs.org/:",
]

// The retired provider/registry/directory tokens are assembled from fragments on
// purpose: this repository bans those literals from scripts/**, and this gate is the
// thing that enforces the ban. Keeping the fragments apart means the gate's own source
// never carries the retired literal while still detecting it in .github/**.
const RETIRED_PROVIDER = "gi" + "tee"
const RETIRED_REGISTRY = "npm" + "mirror"
const RETIRED_DIR = "." + "workflow"
const RETIRED_PATTERNS = [
  {
    rule: "provider-reference",
    pattern: new RegExp(RETIRED_PROVIDER, "i"),
    message: "file names the retired CI provider; keep provider references out of .github/**",
  },
  {
    rule: "registry-reference",
    pattern: new RegExp(RETIRED_REGISTRY, "i"),
    message: "file names the retired registry mirror; use the default registry",
  },
  {
    rule: "pipeline-dir-reference",
    pattern: new RegExp(`(?<![\\w-])${escapeRegExp(RETIRED_DIR)}\\b`),
    message: "file references the retired pipeline directory; workflows live under .github/workflows",
  },
]

function readOption(args, flag) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) return args[i + 1] ?? ""
    if (args[i].startsWith(flag + "=")) return args[i].slice(flag.length + 1)
  }
  return null
}

function isMap(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function nonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString)
}

/**
 * A job condition that is literally false: the job never runs, yet the workflow run still
 * reports success. `false` (YAML boolean), 'false', '${{ false }}' (with any spacing) and a
 * padded 'false ' all mean the same thing. A condition that can be true (startsWith,
 * needs.*.result) is not matched, so legitimate job-level conditions stay allowed.
 */
function isDisabledCondition(value) {
  if (value === false) return true
  if (typeof value !== "string") return false
  const condition = value.trim().toLowerCase().replace(/\s+/g, "")
  return condition === "false" || condition === "${{false}}"
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A command must own its statement: line start (or a separator) before, end of line after. */
function matchCommand(text, command, from) {
  const pattern = new RegExp(
    `(?:^|[\\n;&|])\\s*${escapeRegExp(command)}\\s*(?=$|[\\n;&|])`,
    "gm",
  )
  pattern.lastIndex = from
  return pattern.exec(text)
}

function probe(cmd, args) {
  const run = spawnSync(cmd, args, { encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024 })
  return run.status === 0 ? run : null
}

/**
 * Locate a real YAML parser. PyYAML is the oracle named by the verification recipe;
 * Bun.YAML is the fallback that exists wherever the pinned CI toolchain is installed.
 */
function findOracle() {
  const python = probe("python3", ["-c", "import yaml; print(yaml.__version__)"])
  if (python !== null) return { kind: "python", label: `python3 + PyYAML ${String(python.stdout).trim()}` }
  const candidates = [process.env.BUN_BIN, "bun", join(repoRoot, ".mpd", "tools", "bun", "bin", "bun")].filter(Boolean)
  for (const cmd of candidates) {
    const run = probe(cmd, ["-e", "console.log(typeof Bun.YAML?.parse)"])
    if (run !== null && String(run.stdout).trim() === "function") return { kind: "bun", cmd, label: `${cmd} + Bun.YAML.parse` }
  }
  return null
}

const PY_PARSE = `import json, sys, yaml
out = []
for path in sys.argv[1:]:
    try:
        with open(path, encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
        out.append({"file": path, "ok": True, "data": data})
    except Exception as error:
        out.append({"file": path, "ok": False, "error": str(error)})
print(json.dumps(out, default=str))
`

const BUN_PARSE = `const fs = require("node:fs")
const files = JSON.parse(process.env.YWF_FILES)
const out = files.map((file) => {
  try {
    return { file, ok: true, data: Bun.YAML.parse(fs.readFileSync(file, "utf8")) }
  } catch (error) {
    return { file, ok: false, error: String(error && error.message || error) }
  }
})
process.stdout.write(JSON.stringify(out))
`

function parseFiles(oracle, files) {
  const run =
    oracle.kind === "python"
      ? spawnSync("python3", ["-c", PY_PARSE, ...files], { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
      : spawnSync(oracle.cmd, ["-e", BUN_PARSE], {
          encoding: "utf8",
          timeout: 120000,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, YWF_FILES: JSON.stringify(files) },
        })
  if (run.status !== 0) return { error: `YAML parser failed (exit ${String(run.status)}): ${String(run.stderr || run.error || "").trim()}` }
  try {
    return { results: JSON.parse(String(run.stdout)) }
  } catch (error) {
    return { error: `YAML parser emitted non-JSON output: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function forbiddenIssues(raw) {
  const issues = []
  for (const retired of RETIRED_PATTERNS) {
    if (retired.pattern.test(raw)) issues.push({ rule: retired.rule, message: retired.message })
  }
  return issues
}

/** Checks that need no parser: retired references, tabs and referenced gate scripts. */
function rawChecks(raw) {
  const issues = forbiddenIssues(raw)
  if (raw.includes("\t")) issues.push({ rule: "no-tabs", message: "file contains a tab character; YAML indentation must use spaces" })
  const refs = new Set()
  for (const match of raw.matchAll(/\bscripts\/[A-Za-z0-9._-]+\.mjs\b/g)) refs.add(match[0])
  for (const ref of [...refs].sort()) {
    if (!existsSync(join(repoRoot, ref))) issues.push({ rule: "script-ref", message: `referenced script does not exist: ${ref}` })
  }
  return issues
}

function validateTriggers(triggers, add) {
  for (const [key, value] of Object.entries(triggers)) {
    if (!TRIGGER_KEYS.has(key)) {
      add("trigger-key", `unknown trigger ${JSON.stringify(key)}; expected push, pull_request or workflow_dispatch`)
      continue
    }
    if (key === "workflow_dispatch") {
      if (value !== null && !isMap(value)) add("trigger-manual", "on.workflow_dispatch must be empty or a mapping")
      continue
    }
    if (!isMap(value)) {
      add("trigger-mapping", `on.${key} must be a mapping`)
      continue
    }
    for (const spec of ["branches", "paths", "tags"]) {
      if (value[spec] === undefined) continue
      if (!nonEmptyStringArray(value[spec])) add("trigger-spec", `on.${key}.${spec} must be a non-empty array of strings`)
    }
    if (key === "push" && !nonEmptyStringArray(value.branches) && !nonEmptyStringArray(value.tags)) {
      add("trigger-push", "on.push must declare branches and/or tags")
    }
    if (key === "pull_request" && !nonEmptyStringArray(value.branches)) {
      add("trigger-pr", "on.pull_request must declare branches")
    }
  }
}

/**
 * PyYAML implements YAML 1.1, where an unquoted `on:` key is the boolean true; Bun.YAML
 * (YAML 1.2) keeps it as the string "on". Accept whichever the oracle produced.
 */
function triggerMap(data) {
  if (isMap(data.on)) return data.on
  if (isMap(data.true)) return data.true
  return null
}

function allJobs(data) {
  return isMap(data.jobs) ? Object.entries(data.jobs) : []
}

function jobSteps(job) {
  return isMap(job) && Array.isArray(job.steps) ? job.steps.filter(isMap) : []
}

function collectSteps(data) {
  const steps = []
  for (const [jobId, job] of allJobs(data)) {
    jobSteps(job).forEach((step, index) => steps.push({ jobId, index, step }))
  }
  return steps
}

function stepMatches(step, prefix) {
  return nonEmptyString(step.uses) && step.uses.startsWith(prefix + "@")
}

function findStep(steps, prefix) {
  return steps.find(({ step }) => stepMatches(step, prefix))
}

function requiresPin(steps, prefix, withKey, expected, add, rule) {
  const found = findStep(steps, prefix)
  if (found === undefined) {
    add(rule, `${prefix} is missing; the workflow must use it`)
    return
  }
  const value = isMap(found.step.with) ? found.step.with[withKey] : undefined
  if (String(value) !== expected) add(rule, `${prefix} must set ${withKey}: ${expected}, got ${JSON.stringify(value)}`)
}

function validateSetupPins(steps, add, rule) {
  if (findStep(steps, "actions/checkout") === undefined) add(rule, "actions/checkout is missing")
  requiresPin(steps, "oven-sh/setup-bun", "bun-version", "1.4.3", add, rule)
  requiresPin(steps, "actions/setup-node", "node-version", "24", add, rule)
}

function gateSequenceIssues(data, fileKey, add) {
  const text = collectSteps(data)
    .map(({ step }) => step.run)
    .filter(nonEmptyString)
    .join("\n")
  let cursor = 0
  for (const command of GATE_COMMANDS) {
    const match = matchCommand(text, command, cursor)
    if (match === null) {
      if (text.includes(command)) {
        add("gate-order", `${fileKey} runs ${JSON.stringify(command)} out of the AGENTS.md §3 order`)
      } else {
        add("gate-missing", `${fileKey} is missing the AGENTS.md §3 gate command: ${command}`)
      }
      return
    }
    cursor = match.index + match[0].length
  }
}

function validateWorkflow(file, data) {
  const issues = []
  const add = (rule, message) => issues.push({ rule, message })
  if (!isMap(data)) {
    add("root-mapping", "top level must be a mapping")
    return issues
  }
  if (!nonEmptyString(data.name)) add("name", "name must be a non-empty string")
  const triggers = triggerMap(data)
  if (triggers === null || Object.keys(triggers).length === 0) {
    add("on", "on must be a non-empty mapping")
  } else {
    validateTriggers(triggers, add)
  }
  if (!isMap(data.permissions) || Object.keys(data.permissions).length === 0) {
    add("permissions", "permissions must be a non-empty mapping, e.g. contents: read")
  } else {
    for (const [scope, level] of Object.entries(data.permissions)) {
      if (!["read", "write", "none"].includes(level)) {
        add("permissions-value", `permissions.${scope} must be read, write or none, got ${JSON.stringify(level)}`)
      }
    }
  }
  const jobs = allJobs(data)
  if (jobs.length === 0) add("jobs", "jobs must be a non-empty mapping")

  const steps = collectSteps(data)
  for (const [jobId, job] of jobs) {
    const where = `jobs.${jobId}`
    if (!isMap(job)) {
      add("job-mapping", `${where} must be a mapping`)
      continue
    }
    if (!nonEmptyString(job["runs-on"]) && !nonEmptyStringArray(job["runs-on"])) {
      add("runs-on", `${where}.runs-on must be a non-empty runner label`)
    }
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      add("steps", `${where}.steps must be a non-empty array`)
      continue
    }
    const stepNames = new Set()
    job.steps.forEach((step, index) => {
      const swhere = `${where}.steps[${index}]`
      if (!isMap(step)) {
        add("step-mapping", `${swhere} must be a mapping`)
        return
      }
      for (const key of Object.keys(step)) {
        if (!STEP_KEYS.has(key)) add("step-key", `${swhere}.${key} is not a GitHub Actions step key`)
      }
      if (!nonEmptyString(step.run) && !nonEmptyString(step.uses)) add("step-body", `${swhere} must have a non-empty run or uses`)
      if (nonEmptyString(step.run) && nonEmptyString(step.uses)) add("step-body", `${swhere} cannot have both run and uses`)
      if (step.name !== undefined) {
        if (!nonEmptyString(step.name)) {
          add("step-name", `${swhere}.name must be a non-empty string`)
        } else if (stepNames.has(step.name)) {
          add("step-name-duplicate", `${swhere}.name duplicates another step in the same job: ${step.name}`)
        } else {
          stepNames.add(step.name)
        }
      }
    })
  }

  const fileKey = basename(file)
  if (fileKey === "ci.yml") {
    const push = triggers !== null && isMap(triggers.push) ? triggers.push : null
    const pullRequest = triggers !== null && isMap(triggers.pull_request) ? triggers.pull_request : null
    if (push === null || !Array.isArray(push.branches) || !push.branches.includes("main")) add("ci-trigger", "ci.yml must trigger on push to main")
    if (pullRequest === null || !Array.isArray(pullRequest.branches) || !pullRequest.branches.includes("main")) {
      add("ci-trigger", "ci.yml must trigger on pull_request to main")
    }
    if (triggers === null || triggers.workflow_dispatch === undefined) add("ci-trigger", "ci.yml must expose workflow_dispatch")
    for (const [jobId, job] of jobs) {
      const runner = isMap(job) ? job["runs-on"] : undefined
      if (!matchesRunner(runner, 24)) add("ci-runner", `jobs.${jobId}.runs-on must be ubuntu-24.04 or a newer ubuntu runner, got ${JSON.stringify(runner)}`)
    }
    validateSetupPins(steps, add, "ci-setup")
    gateSequenceIssues(data, fileKey, add)
    const writable = isMap(data.permissions) ? Object.entries(data.permissions).filter(([, level]) => level === "write") : []
    for (const [scope] of writable) add("ci-no-publish", `ci.yml must be read-only; permissions.${scope} is write`)
    for (const { step } of steps) {
      for (const action of PUBLISH_ACTIONS) {
        if (stepMatches(step, action)) add("ci-no-publish", `ci.yml must not publish; ${action} belongs to release.yml`)
      }
    }
    const upload = findStep(steps, "actions/upload-artifact")
    if (upload === undefined) {
      add("ci-artifact", "ci.yml must upload the staged package with actions/upload-artifact")
    } else {
      const input = isMap(upload.step.with) ? upload.step.with : {}
      if (input.name !== "silicon-package") add("ci-artifact", `upload-artifact name must be silicon-package, got ${JSON.stringify(input.name)}`)
      if (!String(input.path ?? "").includes("dist/silicon-package")) add("ci-artifact", "upload-artifact path must include dist/silicon-package")
      if (Number(input["retention-days"]) !== 7) add("ci-artifact", "upload-artifact retention-days must be 7")
    }
  }

  if (fileKey === "boot-e2e.yml") {
    if (triggers !== null && triggers.pull_request !== undefined) add("boot-e2e-no-pr", "boot-e2e.yml is push/manual only; remove the pull_request trigger")
    const push = triggers !== null && isMap(triggers.push) ? triggers.push : null
    if (push === null || !Array.isArray(push.branches) || !push.branches.includes("main")) add("boot-e2e-trigger", "boot-e2e.yml must trigger on push to main")
    if (triggers === null || triggers.workflow_dispatch === undefined) add("boot-e2e-trigger", "boot-e2e.yml must expose workflow_dispatch")
    const paths = push !== null && Array.isArray(push.paths) ? push.paths : []
    for (const required of ["packages/**", "scripts/**", "package.json", "bun.lock", "packages/mpd-bundle/cordis.patch.yml", ".github/workflows/boot-e2e.yml"]) {
      if (!paths.includes(required)) add("boot-e2e-paths", `boot-e2e.yml push.paths must include ${required}`)
    }
    validateSetupPins(steps, add, "boot-e2e-setup")
    const runs = steps.map(({ step }) => step.run).filter(nonEmptyString).join("\n")
    if (!runs.includes("npm install -g @deepseek-ai/dsh@0.2.1-rc.2")) add("boot-e2e-harness", "boot-e2e.yml must install the pinned harness CLI: npm install -g @deepseek-ai/dsh@0.2.1-rc.2")
    if (matchCommand(runs, "node scripts/ci-boot.mjs --require", 0) === null) add("boot-e2e-harness", "boot-e2e.yml must run node scripts/ci-boot.mjs --require")
    const upload = findStep(steps, "actions/upload-artifact")
    if (upload === undefined) {
      add("boot-e2e-artifact", "boot-e2e.yml must upload the boot logs with actions/upload-artifact")
    } else {
      const input = isMap(upload.step.with) ? upload.step.with : {}
      if (input.name !== "ci-boot-logs") add("boot-e2e-artifact", `upload-artifact name must be ci-boot-logs, got ${JSON.stringify(input.name)}`)
      if (!String(input.path ?? "").includes("dist/ci-boot-logs")) add("boot-e2e-artifact", "upload-artifact path must include dist/ci-boot-logs")
    }
  }

  if (fileKey === "docker-verify.yml") {
    if (findStep(steps, "actions/checkout") === undefined) add("docker-verify-build", "docker-verify.yml must check out the repository")
    if (findStep(steps, "docker/setup-buildx-action") === undefined) add("docker-verify-build", "docker-verify.yml must set up buildx (docker/setup-buildx-action)")
    const build = findStep(steps, "docker/build-push-action")
    if (build === undefined) {
      add("docker-verify-build", "docker-verify.yml must build the image with docker/build-push-action")
    } else {
      const input = isMap(build.step.with) ? build.step.with : {}
      if (input.context !== ".") add("docker-verify-build", `docker/build-push-action context must be '.', got ${JSON.stringify(input.context)}`)
      if (input.load !== true) add("docker-verify-build", "docker/build-push-action must set load: true so the image exists locally for the run step")
    }
    const runs = steps.map(({ step }) => step.run).filter(nonEmptyString).join("\n")
    if (!/\bdocker run\b/.test(runs)) add("docker-verify-run", "docker-verify.yml must run the built image (docker run)")
    if (!existsSync(join(repoRoot, "Dockerfile"))) add("dockerfile", "docker-verify.yml builds the repository Dockerfile, but ./Dockerfile does not exist")
  }

  if (fileKey === "release.yml") {
    const push = triggers !== null && isMap(triggers.push) ? triggers.push : null
    const tags = push !== null && Array.isArray(push.tags) ? push.tags : []
    if (tags.length === 0) add("release-trigger", "release.yml must trigger on push.tags")
    else if (!tags.includes("v*")) add("release-trigger", `release.yml push.tags must include 'v*', got ${JSON.stringify(tags)}`)
    const permissions = isMap(data.permissions) ? data.permissions : {}
    if (permissions.contents !== "write") add("release-permissions", "release.yml needs permissions.contents: write for the GitHub Release")
    if (permissions.packages !== "write") add("release-permissions", "release.yml needs permissions.packages: write for the GHCR push")
    if (permissions["id-token"] !== "write") {
      add("release-id-token", "release.yml needs permissions.id-token: write so npm Trusted Publishing can exchange a GitHub OIDC token")
    }
    // A literal disabling condition on a release job makes npm publish, the GitHub Release and
    // the GHCR push no-ops while the run still reports success, so release.yml refuses one. A
    // condition that can legitimately be true is untouched: only an always-false value counts.
    for (const [jobId, job] of jobs) {
      if (isMap(job) && isDisabledCondition(job.if)) {
        add(
          "release-job-if-disabled",
          `release.yml jobs.${jobId}.if is always false (${JSON.stringify(job.if)}); the release would be skipped while the run still reports success`,
        )
      }
    }
    // Trusted Publishing is tokenless. The parsed tree carries no comments, so release.yml's
    // explanatory comment (which names these tokens) is not scanned — only semantic values are.
    const semantic = JSON.stringify(data)
    for (const token of NPM_TOKENLESS_DENY) {
      if (semantic.includes(token)) {
        add("release-npm-tokenless", `release.yml must stay tokenless for Trusted Publishing; found ${JSON.stringify(token)} in a workflow value (not a comment)`)
      }
    }
    const checkout = findStep(steps, "actions/checkout")
    if (checkout === undefined) {
      add("release-checkout-depth", "release.yml must check out the repository")
    } else {
      const input = isMap(checkout.step.with) ? checkout.step.with : {}
      if (Number(input["fetch-depth"]) !== 0) add("release-checkout-depth", "release.yml actions/checkout must set fetch-depth: 0 for release notes")
    }
    validateSetupPins(steps, add, "release-setup")
    const versionStep = steps.find(
      ({ step }) => nonEmptyString(step.run) && step.run.includes("GITHUB_REF_NAME") && step.run.includes("package.json"),
    )
    if (versionStep === undefined) {
      add("release-version-assert", "release.yml must assert the tag version equals the package.json version (GITHUB_REF_NAME + package.json)")
    } else if (!/(!==|!=|-ne|exit 1)/.test(versionStep.step.run)) {
      add("release-version-assert", "release.yml version assert must fail on a mismatch (exit 1 or a != comparison)")
    }
    gateSequenceIssues(data, fileKey, add)
    if (versionStep !== undefined) {
      const firstGate = steps.find(({ step }) => nonEmptyString(step.run) && matchCommand(step.run, GATE_COMMANDS[0], 0) !== null)
      const versionIndex = steps.indexOf(versionStep)
      const gateIndex = firstGate === undefined ? -1 : steps.indexOf(firstGate)
      if (gateIndex !== -1 && versionIndex > gateIndex) add("release-version-assert-order", "release.yml must assert the tag version before running the gates")
    }
    const releaseStep = findStep(steps, "softprops/action-gh-release")
    if (releaseStep === undefined) {
      add("release-assets", "release.yml must create a GitHub Release with softprops/action-gh-release")
    } else {
      const input = isMap(releaseStep.step.with) ? releaseStep.step.with : {}
      const files = String(input.files ?? "")
      if (!files.includes("dist/*.tgz")) add("release-assets", "release.yml release files must include dist/*.tgz")
      if (!files.includes("dist/silicon-package.tar.gz")) add("release-assets", "release.yml release files must include dist/silicon-package.tar.gz")
      if (input.generate_release_notes !== true) add("release-assets", "release.yml must set generate_release_notes: true")
    }
    const publishSteps = steps.filter(({ step }) => nonEmptyString(step.run) && NPM_PUBLISH_PATTERN.test(step.run))
    if (publishSteps.length === 0) {
      add("release-npm-publish", `release.yml must stage the npm publish with a step whose run is exactly ${JSON.stringify(NPM_STAGE_PUBLISH_COMMAND)} (Trusted Publishing)`)
    } else {
      const publishEntry = publishSteps[0]
      const publishIndex = steps.indexOf(publishEntry)
      const publishStep = publishEntry.step
      if (publishSteps.length > 1) {
        add("release-npm-publish", `release.yml must stage the npm publish from exactly one step; ${publishSteps.length} steps mention npm publish`)
      }
      const publishRun = publishStep.run.trim()
      if (publishRun !== NPM_STAGE_PUBLISH_COMMAND) {
        const plainPublish = /\bnpm\s+publish\b/.test(publishRun)
        add(
          "release-npm-publish",
          plainPublish
            ? `release.yml must use staged publishing (${JSON.stringify(NPM_STAGE_PUBLISH_COMMAND)}), not a plain \`npm publish\`; got ${JSON.stringify(publishRun)}`
            : `release.yml npm staging step must run exactly ${JSON.stringify(NPM_STAGE_PUBLISH_COMMAND)} — no --dry-run, echo, if-guard or || chain; got ${JSON.stringify(publishRun)}`,
        )
      }
      for (const key of NPM_PUBLISH_SHAPE_KEYS) {
        if (publishStep[key] !== undefined) add("release-npm-publish", `release.yml npm staging step must not set ${key}; the staged publish itself must be unconditional`)
      }
      for (const key of NPM_PUBLISH_TOKEN_KEYS) {
        if (publishStep[key] !== undefined) add("release-npm-tokenless", `release.yml npm staging step must not set ${key}; Trusted Publishing supplies its own short-lived OIDC token`)
      }
      const artifactIndex = steps.reduce(
        (found, { step }, index) => (nonEmptyString(step.run) && /npm pack|silicon-package\.tar\.gz/.test(step.run) ? index : found),
        -1,
      )
      if (artifactIndex !== -1 && publishIndex < artifactIndex) {
        add("release-npm-publish-order", "release.yml must publish to npm after the pack/archive steps")
      }
      if (releaseStep !== undefined && publishIndex > steps.indexOf(releaseStep)) {
        add("release-npm-publish-order", "release.yml must publish to npm before creating the GitHub Release")
      }
    }
    const login = findStep(steps, "docker/login-action")
    if (login === undefined) {
      add("release-ghcr", "release.yml must log in to GHCR with docker/login-action")
    } else {
      const input = isMap(login.step.with) ? login.step.with : {}
      if (input.registry !== "ghcr.io") add("release-ghcr", `docker/login-action registry must be ghcr.io, got ${JSON.stringify(input.registry)}`)
    }
    const pushStep = findStep(steps, "docker/build-push-action")
    if (pushStep === undefined) {
      add("release-ghcr", "release.yml must push the image with docker/build-push-action")
    } else {
      const input = isMap(pushStep.step.with) ? pushStep.step.with : {}
      if (input.push !== true) add("release-ghcr", "docker/build-push-action must set push: true")
      if (!String(input.tags ?? "").includes("ghcr.io/")) add("release-ghcr", "docker/build-push-action tags must target ghcr.io")
    }
  }

  return issues
}

function matchesRunner(runner, major) {
  const match = typeof runner === "string" ? /^ubuntu-(\d{2})\.(\d{2})$/.exec(runner) : null
  if (match === null) return false
  return Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= 4)
}

function collectWorkflowFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .sort()
    .map((entry) => join(dir, entry))
}

function requiredFileIssues(dir) {
  const issues = []
  for (const name of REQUIRED_WORKFLOWS) {
    if (!existsSync(join(dir, name))) issues.push({ rule: "missing-workflow", message: `required workflow is missing: ${name}` })
  }
  return issues
}

function listFiles(dir) {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files.sort()
}

/** Validate a set of files; returns Map<file, issue[]>. */
function validateFiles(files, oracle) {
  const result = new Map()
  for (const file of files) result.set(file, rawChecks(readFileSync(file, "utf8")))
  if (oracle === null) return result
  const parsed = parseFiles(oracle, files)
  if (parsed.error !== undefined) {
    for (const file of files) result.get(file).push({ rule: "yaml-parse", message: parsed.error })
    return result
  }
  const byFile = new Map(parsed.results.map((item) => [item.file, item]))
  for (const file of files) {
    const item = byFile.get(file)
    if (item === undefined) result.get(file).push({ rule: "yaml-parse", message: "parser returned no result for this file" })
    else if (!item.ok) result.get(file).push({ rule: "yaml-parse", message: String(item.error) })
    else result.get(file).push(...validateWorkflow(file, item.data))
  }
  return result
}

function printIssues(label, issues) {
  if (issues.length === 0) {
    console.log(`PASS ${label}`)
    return true
  }
  console.log(`FAIL ${label}`)
  for (const issue of issues) console.log(`  [${issue.rule}] ${issue.message}`)
  return false
}

function printFileResults(files, issuesByFile) {
  let ok = true
  for (const file of files) {
    if (!printIssues(relative(repoRoot, file) || file, issuesByFile.get(file) ?? [])) ok = false
  }
  return ok
}

const GOOD_FIXTURE = `name: Good fixture
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Typecheck
        run: node scripts/typecheck.mjs --require
`

const CI_GATE_STEPS = GATE_COMMANDS.map(
  (command, index) => `      - name: Gate ${index + 1}\n        run: ${command}`,
).join("\n")

const CI_FIXTURE = `name: CI — static gates
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  gates:
    name: Static gates
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install dependencies
        run: bun install --frozen-lockfile
${CI_GATE_STEPS}
      - uses: actions/upload-artifact@v4
        with:
          name: silicon-package
          path: dist/silicon-package
          retention-days: 7
`

const BOOT_FIXTURE = `name: CI — boot e2e (real harness mounts)
on:
  push:
    branches: [main]
    paths:
      - packages/**
      - scripts/**
      - package.json
      - bun.lock
      - packages/mpd-bundle/cordis.patch.yml
      - .github/workflows/boot-e2e.yml
  workflow_dispatch:
permissions:
  contents: read
jobs:
  boot:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Install the harness CLI
        run: npm install -g @deepseek-ai/dsh@0.2.1-rc.2
      - name: Boot
        run: node scripts/ci-boot.mjs --require
      - uses: actions/upload-artifact@v4
        with:
          name: ci-boot-logs
          path: dist/ci-boot-logs
          retention-days: 7
`

const RELEASE_ASSERT_STEP = `      - name: Assert the tag matches the package version
        run: |
          set -euo pipefail
          tag="\${GITHUB_REF_NAME#v}"
          version="$(node -p "require('./package.json').version")"
          if [ "$tag" != "$version" ]; then
            echo "release: tag $GITHUB_REF_NAME does not match package.json version $version" >&2
            exit 1
          fi
`

const NPM_PUBLISH_STEP = `      - name: Stage the npm publish (Trusted Publishing / OIDC)
        run: npm stage publish --access public --provenance
`

// Adversarial copies of the publish step. Each one carries the exact command text (or a
// prefix of it) yet must not count as an effective staged publish.
const NPM_PLAIN_PUBLISH_STEP = `      - name: Publish to npm directly
        run: npm publish --access public --provenance
`

const NPM_PUBLISH_DRY_RUN_STEP = `      - name: Stage the npm publish (Trusted Publishing / OIDC)
        run: npm stage publish --access public --provenance --dry-run
`

const NPM_PUBLISH_GUARDED_STEP = `      - name: Stage the npm publish (Trusted Publishing / OIDC)
        if: false
        run: npm stage publish --access public --provenance
`

const NPM_PUBLISH_CONTINUE_ON_ERROR_STEP = `      - name: Stage the npm publish (Trusted Publishing / OIDC)
        continue-on-error: true
        run: npm stage publish --access public --provenance
`

const NPM_PUBLISH_LEGACY_TOKEN_STEP = `      - name: Stage the npm publish (Trusted Publishing / OIDC)
        env:
          LEGACY_PUBLISH_SECRET: \${{ secrets.LEGACY_PUBLISH_SECRET }}
        run: |
          npm config set //registry.npmjs.org/:_password "$LEGACY_PUBLISH_SECRET"
          npm stage publish --access public --provenance
`

// Independent controls for the two publish-rule clauses that had none: "exactly one publish
// step" and "the publish step carries no env, whatever the variable is named".
const NPM_SECOND_PUBLISH_STEP = `      - name: Stage the npm publish again
        run: npm stage publish --access public --provenance
`

const NPM_PUBLISH_ARBITRARY_ENV_STEP = `      - name: Stage the npm publish (Trusted Publishing / OIDC)
        env:
          SOME_RANDOM_NAME: value
        run: npm stage publish --access public --provenance
`

const DOCKER_FIXTURE = `name: CI — docker real-machine verification
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: write
jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          load: true
          tags: mpd-silicon-verify:ci
      - name: Run the image
        run: docker run --rm --name mpd-silicon-verify mpd-silicon-verify:ci
`

const RELEASE_GATE_STEPS = GATE_COMMANDS.map(
  (command, index) => `      - name: Gate ${index + 1}\n        run: ${command}`,
).join("\n")

const RELEASE_FIXTURE = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
  id-token: write
  packages: write
jobs:
  release:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install dependencies
        run: bun install --frozen-lockfile
${RELEASE_ASSERT_STEP}${RELEASE_GATE_STEPS}
      - name: Pack the npm tarball
        run: npm pack --pack-destination dist
${NPM_PUBLISH_STEP}      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/example/mpd-silicon:\${{ github.ref_name }}
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/*.tgz
            dist/silicon-package.tar.gz
          generate_release_notes: true
`

/**
 * Self-test: every valid fixture must pass, and every tampered fixture must be rejected
 * by the specific rule it targets. A validator that cannot fail is not a check.
 */
function runSelfTest(oracle) {
  const dir = mkdtempSync(join(tmpdir(), "silicon-github-workflows-"))
  try {
    const fixtures = [
      { file: "good.yml", content: GOOD_FIXTURE, expected: null },
      { file: "bad-name.yml", content: GOOD_FIXTURE.replace("name: Good fixture\n", ""), expected: "name" },
      { file: "bad-on.yml", content: GOOD_FIXTURE.replace("on:\n  push:\n    branches: [main]\n", ""), expected: "on" },
      { file: "bad-permissions.yml", content: GOOD_FIXTURE.replace("permissions:\n  contents: read\n", ""), expected: "permissions" },
      { file: "bad-jobs.yml", content: GOOD_FIXTURE.split("jobs:")[0], expected: "jobs" },
      { file: "bad-runs-on.yml", content: GOOD_FIXTURE.replace("    runs-on: ubuntu-24.04\n", ""), expected: "runs-on" },
      {
        file: "bad-steps.yml",
        content: GOOD_FIXTURE.replace(
          "    steps:\n      - uses: actions/checkout@v4\n      - name: Typecheck\n        run: node scripts/typecheck.mjs --require\n",
          "    steps: []\n",
        ),
        expected: "steps",
      },
      {
        file: "bad-step-body.yml",
        content: GOOD_FIXTURE.replace("      - name: Typecheck\n        run: node scripts/typecheck.mjs --require\n", "      - name: No body\n"),
        expected: "step-body",
      },
      { file: "bad-tab.yml", content: GOOD_FIXTURE.replace("run: node scripts/typecheck.mjs --require", "run: node scripts/typecheck.mjs --require\t# tab"), expected: "no-tabs" },
      { file: "bad-script.yml", content: GOOD_FIXTURE.replace("scripts/typecheck.mjs", "scripts/missing-gate.mjs"), expected: "script-ref" },
      {
        file: "bad-provider.yml",
        content: GOOD_FIXTURE.replace("node scripts/typecheck.mjs --require", `node scripts/typecheck.mjs --require # ${RETIRED_PROVIDER} mirror`),
        expected: "provider-reference",
      },
      {
        file: "bad-registry.yml",
        content: GOOD_FIXTURE.replace("node scripts/typecheck.mjs --require", `node scripts/typecheck.mjs --require # ${RETIRED_REGISTRY} registry`),
        expected: "registry-reference",
      },
      {
        file: "bad-pipeline-dir.yml",
        content: GOOD_FIXTURE.replace(
          "      - name: Typecheck\n",
          `      - name: Retired pipeline\n        run: ls ${RETIRED_DIR}\n      - name: Typecheck\n`,
        ),
        expected: "pipeline-dir-reference",
      },
      { file: "bad-yaml.yml", content: "name: CI\non: push\n  broken: [\n", expected: "yaml-parse" },
      { file: "ci.yml", content: CI_FIXTURE, expected: null },
      {
        file: "ci.yml",
        content: CI_FIXTURE.replace("      - name: Gate 2\n        run: bun test packages/\n", ""),
        expected: "gate-missing",
      },
      {
        file: "ci.yml",
        content: CI_FIXTURE.replace(
          "      - name: Gate 1\n        run: node scripts/typecheck.mjs --require\n      - name: Gate 2\n        run: bun test packages/\n",
          "      - name: Gate 1\n        run: bun test packages/\n      - name: Gate 2\n        run: node scripts/typecheck.mjs --require\n",
        ),
        expected: "gate-order",
      },
      { file: "ci.yml", content: CI_FIXTURE.replace("permissions:\n  contents: read", "permissions:\n  contents: write"), expected: "ci-no-publish" },
      { file: "boot-e2e.yml", content: BOOT_FIXTURE, expected: null },
      {
        file: "boot-e2e.yml",
        content: BOOT_FIXTURE.replace("  workflow_dispatch:\n", "  pull_request:\n    branches: [main]\n  workflow_dispatch:\n"),
        expected: "boot-e2e-no-pr",
      },
      { file: "docker-verify.yml", content: DOCKER_FIXTURE, expected: null },
      {
        file: "docker-verify.yml",
        content: DOCKER_FIXTURE.replace("        run: docker run --rm --name mpd-silicon-verify mpd-silicon-verify:ci\n", ""),
        expected: "docker-verify-run",
      },
      { file: "release.yml", content: RELEASE_FIXTURE, expected: null },
      { file: "release.yml", content: RELEASE_FIXTURE.replace(RELEASE_ASSERT_STEP, ""), expected: "release-version-assert" },
      { file: "release.yml", content: RELEASE_FIXTURE.replace("registry: ghcr.io", "registry: registry.example.com"), expected: "release-ghcr" },
      { file: "release.yml", content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, ""), expected: "release-npm-publish" },
      { file: "release.yml", content: RELEASE_FIXTURE.replace("  id-token: write\n", ""), expected: "release-id-token" },
      {
        file: "release.yml",
        content: RELEASE_FIXTURE.replace(
          NPM_PUBLISH_STEP,
          `      - name: Publish to npm\n        run: |\n          echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" > .npmrc\n          npm stage publish --access public --provenance\n`,
        ),
        expected: "release-npm-tokenless",
      },
      // H1: a publish step must be EFFECTIVE, not merely mention the command.
      { file: "release.yml", label: "dry-run", content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PUBLISH_DRY_RUN_STEP), expected: "release-npm-publish" },
      // Staged publishing is required: a plain `npm publish` is a direct publish, which the
      // trusted publisher denies (the v0.7.1 E403), so it must not pass this gate.
      {
        file: "release.yml",
        label: "plain-publish (non-stage)",
        content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PLAIN_PUBLISH_STEP),
        expected: "release-npm-publish",
      },
      { file: "release.yml", label: "if-guard", content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PUBLISH_GUARDED_STEP), expected: "release-npm-publish" },
      {
        file: "release.yml",
        label: "continue-on-error",
        content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PUBLISH_CONTINUE_ON_ERROR_STEP),
        expected: "release-npm-publish",
      },
      // M1: tokenless is asserted positively (exact run, no env/with) and by value.
      { file: "release.yml", label: "legacy-token-env", content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PUBLISH_LEGACY_TOKEN_STEP), expected: "release-npm-tokenless" },
      // M2: a publish step moved after the GitHub Release must be named by the order rule.
      {
        file: "release.yml",
        label: "publish-after-release",
        content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, "") + NPM_PUBLISH_STEP,
        expected: "release-npm-publish-order",
      },
      // F1: a literally disabled release job skips the whole release behind a green run.
      {
        file: "release.yml",
        label: "job-if-disabled",
        content: RELEASE_FIXTURE.replace("    runs-on: ubuntu-24.04\n", "    if: false\n    runs-on: ubuntu-24.04\n"),
        expected: "release-job-if-disabled",
      },
      // F2: the two publish-rule clauses that had no independent control.
      {
        file: "release.yml",
        label: "second-publish-step",
        content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PUBLISH_STEP + NPM_SECOND_PUBLISH_STEP),
        expected: "release-npm-publish",
      },
      {
        file: "release.yml",
        label: "publish-arbitrary-env",
        content: RELEASE_FIXTURE.replace(NPM_PUBLISH_STEP, NPM_PUBLISH_ARBITRARY_ENV_STEP),
        expected: "release-npm-tokenless",
      },
    ]
    let passed = 0
    for (const [index, fixture] of fixtures.entries()) {
      const caseDir = join(dir, `case-${index}`)
      mkdirSync(caseDir, { recursive: true })
      const file = join(caseDir, fixture.file)
      writeFileSync(file, fixture.content)
      const issues = validateFiles([file], oracle).get(file) ?? []
      const label = fixture.expected === null ? "valid workflow accepted" : `tampered workflow rejected by ${fixture.expected}`
      const ok = fixture.expected === null ? issues.length === 0 : issues.some((issue) => issue.rule === fixture.expected)
      if (ok) passed += 1
      console.log(`${ok ? "PASS" : "FAIL"} self-test: ${fixture.file}${fixture.label === undefined ? "" : ` (${fixture.label})`} — ${label}`)
      if (!ok) for (const issue of issues) console.log(`  [${issue.rule}] ${issue.message}`)
    }

    const subsetDir = join(dir, "case-missing-workflow")
    mkdirSync(subsetDir, { recursive: true })
    writeFileSync(join(subsetDir, "ci.yml"), CI_FIXTURE)
    const missing = requiredFileIssues(subsetDir)
    const missingOk = missing.some((issue) => issue.rule === "missing-workflow")
    if (missingOk) passed += 1
    console.log(`${missingOk ? "PASS" : "FAIL"} self-test: missing-workflow — a missing required workflow is rejected`)
    if (!missingOk) for (const issue of missing) console.log(`  [${issue.rule}] ${issue.message}`)

    const total = fixtures.length + 1
    console.log(`verify-github-workflows self-test: ${passed}/${total} fixtures behaved`)
    return passed === total
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Validate the real tree: required workflows, every workflow file, and every other file
 * under the scan root (the retired-reference ban covers all of .github/**).
 */
function validateTree(oracle) {
  const files = collectWorkflowFiles(workflowDir)
  if (files.length === 0) {
    console.error(`verify-github-workflows: no workflow files under ${workflowDir}`)
    return false
  }
  console.log(`verify-github-workflows: ${files.length} workflow file(s) under ${relative(repoRoot, workflowDir) || workflowDir}`)
  let ok = true
  const requiredLabel = `${relative(repoRoot, workflowDir) || workflowDir} (required set)`
  if (!printIssues(requiredLabel, requiredFileIssues(workflowDir))) ok = false
  const issuesByFile = validateFiles(files, oracle)
  for (const file of listFiles(scanRoot)) {
    if (files.includes(file)) continue
    const issues = forbiddenIssues(readFileSync(file, "utf8"))
    if (issues.length > 0) issuesByFile.set(file, issues)
  }
  const printed = [...new Set([...files, ...issuesByFile.keys()])].sort()
  if (!printFileResults(printed, issuesByFile)) ok = false
  return ok
}

function main() {
  const oracle = findOracle()
  if (oracle !== null) console.log(`verify-github-workflows: oracle ${oracle.label}`)
  if (selfTest) {
    if (oracle === null) {
      console.error("verify-github-workflows: --self-test needs a YAML parser (python3+PyYAML or bun); cannot prove falsifiability")
      return 3
    }
    if (!existsSync(workflowDir) || collectWorkflowFiles(workflowDir).length === 0) {
      console.error(`verify-github-workflows: no workflow files under ${workflowDir}`)
      return 1
    }
    const realOk = validateTree(oracle)
    const fixturesOk = runSelfTest(oracle)
    return realOk && fixturesOk ? 0 : 1
  }

  if (!existsSync(workflowDir) || collectWorkflowFiles(workflowDir).length === 0) {
    console.error(`verify-github-workflows: no workflow files under ${workflowDir}`)
    return 1
  }
  if (oracle === null) {
    console.log("WARN no YAML parser available (tried python3+PyYAML, then bun+Bun.YAML.parse)")
    console.log("WARN structural validation SKIPPED; only raw checks (tabs, script references, retired references) ran")
    console.log("WARN install PyYAML or bun to make this gate structural; --require turns this skip into exit 3")
    if (!validateTree(null)) return 1
    return requireOracle ? 3 : 0
  }
  return validateTree(oracle) ? 0 : 1
}

process.exit(main())
