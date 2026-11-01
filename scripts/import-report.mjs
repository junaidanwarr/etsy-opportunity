// Import a Radar JSON report straight into the database, without going through HTTP.
// Usage: node scripts/import-report.mjs path/to/report.json [more.json ...]
// Writes to Turso when TURSO_DATABASE_URL is set in .env, otherwise to the local SQLite file.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSchema, makeStore, openDatabase } from '../lib/db.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }

const files = process.argv.slice(2)
if (!files.length) { console.error('Usage: node scripts/import-report.mjs report.json [...]'); process.exit(2) }
const db = openDatabase(root)
await ensureSchema(db)
const store = makeStore(db, { autoApprove: process.env.AUTO_APPROVE === 'true' })
let failed = 0
for (const file of files) {
  try {
    const result = await store.ingest(JSON.parse(await readFile(file, 'utf8')), 'cli')
    if (!result.ok) { failed++; console.error(`${file}: ${result.message}`); continue }
    console.log(`${file}: ${result.created} new, ${result.updated} updated, ${result.skipped} skipped${result.problems.length ? `\n  ${result.problems.join('\n  ')}` : ''}`)
  } catch (error) { failed++; console.error(`${file}: ${error instanceof SyntaxError ? 'not valid JSON' : error.message}`) }
}
db.close()
process.exit(failed ? 1 : 0)
