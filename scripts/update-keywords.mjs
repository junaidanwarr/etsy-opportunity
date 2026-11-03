import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSchema, openDatabase, makeState } from '../lib/db.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
try { process.loadEnvFile(resolve(root, '.env')) } catch (e) { if (e.code !== 'ENOENT') throw e }
const file = process.argv[2]
if (!file) throw new Error('Usage: npm run update-keywords -- path/to/keywords.json')
const input = JSON.parse(await readFile(file, 'utf8'))
const keywords = [...new Set((Array.isArray(input) ? input : input.keywords || []).map(k => typeof k === 'string' ? k.trim().slice(0,100) : '').filter(Boolean))]
if (!keywords.length || keywords.length > 1000) throw new Error('Provide 1–1000 keyword strings.')
const db = openDatabase(root)
try { await ensureSchema(db); await makeState(db).setMeta('weekly_keywords', JSON.stringify({ keywords, updatedAt: new Date().toISOString() })); console.log(`Published ${keywords.length} keywords. This replaces the previous weekly list.`) } finally { db.close() }
