import { createClient } from '@libsql/client'

export function createDatabase() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!url || !authToken) return null

  return createClient({ url, authToken })
}

export async function initializeDatabase(db) {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS records (
        resource TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (resource, id)
      )`,
      `CREATE INDEX IF NOT EXISTS records_by_resource ON records(resource)`,
      `CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS app_users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        auth_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )`,
    ],
    'write',
  )
  const columns = await db.execute('PRAGMA table_info(app_users)')
  if (!columns.rows.some((column) => column.name === 'auth_version')) {
    await db.execute('ALTER TABLE app_users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1')
  }
}
