import { execFile } from "node:child_process"
import { basename, dirname, resolve } from "node:path"
import { promisify } from "node:util"

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const execFileAsync = promisify(execFile)

type ValidationResult = {
  ok: boolean
  command: string
  cwd: string
  output: string
  error?: string
}

export const RenderPlugin: Plugin = async ({ client }) => {
  await client.app.log({
    body: {
      service: "render-opencode-plugin",
      level: "info",
      message: "Render OpenCode plugin initialized",
    },
  })

  return {
    tool: {
      render_validate_blueprint: tool({
        description: "Validate a Render Blueprint file with the Render CLI.",
        args: {
          path: tool.schema.string().describe("Path to render.yaml or render.yml."),
        },
        async execute(args) {
          const result = await validateBlueprint(args.path)
          return {
            title: result.ok ? "Render Blueprint valid" : "Render Blueprint validation failed",
            output: result.output,
            metadata: {
              command: result.command,
              cwd: result.cwd,
              ok: result.ok,
              error: result.error,
            },
          }
        },
      }),
    },

    "tool.execute.after": async (input, output) => {
      const blueprintPath = extractTouchedFiles(input.args).find(isBlueprintFile)
      if (!blueprintPath) {
        return
      }

      const result = await validateBlueprint(blueprintPath)
      if (result.ok) {
        await client.app.log({
          body: {
            service: "render-opencode-plugin",
            level: "info",
            message: "Validated Render Blueprint",
            extra: {
              path: blueprintPath,
              cwd: result.cwd,
            },
          },
        })
        return
      }

      output.title = "Render Blueprint validation"
      output.output = [output.output, result.output].filter(Boolean).join("\n\n")
      output.metadata = {
        ...output.metadata,
        renderBlueprintValidation: {
          ok: false,
          command: result.command,
          cwd: result.cwd,
          error: result.error,
        },
      }
    },
  }
}

function isBlueprintFile(filePath: string) {
  const name = basename(filePath)
  return name === "render.yaml" || name === "render.yml"
}

function getBlueprintWorkingDirectory(filePath: string) {
  return dirname(resolve(filePath))
}

async function validateBlueprint(filePath: string): Promise<ValidationResult> {
  const cwd = getBlueprintWorkingDirectory(filePath)
  const command = "render blueprints validate"

  try {
    const result = await execFileAsync("render", ["blueprints", "validate"], { cwd })
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

function extractTouchedFiles(value: unknown): string[] {
  const files: string[] = []
  collectTouchedFiles(value, files)
  return files
}

const filePathKeys = new Set(["file", "filePath", "file_path", "filename", "path"])

function collectTouchedFiles(value: unknown, files: string[], key?: string) {
  if (typeof value === "string") {
    if (key && filePathKeys.has(key)) {
      files.push(value)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTouchedFiles(item, files)
    }
    return
  }

  if (typeof value !== "object" || value === null) {
    return
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    collectTouchedFiles(entryValue, files, entryKey)
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

export default RenderPlugin
