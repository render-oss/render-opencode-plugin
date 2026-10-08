# Render OpenCode Plugin

Use Render from OpenCode to deploy apps, validate Blueprints, debug failed deploys, monitor services, and work through common platform workflows.

## What you get

- An npm-installable OpenCode plugin with a `render_validate_blueprint` tool
- Automatic validation when an agent edits `render.yaml` or `render.yml`
- Bundled Render skills for deploys, debugging, monitoring, migrations, and service configuration
- OpenCode commands for `/deploy-to-render` and `/check-render-status`
- A Render-focused `@render` subagent
- Optional Render MCP server configuration

## Installing the plugin

### Install from GitHub

Until the package is published to npm, install the local OpenCode plugin, skills, commands, and agent directly from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/render-oss/render-opencode-plugin/main/install.sh | bash
```

The installer requires Node.js 18+ or Bun. It writes files to OpenCode's config directory: `$OPENCODE_CONFIG_DIR` when set, otherwise `$XDG_CONFIG_HOME/opencode`, otherwise `~/.config/opencode/`:

- `plugins/render.ts`
- `skills/render-*/SKILL.md`
- `commands/deploy-to-render.md`
- `commands/check-render-status.md`
- `agents/render.md`

On upgrades, unchanged bundled files update automatically and obsolete bundled files are removed. A tracking manifest records installed file hashes; known unchanged files from version 0.1.0 are also recognized. Your modified files and unrelated files are preserved. Use `--force` to replace modified files:

```bash
curl -fsSL https://raw.githubusercontent.com/render-oss/render-opencode-plugin/main/install.sh | bash -s -- --force
```

Preview changes without writing files:

```bash
curl -fsSL https://raw.githubusercontent.com/render-oss/render-opencode-plugin/main/install.sh | bash -s -- --dry-run
```

Install the Render MCP server config too:

```bash
curl -fsSL https://raw.githubusercontent.com/render-oss/render-opencode-plugin/main/install.sh | bash -s -- --enable-mcp
```

This preserves your existing `opencode.json` fields and skips an existing `mcp.render` entry unless you pass `--force`. Set `RENDER_API_KEY` before using Render MCP.

Restart OpenCode after installation.

### Install from npm

Add the npm package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@render/opencode-plugin"]
}
```

OpenCode installs npm plugins with Bun at startup and caches them in its XDG cache directory (normally `~/.cache/opencode/node_modules/`). This flow requires the package to be published to npm.

Choose either the GitHub plugin or the npm plugin. When switching from GitHub to npm, remove the installed `plugins/render.ts`; OpenCode loads local and npm plugins independently and would otherwise run both validation hooks.

## Installing skills, commands, and the agent

OpenCode npm plugins can provide tools and hooks, but they don't automatically register bundled skills, commands, or agents. OpenCode discovers those files from your OpenCode config directory.

Run the explicit setup command after adding the plugin:

```bash
npx @render/opencode-plugin setup
```

This opt-in step uses the same config-directory defaults as the GitHub installer and writes:

- `skills/render-*/SKILL.md`
- `commands/deploy-to-render.md`
- `commands/check-render-status.md`
- `agents/render.md`

Rerun setup after updating the npm package to upgrade the bundled skills, commands, and agent. Unchanged installed files update automatically, obsolete bundled files are removed, and your edits are preserved. Use `--force` to replace modified files.

```bash
npx @render/opencode-plugin setup --force
```

To preview changes without writing files:

```bash
npx @render/opencode-plugin setup --dry-run
```

To install into a different OpenCode config directory:

```bash
npx @render/opencode-plugin setup --config-dir ./tmp-opencode
```

## Configuring Render MCP

If you want OpenCode to use Render MCP tools, run setup with `--enable-mcp`:

```bash
npx @render/opencode-plugin setup --enable-mcp
```

This merges the following server into `opencode.json`:

```json
{
  "mcp": {
    "render": {
      "type": "remote",
      "url": "https://mcp.render.com/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:RENDER_API_KEY}"
      }
    }
  }
}
```

Set `RENDER_API_KEY` in the environment of the process that launches OpenCode, then verify the connection:

```bash
opencode mcp list
```

The generated configuration uses API-key authentication with OAuth disabled. Setup preserves an existing `mcp.render` entry, including disabled or custom authentication settings, unless you pass `--force`.

## Setting up the Render CLI

The plugin validates Blueprints with the Render CLI. Render CLI 2.28.0 is tested with this plugin.

1. Install the Render CLI:

```bash
brew install render
```

2. Authenticate:

```bash
render login
```

3. Select the workspace used for validation and verify access:

```bash
render workspace set <workspace-id>
render whoami -o json
render blueprints validate ./render.yaml --output json
```

For API-key authentication, set `RENDER_API_KEY` instead of running `render login`. You can also set `RENDER_WORKSPACE` to select the workspace without changing saved CLI configuration. OpenCode must inherit these environment variables. Validation sends the Blueprint to Render for checking; it does not create or deploy resources.

The plugin passes the requested filename explicitly and resolves relative paths from the OpenCode session directory. It validates after `write`, `edit`, and `apply_patch` changes, including moved files, and skips reads and deletions. The explicit validation tool runs once per invocation.

## Using the plugin

Good first prompts:

- `Help me deploy this project to Render.`
- `Validate my render.yaml for Render.`
- `Debug a failed Render deployment.`
- `How are my Render services doing?`

You can also run:

```text
/deploy-to-render
/check-render-status
```

## Maintainer workflow

Refresh bundled skills from `render-oss/skills`:

```bash
./scripts/sync-skills.sh
```

Use a different source repo or subdirectory:

```bash
./scripts/sync-skills.sh --repo https://github.com/render-oss/skills --subdir skills
```

Verify the package before publishing:

```bash
npm run check
```

`npm run build` generates `assets/opencode/plugins/render.ts` from the same source as the npm plugin. Commit that generated file; do not edit it directly. Both installers use `assets/setup.mjs` for copying, upgrade tracking, and MCP configuration.

Install the OpenCode CLI and run the packaged integration tests:

```bash
npm install --prefix /tmp/render-opencode-cli opencode-ai@1.18.35
OPENCODE_BIN=/tmp/render-opencode-cli/node_modules/.bin/opencode npm run test:integration
```

The tests pack and install the npm package, exercise its executable, and start isolated OpenCode servers for both installation flows. A local scripted model and fake Render CLI test skills, command delegation, filename resolution, and validation hooks without model charges or Render credentials. CI runs the suite against OpenCode 1.15.11 and 1.18.35. Set `OPENCODE_INTEGRATION_KEEP=1` to retain temporary test artifacts.

## License

MIT. See [LICENSE](LICENSE).
