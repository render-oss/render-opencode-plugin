import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, describe, expect, it } from "vitest"

import { installOpenCodeAssets } from "../src/setup.js"

const tempRoots: string[] = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "render-opencode-test-"))
  tempRoots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("installOpenCodeAssets", () => {
  it("copies bundled skills, commands, and agents into an OpenCode config directory", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    await mkdir(join(sourceAssetsDir, "skills", "render-deploy"), { recursive: true })
    await mkdir(join(sourceAssetsDir, "commands"), { recursive: true })
    await mkdir(join(sourceAssetsDir, "agents"), { recursive: true })
    await writeFile(join(sourceAssetsDir, "skills", "render-deploy", "SKILL.md"), "---\nname: render-deploy\ndescription: Deploy\n---\n")
    await writeFile(join(sourceAssetsDir, "commands", "deploy-to-render.md"), "---\ndescription: Deploy\n---\n")
    await writeFile(join(sourceAssetsDir, "agents", "render.md"), "---\ndescription: Render\nmode: subagent\n---\n")

    const result = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })

    await expect(readFile(join(targetConfigDir, "skills", "render-deploy", "SKILL.md"), "utf8")).resolves.toContain("render-deploy")
    await expect(readFile(join(targetConfigDir, "commands", "deploy-to-render.md"), "utf8")).resolves.toContain("Deploy")
    await expect(readFile(join(targetConfigDir, "agents", "render.md"), "utf8")).resolves.toContain("Render")
    expect(result.written.length).toBe(3)
    expect(result.skipped.length).toBe(0)
  })

  it("does not overwrite existing files unless force is enabled", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    const targetFile = join(targetConfigDir, "commands", "deploy-to-render.md")
    await mkdir(join(sourceAssetsDir, "commands"), { recursive: true })
    await mkdir(join(targetConfigDir, "commands"), { recursive: true })
    await writeFile(join(sourceAssetsDir, "commands", "deploy-to-render.md"), "new")
    await writeFile(targetFile, "existing")

    const skipped = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })
    expect(await readFile(targetFile, "utf8")).toBe("existing")
    expect(skipped.skipped).toContain(targetFile)

    const forced = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir, force: true })
    expect(await readFile(targetFile, "utf8")).toBe("new")
    expect(forced.written).toContain(targetFile)
  })

  it("can merge the Render MCP server into opencode.json", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    await writeFile(join(targetConfigDir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))

    await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir, enableMcp: true })

    const config = JSON.parse(await readFile(join(targetConfigDir, "opencode.json"), "utf8"))
    expect(config.mcp.render).toEqual({
      type: "remote",
      url: "https://mcp.render.com/mcp",
      enabled: true,
      oauth: false,
      headers: {
        Authorization: "Bearer {env:RENDER_API_KEY}",
      },
    })
  })
})
