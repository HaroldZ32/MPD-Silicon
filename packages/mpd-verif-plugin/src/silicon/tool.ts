// The conversational `mpd_verif_toolchain` tool: one entry point for "where is
// oss-cad-suite / verible / librelane installed?" questions.
//
// Actions are thin wrappers over ./config (show/set/unset/init/path/detect); the
// module owns the tool DEFINITION (parameters + render) so index.ts stays a
// registration list. Every refusal crosses the DSH seam as the structured
// { ok:false, error:{code,message,hint} } shape produced by refusalOf.
import { existsSync } from "node:fs"
import { refusalOf, VerifError } from "../errors"
import type { DshToolDef } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import {
  detectToolchains,
  initConfigFile,
  setConfigValue,
  showConfig,
  siliconPaths,
  unsetConfigValue,
  type DetectResult,
  type InitResult,
  type SetResult,
  type ShowResult,
  type UnsetResult,
} from "./config"

/** The action vocabulary the tool accepts (default `show`). */
const ACTIONS = ["show", "set", "unset", "init", "path", "detect"] as const
/** One accepted action. */
type Action = (typeof ACTIONS)[number]

/** The `path` action's payload. */
interface PathResult {
  ok: true
  action: "path"
  dshHome: string
  workspaceRoot: string
  userFile: { path: string; exists: boolean }
  workspaceFile: { path: string; exists: boolean }
}

/** The result union the tool returns before rendering. */
type ToolchainResult = ShowResult | SetResult | UnsetResult | InitResult | PathResult | DetectResult

/** Narrow an incoming action string (unknown values fall back to `show`). */
function normalizeAction(value: unknown): Action {
  const action = String(value ?? "show")
  return (ACTIONS as readonly string[]).includes(action) ? (action as Action) : "show"
}

/** The two paths, their existence, and the DSH home in use. */
function pathInfo(exec?: unknown): PathResult {
  const p = siliconPaths(exec)
  return {
    ok: true,
    action: "path",
    dshHome: p.dshHome,
    workspaceRoot: p.workspaceRoot,
    userFile: { path: p.userFile, exists: existsSync(p.userFile) },
    workspaceFile: { path: p.workspaceFile, exists: existsSync(p.workspaceFile) },
  }
}

/** Run one action; refusals are thrown as VerifError and converted at this boundary. */
function dispatch(args: Record<string, unknown>, exec: unknown): ToolchainResult {
  const action = normalizeAction(args.action)
  switch (action) {
    case "show":
      return showConfig(exec, typeof args.key === "string" && args.key.trim().length > 0 ? args.key : undefined)
    case "set": {
      if (typeof args.key !== "string" || args.key.trim().length === 0) {
        throw new VerifError("VERIF_E_CONFIG", "action=set needs a key", "pass key like ossCadSuite.bin or librelane.mode")
      }
      if (args.value === undefined) {
        throw new VerifError("VERIF_E_CONFIG", "action=set needs a value", "pass value (string / boolean) matching the key's schema type")
      }
      return setConfigValue({ key: args.key, value: args.value, scope: typeof args.scope === "string" ? args.scope : undefined }, exec)
    }
    case "unset": {
      if (typeof args.key !== "string" || args.key.trim().length === 0) {
        throw new VerifError("VERIF_E_CONFIG", "action=unset needs a key", "pass key like ossCadSuite.bin")
      }
      return unsetConfigValue({ key: args.key, scope: typeof args.scope === "string" ? args.scope : undefined }, exec)
    }
    case "init":
      return initConfigFile({ scope: typeof args.scope === "string" ? args.scope : undefined, force: args.force === true }, exec)
    case "path":
      return pathInfo(exec)
    case "detect":
      return detectToolchains()
  }
}

/** Compact one-line-per-item text rendering for the harness UI. */
function render(value: unknown): { type: "text"; text: string }[] {
  const v = value as Record<string, any>
  if (v && v.error) {
    return [{ type: "text", text: `mpd_verif_toolchain FAILED: ${v.error.message}\nhint: ${v.error.hint}` }]
  }
  switch (v?.action) {
    case "set":
      return [{ type: "text", text: `mpd_verif_toolchain set ${v.scope}:${v.key} = ${JSON.stringify(v.new)} (old ${JSON.stringify(v.old)}, ${v.changed ? "written" : "unchanged"})\nfile: ${v.file}${(v.notes ?? []).length > 0 ? "\nnotes: " + v.notes.map((n: any) => n.detail).join("; ") : ""}` }]
    case "unset":
      return [{ type: "text", text: `mpd_verif_toolchain unset ${v.scope}:${v.key} (old ${JSON.stringify(v.old)}, ${v.changed ? "removed" : "not set"})\nfile: ${v.file}` }]
    case "init":
      return [{ type: "text", text: `mpd_verif_toolchain init: template ${v.created ? "written" : "unchanged"} (${v.scope})\nfile: ${v.file}` }]
    case "path":
      return [{ type: "text", text: `mpd_verif_toolchain paths\nuser: ${v.userFile.path} (${v.userFile.exists ? "exists" : "missing"})\nproject: ${v.workspaceFile.path} (${v.workspaceFile.exists ? "exists" : "missing"})\nDSH_HOME: ${v.dshHome}\nworkspace: ${v.workspaceRoot}` }]
    case "detect": {
      const suggestions = (v.suggestions ?? []).map((s: any) => `  ${s.key} = ${s.value}  (${s.evidence})`).join("\n")
      return [{ type: "text", text: `mpd_verif_toolchain detect — ${(v.suggestions ?? []).length} suggestion(s)\n${suggestions || "  none found"}${v.note ? "\n" + v.note : ""}` }]
    }
    case "show": {
      const user = v.userFile
      const project = v.workspaceFile
      const files = `user: ${user.path} (${user.exists ? "exists" : "missing"}${user.parseError ? ", parse error" : ""})\nproject: ${project.path} (${project.exists ? "exists" : "missing"}${project.parseError ? ", parse error" : ""})`
      const backends = (v.backends ?? []).map((b: any) => `  ${b.name}: ${b.binary ?? "unresolved"}${b.source ? " [" + b.source + "]" : ""}${b.version ? " — " + b.version : ""}`).join("\n")
      const paths = (v.paths ?? []).map((p: any) => `  ${p.key}: ${p.path} (${p.kind}${p.executable ? ", executable" : ""})`).join("\n")
      const focused = v.key ? `\nkey ${v.key.key} = ${JSON.stringify(v.key.value)} [${v.key.source ?? "unset"}]` : ""
      const problems = [
        ...(v.parseErrors ?? []).map((e: any) => `parse error (${e.file}): ${e.error}`),
        ...(v.unknownKeys ?? []).map((k: string) => `unknown key: ${k}`),
        ...(v.invalidKeys ?? []).map((i: any) => `invalid ${i.key}: expected ${i.expected}, got ${i.actual}`),
      ]
      return [{ type: "text", text: `mpd_verif_toolchain show${focused}\n${files}\nresolved backends:\n${backends || "  (none)"}${paths ? "\nconfigured paths:\n" + paths : ""}${problems.length > 0 ? "\nproblems:\n  " + problems.join("\n  ") : ""}` }]
    }
    default:
      return [{ type: "text", text: `mpd_verif_toolchain: ${JSON.stringify(v)}` }]
  }
}

/** The tool definition registered as the ninth `mpd_verif_*` tool. */
export function toolchainToolDefinition(): DshToolDef {
  return {
    name: "mpd_verif_toolchain",
    description: "Inspect and edit the silicon toolchain config (oss-cad-suite / verible / librelane). Layers: user $DSH_HOME/silicon.jsonc, project <workspace>/.mpd/silicon.jsonc (project wins; env MPD_DSH_VERIF_* still wins at run time, PATH last). action=show (optional key) reports the effective config, per-key source layer, resolved binaries with existence/executable/version and both file paths; action=set (key, value, scope?) writes ONE key with a comment-preserving surgical edit; action=unset removes it; action=init writes a commented template (force to overwrite); action=path lists the two files; action=detect probes env/PATH/common roots and returns suggestions only (never writes). Call this when the user says where oss-cad-suite, verible or librelane live.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS], description: "show (default) | set | unset | init | path | detect" },
        key: { type: "string", description: "dot path for show/set/unset: ossCadSuite.bin | ossCadSuite.home | verible.bin | verible.home | librelane.appimage | librelane.mode | librelane.appimageExtract | librelane.bin | librelane.home" },
        value: { description: "value for action=set (string for paths, boolean for librelane.appimageExtract, 'auto'|'appimage'|'devshell'|'binary' for librelane.mode)" },
        scope: { type: "string", enum: ["user", "workspace"], description: "target layer; default = the layer that already defines the key, else user" },
        force: { type: "boolean", description: "action=init: overwrite an existing file" },
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          action: { type: "string" },
          file: { type: "string" },
          key: {},
          config: { type: "object" },
          backends: { type: "array" },
          suggestions: { type: "array" },
          error: { type: "object" },
        },
      },
      render: (_a: unknown, v: unknown) => render(v),
    },
    execute: async (args: Record<string, unknown>, exec: unknown) => {
      try {
        return dispatch(args ?? {}, exec)
      } catch (e) {
        return refusalOf(e)
      }
    },
  }
}
