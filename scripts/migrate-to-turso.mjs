// One-time copy of everything in the local SQLite file (data/foundry.sqlite) into your Turso database.
// Needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env. Safe to re-run: rows are upserted by their ids.
import { createClient } from '@libsql/client'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureSchema } from '../lib/db.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env
if (!url || !authToken) { console.error('Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to .env first.'); process.exit(2) }
const localPath = resolve(root, process.env.DATABASE_PATH || 'data/foundry.sqlite')
if (!existsSync(localPath)) { console.error(`No local database at ${localPath}.`); process.exit(2) }

const source = createClient({ url: 'file:' + localPath.split('\\').join('/') })
const target = createClient({ url, authToken })
await ensureSchema(target)
for (const table of ['discoveries', 'reports', 'snapshots', 'workflow_requests']) {
  const { rows, columns } = await source.execute(`SELECT * FROM ${table}`)
  for (let i = 0; i < rows.length; i += 200) {
    await target.batch(rows.slice(i, i + 200).map(r => ({
      sql: `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      args: columns.map(c => r[c]),
    })), 'write')
  }
  const { rows: [{ n }] } = await target.execute(`SELECT COUNT(*) AS n FROM ${table}`)
  console.log(`${table}: copied ${rows.length}, Turso now has ${n}`)
}
source.close(); target.close()
