// Evidence-only harness: calls the plugin's REAL tool `execute` functions (no reimplementation).
// usage:
//   bun invoke-tools.ts run <outputDir> <label>
//   bun invoke-tools.ts verify <xlsx> <docxZh> [docxEn]
import { resolve } from "node:path"
import { docgenRunToolDefinition } from "../../../../packages/mpd-docgen-plugin/src/tool-run.ts"
import { docgenVerifyToolDefinition } from "../../../../packages/mpd-docgen-plugin/src/tool-verify.ts"

const root = resolve(import.meta.dir, "../../../..")
const exec = { agent: { session: { header: { cwd: root } } } }
const [command, ...rest] = process.argv.slice(2)

async function main(): Promise<void> {
  if (command === "run") {
    const [outputDir, label] = rest
    const args = { manual: "/home/haroldzhao/eCap/docs/user-manual.md", outputDir: resolve(outputDir!), ip: "eCap" }
    const result = await docgenRunToolDefinition().execute(args, exec)
    console.log(JSON.stringify({ label, workspaceRoot: root, args, result }, null, 2))
    return
  }
  if (command === "verify") {
    const [xlsx, docxZh, docxEn] = rest
    const args = { xlsx: resolve(xlsx!), docxZh: resolve(docxZh!), ...(docxEn === undefined ? {} : { docxEn: resolve(docxEn) }) }
    const result = await docgenVerifyToolDefinition().execute(args, exec)
    console.log(JSON.stringify({ workspaceRoot: root, args, result }, null, 2))
    return
  }
  console.error("usage: run <outputDir> <label> | verify <xlsx> <docxZh> [docxEn]")
  process.exit(2)
}

main().catch((error) => {
  console.error("HARNESS FAILURE:", error)
  process.exit(1)
})
