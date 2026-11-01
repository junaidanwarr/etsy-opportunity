// Remove the [Sample] discoveries loaded from samples/sample-report.json. Run before going live.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSchema, openDatabase } from '../lib/db.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const db = openDatabase(root)
await ensureSchema(db)
const [, del] = await db.batch([
  "DELETE FROM snapshots WHERE discovery_id LIKE 'sample-%'",
  "DELETE FROM discoveries WHERE id LIKE 'sample-%'",
  "DELETE FROM reports WHERE source = 'cli' AND products + shops > 0 AND NOT EXISTS (SELECT 1 FROM snapshots WHERE snapshots.report_id = reports.id)",
], 'write')
console.log(`Removed ${del.rowsAffected} sample discoveries.`)
db.close()
