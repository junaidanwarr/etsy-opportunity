// The whole site as one request handler: used by server.mjs locally and api/index.mjs on Vercel.
import { timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { CONTACT_METHODS, REQUEST_STATUSES, ensureSchema, makeRequests, makeState, makeStore, openDatabase, safeText, sha } from './db.mjs'
import { makeViews } from './views.mjs'
import { mailConfigFromEnv, mailReady, sendMail } from './mail.mjs'

export function createApp(root, env = process.env) {
  const isProduction = env.NODE_ENV === 'production'
  const cfg = {
    workflowVideos: [env.WORKFLOW_VIDEO_1_URL || '', env.WORKFLOW_VIDEO_2_URL || ''],
    siteName: env.SITE_NAME || 'Etsscope',
    siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
    newDays: Math.max(1, Number(env.NEW_DAYS) || 7),
    replyDays: env.REPLY_TIME || '2 working days',
    staleHours: Math.max(1, Number(env.STALE_AFTER_HOURS) || 36),
    assetVersion: (env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 10),
  }
  const contact = { email: env.CONTACT_EMAIL || '', whatsapp: env.CONTACT_WHATSAPP || '' }
  const adminPassword = env.ADMIN_PASSWORD || ''
  const radarToken = env.RADAR_INGEST_TOKEN || ''
  const describe = (name, value, min) => !value ? `${name} is not set` : value.length < min ? `${name} is ${value.length} characters (needs ${min}+)` : ''
  const configProblem = isProduction
    ? [describe('ADMIN_PASSWORD', adminPassword, 12), describe('RADAR_INGEST_TOKEN', radarToken, 24)].filter(Boolean).join('; ') : ''
  if (configProblem) console.error('Configuration error:', configProblem)

  const db = openDatabase(root, env)
  const store = makeStore(db, { autoApprove: env.AUTO_APPROVE === 'true' })
  const requests = makeRequests(db)
  const state = makeState(db)
  const views = makeViews(cfg)
  const publicDir = resolve(root, 'public')
  const mail = mailConfigFromEnv(env)
  const trustProxy = env.TRUST_PROXY === 'true' || Boolean(env.VERCEL)

  /* ---------- HTTP helpers ---------- */
  const safeEqual = (a, b) => timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b)))) && String(a).length === String(b).length
  const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown'
  const SECURITY = {
    'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(isProduction ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  }
  const HTML_CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; media-src 'self' https:; frame-src https://www.youtube-nocookie.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"
  const send = (res, status, body, type, extra = {}) => { res.writeHead(status, { 'content-type': type, ...SECURITY, ...extra }); res.end(body) }
  const html = (res, status, body, extra = {}) => send(res, status, body, 'text/html; charset=utf-8', { 'content-security-policy': HTML_CSP, 'cache-control': 'no-cache', ...extra })
  const json = (res, status, body, extra = {}) => send(res, status, JSON.stringify(body), 'application/json; charset=utf-8', { 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'", ...extra })
  const redirect = (res, location) => send(res, 303, '', 'text/plain', { location })
  const messagePage = (title, text, link = '') => views.layout({ title, description: '', path: '', noindex: true, body: `<section class="thanks"><div class="wrap narrow"><h1>${title}</h1><p class="lead">${text}</p>${link}</div></section>` })

  function readBody(req, maxBytes = 1_000_000) {
    const parse = (raw, type) => type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw || '{}')
    const type = String(req.headers['content-type'] || '')
    return new Promise((ok, fail) => {
      let size = 0; const chunks = []
      req.on('data', c => { size += c.length; if (size > maxBytes) { fail(Object.assign(new Error('Request body is too large.'), { status: 413 })); req.destroy(); return } chunks.push(c) })
      req.on('end', () => { try { ok(parse(Buffer.concat(chunks).toString('utf8'), type)) } catch { fail(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })) } })
      req.on('error', fail)
    })
  }
  const cookie = (req, name) => { const v = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1); return v ? decodeURIComponent(v) : '' }
  const sameOrigin = req => { const o = req.headers.origin; return !o || o === `${isProduction ? 'https' : 'http'}://${req.headers.host}` || (cfg.siteUrl && o === cfg.siteUrl) }

  /* ---------- Team notifications ---------- */
  function requestEmail(r) {
    const adminUrl = `${cfg.siteUrl || 'http://127.0.0.1:4174'}/admin`
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
    try { await sendMail(mail, message); await state.setMeta('last_mail_error', ''); return true }
    catch (error) { console.error('Team email failed:', error.message); await state.setMeta('last_mail_error', `${new Date().toISOString()}: ${error.message}`).catch(() => {}); return false }
  }
  async function notifyWebhook(text) {
    if (!env.NOTIFY_WEBHOOK_URL) return
    try { await fetch(env.NOTIFY_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) }) }
    catch (error) { console.error('Webhook notification failed:', error.message) }
  }

  /* ---------- Public data helpers ---------- */
  async function shopIndex() {
    const everything = await store.publicAll()
    const shops = everything.filter(i => i.kind === 'shop'), products = everything.filter(i => i.kind === 'product')
    const norm = u => u.replace(/\/$/, '').toLowerCase()
    const byUrl = new Map(shops.filter(s => s.shopUrl).map(s => [norm(s.shopUrl), s]))
    const byName = new Map(shops.map(s => [(s.shopName || s.title).toLowerCase(), s]))
    const shopFor = p => (p.shopUrl && byUrl.get(norm(p.shopUrl))) || (p.shopName && byName.get(p.shopName.toLowerCase())) || null
    const counts = {}
    for (const p of products) { const s = shopFor(p); if (s) counts[s.id] = (counts[s.id] || 0) + 1 }
    const weekly = await state.getMeta('weekly_keywords')
    const terms = new Map()
    for (const item of everything) for (const term of item.keywords || []) {
      const title = term.trim(), key = title.toLowerCase()
      if (!key) continue
      if (!terms.has(key)) terms.set(key, { title, items: [] })
      terms.get(key).items.push(item)
    }
    const supplied = weekly ? JSON.parse(weekly) : null
    const keywords = (supplied ? supplied.keywords.map(title => ({ title, items: terms.get(title.toLowerCase())?.items || [] })) : [...terms.values()]).map(({ title, items }) => {
      const sources = shops.filter(s => items.some(i => i.id === s.id || shopFor(i)?.id === s.id))
      const date = supplied?.updatedAt || items.map(i => i.lastSeenAt).sort().at(-1) || new Date().toISOString()
      return { id: 'kw-' + sha(title.toLowerCase()).slice(0, 24), kind: 'product', title, category: 'Keyword research', image: '', keywords: [title], shopName: '', shopUrl: '', listingUrl: 'https://www.etsy.com/search?q=' + encodeURIComponent(title), metrics: { shopsInResearch: sources.length }, discoveredAt: date, lastSeenAt: date, featured: false, note: 'Keyword from our research. Shop counts reflect published research, not search volume or a guarantee of demand.', sourceShopIds: sources.map(s => s.id) }
    }).sort((a,b) => b.metrics.shopsInResearch - a.metrics.shopsInResearch || a.title.localeCompare(b.title))
    const keywordCounts = Object.fromEntries(shops.map(s => [s.id, keywords.filter(k => k.sourceShopIds.includes(s.id)).length]))
    return { shops, products: keywords, shopFor: p => shops.find(s => p.sourceShopIds?.includes(s.id)) || null, counts: keywordCounts }
  }
  function filterItems(items, params) {
    const q = params.q.toLowerCase(), now = Date.now(), DAY = 864e5
    const out = items.filter(i => {
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
  async function radarStatus() {
    const last = await store.lastGoodReport()
    const ageHours = last ? (Date.now() - new Date(last.received_at).getTime()) / 36e5 : null
    return { last, lastReportAt: last?.received_at || null, radarStale: ageHours === null || ageHours > cfg.staleHours }
  }

  /* ---------- Static files (Vercel serves public/ from its CDN; this is for local runs) ---------- */
  const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' }
  async function serveStatic(res, path) {
    const file = normalize(join(publicDir, path))
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
    let path = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method || 'GET'
    if (method === 'GET' && /^\/products(?:\/|$)/.test(path)) return redirect(res, path.replace('/products', '/keywords') + url.search)

    if (method === 'GET' && path.startsWith('/static/') && await serveStatic(res, path)) return
    if (configProblem) return json(res, 503, { error: 'Site is misconfigured. Check the server logs.' })
    await ensureSchema(db)

    if (method === 'GET' && path === '/api/health') { const s = await radarStatus(); return json(res, 200, { status: 'ok', lastReportAt: s.lastReportAt, radarStale: s.radarStale }) }

    /* --- Radar ingest (machine-to-machine) --- */
    if (method === 'POST' && path === '/api/radar/reports') {
      if (await state.limited('radar:' + clientIp(req), 60, 3_600_000)) return json(res, 429, { error: 'Too many reports from this address.' })
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!radarToken || !safeEqual(token, radarToken)) return json(res, 401, { error: 'Radar token missing or invalid.' })
      try {
        const result = await store.ingest(await readBody(req, 8_000_000), 'api')
        if (result.ok && result.created) await notifyWebhook(`${cfg.siteName}: Radar report received, ${result.created} new and ${result.updated} updated discoveries${result.autoApproved ? '' : ' waiting for review'}.`)
        return json(res, result.status, result.ok ? { received: true, ...result } : { error: result.message })
      } catch (error) { return json(res, error.status || 400, { error: error.message }) }
    }

    /* --- Public pages --- */
    if (method === 'GET' && path === '/') {
      const { shops, products, counts } = await shopIndex()
      const featured = [...products.filter(p => p.featured), ...products.filter(p => !p.featured)].slice(0, 8)
      const topShops = [...shops.filter(s => s.featured), ...shops.filter(s => !s.featured)].slice(0, 4)
      return html(res, 200, views.home({ featured, radarKeywords: products, shops: topShops, counts: { products: products.length, shops: shops.length }, lastReport: (await radarStatus()).last, shopKeywordCounts: counts }))
    }
    if (method === 'GET' && (path === '/keywords' || path === '/shops')) {
      const kind = path === '/keywords' ? 'product' : 'shop'
      const { shops, products, counts } = await shopIndex()
      const all = kind === 'product' ? products : shops
      const params = { q: safeText(url.searchParams.get('q') || '', 100), category: safeText(url.searchParams.get('category') || '', 100),
        when: ['new', '30d', 'older'].includes(url.searchParams.get('when')) ? url.searchParams.get('when') : '', sort: safeText(url.searchParams.get('sort') || '', 80) }
      const filtered = filterItems(all, params)
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), page = Math.min(pages, Math.max(1, Number(url.searchParams.get('page')) || 1))
      return html(res, 200, views.listing({ kind, items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), params, total: filtered.length, page, pages,
        categories: [...new Set(all.map(i => i.category).filter(Boolean))].sort(), metricKeys: numericMetricKeys(all), shopKeywordCounts: counts }))
    }
    const detailMatch = method === 'GET' && path.match(/^\/(keywords|shops)\/([^/]+)$/)
    if (detailMatch) {
      const kind = detailMatch[1] === 'keywords' ? 'product' : 'shop'
      const item = kind === 'product' ? (await shopIndex()).products.find(i => i.id === decodeURIComponent(detailMatch[2])) : await store.publicOne(decodeURIComponent(detailMatch[2]))
      if (!item || item.kind !== kind) return html(res, 404, views.notFound())
      const [{ products, shopFor }, history] = await Promise.all([shopIndex(), store.snapshots(item.id)])
      if (kind === 'product') {
        const shop = shopFor(item)
        const sameShop = shop ? products.filter(p => p.id !== item.id && shopFor(p)?.id === shop.id) : []
        const related = (sameShop.length ? sameShop : products.filter(p => p.id !== item.id && item.category && p.category === item.category)).slice(0, 4)
        return html(res, 200, views.detail({ item, history, shop, related, relatedTitle: sameShop.length ? 'More from <span class="it">this shop</span>' : 'More in <span class="it">this category</span>' }))
      }
      return html(res, 200, views.detail({ item, history, shop: null, related: products.filter(p => p.sourceShopIds?.includes(item.id)).slice(0, 8), relatedTitle: 'Research keywords <span class="it">from this shop</span>' }))
    }
    if (method === 'GET' && path === '/request') return html(res, 200, views.requestPage({ contact }))
    if (method === 'POST' && path === '/request') {
      if (!sameOrigin(req)) return html(res, 403, views.notFound())
      if (await state.limited('req:' + clientIp(req), 5, 3_600_000)) return html(res, 429, messagePage('Too many requests', 'Please try again in an hour, or contact us directly.'))
      try {
        const body = await readBody(req, 100_000)
        const wantsJson = String(req.headers.accept || '').includes('application/json')
        const fail = message => wantsJson ? json(res, 400, { error: message }) : html(res, 400, messagePage('Please check your request', message, '<div class="ctas"><a class="btn" href="/request">Back to the form</a></div>'))
        if (body.website) return redirect(res, '/request/thanks') // honeypot: quietly drop bots
        const name = safeText(body.name, 120), contactDetail = safeText(body.contact, 240), method_ = safeText(body.contactMethod, 24), goal = safeText(body.goal, 3000)
        if (name.length < 2) return fail('Please enter your name.')
        if (!CONTACT_METHODS.includes(method_)) return fail('Please choose how we should contact you.')
        if (method_ === 'Email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactDetail) : contactDetail.replace(/\D/g, '').length < 7) return fail(method_ === 'Email' ? 'Please enter a valid email address.' : 'Please enter a valid phone number, including the country code.')
        if (body.consent !== 'yes' && body.consent !== true) return fail('Please agree to be contacted about your request.')
        let picked = []
        try { picked = typeof body.selected === 'string' ? JSON.parse(body.selected) : Array.isArray(body.selected) ? body.selected : [] } catch { picked = [] }
        // Keep only items that really are published, and store their current titles/links (never trust the browser's copy).
        const ids = [...new Set(picked.slice(0, 50).map(s => safeText(s?.id ?? s, 100)))]
        const keywordItems = (await shopIndex()).products
        const selected = (await Promise.all(ids.map(id => id.startsWith('kw-') ? keywordItems.find(i => i.id === id) : store.publicOne(id)))).filter(Boolean)
          .map(i => ({ id: i.id, kind: i.kind, title: i.title, url: i.kind === 'product' ? i.listingUrl : i.shopUrl }))
        const { ref } = await requests.create({ name, contact: contactDetail, contactMethod: method_, goal, selected })
        // Awaited on purpose: serverless hosts may stop the function as soon as the response is sent.
        await Promise.all([emailTeam(requestEmail({ ref, name, contact: contactDetail, contactMethod: method_, goal, selected })),
          notifyWebhook(`${cfg.siteName}: new workflow request ${ref} from ${name} (${method_}), ${selected.length} selection(s).`)])
        return wantsJson ? json(res, 201, { ref, redirect: `/request/thanks?ref=${ref}` }) : redirect(res, `/request/thanks?ref=${ref}`)
      } catch (error) { return json(res, error.status || 400, { error: error.message }) }
    }
    if (method === 'GET' && path === '/request/thanks') {
      const request = await requests.byRef(safeText(url.searchParams.get('ref') || '', 20))
      if (!request || Date.now() - new Date(request.createdAt).getTime() > 7 * 864e5) return redirect(res, '/')
      return html(res, 200, views.thanksPage({ request, contact }))
    }
    if (method === 'GET' && path === '/privacy') return html(res, 200, views.privacyPage({ contact }))
    if (method === 'GET' && path === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /request/thanks\n${cfg.siteUrl ? `Sitemap: ${cfg.siteUrl}/sitemap.xml\n` : ''}`, 'text/plain; charset=utf-8')
    if (method === 'GET' && path === '/sitemap.xml') {
      const base = cfg.siteUrl || `http://${req.headers.host}`
      const { shops, products } = await shopIndex()
      const urls = ['/', '/keywords', '/shops', '/request', ...products.map(p => `/keywords/${encodeURIComponent(p.id)}`), ...shops.map(s => `/shops/${encodeURIComponent(s.id)}`)]
      const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${xmlEsc(base + u)}</loc></url>`).join('')}</urlset>`, 'application/xml; charset=utf-8')
    }

    /* --- Admin --- */
    if (method === 'GET' && path === '/admin') return html(res, 200, views.adminShell(), { 'x-robots-tag': 'noindex, nofollow' })
    if (method === 'POST' && path === '/api/admin/login') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked.' })
      if (await state.limited('login:' + clientIp(req), 8, 900_000)) return json(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' })
      if (!adminPassword) return json(res, 503, { error: 'ADMIN_PASSWORD is not set on the server. Add it and redeploy/restart.' })
      const body = await readBody(req, 10_000).catch(() => ({}))
      if (!safeEqual(body.password || '', adminPassword)) return json(res, 401, { error: 'Incorrect password.' })
      const ttl = 8 * 3600, token = await state.createSession(ttl * 1000)
      return json(res, 200, { ok: true }, { 'set-cookie': `etsscope_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}${isProduction ? '; Secure' : ''}` })
    }
    if (path.startsWith('/api/admin/')) {
      const token = cookie(req, 'etsscope_admin')
      if (!(await state.validSession(token))) return json(res, 401, { error: 'Please sign in.' })
      if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked.' })
      try {
        if (method === 'POST' && path === '/api/admin/logout') { await state.dropSession(token); return json(res, 200, { ok: true }, { 'set-cookie': 'etsscope_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }) }
        if (method === 'GET' && path === '/api/admin/overview') {
          const [counts, reports, s, lastError] = await Promise.all([store.counts(), store.reports(), radarStatus(), state.getMeta('last_mail_error')])
          return json(res, 200, { counts, reports: reports.slice(0, 10), lastReportAt: s.lastReportAt, staleHours: cfg.staleHours, radarStale: s.radarStale,
            autoApprove: env.AUTO_APPROVE === 'true', tokenConfigured: Boolean(radarToken), siteUrl: cfg.siteUrl,
            email: { ready: mailReady(mail), to: mail.to, host: mail.host, lastError } })
        }
        if (method === 'POST' && path === '/api/admin/test-email') {
          if (!mailReady(mail)) return json(res, 400, { error: 'Email is not configured. Set NOTIFY_EMAIL, SMTP_HOST, SMTP_USER and SMTP_PASS, then restart/redeploy.' })
          try {
            await sendMail(mail, { to: mail.to, subject: `${cfg.siteName}: test email`, text: `This is a test from your ${cfg.siteName} admin.\n\nIf you can read this, new workflow requests will be emailed to ${mail.to}.` })
            await state.setMeta('last_mail_error', '')
            return json(res, 200, { sent: true, to: mail.to })
          } catch (error) { await state.setMeta('last_mail_error', `${new Date().toISOString()}: ${error.message}`); return json(res, 502, { error: error.message }) }
        }
        if (method === 'GET' && path === '/api/admin/discoveries') return json(res, 200, { discoveries: await store.adminAll() })
        if (method === 'GET' && path === '/api/admin/reports') return json(res, 200, { reports: await store.reports() })
        if (method === 'POST' && path === '/api/admin/reports') { const result = await store.ingest(await readBody(req, 8_000_000), 'upload'); return json(res, result.status, result.ok ? result : { error: result.message }) }
        if (method === 'POST' && path === '/api/admin/discoveries/approve-all') return json(res, 200, { changed: await store.approveAll() })
        if (method === 'POST' && path === '/api/admin/discoveries/unpublish-stale') {
          const body = await readBody(req, 10_000)
          const days = Math.max(7, Math.min(3650, Number(body.days) || 90))
          return json(res, 200, { changed: await store.unpublishStale(days), days })
        }
        const dm = path.match(/^\/api\/admin\/discoveries\/([^/]+)$/)
        if (dm && method === 'PATCH') { const d = await store.update(decodeURIComponent(dm[1]), await readBody(req, 20_000)); return d ? json(res, 200, { discovery: d }) : json(res, 404, { error: 'Not found.' }) }
        if (dm && method === 'DELETE') return (await store.remove(decodeURIComponent(dm[1]))) ? json(res, 200, { deleted: true }) : json(res, 404, { error: 'Not found.' })
        if (method === 'GET' && path === '/api/admin/requests') return json(res, 200, { requests: await requests.all(), statuses: REQUEST_STATUSES })
        const rm = path.match(/^\/api\/admin\/requests\/([^/]+)$/)
        if (rm && method === 'PATCH') { const r = await requests.update(decodeURIComponent(rm[1]), await readBody(req, 20_000)); return r ? json(res, 200, { request: r }) : json(res, 404, { error: 'Not found.' }) }
        return json(res, 404, { error: 'Unknown admin endpoint.' })
      } catch (error) { return json(res, error.status || 400, { error: error.message }) }
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found.' })
    return html(res, 404, views.notFound())
  }

  return {
    cfg, db,
    handler: (req, res) => handle(req, res).catch(error => {
      console.error(error)
      if (!res.headersSent) html(res, 500, messagePage('Something went wrong', 'Please try again in a moment.'))
    }),
  }
}
