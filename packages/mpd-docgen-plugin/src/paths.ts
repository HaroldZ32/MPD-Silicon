// Workspace-rooted path resolution, deterministic artifact names and the atomic write
// helper. No function here writes anything except `atomicWriteFile`.
//
// The workspace root is resolved PER CALL through mpd's adapter (`workspaceRootOf`), never
// cached at module scope: one process serves several sessions with different roots.
// Relative paths resolve against that root; absolute paths are kept. Nothing writes
// $DSH_HOME.
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { workspaceRootOf } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import { DocgenError, type Lang } from "./types.js"

/** Output directory used when the caller does not name one (plan §5). */
export const DEFAULT_OUTPUT_DIR = "docs"

/** Monotonic suffix source for sibling temp files (never a workspace cache). */
let tempSequence = 0

/** The calling session's workspace root, resolved per call. */
export function workspaceRoot(exec?: unknown): string {
  return resolve(workspaceRootOf(exec as Parameters<typeof workspaceRootOf>[0]))
}

/** Resolve an input path against the workspace root; absolute paths win unchanged. */
export function resolveInputPath(path: string, exec?: unknown): string {
  return isAbsolute(path) ? resolve(path) : resolve(workspaceRoot(exec), path)
}

/** Resolve an output path against the workspace root; absolute paths win unchanged. */
export function resolveOutputPath(path: string, exec?: unknown): string {
  return resolveInputPath(path, exec)
}

/** Resolve the output directory argument, defaulting to `<workspace>/docs`. */
export function resolveOutputDir(dir: string | undefined, exec?: unknown): string {
  const chosen = dir !== undefined && dir.trim() !== "" ? dir : DEFAULT_OUTPUT_DIR
  return resolveOutputPath(chosen, exec)
}

/** Path of the register workbook: `<ip>_regExcel_full.xlsx`. */
export function regExcelFileName(ip: string): string {
  return ip + "_regExcel_full.xlsx"
}

/** Path of one user-manual docx: `<ip>_reg_user_manual.<lang>.docx`. */
export function docxFileName(ip: string, lang: Lang): string {
  return ip + "_reg_user_manual." + lang + ".docx"
}

/** The first filename-safe ASCII word of a title (`eCap`, `TIMER`, `v1.2`). */
const IP_WORD = /[A-Za-z0-9][A-Za-z0-9._-]*/

/**
 * Reduce text to a filename-safe token: characters outside `[A-Za-z0-9._-]` become `_`,
 * edge underscores are trimmed, and the CASE IS PRESERVED (`eCap` stays `eCap`).
 */
function sanitiseSlug(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
}

/**
 * The `<ip>` used in output names (plan §2).
 *
 * An explicit `ip` override is used WHOLE (case preserved, unsafe characters replaced by
 * `_`), because it is already an identifier chosen by the caller. Without an override the
 * H1 title contributes its FIRST ASCII WORD, case preserved: `# eCap 用户手册` -> `eCap`,
 * `# TIMER top` -> `TIMER`. A title with no ASCII word (e.g. `# 定时器模块`) falls back to
 * the literal default `ip` — which is why the run tool should pass one `ip` for a
 * zh/en manual pair whose titles differ.
 */
export function ipSlug(title?: string, override?: string): string {
  const explicit = sanitiseSlug((override ?? "").trim())
  if (explicit !== "") return explicit
  const word = IP_WORD.exec(title ?? "")
  return word === null ? "ip" : sanitiseSlug(word[0])
}

/**
 * Write `data` to `path` atomically: a sibling temp file, then a rename, then mode 0644.
 *
 * @param path - absolute or workspace-relative target; parent directories are created.
 * @param data - file contents.
 * @param mode - final file mode (the plan fixes 0644 for these artifacts).
 * @returns the resolved absolute path that was written.
 */
export function atomicWriteFile(path: string, data: Uint8Array | string, mode = 0o644): string {
  const target = resolve(path)
  const temp = target + ".tmp-" + process.pid + "-" + tempSequence++
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, data, { mode })
    renameSync(temp, target)
    // An explicit chmod keeps the contract even under a restrictive umask.
    chmodSync(target, mode)
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // The temp file may not exist; the original failure is what matters.
    }
    throw new DocgenError(
      "DOCGEN_E_IO",
      "cannot write " + target + ": " + (error instanceof Error ? error.message : String(error)),
      "check that the output directory is writable and the target path is valid",
    )
  }
  return target
}
