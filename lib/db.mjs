// Storage, Radar ingestion, sessions and rate limits.
// Uses libSQL: a Turso database in production (TURSO_DATABASE_URL), or a local SQLite file in development.
import { createClient } from '@libsql/client'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const REQUEST_STATUSES = ['new', 'reviewing', 'contacted', 'completed', 'archived']
export const CONTACT_METHODS = ['Email', 'WhatsApp', 'Phone']
const MAX_REPORT_ITEMS = 2000

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS discoveries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('product','shop')),
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    listing_url TEXT NOT NULL DEFAULT '',
    shop_name TEXT NOT NULL DEFAULT '',
    shop_url TEXT NOT NULL DEFAULT '',
    discovered_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    metrics TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0,
    featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS discoveries_public_idx ON discoveries(approved, kind, discovered_at DESC);
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    source TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT '',
    products INTEGER NOT NULL DEFAULT 0,
    shops INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('ok','partial','failed')),
    message TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discovery_id TEXT NOT NULL,
    report_id INTEGER NOT NULL,
    seen_at TEXT NOT NULL,
    metrics TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS snapshots_discovery_idx ON snapshots(discovery_id, seen_at DESC);
  CREATE TABLE IF NOT EXISTS workflow_requests (
    id TEXT PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    contact_method TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    selected TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Open Turso when TURSO_DATABASE_URL is set, otherwise a local SQLite file (DATABASE_PATH, default data/foundry.sqlite). */
export function openDatabase(root, env = process.env) {
  if (env.TURSO_DATABASE_URL) return createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
  const path = resolve(root, env.DATABASE_PATH || 'data/foundry.sqlite')
  mkdirSync(dirname(path), { recursive: true })
  return createClient({ url: 'file:' + path.split('\\').join('/') })
}
const schemaReady = new WeakMap()
export const ensureSchema = db => { if (!schemaReady.has(db)) schemaReady.set(db, db.executeMultiple(SCHEMA)); return schemaReady.get(db) }

/* ---------- Sanitising helpers (also used by the app) ---------- */
export const safeText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : ''
export const sha = value => createHash('sha256').update(value).digest('hex')
export function etsyUrl(value) {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'etsy.com' || url.hostname.endsWith('.etsy.com')) ? url.href : ''
  } catch { return '' }
}
export function httpsUrl(value) {
  if (typeof value !== 'string' || !value) return ''
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '' } catch { return '' }
}
const isoDate = value => {
  const s = safeText(value, 40)
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.getTime() > Date.now() ? new Date().toISOString() : d.toISOString() // a clock-skewed Radar can't post future dates
}
function cleanMetrics(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw).slice(0, 24)) {
    const k = safeText(key, 60)
    if (!k) continue
    if (typeof value === 'number' && Number.isFinite(value)) out[k] = value
    else if (typeof value === 'string' || typeof value === 'boolean') out[k] = safeText(String(value), 120)
  }
  return out
}

/* ---------- Discoveries ---------- */
const decode = row => row && ({
  id: row.id, kind: row.kind, title: row.title, category: row.category, image: row.image,
  listingUrl: row.listing_url, shopName: row.shop_name, shopUrl: row.shop_url,
  discoveredAt: row.discovered_at, lastSeenAt: row.last_seen_at,
  keywords: JSON.parse(row.keywords), metrics: JSON.parse(row.metrics), note: row.note,
  approved: Boolean(row.approved), featured: Boolean(row.featured), createdAt: row.created_at, updatedAt: row.updated_at,
})
const plainRows = result => result.rows.map(r => ({ ...r }))

export function makeStore(db, { autoApprove = false } = {}) {
  const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0]
  const all = async (sql, args = []) => (await db.execute({ sql, args })).rows
  const run = (sql, args = []) => db.execute({ sql, args })

  async function logReport(now, source, generatedAt, products, shops, status, message) {
    const r = await run('INSERT INTO reports (received_at, source, generated_at, products, shops, status, message) VALUES (?,?,?,?,?,?,?)', [now, source, generatedAt, products, shops, status, message])
    return Number(r.lastInsertRowid)
  }

  async function ingest(body, source) {
    const now = new Date().toISOString()
    const products = Array.isArray(body?.products) ? body.products : null
    const shops = Array.isArray(body?.shops) ? body.shops : null
    if (!products || !shops) {
      const message = 'Report must be a JSON object with "products" and "shops" arrays.'
      await logReport(now, source, '', 0, 0, 'failed', message)
      return { ok: false, status: 400, message }
    }
    if (products.length + shops.length > MAX_REPORT_ITEMS) {
      const message = `A report can contain at most ${MAX_REPORT_ITEMS} discoveries; split larger reports.`
      await logReport(now, source, '', products.length, shops.length, 'failed', message)
      return { ok: false, status: 413, message }
    }
    const generatedAt = isoDate(body.generatedAt || body.updatedAt) || now
    const reportId = await logReport(now, source, generatedAt, products.length, shops.length, 'ok', '')

    // Validate everything first, then write it all in one atomic batch (one round trip to Turso).
    const items = [], problems = []
    let skipped = 0
    for (const [kind, records] of [['product', products], ['shop', shops]]) {
      records.forEach((item, index) => {
        if (!item || typeof item !== 'object') { skipped++; problems.push(`${kind} #${index + 1}: not an object`); return }
        const title = safeText(item.title || item.name, 240)
        if (!title) { skipped++; problems.push(`${kind} #${index + 1}: missing title`); return }
        const listingUrl = kind === 'product' ? etsyUrl(item.listingUrl || item.url) : ''
        const shopUrl = etsyUrl(item.shopUrl || (kind === 'shop' ? item.url : ''))
        items.push({
          id: safeText(item.id, 100).replace(/[^\w.-]/g, '-') || `${kind}-${sha(`${title.toLowerCase()}|${listingUrl || shopUrl}`).slice(0, 24)}`,
          kind, title, listingUrl, shopUrl,
          category: safeText(item.category, 100), image: httpsUrl(item.image || item.imageUrl),
          shopName: safeText(item.shopName || (kind === 'shop' ? title : ''), 160),
          keywords: JSON.stringify((Array.isArray(item.keywords) ? item.keywords : []).slice(0, 30).map(w => safeText(w, 80)).filter(Boolean)),
          metrics: JSON.stringify(cleanMetrics(item.metrics)),
          seenAt: isoDate(item.discoveredAt) || generatedAt,
        })
      })
    }
    const existing = new Set()
    for (let i = 0; i < items.length; i += 400) {
      const chunk = items.slice(i, i + 400).map(x => x.id)
      for (const r of await all(`SELECT id FROM discoveries WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)) existing.add(r.id)
    }
    let created = 0, updated = 0
    const stmts = []
    for (const x of items) {
      if (existing.has(x.id)) {
        stmts.push({ sql: `UPDATE discoveries SET title=?, category=CASE WHEN ?<>'' THEN ? ELSE category END, image=CASE WHEN ?<>'' THEN ? ELSE image END,
          listing_url=CASE WHEN ?<>'' THEN ? ELSE listing_url END, shop_name=CASE WHEN ?<>'' THEN ? ELSE shop_name END, shop_url=CASE WHEN ?<>'' THEN ? ELSE shop_url END,
          last_seen_at=?, keywords=CASE WHEN ?<>'[]' THEN ? ELSE keywords END, metrics=CASE WHEN ?<>'{}' THEN ? ELSE metrics END, updated_at=? WHERE id=?`,
          args: [x.title, x.category, x.category, x.image, x.image, x.listingUrl, x.listingUrl, x.shopName, x.shopName, x.shopUrl, x.shopUrl,
            generatedAt, x.keywords, x.keywords, x.metrics, x.metrics, now, x.id] })
        updated++
      } else {
        stmts.push({ sql: `INSERT INTO discoveries (id,kind,title,category,image,listing_url,shop_name,shop_url,discovered_at,last_seen_at,keywords,metrics,approved,featured,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
          args: [x.id, x.kind, x.title, x.category, x.image, x.listingUrl, x.shopName, x.shopUrl, x.seenAt, generatedAt, x.keywords, x.metrics, autoApprove ? 1 : 0, now, now] })
        existing.add(x.id) // a duplicate id later in the same report becomes an update
        created++
      }
      stmts.push({ sql: 'INSERT INTO snapshots (discovery_id, report_id, seen_at, metrics) VALUES (?,?,?,?)', args: [x.id, reportId, generatedAt, x.metrics] })
    }
    try {
      if (stmts.length) await db.batch(stmts, 'write')
    } catch (error) {
      await run('UPDATE reports SET skipped=?, status=?, message=? WHERE id=?', [products.length + shops.length, 'failed', `Import failed: ${error.message}`.slice(0, 500), reportId])
      return { ok: false, status: 500, message: 'The report could not be stored. Nothing was imported.' }
    }
    const status = skipped ? 'partial' : 'ok'
    await run('UPDATE reports SET created=?, updated=?, skipped=?, status=?, message=? WHERE id=?', [created, updated, skipped, status, problems.slice(0, 10).join('; '), reportId])
    return { ok: true, status: 202, reportId, created, updated, skipped, problems: problems.slice(0, 10), autoApproved: autoApprove }
  }

  return {
    ingest,
    get: async id => decode(await one('SELECT * FROM discoveries WHERE id = ?', [id])),
    publicOne: async id => decode(await one('SELECT * FROM discoveries WHERE id = ? AND approved = 1', [id])),
    publicAll: async () => (await all('SELECT * FROM discoveries WHERE approved = 1 ORDER BY featured DESC, discovered_at DESC, updated_at DESC')).map(decode),
    adminAll: async () => (await all('SELECT * FROM discoveries ORDER BY approved ASC, featured DESC, last_seen_at DESC LIMIT 2000')).map(decode),
    snapshots: async id => (await all('SELECT seen_at, metrics FROM snapshots WHERE discovery_id = ? ORDER BY seen_at DESC LIMIT 30', [id])).map(r => ({ seenAt: r.seen_at, metrics: JSON.parse(r.metrics) })),
    reports: async () => plainRows(await db.execute('SELECT * FROM reports ORDER BY id DESC LIMIT 60')),
    lastGoodReport: async () => { const r = await one("SELECT * FROM reports WHERE status <> 'failed' ORDER BY id DESC LIMIT 1"); return r ? { ...r } : null },
    async counts() {
      const c = await one(`SELECT SUM(kind='product' AND approved=1) AS products, SUM(kind='shop' AND approved=1) AS shops, SUM(approved=0) AS pending,
        (SELECT COUNT(*) FROM workflow_requests WHERE status='new') AS newRequests FROM discoveries`)
      return { products: Number(c?.products || 0), shops: Number(c?.shops || 0), pending: Number(c?.pending || 0), newRequests: Number(c?.newRequests || 0) }
    },
    async update(id, patch) {
      const cur = await one('SELECT * FROM discoveries WHERE id = ?', [id])
      if (!cur) return null
      const next = {
        approved: typeof patch.approved === 'boolean' ? Number(patch.approved) : cur.approved,
        featured: typeof patch.featured === 'boolean' ? Number(patch.featured) : cur.featured,
        title: patch.title !== undefined ? safeText(patch.title, 240) || cur.title : cur.title,
        category: patch.category !== undefined ? safeText(patch.category, 100) : cur.category,
        note: patch.note !== undefined ? safeText(patch.note, 1000) : cur.note,
      }
      await run('UPDATE discoveries SET approved=?, featured=?, title=?, category=?, note=?, updated_at=? WHERE id=?',
        [next.approved, next.featured, next.title, next.category, next.note, new Date().toISOString(), id])
      return decode(await one('SELECT * FROM discoveries WHERE id = ?', [id]))
    },
    async remove(id) {
      const [, del] = await db.batch([{ sql: 'DELETE FROM snapshots WHERE discovery_id=?', args: [id] }, { sql: 'DELETE FROM discoveries WHERE id=?', args: [id] }], 'write')
      return del.rowsAffected > 0
    },
    unpublishStale: async days => (await run('UPDATE discoveries SET approved=0, featured=0, updated_at=? WHERE approved=1 AND last_seen_at < ?',
      [new Date().toISOString(), new Date(Date.now() - days * 864e5).toISOString()])).rowsAffected,
    approveAll: async () => (await run('UPDATE discoveries SET approved=1, updated_at=? WHERE approved=0', [new Date().toISOString()])).rowsAffected,
  }
}

/* ---------- Workflow requests ---------- */
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeRef = () => 'FD-' + [...randomBytes(5)].map(b => REF_CHARS[b % REF_CHARS.length]).join('')

export function makeRequests(db) {
  const decodeReq = r => r && ({ id: r.id, ref: r.ref, name: r.name, contact: r.contact, contactMethod: r.contact_method, goal: r.goal,
    selected: JSON.parse(r.selected), status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at })
  const one = async (sql, args) => (await db.execute({ sql, args })).rows[0]
  return {
    async create({ name, contact, contactMethod, goal, selected }) {
      const id = randomBytes(16).toString('hex'), now = new Date().toISOString()
      for (let attempt = 0; ; attempt++) {
        const ref = makeRef()
        try {
          await db.execute({ sql: 'INSERT INTO workflow_requests (id,ref,name,contact,contact_method,goal,selected,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
            args: [id, ref, name, contact, contactMethod, goal, JSON.stringify(selected), now, now] })
          return { id, ref }
        } catch (error) { if (attempt > 4 || !/UNIQUE/i.test(error.message)) throw error } // ref collision: try another
      }
    },
    byRef: async ref => decodeReq(await one('SELECT * FROM workflow_requests WHERE ref=?', [ref])),
    all: async () => (await db.execute('SELECT * FROM workflow_requests ORDER BY created_at DESC LIMIT 1000')).rows.map(decodeReq),
    async update(id, { status, notes }) {
      const cur = await one('SELECT * FROM workflow_requests WHERE id=?', [id])
      if (!cur) return null
      const nextStatus = REQUEST_STATUSES.includes(status) ? status : cur.status
      const nextNotes = notes !== undefined ? safeText(notes, 4000) : cur.notes
      await db.execute({ sql: 'UPDATE workflow_requests SET status=?, notes=?, updated_at=? WHERE id=?', args: [nextStatus, nextNotes, new Date().toISOString(), id] })
      return decodeReq(await one('SELECT * FROM workflow_requests WHERE id=?', [id]))
    },
  }
}

/* ---------- Admin sessions, rate limits, small key/value state (all in the DB so they survive serverless restarts) ---------- */
export function makeState(db) {
  return {
    async createSession(ttlMs) {
      const token = randomBytes(32).toString('base64url')
      await db.batch([{ sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [Date.now()] },
        { sql: 'INSERT INTO sessions (token_hash, expires_at) VALUES (?,?)', args: [sha(token), Date.now() + ttlMs] }], 'write')
      return token
    },
    async validSession(token) {
      if (!token) return false
      const r = (await db.execute({ sql: 'SELECT expires_at FROM sessions WHERE token_hash=?', args: [sha(token)] })).rows[0]
      return Boolean(r && Number(r.expires_at) > Date.now())
    },
    dropSession: token => db.execute({ sql: 'DELETE FROM sessions WHERE token_hash=?', args: [sha(token)] }),
    /** true when the caller is over the limit */
    async limited(key, max, windowMs) {
      const now = Date.now()
      const r = (await db.execute({ sql: `INSERT INTO rate_limits (key, count, until) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET count = CASE WHEN until <= ? THEN 1 ELSE count + 1 END, until = CASE WHEN until <= ? THEN ? ELSE until END
        RETURNING count`, args: [key, now + windowMs, now, now, now + windowMs] })).rows[0]
      if (Math.random() < 0.02) db.execute({ sql: 'DELETE FROM rate_limits WHERE until < ?', args: [now] }).catch(() => {})
      return Number(r.count) > max
    },
    getMeta: async key => (await db.execute({ sql: 'SELECT value FROM meta WHERE key=?', args: [key] })).rows[0]?.value ?? '',
    setMeta: (key, value) => db.execute({ sql: 'INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', args: [key, value] }),
  }
}
