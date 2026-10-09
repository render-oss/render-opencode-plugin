export type InstallOptions = {
  sourceAssetsDir?: string
  targetConfigDir?: string
  force?: boolean
  enableMcp?: boolean
  dryRun?: boolean
  includePlugin?: boolean
}
export type InstallResult = { written: string[]; skipped: string[]; removed: string[] }
export function installOpenCodeAssets(options?: InstallOptions): Promise<InstallResult>
export function getDefaultConfigDir(): string
export function mergeMcpConfig(configPath: string, result: InstallResult, dryRun?: boolean, force?: boolean): Promise<void>
export function main(argv?: string[]): Promise<void>
