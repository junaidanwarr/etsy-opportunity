// Local / VPS entry point. On Vercel, api/index.mjs is used instead.
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }

const { createApp } = await import('./lib/app.mjs')
const { cfg, db, handler } = createApp(root)
const server = createServer(handler)
const port = Number(process.env.PORT || 4174), host = process.env.HOST || '127.0.0.1'
server.listen(port, host, () => console.log(`${cfg.siteName} running on http://${host}:${port}  (admin: /admin)  database: ${process.env.TURSO_DATABASE_URL ? 'Turso' : 'local file'}`))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { db.close(); process.exit(0) }))
