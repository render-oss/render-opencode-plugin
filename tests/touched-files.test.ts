import { describe, expect, it } from "vitest"

import { extractMutatedFiles, extractTouchedFiles } from "../src/touched-files.js"

describe("extractTouchedFiles", () => {
  it("extracts likely file paths from OpenCode tool arguments", () => {
    expect(
      extractTouchedFiles({
        file_path: "render.yaml",
        edits: [{ filePath: "src/index.ts" }],
        nested: { path: "/tmp/app/render.yml" },
      }),
    ).toEqual(["render.yaml", "src/index.ts", "/tmp/app/render.yml"])
  })

  it("ignores non-file values", () => {
    expect(extractTouchedFiles({ path: 1, other: "render.yaml" })).toEqual([])
  })
})

describe("OpenCode mutation detection", () => {
  it("ignores reads, MCP tools, and explicit validation", () => {
    for (const tool of ["read", "grep", "render_validate_blueprint", "render_get_service"]) {
      expect(extractMutatedFiles(tool, { path: "render.yaml" }, {})).toEqual([])
    }
  })

  it("uses patch result metadata for multiple files, moves, and deletions", () => {
    expect(extractMutatedFiles("apply_patch", {}, { files: [
      { filePath: "render.yaml", type: "update" },
      { filePath: "render.yaml", type: "update" },
      { filePath: "old/render.yml", movePath: "new/render.yml", type: "move" },
      { filePath: "deleted/render.yaml", type: "delete" },
    ] })).toEqual(["render.yaml", "new/render.yml"])
  })

  it("supports older patch clients without file metadata", () => {
    const patchText = "*** Begin Patch\r\n*** Update File: old/render.yaml\r\n*** Move to: new/render.yaml\r\n@@\r\n-old\r\n+new\r\n*** Add File: render.yml\r\n+services: []\r\n*** Delete File: deleted/render.yaml\r\n*** End Patch"
    expect(extractMutatedFiles("apply_patch", { patchText }, {})).toEqual(["new/render.yaml", "render.yml"])
  })
})
