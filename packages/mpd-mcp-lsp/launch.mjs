#!/usr/bin/env node
// launch.mjs — PATH-priming launcher for the pinned HDL language service.
//
// The pinned dist/cli.js (recorded in BUILD.lock) finds `verible-verilog-ls` and
// `slang-server` on PATH, so the silicon toolchain configuration has to reach it
// as an environment change. The MCP row therefore launches THIS hand-written
// file, not a build artifact: it reads the toolchain config, prepends the
// configured bin directories to PATH, and then starts the pinned CLI with that
// environment. dist/ stays byte-identical to BUILD.lock, and build-lsp.mjs never
// touches this file (it lives beside dist/, which the packer copies explicitly).
//
// Config layers, deep-merged with the project winning:
//   user:    $MPD_SILICON_CONFIG, else ${DSH_HOME:-~/.dsh}/silicon.jsonc
//   project: <cwd>/.mpd/silicon.jsonc
//
// The project layer is resolved from the dsh PROCESS cwd, so it only works when
// that cwd IS the workspace. A dsh process started from another directory (the
// common GUI case) will not see it; the user-level file is the reliable layer.
//
// PATH order: ossCadSuite bin, then verible bin, then slangServer bin, then the
// inherited PATH. Only existing directories are prepended. A missing config file
// is normal; a malformed or unreadable one produces ONE warning on stderr and
// leaves PATH unchanged. Nothing is ever written to stdout: MCP JSON-RPC owns that stream.
//
// Usage: node launch.mjs <cli.js> [mcp|...]
import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir, constants as osConstants } from "node:os"
import { delimiter, join, resolve } from "node:path"

const WARN_PREFIX = "[silicon-lsp-launcher] WARN: "
const ERROR_PREFIX = "[silicon-lsp-launcher] ERROR: "

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Strip // and slash-star comments outside strings. The scanner tracks string
 * state so a `//` inside a quoted path/URL survives.
 * @param {string} text JSONC source
 * @returns {string} JSON source without comments
 */
function stripComments(text) {
  let out = ""
  let inString = false
  let escaped = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (inLine) {
      if (ch === "\n") {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        i += 1
      }
      continue
    }
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      inLine = true
      i += 1
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      i += 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * Drop trailing commas outside strings, so JSON.parse accepts the JSONC form.
 * @param {string} text comment-free JSONC source
 * @returns {string} JSON source without trailing commas
 */
function stripTrailingCommas(text) {
  let out = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ",") {
      let lookahead = i + 1
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1
      if (text[lookahead] === "}" || text[lookahead] === "]") continue
    }
    out += ch
  }
  return out
}

/**
 * Parse the JSONC subset this file uses: comments and trailing commas.
 * @param {string} text config file contents
 * @returns {unknown} parsed value
 */
function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripComments(text)))
}

/**
 * Read one config layer. A missing file returns undefined (normal); any other
 * failure is thrown so the caller can warn once and leave PATH unchanged.
 * @param {string} path config path
 * @returns {Record<string, unknown> | undefined} parsed layer
 */
function readLayer(path) {
  let text
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return undefined
    throw error
  }
  const parsed = parseJsonc(text)
  if (!isRecord(parsed)) throw new Error("top-level value is not a JSON object")
  return parsed
}

/**
 * Deep-merge plain objects; override wins, arrays and scalars are replaced.
 * @param {Record<string, unknown>} base lower-priority layer
 * @param {Record<string, unknown>} override higher-priority layer
 * @returns {Record<string, unknown>} merged layer
 */
function merge(base, override) {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key]
    result[key] = isRecord(previous) && isRecord(value) ? merge(previous, value) : value
  }
  return result
}

/**
 * Load the user layer overlaid by the project layer. On the first malformed or
 * unreadable layer, warn once on stderr and return an empty config.
 * @returns {Record<string, unknown>} merged config
 */
function loadConfig() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh")
  const layers = [
    ["user", process.env.MPD_SILICON_CONFIG ?? join(dshHome, "silicon.jsonc")],
    ["project", join(process.cwd(), ".mpd", "silicon.jsonc")],
  ]
  let merged = {}
  for (const [label, path] of layers) {
    if (!existsSync(path)) continue
    try {
      merged = merge(merged, readLayer(path))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(WARN_PREFIX + "ignoring " + label + " config " + path + " (" + detail + "); PATH left unchanged")
      return {}
    }
  }
  return merged
}

/**
 * Resolve a section's bin directory: `bin` wins, else `home + "/bin"`.
 * @param {unknown} section config section
 * @returns {string | undefined} configured directory
 */
function configuredBin(section) {
  if (!isRecord(section)) return undefined
  if (typeof section.bin === "string" && section.bin.length > 0) return section.bin
  if (typeof section.home === "string" && section.home.length > 0) return join(section.home, "bin")
  return undefined
}

/**
 * @param {unknown} candidate configured path
 * @returns {string | undefined} absolute path when it is an existing directory
 */
function existingDir(candidate) {
  if (typeof candidate !== "string") return undefined
  const absolute = resolve(candidate)
  try {
    return statSync(absolute).isDirectory() ? absolute : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {Record<string, unknown>} config merged config
 * @returns {string[]} directories to prepend, in PATH order
 */
function prependDirs(config) {
  const dirs = []
  for (const key of ["ossCadSuite", "verible", "slangServer"]) {
    const dir = existingDir(configuredBin(config[key]))
    if (dir !== undefined && !dirs.includes(dir)) dirs.push(dir)
  }
  return dirs
}

/**
 * @param {Record<string, unknown>} config merged config
 * @returns {NodeJS.ProcessEnv} environment for the pinned CLI
 */
function childEnv(config) {
  const env = { ...process.env }
  const dirs = prependDirs(config)
  if (dirs.length > 0) {
    const inherited = typeof env.PATH === "string" && env.PATH.length > 0 ? [env.PATH] : []
    env.PATH = [...dirs, ...inherited].join(delimiter)
  }
  return env
}

const argv = process.argv.slice(2)
const cli = argv[0]
if (typeof cli !== "string" || cli.length === 0) {
  console.error("usage: node launch.mjs <cli.js> [args...]")
  process.exit(2)
}

const child = spawn(process.execPath, [cli, ...argv.slice(1)], {
  stdio: "inherit",
  env: childEnv(loadConfig()),
})

let settled = false
const fail = (message) => {
  if (settled) return
  settled = true
  console.error(ERROR_PREFIX + message)
  process.exit(1)
}

child.on("error", (error) => {
  fail("failed to start " + process.execPath + ": " + error.message)
})

child.on("exit", (code, signal) => {
  if (settled) return
  settled = true
  if (signal !== null) {
    const number = osConstants.signals[signal]
    process.exit(typeof number === "number" ? 128 + number : 1)
  }
  process.exit(code ?? 1)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!settled) child.kill(signal)
  })
}
