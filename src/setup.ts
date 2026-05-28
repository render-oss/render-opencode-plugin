#!/usr/bin/env node
import { constants } from "node:fs"
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

type InstallOptions = {
  sourceAssetsDir?: string
  targetConfigDir?: string
  force?: boolean
  enableMcp?: boolean
  dryRun?: boolean
}

type InstallResult = {
  written: string[]
  skipped: string[]
}

const ASSET_DIRECTORIES = ["skills", "commands", "agents"] as const

const RENDER_MCP_CONFIG = {
  type: "remote",
  url: "https://mcp.render.com/mcp",
  enabled: true,
  oauth: false,
  headers: {
    Authorization: "Bearer {env:RENDER_API_KEY}",
  },
}

const moduleDir = dirname(fileURLToPath(import.meta.url))

export async function installOpenCodeAssets(options: InstallOptions = {}): Promise<InstallResult> {
  const sourceAssetsDir = options.sourceAssetsDir ?? join(moduleDir, "..", "assets", "opencode")
  const targetConfigDir = options.targetConfigDir ?? getDefaultConfigDir()
  const result: InstallResult = { written: [], skipped: [] }

  for (const directory of ASSET_DIRECTORIES) {
    const sourceDirectory = join(sourceAssetsDir, directory)
    if (!(await pathExists(sourceDirectory))) {
      continue
    }

    const files = await listFiles(sourceDirectory)
    for (const sourceFile of files) {
      const destination = join(targetConfigDir, directory, relative(sourceDirectory, sourceFile))
      if ((await pathExists(destination)) && !options.force) {
        result.skipped.push(destination)
        continue
      }

      result.written.push(destination)
      if (!options.dryRun) {
        await mkdir(dirname(destination), { recursive: true })
        await copyFile(sourceFile, destination)
      }
    }
  }

  if (options.enableMcp) {
    const configPath = join(targetConfigDir, "opencode.json")
    await mergeMcpConfig(configPath, result, Boolean(options.dryRun))
  }

  return result
}

export function getDefaultConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return resolve(process.env.OPENCODE_CONFIG_DIR)
  }

  const home = process.env.HOME
  if (!home) {
    throw new Error("Cannot locate OpenCode config directory because HOME is not set.")
  }

  return join(home, ".config", "opencode")
}

export async function mergeMcpConfig(configPath: string, result: InstallResult, dryRun = false) {
  const existing = await readJsonFile(configPath)
  const nextConfig = {
    ...existing,
    mcp: {
      ...(isRecord(existing.mcp) ? existing.mcp : {}),
      render: RENDER_MCP_CONFIG,
    },
  }

  result.written.push(configPath)
  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`)
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(filePath))) {
    return { $schema: "https://opencode.ai/config.json" }
  }

  const contents = await readFile(filePath, "utf8")
  if (contents.trim().length === 0) {
    return { $schema: "https://opencode.ai/config.json" }
  }

  const parsed = JSON.parse(contents) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must contain a JSON object.`)
  }

  return parsed
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        return listFiles(entryPath)
      }

      if (entry.isFile()) {
        return [entryPath]
      }

      return []
    }),
  )

  return files.flat()
}

async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseArgs(argv: string[]) {
  const args: Required<Pick<InstallOptions, "force" | "enableMcp" | "dryRun">> & Pick<InstallOptions, "targetConfigDir"> = {
    dryRun: false,
    enableMcp: false,
    force: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "setup":
        break
      case "--config-dir":
        index += 1
        if (!argv[index]) {
          throw new Error("--config-dir requires a path.")
        }
        args.targetConfigDir = resolve(argv[index])
        break
      case "--enable-mcp":
        args.enableMcp = true
        break
      case "--force":
        args.force = true
        break
      case "--dry-run":
        args.dryRun = true
        break
      case "--help":
      case "-h":
        printHelp()
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`render-opencode setup

Install Render skills, commands, and agent files into your OpenCode config directory.

Options:
  --config-dir <path>  Target OpenCode config directory. Defaults to ~/.config/opencode.
  --enable-mcp        Add the Render MCP server to opencode.json.
  --force             Overwrite existing files.
  --dry-run           Print what would change without writing files.
  -h, --help          Show this help.
`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await installOpenCodeAssets(options)

  for (const filePath of result.written) {
    console.log(`${options.dryRun ? "would write" : "wrote"} ${filePath}`)
  }

  for (const filePath of result.skipped) {
    console.log(`skipped existing ${filePath}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
