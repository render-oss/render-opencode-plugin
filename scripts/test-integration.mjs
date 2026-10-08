// Exercise both public installation flows inside real OpenCode, without a paid model or Render account.
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { createServer } from "node:http"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const root = await realpath(await mkdtemp(join(tmpdir(), "render-opencode-integration-")))
const cli = process.env.OPENCODE_BIN || "opencode"
let scenario = []
let modelError
let succeeded = false

// Only tool-enabled turns consume the script; OpenCode also requests session titles.
const model = createServer(async (request, response) => {
  try {
    let body = ""
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    const call = input.tools?.length ? scenario.shift() : undefined
    if (call) assert(input.tools.some((t) => t.function.name === call[0]), `Tool unavailable: ${call[0]}`)
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id: "integration", object: "chat.completion.chunk", created: 1, model: input.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`)
    send({ role: "assistant", content: "" })
    send(call ? { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { content: "Integration test complete." })
    send({}, call ? "tool_calls" : "stop")
    response.end("data: [DONE]\n\n")
  } catch (error) {
    modelError = error
    response.writeHead(500).end("Local test model failed")
  }
})

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  return server.address().port
}
async function freePort() {
  const server = createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function calls(path) {
  try { return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) }
  catch (error) { if (error.code === "ENOENT") return []; throw error }
}

function environment(base, configDir, log) {
  const env = { ...process.env,
    OPENCODE_TEST_HOME: join(base, "home"), OPENCODE_CONFIG_DIR: configDir,
    XDG_CONFIG_HOME: join(base, "config"), XDG_DATA_HOME: join(base, "data"),
    XDG_CACHE_HOME: join(base, "cache"), XDG_STATE_HOME: join(base, "state"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1", OPENCODE_AUTH_CONTENT: "{}",
    PATH: `${join(root, "bin")}:${process.env.PATH}`, RENDER_PLUGIN_TEST_LOG: log,
  }
  delete env.RENDER_API_KEY
  return env
}

async function exercise(kind, tarball, consumer, modelPort) {
  const base = join(root, kind)
  const cfg = join(base, "opencode")
  const project = join(base, "project")
  const serverCwd = join(base, "server-cwd")
  const log = join(base, "render-calls.jsonl")
  for (const path of [cfg, project, serverCwd]) await mkdir(path, { recursive: true })
  const env = environment(base, cfg, log)
  if (kind === "npm") {
    // Invoke the actual npm-created executable symlink, rather than the module directly.
    await run(join(consumer, "node_modules", ".bin", "render-opencode"), ["setup", "--config-dir", cfg], { env, cwd: consumer })
  } else {
    await run("bash", [join(repo, "install.sh"), "--source", repo, "--config-dir", cfg], { env })
  }
  const modelDefinition = { name: "Local integration model", attachment: false, reasoning: false, temperature: false, tool_call: true,
    release_date: "2025-01-01", limit: { context: 100000, output: 10000 }, cost: { input: 0, output: 0 }, options: {} }
  const config = {
    $schema: "https://opencode.ai/config.json", formatter: false, lsp: false, share: "disabled",
    model: "review/review-model", small_model: "review/review-model", enabled_providers: ["review"],
    permission: { edit: "allow", read: "allow", skill: "allow", external_directory: "deny" },
    provider: { review: { id: "review", name: "Local test model", env: [], npm: "@ai-sdk/openai-compatible",
      models: { "review-model": { ...modelDefinition, id: "review-model" }, "gpt-review": { ...modelDefinition, id: "gpt-review" } },
      options: { apiKey: "local-test-only", baseURL: `http://127.0.0.1:${modelPort}/v1` } } },
  }
  // This goes through OpenCode's npm installation/cache/package-entrypoint resolution.
  if (kind === "npm") config.plugin = [`@render/opencode-plugin@file:${tarball}`]
  await writeFile(join(cfg, "opencode.json"), JSON.stringify(config))
  await writeFile(join(serverCwd, "render.yaml"), "INVALID server working directory\n")
  const port = await freePort()
  const server = spawn(cli, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { env, cwd: serverCwd })
  let serverOutput = ""
  server.stdout.on("data", (chunk) => { serverOutput += chunk })
  server.stderr.on("data", (chunk) => { serverOutput += chunk })
  const api = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-opencode-directory": project },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(75000),
    })
    const text = await response.text()
    assert(response.ok, `${path}: ${response.status} ${text.slice(0, 500)}`)
    return JSON.parse(text)
  }
  try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(server.exitCode, null, `OpenCode exited: ${serverOutput.slice(-2000)}`)
      try { await api("/global/health"); ready = true; break } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert(ready, "OpenCode did not start")
    const skills = await api("/skill")
    const names = await readdir(join(repo, "assets", "opencode", "skills"))
    assert.deepEqual(skills.filter((s) => s.name.startsWith("render-")).map((s) => s.name).sort(), names.sort())
    const commands = await api("/command")
    for (const name of ["deploy-to-render", "check-render-status"]) assert(commands.some((c) => c.name === name))
    assert((await api("/agent")).some((a) => a.name === "render"))
    assert((await api("/experimental/tool/ids")).includes("render_validate_blueprint"))

    async function test(name, script, expectedPaths, modelID = "review-model", verify = () => {}) {
      const before = (await calls(log)).length
      scenario = [...script]
      modelError = undefined
      const session = await api("/session", {})
      await api(`/session/${session.id}/message`, { parts: [{ type: "text", text: "Run the scripted integration test." }], model: { providerID: "review", modelID } })
      if (modelError) throw modelError
      assert.equal(scenario.length, 0, `${name}: not all scripted tools ran`)
      const parts = (await api(`/session/${session.id}/message`)).flatMap((m) => m.parts).filter((p) => p.type === "tool")
      for (const part of parts) assert.equal(part.state.status, "completed", `${name}: ${JSON.stringify(part.state)}`)
      const actual = (await calls(log)).slice(before)
      assert.deepEqual(actual.map((c) => c.args[2]).sort(), expectedPaths.map((p) => resolve(project, p)).sort(), `${name}: validation call count or filename`)
      for (const call of actual) {
        assert.deepEqual(call.args, ["blueprints", "validate", call.args[2], "--output", "json"])
        assert.equal(call.cwd, dirname(call.args[2]))
        assert.equal(call.exists, true)
      }
      verify(parts, actual)
      console.log(`${kind}: ${name} passed`)
    }
    const yaml = join(project, "render.yaml")
    const yml = join(project, "render.yml")
    await writeFile(yaml, "services: []\n")
    await test("skill loading", [["skill", { name: "render-deploy" }]], [], "review-model", (parts) => {
      assert(parts.some((p) => p.tool === "skill" && p.state.output.includes("Render")))
    })
    const valid = (parts, actual) => { assert.equal(parts.at(-1).state.metadata.ok, true); assert(actual.every((c) => c.valid)) }
    await test("absolute custom validation once", [["render_validate_blueprint", { path: yaml }]], [yaml], "review-model", valid)
    await test("relative custom validation from session directory", [["render_validate_blueprint", { path: "render.yaml" }]], [yaml], "review-model", valid)
    await rm(yaml)
    await writeFile(yml, "services: []\n")
    await test("render.yml without render.yaml", [["render_validate_blueprint", { path: "render.yml" }]], [yml], "review-model", valid)
    await writeFile(yaml, "INVALID decoy\n")
    await test("render.yml selected when render.yaml also exists", [["render_validate_blueprint", { path: "render.yml" }]], [yml], "review-model", valid)
    const failed = (parts) => {
      const p = parts.find((p) => p.state.metadata.renderBlueprintValidation)
      assert(p && p.state.output.includes("invalid blueprint"), "Validation failure must be visible to the agent")
      assert.equal(p.state.metadata.renderBlueprintValidation.ok, false)
    }
    await test("write hook reports validation failure", [["write", { filePath: yaml, content: "INVALID\n" }]], [yaml], "review-model", failed)
    await test("read skips validation", [["read", { filePath: yaml }]], [])
    await test("edit hook", [["read", { filePath: yaml }], ["edit", { filePath: yaml, oldString: "INVALID", newString: "services: []" }]], [yaml], "review-model", (_, actual) => assert(actual[0].valid))
    await test("GPT apply_patch hook", [["apply_patch", { patchText: `*** Begin Patch\n*** Update File: ${yaml}\n@@\n-services: []\n+INVALID\n*** End Patch` }]], [yaml], "gpt-review", failed)
    for (const dir of ["moved", "nested", "deleted"]) await mkdir(join(project, dir))
    await writeFile(join(project, "deleted", "render.yaml"), "services: []\n")
    const moved = join(project, "moved", "render.yaml")
    const nested = join(project, "nested", "render.yml")
    const patchText = `*** Begin Patch\n*** Update File: ${yaml}\n*** Move to: ${moved}\n@@\n-INVALID\n+services: []\n*** Add File: ${nested}\n+INVALID\n*** Delete File: ${join(project, "deleted", "render.yaml")}\n*** End Patch`
    await test("multi-file patch with move and deletion", [["apply_patch", { patchText }]], [moved, nested], "gpt-review", failed)
    for (const [command, skill] of [["check-render-status", "render-monitor"], ["deploy-to-render", "render-deploy"]]) {
      scenario = [["skill", { name: skill }]]
      const session = await api("/session", {})
      await api(`/session/${session.id}/command`, { command, arguments: "", model: "review/review-model" })
      if (modelError) throw modelError
      const children = await api(`/session/${session.id}/children`)
      const messages = (await Promise.all(children.map((c) => api(`/session/${c.id}/message`)))).flat()
      assert(messages.some((m) => m.info.agent === "render"))
      assert(messages.flatMap((m) => m.parts).some((p) => p.tool === "skill" && p.state.status === "completed" && p.state.input.name === skill))
      assert.equal(scenario.length, 0)
      console.log(`${kind}: /${command} delegates to @render and loads ${skill}`)
    }
    await writeFile(join(base, "summary.json"), JSON.stringify({ kind, skills: names.length, commands: 2, renderCalls: (await calls(log)).length }))
  } finally {
    server.kill("SIGTERM")
    if (server.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => { server.kill("SIGKILL"); resolve() }, 5000)
        server.once("exit", () => { clearTimeout(timeout); resolve() })
      })
    }
    await writeFile(join(base, "server.log"), serverOutput)
  }
}

try {
  console.log(`Testing OpenCode ${(await run(cli, ["--version"])).stdout.trim()}`)
  await mkdir(join(root, "bin"))
  const render = join(root, "bin", "render")
  await writeFile(render, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nconst exists = fs.existsSync(args[2]);\nconst valid = exists && !fs.readFileSync(args[2], 'utf8').includes('INVALID');\nfs.appendFileSync(process.env.RENDER_PLUGIN_TEST_LOG, JSON.stringify({args,cwd:process.cwd(),exists,valid})+'\\n');\nconsole.log(valid ? 'valid blueprint' : 'invalid blueprint');\nprocess.exitCode = valid ? 0 : 1;\n`)
  await chmod(render, 0o755)
  const packed = JSON.parse((await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: repo })).stdout)[0]
  const tarball = join(root, packed.filename)
  const consumer = join(root, "consumer")
  await mkdir(consumer)
  await run("npm", ["install", "--prefix", consumer, "--ignore-scripts", "--no-audit", "--no-fund", tarball], { timeout: 120000 })
  const modelPort = await listen(model)
  for (const kind of ["github", "npm"]) await exercise(kind, tarball, consumer, modelPort)
  succeeded = true
  console.log("Both plugin installation flows passed all real OpenCode integration checks.")
} finally {
  model.closeAllConnections()
  await new Promise((resolve) => model.close(resolve))
  if (succeeded && !process.env.OPENCODE_INTEGRATION_KEEP) await rm(root, { recursive: true, force: true })
  else console.log(`Integration artifacts: ${root}`)
}
