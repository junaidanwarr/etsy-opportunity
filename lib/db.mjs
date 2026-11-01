// Storage and Radar ingestion. Uses Node's built-in SQLite, so there are no native dependencies to install.
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const REQUEST_STATUSES = ['new', 'reviewing', 'contacted', 'completed', 'archived']
export const CONTACT_METHODS = ['Email', 'WhatsApp', 'Phone']
const MAX_REPORT_ITEMS = 2000

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
      discovery_id TEXT NOT NULL REFERENCES discoveries(id) ON DELETE CASCADE,
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
  `)
  return db
}

/* ---------- Sanitising helpers (also used by the server) ---------- */
export const safeText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : ''
const hash = value => createHash('sha256').update(value).digest('hex')
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

export function makeStore(db, { autoApprove = false } = {}) {
  const q = {
    get: db.prepare('SELECT * FROM discoveries WHERE id = ?'),
    publicOne: db.prepare('SELECT * FROM discoveries WHERE id = ? AND approved = 1'),
    publicKind: db.prepare('SELECT * FROM discoveries WHERE approved = 1 AND kind = ? ORDER BY featured DESC, discovered_at DESC, updated_at DESC'),
    adminAll: db.prepare('SELECT * FROM discoveries ORDER BY approved ASC, featured DESC, last_seen_at DESC LIMIT 2000'),
    insert: db.prepare(`INSERT INTO discoveries (id,kind,title,category,image,listing_url,shop_name,shop_url,discovered_at,last_seen_at,keywords,metrics,approved,featured,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`),
    refresh: db.prepare(`UPDATE discoveries SET title=?, category=CASE WHEN ?<>'' THEN ? ELSE category END, image=CASE WHEN ?<>'' THEN ? ELSE image END,
      listing_url=CASE WHEN ?<>'' THEN ? ELSE listing_url END, shop_name=CASE WHEN ?<>'' THEN ? ELSE shop_name END, shop_url=CASE WHEN ?<>'' THEN ? ELSE shop_url END,
      last_seen_at=?, keywords=CASE WHEN ?<>'[]' THEN ? ELSE keywords END, metrics=CASE WHEN ?<>'{}' THEN ? ELSE metrics END, updated_at=? WHERE id=?`),
    snapshot: db.prepare('INSERT INTO snapshots (discovery_id, report_id, seen_at, metrics) VALUES (?,?,?,?)'),
    snapshots: db.prepare('SELECT seen_at, metrics FROM snapshots WHERE discovery_id = ? ORDER BY seen_at DESC LIMIT 30'),
    report: db.prepare('INSERT INTO reports (received_at, source, generated_at, products, shops, status, message) VALUES (?,?,?,?,?,?,?)'),
    reportDone: db.prepare('UPDATE reports SET created=?, updated=?, skipped=?, status=?, message=? WHERE id=?'),
    reports: db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 60'),
    lastGoodReport: db.prepare("SELECT * FROM reports WHERE status <> 'failed' ORDER BY id DESC LIMIT 1"),
    counts: db.prepare(`SELECT
      SUM(kind='product' AND approved=1) AS products, SUM(kind='shop' AND approved=1) AS shops,
      SUM(approved=0) AS pending, (SELECT COUNT(*) FROM workflow_requests WHERE status='new') AS newRequests FROM discoveries`),
  }

  function ingest(body, source) {
    const now = new Date().toISOString()
    const products = Array.isArray(body?.products) ? body.products : null
    const shops = Array.isArray(body?.shops) ? body.shops : null
    if (!products || !shops) {
      const message = 'Report must be a JSON object with "products" and "shops" arrays.'
      q.report.run(now, source, '', 0, 0, 'failed', message)
      return { ok: false, status: 400, message }
    }
    if (products.length + shops.length > MAX_REPORT_ITEMS) {
      const message = `A report can contain at most ${MAX_REPORT_ITEMS} discoveries; split larger reports.`
      q.report.run(now, source, '', products.length, shops.length, 'failed', message)
      return { ok: false, status: 413, message }
    }
    const generatedAt = isoDate(body.generatedAt || body.updatedAt) || now
    const reportId = Number(q.report.run(now, source, generatedAt, products.length, shops.length, 'ok', '').lastInsertRowid)
    let created = 0, updated = 0, skipped = 0
    const problems = []
    db.exec('BEGIN')
    try {
      for (const [kind, records] of [['product', products], ['shop', shops]]) {
        records.forEach((item, index) => {
          if (!item || typeof item !== 'object') { skipped++; problems.push(`${kind} #${index + 1}: not an object`); return }
          const title = safeText(item.title || item.name, 240)
          if (!title) { skipped++; problems.push(`${kind} #${index + 1}: missing title`); return }
          const listingUrl = kind === 'product' ? etsyUrl(item.listingUrl || item.url) : ''
          const shopUrl = etsyUrl(item.shopUrl || (kind === 'shop' ? item.url : ''))
          const id = safeText(item.id, 100).replace(/[^\w.-]/g, '-') || `${kind}-${hash(`${title.toLowerCase()}|${listingUrl || shopUrl}`).slice(0, 24)}`
          const fields = {
            category: safeText(item.category, 100), image: httpsUrl(item.image || item.imageUrl),
            shopName: safeText(item.shopName || (kind === 'shop' ? title : ''), 160),
            keywords: JSON.stringify((Array.isArray(item.keywords) ? item.keywords : []).slice(0, 30).map(w => safeText(w, 80)).filter(Boolean)),
            metrics: JSON.stringify(cleanMetrics(item.metrics)),
          }
          const seenAt = isoDate(item.discoveredAt) || generatedAt
          const existing = q.get.get(id)
          if (existing) {
            q.refresh.run(title, fields.category, fields.category, fields.image, fields.image, listingUrl, listingUrl, fields.shopName, fields.shopName,
              shopUrl, shopUrl, generatedAt, fields.keywords, fields.keywords, fields.metrics, fields.metrics, now, id)
            updated++
          } else {
            q.insert.run(id, kind, title, fields.category, fields.image, listingUrl, fields.shopName, shopUrl, seenAt, generatedAt,
              fields.keywords, fields.metrics, autoApprove ? 1 : 0, now, now)
            created++
          }
          q.snapshot.run(id, reportId, generatedAt, fields.metrics)
        })
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      q.reportDone.run(0, 0, products.length + shops.length, 'failed', `Import failed: ${error.message}`.slice(0, 500), reportId)
      return { ok: false, status: 500, message: 'The report could not be stored. Nothing was imported.' }
    }
    const status = skipped ? 'partial' : 'ok'
    q.reportDone.run(created, updated, skipped, status, problems.slice(0, 10).join('; '), reportId)
    return { ok: true, status: 202, reportId, created, updated, skipped, problems: problems.slice(0, 10), autoApproved: autoApprove }
  }

  return {
    ingest,
    get: id => decode(q.get.get(id)),
    publicOne: id => decode(q.publicOne.get(id)),
    publicKind: kind => q.publicKind.all(kind).map(decode),
    adminAll: () => q.adminAll.all().map(decode),
    snapshots: id => q.snapshots.all(id).map(r => ({ seenAt: r.seen_at, metrics: JSON.parse(r.metrics) })),
    reports: () => q.reports.all(),
    lastGoodReport: () => q.lastGoodReport.get() || null,
    counts: () => { const c = q.counts.get(); return { products: c.products || 0, shops: c.shops || 0, pending: c.pending || 0, newRequests: c.newRequests || 0 } },
    update(id, patch) {
      const cur = q.get.get(id)
      if (!cur) return null
      const next = {
        approved: typeof patch.approved === 'boolean' ? Number(patch.approved) : cur.approved,
        featured: typeof patch.featured === 'boolean' ? Number(patch.featured) : cur.featured,
        title: patch.title !== undefined ? safeText(patch.title, 240) || cur.title : cur.title,
        category: patch.category !== undefined ? safeText(patch.category, 100) : cur.category,
        note: patch.note !== undefined ? safeText(patch.note, 1000) : cur.note,
      }
      db.prepare('UPDATE discoveries SET approved=?, featured=?, title=?, category=?, note=?, updated_at=? WHERE id=?')
        .run(next.approved, next.featured, next.title, next.category, next.note, new Date().toISOString(), id)
      return decode(q.get.get(id))
    },
    remove: id => db.prepare('DELETE FROM discoveries WHERE id=?').run(id).changes > 0,
    unpublishStale: days => db.prepare("UPDATE discoveries SET approved=0, featured=0, updated_at=? WHERE approved=1 AND last_seen_at < ?")
      .run(new Date().toISOString(), new Date(Date.now() - days * 864e5).toISOString()).changes,
    approveAll: () => db.prepare('UPDATE discoveries SET approved=1, updated_at=? WHERE approved=0').run(new Date().toISOString()).changes,
  }
}

/* ---------- Workflow requests ---------- */
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeRef = () => 'FD-' + [...randomBytes(5)].map(b => REF_CHARS[b % REF_CHARS.length]).join('')

export function makeRequests(db) {
  const decodeReq = r => r && ({ id: r.id, ref: r.ref, name: r.name, contact: r.contact, contactMethod: r.contact_method, goal: r.goal,
    selected: JSON.parse(r.selected), status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at })
  return {
    create({ name, contact, contactMethod, goal, selected }) {
      const id = randomBytes(16).toString('hex'), now = new Date().toISOString()
      let ref = makeRef()
      while (db.prepare('SELECT 1 FROM workflow_requests WHERE ref=?').get(ref)) ref = makeRef()
      db.prepare('INSERT INTO workflow_requests (id,ref,name,contact,contact_method,goal,selected,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, ref, name, contact, contactMethod, goal, JSON.stringify(selected), now, now)
      return { id, ref }
    },
    byRef: ref => decodeReq(db.prepare('SELECT * FROM workflow_requests WHERE ref=?').get(ref)),
    all: () => db.prepare('SELECT * FROM workflow_requests ORDER BY created_at DESC LIMIT 1000').all().map(decodeReq),
    update(id, { status, notes }) {
      const cur = db.prepare('SELECT * FROM workflow_requests WHERE id=?').get(id)
      if (!cur) return null
      const nextStatus = REQUEST_STATUSES.includes(status) ? status : cur.status
      const nextNotes = notes !== undefined ? safeText(notes, 4000) : cur.notes
      db.prepare('UPDATE workflow_requests SET status=?, notes=?, updated_at=? WHERE id=?').run(nextStatus, nextNotes, new Date().toISOString(), id)
      return decodeReq(db.prepare('SELECT * FROM workflow_requests WHERE id=?').get(id))
    },
  }
}
