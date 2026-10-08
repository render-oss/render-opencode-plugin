import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { resolve } from "node:path"

import { isBlueprintFile, validateBlueprint } from "./blueprint.js"
import { extractMutatedFiles } from "./touched-files.js"

export const RenderPlugin: Plugin = async ({ client, directory }) => {
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
        async execute(args, context) {
          const result = await validateBlueprint(args.path, context.directory, context.abort)
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
      const paths = [...new Set(extractMutatedFiles(input.tool, input.args, output.metadata)
        .filter(isBlueprintFile)
        .map((path) => resolve(directory, path)))]
      const failures = []
      for (const path of paths) {
        const result = await validateBlueprint(path, directory)
        if (!result.ok) {
          failures.push({ path, ...result })
          continue
        }
        await client.app.log({ body: {
          service: "render-opencode-plugin",
          level: "info",
          message: "Validated Render Blueprint",
          extra: { path, cwd: result.cwd },
        } })
      }
      if (failures.length === 0) return

      output.title = "Render Blueprint validation"
      output.output = [output.output, ...failures.map((result) => `${result.path}\n${result.output}`)].filter(Boolean).join("\n\n")
      output.metadata = {
        ...output.metadata,
        renderBlueprintValidation: {
          ok: false,
          command: failures[0].command,
          cwd: failures[0].cwd,
          error: failures[0].error,
          results: failures,
        },
      }
    },
  }
}

export default RenderPlugin
