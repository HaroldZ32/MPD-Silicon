// mpd-docgen: document generation for the rtl-ip-flow spec stage.
//
// One manual (`docs/user-manual.md`) is the machine-readable source; this plugin produces
// the register Excel workbook and the bilingual user-manual docx from it. The four tools
// are `mpd_docgen_*` — the `mpd_verif_*` namespace stays untouched.
//
// Every harness seam goes through mpd's adapter, a HARD dependency: `mpdDsh` is injected,
// so a composition without the provider never applies this row and the bundle's
// `silicon-require-mpd` guard refuses startup. There is deliberately NO fallback adapter.
// Zero runtime dependencies: only node: builtins and the adapter.
import { dshSeamInject, DSH_SEAM_TOOLS } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"
import type { DshAdapter, DshToolDef } from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/src/index.ts"
import { registerXlsxToolDefinition } from "./tool-xlsx.js"
import { userManualDocxToolDefinition } from "./tool-docx.js"
import { docgenRunToolDefinition } from "./tool-run.js"
import { docgenVerifyToolDefinition } from "./tool-verify.js"

/** The plugin name the loader reports. */
export const name = "mpd-docgen"

/**
 * The tool registry plus the hard `mpdDsh` dependency. `dshSeamInject` returns the ids
 * verbatim, so this array is byte-identical to `["tools", "mpdDsh"]`.
 */
export const inject = [...dshSeamInject(DSH_SEAM_TOOLS), "mpdDsh"]

/** The plugin context slice this row reads (only the adapter is required). */
type Ctx = { tools?: unknown; mpdDsh?: DshAdapter; [key: string]: unknown }

/** Register the four `mpd_docgen_*` tools through the adapter seam. */
export function apply(ctx: Ctx): void {
  const dsh = ctx.mpdDsh as DshAdapter
  const definitions: DshToolDef[] = [
    registerXlsxToolDefinition(),
    userManualDocxToolDefinition(),
    docgenRunToolDefinition(),
    docgenVerifyToolDefinition(),
  ]
  for (const definition of definitions) dsh.registerTool(definition)
}
