#!/usr/bin/env node
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { copyFile, lstat, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const moduleDir = dirname(fileURLToPath(import.meta.url))
const MANIFEST_NAME = ".render-opencode-manifest.json"
const ASSET_DIRECTORIES = ["skills", "commands", "agents", "plugins"]
const RENDER_MCP_CONFIG = {
  type: "remote",
  url: "https://mcp.render.com/mcp",
  enabled: true,
  oauth: false,
  headers: { Authorization: "Bearer {env:RENDER_API_KEY}" },
}

export function getDefaultConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return resolve(process.env.OPENCODE_CONFIG_DIR)
  if (process.env.XDG_CONFIG_HOME) return join(resolve(process.env.XDG_CONFIG_HOME), "opencode")
  return join(homedir(), ".config", "opencode")
}

export async function installOpenCodeAssets(options = {}) {
  const sourceAssetsDir = options.sourceAssetsDir ?? join(moduleDir, "opencode")
  if (!(await pathExists(sourceAssetsDir))) throw new Error(`Cannot locate bundled OpenCode assets: ${sourceAssetsDir}`)
  const targetConfigDir = options.targetConfigDir ?? getDefaultConfigDir()
  const result = { written: [], skipped: [], removed: [] }
  const manifestPath = join(targetConfigDir, MANIFEST_NAME)
  const previous = await readManifest(manifestPath)
  const legacy = await readManifest(join(moduleDir, "legacy-assets.json"))
  const directories = ASSET_DIRECTORIES.filter((name) => name !== "plugins" || options.includePlugin)
  const belongsToInstall = (path) => directories.includes(path.split("/")[0])
  const next = { ...previous.files }
  const bundled = new Map()

  for (const directory of directories) {
    const source = join(sourceAssetsDir, directory)
    if (!(await pathExists(source))) continue
    for (const file of await listFiles(source)) {
      const path = `${directory}/${relative(source, file).split("\\").join("/")}`
      bundled.set(path, { file, hash: await fileHash(file) })
    }
  }

  for (const [path, asset] of bundled) {
    const destination = join(targetConfigDir, path)
    const exists = await pathExists(destination)
    const current = exists ? await fileHash(destination) : undefined
    if (current === asset.hash) {
      next[path] = asset.hash
      result.skipped.push(destination)
      continue
    }
    const unmodified = current !== undefined && (current === previous.files[path] || current === legacy.files[path])
    if (exists && !options.force && !unmodified) {
      result.skipped.push(destination)
      continue
    }
    next[path] = asset.hash
    result.written.push(destination)
    if (!options.dryRun) {
      await mkdir(dirname(destination), { recursive: true })
      // Replace a file symlink itself instead of following it outside the installation.
      if (exists && (await lstat(destination)).isSymbolicLink()) await unlink(destination)
      await copyFile(asset.file, destination)
    }
  }

  // A manifest tracks ownership; legacy hashes safely adopt unmodified pre-manifest installs.
  for (const path of new Set([...Object.keys(previous.files), ...Object.keys(legacy.files)])) {
    if (!belongsToInstall(path) || bundled.has(path)) continue
    const destination = join(targetConfigDir, path)
    if (!(await pathExists(destination))) {
      delete next[path]
      continue
    }
    const current = await fileHash(destination)
    const unmodified = current !== undefined && (current === previous.files[path] || current === legacy.files[path])
    if (!unmodified && !(options.force && previous.files[path])) {
      result.skipped.push(destination)
      continue
    }
    delete next[path]
    result.removed.push(destination)
    if (!options.dryRun) await unlink(destination)
  }

  if (options.enableMcp) {
    await mergeMcpConfig(join(targetConfigDir, "opencode.json"), result, Boolean(options.dryRun), Boolean(options.force))
  }

  if (!options.dryRun && (bundled.size > 0 || Object.keys(previous.files).length > 0)) {
    await mkdir(targetConfigDir, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, files: next }, null, 2)}\n`)
  }
  return result
}

export async function mergeMcpConfig(configPath, result, dryRun = false, force = false) {
  const existing = await readJsonFile(configPath)
  if (existing.mcp !== undefined && !isRecord(existing.mcp)) throw new Error(`${configPath} has a non-object mcp field.`)
  if (Object.hasOwn(existing.mcp ?? {}, "render") && !force) {
    result.skipped.push(configPath)
    return
  }
  const next = { ...existing, mcp: { ...existing.mcp, render: RENDER_MCP_CONFIG } }
  result.written.push(configPath)
  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`)
  }
}

async function readJsonFile(path) {
  if (!(await pathExists(path))) return { $schema: "https://opencode.ai/config.json" }
  const text = await readFile(path, "utf8")
  if (!text.trim()) return { $schema: "https://opencode.ai/config.json" }
  const value = JSON.parse(text)
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object.`)
  return value
}

async function readManifest(path) {
  if (!(await pathExists(path))) return { version: 1, files: {} }
  const value = JSON.parse(await readFile(path, "utf8"))
  if (value?.version !== 1 || !isRecord(value.files)) throw new Error(`Invalid Render installation manifest: ${path}`)
  for (const [file, hash] of Object.entries(value.files)) {
    if (isAbsolute(file) || file.includes("\\") || file.split("/").some((part) => part === ".." || part === "" || part === ".") || !ASSET_DIRECTORIES.includes(file.split("/")[0]) || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error(`Invalid Render installation manifest entry: ${file}`)
    }
  }
  return value
}

async function fileHash(path) {
  const stat = await lstat(path)
  if (!stat.isFile()) return undefined
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return entry.isFile() ? [path] : []
  }))
  return nested.flat()
}

async function pathExists(path) {
  try { await lstat(path); return true }
  catch (error) { if (error.code === "ENOENT") return false; throw error }
}

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value) }

export async function main(argv = process.argv.slice(2)) {
  const options = { force: false, enableMcp: false, dryRun: false, includePlugin: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "setup") continue
    if (arg === "--config-dir") {
      const path = argv[++index]
      if (!path || path.startsWith("--")) throw new Error("--config-dir requires a path.")
      options.targetConfigDir = resolve(path)
      continue
    }
    if (arg === "--force") { options.force = true; continue }
    if (arg === "--enable-mcp") { options.enableMcp = true; continue }
    if (arg === "--dry-run") { options.dryRun = true; continue }
    if (arg === "--include-plugin") { options.includePlugin = true; continue }
    if (arg === "--help" || arg === "-h") {
      console.log(`render-opencode setup

Install or upgrade Render skills, commands, and agent files.
Unmodified bundled files update automatically; user edits are preserved.

Options:
  --config-dir <path>  OpenCode config directory (OPENCODE_CONFIG_DIR or XDG_CONFIG_HOME/opencode).
  --enable-mcp        Add Render MCP config; preserve an existing entry unless forced.
  --force             Overwrite modified or unmanaged files and existing Render MCP config.
  --dry-run           Print planned writes, removals, and skipped files without changing files.
  --include-plugin    Also install the standalone plugin (used by install.sh).
  -h, --help          Show this help.
`)
      return
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  const result = await installOpenCodeAssets(options)
  for (const path of result.written) console.log(`${options.dryRun ? "would write" : "wrote"} ${path}`)
  for (const path of result.removed) console.log(`${options.dryRun ? "would remove" : "removed"} ${path}`)
  for (const path of result.skipped) console.log(`skipped unchanged or user-owned ${path}`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
