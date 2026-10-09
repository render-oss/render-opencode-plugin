import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, describe, expect, it, vi } from "vitest"

import { getDefaultConfigDir, installOpenCodeAssets } from "../src/setup.js"

const tempRoots: string[] = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "render-opencode-test-"))
  tempRoots.push(dir)
  return dir
}

afterEach(async () => {
  vi.unstubAllEnvs()
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

  it("preserves existing Render MCP settings and other fields unless forced", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    const path = join(targetConfigDir, "opencode.json")
    const render = { type: "remote", url: "https://example.invalid/mcp", enabled: false, oauth: { clientId: "custom" } }
    const existing = { model: "test/model", mcp: { render, other: { type: "local", command: ["other"] } } }
    await writeFile(path, JSON.stringify(existing))
    const skipped = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir, enableMcp: true })
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
    expect(skipped.skipped).toContain(path)
    await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir, enableMcp: true, force: true })
    const changed = JSON.parse(await readFile(path, "utf8"))
    expect(changed.model).toBe(existing.model)
    expect(changed.mcp.other).toEqual(existing.mcp.other)
    expect(changed.mcp.render.oauth).toBe(false)
  })

  it("updates owned files and removes obsolete files while preserving user edits", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    await mkdir(join(sourceAssetsDir, "commands"))
    for (const name of ["update", "edited", "obsolete", "obsolete-edited"]) {
      await writeFile(join(sourceAssetsDir, "commands", `${name}.md`), "old")
    }
    await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })
    for (const name of ["edited", "obsolete-edited"]) {
      await writeFile(join(targetConfigDir, "commands", `${name}.md`), "user edit")
    }
    for (const name of ["update", "edited"]) {
      await writeFile(join(sourceAssetsDir, "commands", `${name}.md`), "new")
    }
    for (const name of ["obsolete", "obsolete-edited"]) {
      await rm(join(sourceAssetsDir, "commands", `${name}.md`))
    }
    const result = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })
    expect(await readFile(join(targetConfigDir, "commands", "update.md"), "utf8")).toBe("new")
    expect(await readFile(join(targetConfigDir, "commands", "edited.md"), "utf8")).toBe("user edit")
    expect(await readFile(join(targetConfigDir, "commands", "obsolete-edited.md"), "utf8")).toBe("user edit")
    await expect(readFile(join(targetConfigDir, "commands", "obsolete.md"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(result.removed).toEqual([join(targetConfigDir, "commands", "obsolete.md")])
    await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir, force: true })
    expect(await readFile(join(targetConfigDir, "commands", "edited.md"), "utf8")).toBe("new")
    await expect(readFile(join(targetConfigDir, "commands", "obsolete-edited.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("adopts unmodified 0.1.0 installs that predate tracking", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    // Command fixtures predate tracking and are unaffected by later skill syncs.
    await cp("assets/opencode/commands", join(targetConfigDir, "commands"), { recursive: true })
    await cp("assets/opencode/commands", join(sourceAssetsDir, "commands"), { recursive: true })
    const path = join("commands", "deploy-to-render.md")
    await writeFile(join(sourceAssetsDir, path), "upgraded command")
    await rm(join(sourceAssetsDir, "commands", "check-render-status.md"))
    const result = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })
    expect(await readFile(join(targetConfigDir, path), "utf8")).toBe("upgraded command")
    expect(result.removed).toContain(join(targetConfigDir, "commands", "check-render-status.md"))
  })

  it("plans an upgrade without changing assets or their tracking manifest", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    await mkdir(join(sourceAssetsDir, "commands"))
    await writeFile(join(sourceAssetsDir, "commands", "old.md"), "old")
    await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })
    const manifest = await readFile(join(targetConfigDir, ".render-opencode-manifest.json"), "utf8")
    await rm(join(sourceAssetsDir, "commands", "old.md"))
    await writeFile(join(sourceAssetsDir, "commands", "new.md"), "new")
    const result = await installOpenCodeAssets({ sourceAssetsDir, targetConfigDir, dryRun: true, enableMcp: true })
    expect(result.removed).toContain(join(targetConfigDir, "commands", "old.md"))
    expect(await readFile(join(targetConfigDir, "commands", "old.md"), "utf8")).toBe("old")
    expect(await readFile(join(targetConfigDir, ".render-opencode-manifest.json"), "utf8")).toBe(manifest)
    await expect(readFile(join(targetConfigDir, "commands", "new.md"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(join(targetConfigDir, "opencode.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects unsafe tracking paths before changing files", async () => {
    const targetConfigDir = await tempDir()
    const sourceAssetsDir = await tempDir()
    await writeFile(join(targetConfigDir, ".render-opencode-manifest.json"), JSON.stringify({ version: 1, files: { "../outside": "0".repeat(64) } }))
    await expect(installOpenCodeAssets({ sourceAssetsDir, targetConfigDir })).rejects.toThrow("Invalid Render installation manifest entry")
  })

  it("follows OpenCode config-directory precedence", () => {
    vi.stubEnv("OPENCODE_CONFIG_DIR", "")
    vi.stubEnv("XDG_CONFIG_HOME", "/tmp/test-xdg")
    expect(getDefaultConfigDir()).toBe("/tmp/test-xdg/opencode")
    vi.stubEnv("OPENCODE_CONFIG_DIR", "/tmp/explicit-opencode")
    expect(getDefaultConfigDir()).toBe("/tmp/explicit-opencode")
  })
})
