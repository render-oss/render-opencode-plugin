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

This writes files to `~/.config/opencode/`:

- `plugins/render.ts`
- `skills/render-*/SKILL.md`
- `commands/deploy-to-render.md`
- `commands/check-render-status.md`
- `agents/render.md`

The installer doesn't overwrite existing files unless you pass `--force`:

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

OpenCode installs npm plugins with Bun at startup and caches them in `~/.cache/opencode/node_modules/`. This flow requires the package to be published to npm.

## Installing skills, commands, and the agent

OpenCode npm plugins can provide tools and hooks, but they don't automatically register bundled skills, commands, or agents. OpenCode discovers those files from your OpenCode config directory.

Run the explicit setup command after adding the plugin:

```bash
npx @render/opencode-plugin setup
```

This opt-in step writes files to `~/.config/opencode/`:

- `skills/render-*/SKILL.md`
- `commands/deploy-to-render.md`
- `commands/check-render-status.md`
- `agents/render.md`

The setup command doesn't overwrite existing files unless you pass `--force`.

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

Set `RENDER_API_KEY` in your environment before using Render MCP.

## Setting up the Render CLI

The plugin can validate Blueprints with the Render CLI.

1. Install the Render CLI:

```bash
brew install render
```

2. Authenticate:

```bash
render login
```

3. Verify access:

```bash
render whoami -o json
```

If `render whoami -o json` fails, fix authentication before relying on live Render workflows in OpenCode.

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

## License

MIT. See [LICENSE](LICENSE).
