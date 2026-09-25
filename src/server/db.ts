import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { listMigrationFiles } from '../domain/migrations'
import { ensureSchema, type Db } from '../domain/ingest'

/** One client for the process. The startup plugin and the request graph are separate bundles. */
export const PROCESS_DB = '__floorTapeDb'

type DbHost = typeof globalThis & { [PROCESS_DB]?: Promise<Db> }

export async function readMigrationSql(): Promise<string> {
  const dir = path.join(process.cwd(), 'migrations')
  const files = listMigrationFiles(await readdir(dir))
  if (!files.some((name) => name.startsWith('0002_'))) throw new Error('migrations/0002_*.sql is missing')
  const chunks = await Promise.all(files.map((file) => readFile(path.join(dir, file), 'utf8')))
  return chunks.join('\n')
}

async function openDb(): Promise<Db> {
  const schemaSql = await readMigrationSql()
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    const loaded = await import('pg')
    const Pool = loaded.Pool ?? loaded.default?.Pool
    if (!Pool) throw new Error('pg Pool export is missing')
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
    })
    const db: Db = {
      exec: async (sql) => {
        await pool.query(sql)
      },
      query: async <T>(sql: string, params: unknown[] = []) => {
        const result = await pool.query(sql, params)
        return result.rows as T[]
      },
    }
    await ensureSchema(db, schemaSql)
    return db
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const dir = path.join(process.cwd(), '.data', 'pglite')
  await mkdir(dir, { recursive: true })
  const client = new PGlite(dir)
  const db: Db = {
    exec: async (sql) => {
      await client.exec(sql)
    },
    query: async <T>(sql: string, params: unknown[] = []) => {
      const result = await client.query<T>(sql, params)
      return result.rows
    },
  }
  await ensureSchema(db, schemaSql)
  return db
}

export function getDb(): Promise<Db> {
  const host = globalThis as DbHost
  if (!host[PROCESS_DB]) host[PROCESS_DB] = openDb()
  return host[PROCESS_DB]
}
