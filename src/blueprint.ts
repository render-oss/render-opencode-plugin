import { execFile } from "node:child_process"
import { basename, dirname, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type ValidationResult = {
  ok: boolean
  command: string
  cwd: string
  output: string
  error?: string
}

export function isBlueprintFile(filePath: string) {
  const name = basename(filePath)
  return name === "render.yaml" || name === "render.yml"
}

export function getBlueprintWorkingDirectory(filePath: string, directory = process.cwd()) {
  return dirname(resolve(directory, filePath))
}

export async function validateBlueprint(filePath: string, directory = process.cwd(), signal?: AbortSignal): Promise<ValidationResult> {
  const path = resolve(directory, filePath)
  const cwd = dirname(path)
  const command = `render blueprints validate ${JSON.stringify(path)} --output json`

  try {
    const result = await execFileAsync("render", ["blueprints", "validate", path, "--output", "json"], {
      cwd,
      signal,
      timeout: 30_000,
    })
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    return {
      ok: true,
      command,
      cwd,
      output: output || "render blueprints validate completed successfully.",
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ok: false,
        command,
        cwd,
        output: "Render CLI not found. Install it to validate render.yaml:\n  macOS:  brew install render\n  Linux:  curl -fsSL https://raw.githubusercontent.com/render-oss/cli/main/bin/install.sh | sh",
        error: "render-cli-not-found",
      }
    }

    const output = getExecErrorOutput(error)
    return {
      ok: false,
      command,
      cwd,
      output: output || String(error),
      error: "validation-failed",
    }
  }
}

function getExecErrorOutput(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const withOutput = error as { stdout?: unknown; stderr?: unknown; message?: unknown }
    return [withOutput.stdout, withOutput.stderr, withOutput.message]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n")
      .trim()
  }

  return ""
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}
