// Pulls the Etsy Radar's weekly data.json from GitHub and publishes it: shops go through the normal Radar ingest,
// keywords replace the weekly keyword list, and the new batch becomes the featured set.
// Only fields that exist in data.json are mapped; nothing is estimated or filled in here.
import { etsyUrl, safeText, sha } from './db.mjs'

export const DEFAULT_RADAR_DATA_URL = 'https://raw.githubusercontent.com/Moshsin1991/etsy-radar-data/main/data.json'
const MAX_BYTES = 8_000_000

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''))
// data.json dates are Pakistan dates (UTC+5); pin them to local midnight so they don't shift a day.
const pktDate = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d}T00:00:00+05:00` : '')

/** Turn one data.json document into an ingest report plus the weekly keyword list. Throws on a malformed file. */
export function mapRadarData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.shops) || !Array.isArray(data.keywords)) {
    throw new Error('data.json must contain "shops" and "keywords" arrays.')
  }
  const meta = data.metadata || {}
  const dataDate = pktDate(meta.data_date) || new Date().toISOString()

  const shops = data.shops.map(s => {
    const title = safeText(s?.shop_name, 240)
    const url = etsyUrl(s?.url)
    return {
      id: `shop-${sha(`${title.toLowerCase()}|${url}`).slice(0, 24)}`,
      title, url,
      keywords: String(s?.linked_keywords || '').split('|').map(k => k.trim()).filter(Boolean),
      discoveredAt: dataDate,
      metrics: defined({
        'Est. monthly revenue (USD)': num(s?.est_monthly_revenue_usd),
        'Est. monthly sales': num(s?.est_monthly_sales),
        'Avg. price (USD)': num(s?.avg_price_usd),
        'Reviews (90 days)': num(s?.reviews_90d),
        'Lifetime sales': num(s?.lifetime_sales),
        'Rating': num(s?.rating),
        'Active listings': num(s?.active_listings),
        'Digital listings (%)': num(s?.digital_share) !== undefined ? Math.round(s.digital_share * 100) : undefined,
        'Shop age (months)': num(s?.age_months),
        'Opened': safeText(s?.open_date, 20),
        'Rank': num(s?.rank),
      }),
    }
  }).filter(s => s.title)

  const ranked = [...data.keywords].filter(k => k && safeText(k.keyword, 100)).sort((a, b) => (num(a.rank) ?? 1e9) - (num(b.rank) ?? 1e9))
  const keywords = [...new Set(ranked.map(k => safeText(k.keyword, 100)))]
  const details = {}
  for (const k of ranked) {
    const key = safeText(k.keyword, 100).toLowerCase()
    if (details[key]) continue
    details[key] = defined({
      'Shops using this tag': num(k.shops),
      'Students who found it': num(k.students),
      'Reviews on tagged listings (90 days)': num(k.reviews90_on_tagged_listings),
      'Etsy search results': num(k.competition_supply_results),
      'Tail': safeText(k.tail, 40),
      'Rank': num(k.rank),
    })
  }
  return {
    report: { generatedAt: dataDate, products: [], shops },
    weekly: {
      keywords, details, updatedAt: dataDate, source: 'github',
      note: 'Listing-linked keyword candidate from the Etsy Radar: an exact Etsy tag on listings that received reviews in the research window. It is not a proven sales driver, and search volume was not measured.',
    },
    dataset: safeText(meta.dataset, 160), dataDate: safeText(meta.data_date, 20),
  }
}

/**
 * Fetch data.json and import it when it changed since the last sync (or always, with force).
 * publish=false leaves new shops unpublished for review; keywords are always replaced.
 */
export async function syncRadarFromGitHub({ db, store, state, url = DEFAULT_RADAR_DATA_URL, token = '', force = false, publish = true, fetchImpl = fetch }) {
  const checkedAt = new Date().toISOString()
  const previous = JSON.parse((await state.getMeta('radar_sync')) || '{}')
  const remember = async extra => { const record = { ...previous, checkedAt, ...extra }; await state.setMeta('radar_sync', JSON.stringify(record)); return record }
  try {
    // A private repo needs a read-only token; raw.githubusercontent.com accepts it as a bearer token.
    const res = await fetchImpl(url, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15_000) })
    if (res.status === 404) throw new Error(token ? 'GitHub returned 404: check the file path and that RADAR_GITHUB_TOKEN can read this repo.' : 'GitHub returned 404: the repo is private, so set RADAR_GITHUB_TOKEN (read-only) or make the repo public.')
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${url}`)
    const text = await res.text()
    if (text.length > MAX_BYTES) throw new Error('data.json is larger than 8 MB.')
    const hash = sha(text)
    if (!force && hash === previous.hash) return { changed: false, ...(await remember({ lastError: '' })) }

    let data
    try { data = JSON.parse(text) } catch { throw new Error('data.json is not valid JSON.') }
    const { report, weekly, dataset, dataDate } = mapRadarData(data)
    // Reuse the id of a shop already on the site (matched by Etsy URL, then name) so a weekly import updates it instead of duplicating it.
    const norm = u => String(u || '').toLowerCase().split('?')[0].replace(/\/+$/, '')
    const existing = (await db.execute("SELECT id, title, shop_url FROM discoveries WHERE kind = 'shop'")).rows
    const byUrl = new Map(existing.filter(r => r.shop_url).map(r => [norm(r.shop_url), r.id]))
    const byName = new Map(existing.map(r => [String(r.title).toLowerCase(), r.id]))
    for (const s of report.shops) s.id = (s.url && byUrl.get(norm(s.url))) || byName.get(s.title.toLowerCase()) || s.id
    const result = await store.ingest(report, 'github')
    if (!result.ok) throw new Error(result.message)

    const ids = report.shops.map(s => s.id)
    const now = new Date().toISOString(), marks = ids.map(() => '?').join(',')
    const stmts = [
      // The newest batch becomes the featured set; older shops stay published but are no longer featured.
      { sql: `UPDATE discoveries SET featured = 0, updated_at = ? WHERE kind = 'shop' AND featured = 1 AND id NOT IN (${marks || "''"})`, args: [now, ...ids] },
    ]
    if (ids.length) stmts.push({ sql: `UPDATE discoveries SET featured = 1${publish ? ', approved = 1' : ''}, updated_at = ? WHERE id IN (${marks})`, args: [now, ...ids] })
    await db.batch(stmts, 'write')
    await state.setMeta('weekly_keywords', JSON.stringify(weekly))

    return { changed: true, ...(await remember({
      hash, importedAt: checkedAt, dataset, dataDate, lastError: '',
      shops: ids.length, keywords: weekly.keywords.length, created: result.created, updated: result.updated, skipped: result.skipped, published: publish,
    })) }
  } catch (error) {
    return { changed: false, error: error.message, ...(await remember({ lastError: `${checkedAt}: ${error.message}`.slice(0, 500) })) }
  }
}
