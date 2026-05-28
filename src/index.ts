import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { isBlueprintFile, validateBlueprint } from "./blueprint.js"
import { extractTouchedFiles } from "./touched-files.js"

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

export default RenderPlugin
