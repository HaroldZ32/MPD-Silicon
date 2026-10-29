// Dependency-surface smoke test: the bundle's ONLY adapter is the one shipped by
// @mpd-dsh/mpd. This pins the contract the imports rely on and the removal of the
// local port, so a missing/renamed export or a resurrected local package fails here
// instead of at boot.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as mpdAdapter from "@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

describe("@mpd-dsh/mpd adapter surface", () => {
  test("the service name is mpdDsh (the name consumers inject)", () => {
    expect(mpdAdapter.SERVICE_NAME).toBe("mpdDsh")
  })

  test("every symbol the bundle imports exists at runtime", () => {
    for (const symbol of ["createDshAdapter", "workspaceRootOf", "rowLogLine", "dshSeamInject", "apply"] as const) {
      expect(typeof (mpdAdapter as Record<string, unknown>)[symbol]).toBe("function")
    }
    expect(mpdAdapter.DSH_SEAM_TOOLS).toBe("tools")
    expect(mpdAdapter.DSH_SEAM_SKILLS).toBe("skills")
    expect(Array.isArray(mpdAdapter.inject)).toBe(true)
  })

  test("the local adapter port is gone and the dependency is pinned", () => {
    expect(existsSync(join(repoRoot, "packages", "mpd-dsh-adapter-plugin"))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    expect(manifest.dependencies["@mpd-dsh/mpd"]).toBe("0.15.1")
  })
})
