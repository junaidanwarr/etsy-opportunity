// Remove the [Sample] discoveries loaded from samples/sample-report.json. Run before going live.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../lib/db.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const db = openDatabase(resolve(root, process.env.DATABASE_PATH || 'data/foundry.sqlite'))
const { changes } = db.prepare("DELETE FROM discoveries WHERE id LIKE 'sample-%'").run()
db.prepare("DELETE FROM reports WHERE source = 'cli' AND products + shops > 0 AND NOT EXISTS (SELECT 1 FROM snapshots WHERE snapshots.report_id = reports.id)").run()
console.log(`Removed ${changes} sample discoveries.`)
db.close()
