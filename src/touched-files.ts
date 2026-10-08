const FILE_PATH_KEYS = new Set(["file", "filePath", "file_path", "filename", "path"])
const MUTATING_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch"])

export function extractMutatedFiles(tool: string, args: unknown, metadata: unknown): string[] {
  if (!MUTATING_TOOLS.has(tool)) return []
  if (tool !== "apply_patch") return [...new Set(extractTouchedFiles(args))]

  // OpenCode's patch result identifies every affected file, including moves and deletions.
  if (isRecord(metadata) && Array.isArray(metadata.files)) {
    return [...new Set(metadata.files.flatMap((file) => {
      if (!isRecord(file) || file.type === "delete") return []
      const path = file.movePath ?? file.filePath
      return typeof path === "string" ? [path] : []
    }))]
  }

  // Older clients can omit file metadata. Read only path headers, never patch contents.
  if (!isRecord(args) || typeof args.patchText !== "string") return []
  const files: string[] = []
  for (const line of args.patchText.split(/\r?\n/)) {
    const match = /^\*\*\* (Add File|Update File|Move to): (.+)$/.exec(line)
    if (!match) continue
    if (match[1] === "Move to") files.pop()
    files.push(match[2])
  }
  return [...new Set(files)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function extractTouchedFiles(value: unknown): string[] {
  const files: string[] = []
  collectTouchedFiles(value, files)
  return files
}

function collectTouchedFiles(value: unknown, files: string[], key?: string) {
  if (typeof value === "string") {
    if (key && FILE_PATH_KEYS.has(key)) {
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
