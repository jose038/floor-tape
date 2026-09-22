/** Ordered SQL migrations. 0002 stays required; later files run after it. */
export function listMigrationFiles(names: string[]): string[] {
  return names.filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
}
