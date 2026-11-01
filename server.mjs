// Foundry: public Etsy trend-discovery site + admin + Radar ingest API. Zero runtime dependencies (Node 22.13+ / 24).
import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTACT_METHODS, REQUEST_STATUSES, makeRequests, makeStore, openDatabase, safeText } from './lib/db.mjs'
import { makeViews } from './lib/views.mjs'
import { mailConfigFromEnv, mailReady, sendMail } from './lib/mail.mjs'

const root = dirname(fileURLToPath(import.meta.url))
try { process.loadEnvFile(resolve(root, '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }

const env = process.env
const isProduction = env.NODE_ENV === 'production'
const cfg = {
  siteName: env.SITE_NAME || 'Foundry',
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  newDays: Math.max(1, Number(env.NEW_DAYS) || 7),
  replyDays: env.REPLY_TIME || '2 working days',
  staleHours: Math.max(1, Number(env.STALE_AFTER_HOURS) || 36),
  assetVersion: Date.now().toString(36),
}
const contact = { email: env.CONTACT_EMAIL || '', whatsapp: env.CONTACT_WHATSAPP || '' }
const adminPassword = env.ADMIN_PASSWORD || ''
const radarToken = env.RADAR_INGEST_TOKEN || ''
if (isProduction && (adminPassword.length < 12 || radarToken.length < 24)) {
  console.error('Refusing to start: in production ADMIN_PASSWORD must be 12+ characters and RADAR_INGEST_TOKEN 24+ characters.')
  process.exit(1)
}

const db = openDatabase(resolve(root, env.DATABASE_PATH || 'data/foundry.sqlite'))
const store = makeStore(db, { autoApprove: env.AUTO_APPROVE === 'true' })
const requests = makeRequests(db)
const views = makeViews(cfg)
const publicDir = resolve(root, 'public')

/* ---------- HTTP helpers ---------- */
const sessions = new Map(), buckets = new Map()
const sha = v => createHash('sha256').update(v).digest('hex')
const safeEqual = (a, b) => { const x = Buffer.from(sha(String(a))), y = Buffer.from(sha(String(b))); return timingSafeEqual(x, y) && String(a).length === String(b).length }
const clientIp = req => (env.TRUST_PROXY === 'true' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown'
function limited(key, max, windowMs) {
  const now = Date.now(), b = buckets.get(key)
  if (!b || b.until <= now) { buckets.set(key, { n: 1, until: now + windowMs }); return false }
  return ++b.n > max
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.until <= now) buckets.delete(k); for (const [k, s] of sessions) if (s.expiresAt <= now) sessions.delete(k) }, 600_000).unref()

const SECURITY = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  ...(isProduction ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
}
const HTML_CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"
function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'content-type': type, ...SECURITY, ...extra })
  res.end(body)
}
const html = (res, status, body, extra = {}) => send(res, status, body, 'text/html; charset=utf-8', { 'content-security-policy': HTML_CSP, 'cache-control': 'no-cache', ...extra })
const json = (res, status, body, extra = {}) => send(res, status, JSON.stringify(body), 'application/json; charset=utf-8', { 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'", ...extra })
const redirect = (res, location) => send(res, 303, '', 'text/plain', { location })

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = []
    req.on('data', c => { size += c.length; if (size > maxBytes) { fail(Object.assign(new Error('Request body is too large.'), { status: 413 })); req.destroy(); return } chunks.push(c) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8'), type = String(req.headers['content-type'] || '')
      try {
        if (type.includes('application/x-www-form-urlencoded')) ok(Object.fromEntries(new URLSearchParams(raw)))
        else ok(JSON.parse(raw || '{}'))
      } catch { fail(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })) }
    })
    req.on('error', fail)
  })
}
const cookie = (req, name) => String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1)
function adminSession(req) {
  const token = cookie(req, 'foundry_admin')
  if (!token) return null
  const s = sessions.get(sha(decodeURIComponent(token)))
  if (!s || s.expiresAt < Date.now()) return null
  return s
}
const sameOrigin = req => { const o = req.headers.origin; return !o || o === `${isProduction ? 'https' : 'http'}://${req.headers.host}` || (cfg.siteUrl && o === cfg.siteUrl) }

const mail = mailConfigFromEnv(env)
let lastMailError = ''
function requestEmail(r) {
  const adminUrl = `${cfg.siteUrl || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 4174}`}/admin`
  const lines = [
    `New workflow request ${r.ref}`, '',
    `Name: ${r.name}`, `Preferred contact: ${r.contactMethod}`, `${r.contactMethod === 'Email' ? 'Email' : 'Number'}: ${r.contact}`,
    ...(r.contactMethod === 'WhatsApp' ? [`WhatsApp link: https://wa.me/${r.contact.replace(/\D/g, '').replace(/^0/, '92')}`] : []), '',
    'Goals / questions:', r.goal || '(none given)', '',
    `Selections (${r.selected.length}):`, ...(r.selected.length ? r.selected.map(s => `- ${s.title} (${s.kind})${s.url ? `\n  ${s.url}` : ''}`) : ['(none)']), '',
    `Review and update the status in admin: ${adminUrl}`,
  ]
  return { to: mail.to, subject: `New workflow request ${r.ref} from ${r.name}`, text: lines.join('\n'), replyTo: r.contactMethod === 'Email' ? r.contact : undefined }
}
async function emailTeam(message) {
  if (!mailReady(mail)) return false
  try { await sendMail(mail, message); lastMailError = ''; return true }
  catch (error) { lastMailError = `${new Date().toISOString()}: ${error.message}`; console.error('Team email failed:', error.message); return false }
}

async function notifyTeam(text) {
  if (!env.NOTIFY_WEBHOOK_URL) return
  try { await fetch(env.NOTIFY_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) }) }
  catch (error) { console.error('Team notification failed:', error.message) }
}

/* ---------- Public data helpers ---------- */
function shopIndex() {
  const shops = store.publicKind('shop'), products = store.publicKind('product')
  const byUrl = new Map(shops.filter(s => s.shopUrl).map(s => [s.shopUrl.replace(/\/$/, '').toLowerCase(), s]))
  const byName = new Map(shops.map(s => [(s.shopName || s.title).toLowerCase(), s]))
  const shopFor = p => (p.shopUrl && byUrl.get(p.shopUrl.replace(/\/$/, '').toLowerCase())) || (p.shopName && byName.get(p.shopName.toLowerCase())) || null
  const counts = {}
  for (const p of products) { const s = shopFor(p); if (s) counts[s.id] = (counts[s.id] || 0) + 1 }
  return { shops, products, shopFor, counts }
}
function filterItems(items, params) {
  const q = params.q.toLowerCase(), now = Date.now(), DAY = 864e5
  let out = items.filter(i => {
    if (params.category && i.category !== params.category) return false
    const age = now - new Date(i.discoveredAt).getTime()
    if (params.when === 'new' && age > cfg.newDays * DAY) return false
    if (params.when === '30d' && age > 30 * DAY) return false
    if (params.when === 'older' && age <= cfg.newDays * DAY) return false
    if (q && !`${i.title} ${i.category} ${i.shopName} ${i.keywords.join(' ')}`.toLowerCase().includes(q)) return false
    return true
  })
  const t = d => new Date(d).getTime() || 0
  if (params.sort === 'oldest') out.sort((a, b) => t(a.discoveredAt) - t(b.discoveredAt))
  else if (params.sort === 'seen') out.sort((a, b) => t(b.lastSeenAt) - t(a.lastSeenAt))
  else if (params.sort.startsWith('m:')) { const k = params.sort.slice(2); const v = i => typeof i.metrics[k] === 'number' ? i.metrics[k] : -Infinity; out.sort((a, b) => v(b) - v(a)) }
  else out.sort((a, b) => t(b.discoveredAt) - t(a.discoveredAt))
  return out
}
const numericMetricKeys = items => [...new Set(items.flatMap(i => Object.entries(i.metrics).filter(([, v]) => typeof v === 'number').map(([k]) => k)))].slice(0, 8)

/* ---------- Static files ---------- */
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' }
async function serveStatic(res, path) {
  const file = normalize(join(publicDir, path.slice('/static/'.length)))
  if (!file.startsWith(publicDir)) return false
  try {
    if (!(await stat(file)).isFile()) return false
    send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream', { 'cache-control': isProduction ? 'public, max-age=31536000, immutable' : 'no-cache' })
    return true
  } catch { return false }
}

/* ---------- Router ---------- */
const PAGE_SIZE = 24
async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method || 'GET'

  if (method === 'GET' && path.startsWith('/static/') && await serveStatic(res, path)) return
  if (method === 'GET' && path === '/api/health') {
    const last = store.lastGoodReport()
    const ageHours = last ? (Date.now() - new Date(last.received_at).getTime()) / 36e5 : null
    return json(res, 200, { status: 'ok', lastReportAt: last?.received_at || null, radarStale: ageHours === null || ageHours > cfg.staleHours })
  }

  /* --- Radar ingest (machine-to-machine) --- */
  if (method === 'POST' && path === '/api/radar/reports') {
    if (limited('radar:' + clientIp(req), 60, 3_600_000)) return json(res, 429, { error: 'Too many reports from this address.' })
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!radarToken || !safeEqual(token, radarToken)) return json(res, 401, { error: 'Radar token missing or invalid.' })
    try {
      const result = store.ingest(await readBody(req, 8_000_000), 'api')
      if (result.ok && result.created) notifyTeam(`${cfg.siteName}: Radar report received, ${result.created} new and ${result.updated} updated discoveries${result.autoApproved ? '' : ' waiting for review'}.`)
      return json(res, result.status, result.ok ? { received: true, ...result } : { error: result.message })
    } catch (error) { return json(res, error.status || 400, { error: error.message }) }
  }

  /* --- Public pages --- */
  if (method === 'GET' && path === '/') {
    const { shops, products, counts } = shopIndex()
    const featured = [...products.filter(p => p.featured), ...products.filter(p => !p.featured)].slice(0, 8)
    const topShops = [...shops.filter(s => s.featured), ...shops.filter(s => !s.featured)].slice(0, 4)
    return html(res, 200, views.home({ featured, shops: topShops, counts: { products: products.length, shops: shops.length }, lastReport: store.lastGoodReport(), shopProductCounts: counts }))
  }
  if (method === 'GET' && (path === '/products' || path === '/shops')) {
    const kind = path === '/products' ? 'product' : 'shop'
    const { shops, products, counts } = shopIndex()
    const all = kind === 'product' ? products : shops
    const params = { q: safeText(url.searchParams.get('q') || '', 100), category: safeText(url.searchParams.get('category') || '', 100),
      when: ['new', '30d', 'older'].includes(url.searchParams.get('when')) ? url.searchParams.get('when') : '', sort: safeText(url.searchParams.get('sort') || '', 80) }
    const filtered = filterItems(all, params)
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), page = Math.min(pages, Math.max(1, Number(url.searchParams.get('page')) || 1))
    return html(res, 200, views.listing({ kind, items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), params, total: filtered.length, page, pages,
      categories: [...new Set(all.map(i => i.category).filter(Boolean))].sort(), metricKeys: numericMetricKeys(all), shopProductCounts: counts }))
  }
  const detailMatch = method === 'GET' && path.match(/^\/(products|shops)\/([^/]+)$/)
  if (detailMatch) {
    const kind = detailMatch[1] === 'products' ? 'product' : 'shop'
    const item = store.publicOne(decodeURIComponent(detailMatch[2]))
    if (!item || item.kind !== kind) return html(res, 404, views.notFound())
    const { products, shopFor } = shopIndex()
    if (kind === 'product') {
      const shop = shopFor(item)
      const sameShop = shop ? products.filter(p => p.id !== item.id && shopFor(p)?.id === shop.id) : []
      const related = (sameShop.length ? sameShop : products.filter(p => p.id !== item.id && item.category && p.category === item.category)).slice(0, 4)
      return html(res, 200, views.detail({ item, history: store.snapshots(item.id), shop, related, relatedTitle: sameShop.length ? 'More from <span class="it">this shop</span>' : 'More in <span class="it">this category</span>' }))
    }
    return html(res, 200, views.detail({ item, history: store.snapshots(item.id), shop: null, related: products.filter(p => shopFor(p)?.id === item.id).slice(0, 8), relatedTitle: 'Trending products <span class="it">from this shop</span>' }))
  }
  if (method === 'GET' && path === '/request') return html(res, 200, views.requestPage({ contact }))
  if (method === 'POST' && path === '/request') {
    const ip = clientIp(req)
    if (!sameOrigin(req)) return html(res, 403, views.notFound())
    if (limited('req:' + ip, 5, 3_600_000)) return html(res, 429, views.layout({ title: 'Please wait', description: '', path: '', noindex: true, body: '<section class="thanks"><div class="wrap narrow"><h1>Too many requests</h1><p class="lead">Please try again in an hour, or contact us directly.</p></div></section>' }))
    try {
      const body = await readBody(req, 100_000)
      const wantsJson = String(req.headers.accept || '').includes('application/json')
      const fail = message => wantsJson ? json(res, 400, { error: message }) : html(res, 400, views.layout({ title: 'Check your request', description: '', path: '', noindex: true, body: `<section class="thanks"><div class="wrap narrow"><h1>Please check your request</h1><p class="lead">${message}</p><div class="ctas"><a class="btn" href="/request">Back to the form</a></div></div></section>` }))
      if (body.website) return redirect(res, '/request/thanks') // honeypot: quietly drop bots
      const name = safeText(body.name, 120), contactDetail = safeText(body.contact, 240), method_ = safeText(body.contactMethod, 24), goal = safeText(body.goal, 3000)
      if (name.length < 2) return fail('Please enter your name.')
      if (!CONTACT_METHODS.includes(method_)) return fail('Please choose how we should contact you.')
      if (method_ === 'Email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactDetail) : contactDetail.replace(/\D/g, '').length < 7) return fail(method_ === 'Email' ? 'Please enter a valid email address.' : 'Please enter a valid phone number, including the country code.')
      if (body.consent !== 'yes' && body.consent !== true) return fail('Please agree to be contacted about your request.')
      let picked = []
      try { picked = typeof body.selected === 'string' ? JSON.parse(body.selected) : Array.isArray(body.selected) ? body.selected : [] } catch { picked = [] }
      // Keep only items that really are published, and store their current titles/links (never trust the browser's copy).
      const selected = [...new Set(picked.slice(0, 50).map(s => safeText(s?.id ?? s, 100)))].map(id => store.publicOne(id)).filter(Boolean)
        .map(i => ({ id: i.id, kind: i.kind, title: i.title, url: i.kind === 'product' ? i.listingUrl : i.shopUrl }))
      const { ref } = requests.create({ name, contact: contactDetail, contactMethod: method_, goal, selected })
      emailTeam(requestEmail({ ref, name, contact: contactDetail, contactMethod: method_, goal, selected })) // not awaited: the visitor shouldn't wait on SMTP
      notifyTeam(`${cfg.siteName}: new workflow request ${ref} from ${name} (${method_}), ${selected.length} selection(s).`)
      return wantsJson ? json(res, 201, { ref, redirect: `/request/thanks?ref=${ref}` }) : redirect(res, `/request/thanks?ref=${ref}`)
    } catch (error) { return json(res, error.status || 400, { error: error.message }) }
  }
  if (method === 'GET' && path === '/request/thanks') {
    const request = requests.byRef(safeText(url.searchParams.get('ref') || '', 20))
    if (!request || Date.now() - new Date(request.createdAt).getTime() > 7 * 864e5) return redirect(res, '/')
    return html(res, 200, views.thanksPage({ request, contact }))
  }
  if (method === 'GET' && path === '/privacy') return html(res, 200, views.privacyPage({ contact }))
  if (method === 'GET' && path === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /request/thanks\n${cfg.siteUrl ? `Sitemap: ${cfg.siteUrl}/sitemap.xml\n` : ''}`, 'text/plain; charset=utf-8')
  if (method === 'GET' && path === '/sitemap.xml') {
    const base = cfg.siteUrl || `http://${req.headers.host}`
    const { shops, products } = shopIndex()
    const urls = ['/', '/products', '/shops', '/request', ...products.map(p => `/products/${encodeURIComponent(p.id)}`), ...shops.map(s => `/shops/${encodeURIComponent(s.id)}`)]
    const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${xmlEsc(base + u)}</loc></url>`).join('')}</urlset>`, 'application/xml; charset=utf-8')
  }

  /* --- Admin --- */
  if (method === 'GET' && path === '/admin') return html(res, 200, views.adminShell(), { 'x-robots-tag': 'noindex, nofollow' })
  if (method === 'POST' && path === '/api/admin/login') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked.' })
    if (limited('login:' + clientIp(req), 8, 900_000)) return json(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' })
    if (!adminPassword) return json(res, 503, { error: 'ADMIN_PASSWORD is not set on the server. Add it to .env and restart.' })
    const body = await readBody(req, 10_000).catch(() => ({}))
    if (!safeEqual(body.password || '', adminPassword)) return json(res, 401, { error: 'Incorrect password.' })
    const token = randomBytes(32).toString('base64url'), ttl = 8 * 3600
    sessions.set(sha(token), { expiresAt: Date.now() + ttl * 1000 })
    return json(res, 200, { ok: true }, { 'set-cookie': `foundry_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}${isProduction ? '; Secure' : ''}` })
  }
  if (path.startsWith('/api/admin/')) {
    if (!adminSession(req)) return json(res, 401, { error: 'Please sign in.' })
    if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked.' })
    try {
      if (method === 'POST' && path === '/api/admin/logout') {
        const t = cookie(req, 'foundry_admin'); if (t) sessions.delete(sha(decodeURIComponent(t)))
        return json(res, 200, { ok: true }, { 'set-cookie': 'foundry_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })
      }
      if (method === 'GET' && path === '/api/admin/overview') {
        const last = store.lastGoodReport()
        const ageHours = last ? (Date.now() - new Date(last.received_at).getTime()) / 36e5 : null
        return json(res, 200, { counts: store.counts(), reports: store.reports().slice(0, 10), lastReportAt: last?.received_at || null, staleHours: cfg.staleHours,
          radarStale: ageHours === null || ageHours > cfg.staleHours, autoApprove: env.AUTO_APPROVE === 'true', tokenConfigured: Boolean(radarToken), siteUrl: cfg.siteUrl,
          email: { ready: mailReady(mail), to: mail.to, host: mail.host, lastError: lastMailError } })
      }
      if (method === 'POST' && path === '/api/admin/test-email') {
        if (!mailReady(mail)) return json(res, 400, { error: 'Email is not configured. Set NOTIFY_EMAIL, SMTP_HOST, SMTP_USER and SMTP_PASS in .env, then restart.' })
        try {
          await sendMail(mail, { to: mail.to, subject: `${cfg.siteName}: test email`, text: `This is a test from your ${cfg.siteName} admin.\n\nIf you can read this, new workflow requests will be emailed to ${mail.to}.` })
          lastMailError = ''
          return json(res, 200, { sent: true, to: mail.to })
        } catch (error) { lastMailError = `${new Date().toISOString()}: ${error.message}`; return json(res, 502, { error: error.message }) }
      }
      if (method === 'GET' && path === '/api/admin/discoveries') return json(res, 200, { discoveries: store.adminAll() })
      if (method === 'GET' && path === '/api/admin/reports') return json(res, 200, { reports: store.reports() })
      if (method === 'POST' && path === '/api/admin/reports') {
        const result = store.ingest(await readBody(req, 8_000_000), 'upload')
        return json(res, result.status, result.ok ? result : { error: result.message })
      }
      if (method === 'POST' && path === '/api/admin/discoveries/approve-all') return json(res, 200, { changed: store.approveAll() })
      if (method === 'POST' && path === '/api/admin/discoveries/unpublish-stale') {
        const body = await readBody(req, 10_000)
        const days = Math.max(7, Math.min(3650, Number(body.days) || 90))
        return json(res, 200, { changed: store.unpublishStale(days), days })
      }
      const dm = path.match(/^\/api\/admin\/discoveries\/([^/]+)$/)
      if (dm && method === 'PATCH') { const d = store.update(decodeURIComponent(dm[1]), await readBody(req, 20_000)); return d ? json(res, 200, { discovery: d }) : json(res, 404, { error: 'Not found.' }) }
      if (dm && method === 'DELETE') return store.remove(decodeURIComponent(dm[1])) ? json(res, 200, { deleted: true }) : json(res, 404, { error: 'Not found.' })
      if (method === 'GET' && path === '/api/admin/requests') return json(res, 200, { requests: requests.all(), statuses: REQUEST_STATUSES })
      const rm = path.match(/^\/api\/admin\/requests\/([^/]+)$/)
      if (rm && method === 'PATCH') { const r = requests.update(decodeURIComponent(rm[1]), await readBody(req, 20_000)); return r ? json(res, 200, { request: r }) : json(res, 404, { error: 'Not found.' }) }
      return json(res, 404, { error: 'Unknown admin endpoint.' })
    } catch (error) { return json(res, error.status || 400, { error: error.message }) }
  }

  if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found.' })
  return html(res, 404, views.notFound())
}

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(error)
    if (!res.headersSent) html(res, 500, views.layout({ title: 'Something went wrong', description: '', path: '', noindex: true, body: '<section class="thanks"><div class="wrap narrow"><h1>Something went wrong</h1><p class="lead">Please try again in a moment.</p></div></section>' }))
  })
})
const port = Number(env.PORT || 4174), host = env.HOST || '127.0.0.1'
server.listen(port, host, () => console.log(`${cfg.siteName} running on http://${host}:${port}  (admin: /admin)`))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { db.close(); process.exit(0) }))
