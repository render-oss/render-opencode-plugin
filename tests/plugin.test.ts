import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RenderPlugin } from "../src/index.js"

let root: string
let project: string
let log: string
let hooks: Awaited<ReturnType<typeof RenderPlugin>>

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "render-plugin-test-")))
  project = join(root, "project")
  log = join(root, "calls.jsonl")
  await mkdir(join(root, "bin"))
  await mkdir(project)
  const executable = join(root, "bin", "render")
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RENDER_PLUGIN_TEST_LOG, JSON.stringify({args,cwd:process.cwd()})+'\\n');
const contents = fs.readFileSync(args[2], 'utf8');
console.log(contents.includes('INVALID') ? 'invalid blueprint' : 'valid blueprint');
process.exitCode = contents.includes('INVALID') ? 1 : 0;
`)
  await chmod(executable, 0o755)
  vi.stubEnv("PATH", `${join(root, "bin")}:${process.env.PATH}`)
  vi.stubEnv("RENDER_PLUGIN_TEST_LOG", log)
  hooks = await RenderPlugin({ directory: project, client: { app: { log: vi.fn().mockResolvedValue({}) } } } as unknown as Parameters<typeof RenderPlugin>[0])
})

afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

async function calls() {
  try { return (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error }
}

describe("Render OpenCode integration", () => {
  it("resolves a relative filename against the tool's session directory and passes it to Render", async () => {
    const sessionDirectory = join(root, "session")
    await mkdir(sessionDirectory)
    await writeFile(join(sessionDirectory, "render.yml"), "services: []")
    const result = await hooks.tool!.render_validate_blueprint.execute({ path: "render.yml" }, {
      directory: sessionDirectory, abort: new AbortController().signal,
    } as Parameters<NonNullable<typeof hooks.tool>[string]["execute"]>[1])
    expect(result).toMatchObject({ metadata: { ok: true, cwd: sessionDirectory } })
    expect(await calls()).toEqual([{ cwd: sessionDirectory, args: ["blueprints", "validate", join(sessionDirectory, "render.yml"), "--output", "json"] }])
  })

  it("does not validate reads or repeat explicit validation", async () => {
    for (const tool of ["read", "render_validate_blueprint"]) {
      await hooks["tool.execute.after"]!({ tool, sessionID: "test", callID: "test", args: { path: "render.yaml" } }, { title: "read", output: "original", metadata: {} })
    }
    expect(await calls()).toEqual([])
  })

  it("validates a relative write and preserves the tool's metadata", async () => {
    await writeFile(join(project, "render.yaml"), "INVALID")
    const output = { title: "write", output: "wrote", metadata: { existing: true } }
    await hooks["tool.execute.after"]!({ tool: "write", sessionID: "test", callID: "test", args: { filePath: "render.yaml" } }, output)
    expect(output.output).toContain("invalid blueprint")
    expect(output.metadata).toMatchObject({ existing: true, renderBlueprintValidation: { ok: false } })
    expect(await calls()).toHaveLength(1)
  })

  it("validates every surviving patched Blueprint and skips deleted files", async () => {
    await mkdir(join(project, "nested"))
    await writeFile(join(project, "render.yaml"), "INVALID")
    await writeFile(join(project, "nested", "render.yml"), "INVALID")
    const output = { title: "patch", output: "patched", metadata: { files: [
      { type: "update", filePath: join(project, "render.yaml") },
      { type: "add", filePath: join(project, "nested", "render.yml") },
      { type: "delete", filePath: join(project, "deleted", "render.yaml") },
    ] } }
    await hooks["tool.execute.after"]!({ tool: "apply_patch", sessionID: "test", callID: "test", args: { patchText: "patch" } }, output)
    expect(await calls()).toHaveLength(2)
    expect(output.metadata).toMatchObject({ renderBlueprintValidation: { ok: false, results: [{ path: join(project, "render.yaml") }, { path: join(project, "nested", "render.yml") }] } })
  })
})
