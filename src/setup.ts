#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { main } from "../assets/setup.mjs"

export { getDefaultConfigDir, installOpenCodeAssets, mergeMcpConfig } from "../assets/setup.mjs"

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
