const FILE_PATH_KEYS = new Set(["file", "filePath", "file_path", "filename", "path"])

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
