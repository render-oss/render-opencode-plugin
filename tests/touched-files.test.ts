import { describe, expect, it } from "vitest"

import { extractTouchedFiles } from "../src/touched-files.js"

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
