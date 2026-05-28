import { describe, expect, it } from "vitest"

import { getBlueprintWorkingDirectory, isBlueprintFile } from "../src/blueprint.js"

describe("Blueprint path helpers", () => {
  it("recognizes render.yaml and render.yml files", () => {
    expect(isBlueprintFile("render.yaml")).toBe(true)
    expect(isBlueprintFile("/tmp/app/render.yml")).toBe(true)
    expect(isBlueprintFile("/tmp/app/render.production.yaml")).toBe(false)
    expect(isBlueprintFile("/tmp/app/render.yaml.bak")).toBe(false)
  })

  it("uses the Blueprint file directory as the validation working directory", () => {
    expect(getBlueprintWorkingDirectory("/tmp/app/render.yaml")).toBe("/tmp/app")
  })
})
