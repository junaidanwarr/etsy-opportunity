// Server-rendered HTML. Every value that came from the Radar or a visitor goes through esc() / attr().
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const attr = esc
const DAY = 864e5

export function makeViews(cfg) {
  const fmtDate = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  const isNew = item => Date.now() - new Date(item.discoveredAt).getTime() < cfg.newDays * DAY
  const label = key => key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^\w/, c => c.toUpperCase())
  const fmtVal = v => typeof v === 'number' ? v.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(v)
  const url = path => cfg.siteUrl ? cfg.siteUrl.replace(/\/$/, '') + path : path

  /* Deterministic placeholder art for discoveries without an image (no fake photos). */
  function placeholder(item, cls = '') {
    let h = 0; for (const c of item.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const palettes = [['#c8673c', '#e9d8c4'], ['#6f8a6e', '#dfe5d6'], ['#3b5c9a', '#dbe1ec'], ['#9a6b3b', '#efe2cf'], ['#7a4f6a', '#ecdde4']]
    const [a, b] = palettes[h % palettes.length]
    const caption = esc((item.category || (item.kind === 'shop' ? 'Etsy shop' : 'Etsy keyword')).toUpperCase().slice(0, 28))
    const tilt = (h % 13) - 6
    // A simple motif per kind of keyword, so a page of image-less cards doesn't look identical.
    const c = (item.category + ' ' + item.keywords?.join(' ')).toLowerCase()
    const motif =
      /journal|scrapbook|paper|ephemera/.test(c) ? `<rect x="58" y="52" width="84" height="104" rx="4" fill="${b}" stroke="${a}" stroke-width="5" transform="rotate(-8 100 104)"/><rect x="58" y="52" width="84" height="104" rx="4" fill="${a}" opacity=".9" transform="rotate(5 100 104)"/><path d="M74 84h52M74 100h52M74 116h34" stroke="${b}" stroke-width="5" stroke-linecap="round" transform="rotate(5 100 104)"/>`
      : /embroider|cross stitch|stitch/.test(c) ? `<circle cx="100" cy="104" r="50" fill="${b}" stroke="${a}" stroke-width="9"/><rect x="92" y="44" width="16" height="12" rx="3" fill="${a}"/><path d="M80 90l14 14M94 90l-14 14M106 104l14 14M120 104l-14 14M80 118l14 14M94 118l-14 14" stroke="${a}" stroke-width="5" stroke-linecap="round"/>`
      : /crochet|amigurumi|yarn|knit/.test(c) ? `<circle cx="96" cy="108" r="46" fill="${a}"/><path d="M60 90c24 10 50 10 74-6M54 112c30 12 60 10 86-8M64 136c22 6 44 4 64-8" stroke="${b}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M136 70l26-26" stroke="${a}" stroke-width="7" stroke-linecap="round"/>`
      : /color/.test(c) ? `<rect x="50" y="56" width="74" height="96" rx="6" fill="${b}" stroke="${a}" stroke-width="5"/><circle cx="87" cy="104" r="20" fill="none" stroke="${a}" stroke-width="4"/><rect x="130" y="60" width="20" height="80" rx="4" fill="${a}" transform="rotate(14 140 100)"/><path d="M134 140l6 18 6-18z" fill="${a}" transform="rotate(14 140 100)"/>`
      : /template|canva|website|invitation/.test(c) ? `<rect x="46" y="56" width="108" height="94" rx="8" fill="${b}" stroke="${a}" stroke-width="5"/><rect x="46" y="56" width="108" height="18" rx="6" fill="${a}"/><rect x="58" y="84" width="40" height="54" rx="4" fill="${a}" opacity=".85"/><path d="M108 90h34M108 104h34M108 118h22" stroke="${a}" stroke-width="5" stroke-linecap="round"/>`
      : /svg|cricut|cut file/.test(c) ? `<circle cx="74" cy="132" r="16" fill="none" stroke="${a}" stroke-width="7"/><circle cx="126" cy="132" r="16" fill="none" stroke="${a}" stroke-width="7"/><path d="M84 120l46-70M116 120l-46-70" stroke="${a}" stroke-width="8" stroke-linecap="round"/>`
      : /kids|education|worksheet|learning/.test(c) ? `<rect x="50" y="104" width="46" height="46" rx="6" fill="${a}"/><rect x="104" y="104" width="46" height="46" rx="6" fill="${a}" opacity=".7"/><rect x="76" y="54" width="46" height="46" rx="6" fill="${a}" opacity=".85" transform="rotate(${tilt} 99 77)"/><text x="73" y="136" text-anchor="middle" font-size="26" font-family="sans-serif" font-weight="700" fill="${b}">A</text><text x="127" y="136" text-anchor="middle" font-size="26" font-family="sans-serif" font-weight="700" fill="${b}">B</text>`
      : /clipart|png|sticker|sublimation/.test(c) ? `<path d="M100 48l13 33 35 3-27 23 9 34-30-19-30 19 9-34-27-23 35-3z" fill="${a}" transform="rotate(${tilt} 100 100)"/><circle cx="148" cy="62" r="10" fill="${a}" opacity=".5"/><circle cx="56" cy="146" r="7" fill="${a}" opacity=".5"/>`
      : `<rect x="48" y="66" width="104" height="96" rx="16" fill="${a}" opacity=".88" transform="rotate(${tilt} 100 114)"/><circle cx="${128 + h % 14}" cy="66" r="20" fill="${b}" stroke="${a}" stroke-width="6"/>`
    const shape = item.kind === 'shop'
      ? `<g transform="translate(0 6)"><path d="M44 84h112v76H44z" fill="${a}" opacity=".18"/><path d="M36 84l14-32h100l14 32z" fill="${a}"/><path d="M36 84h128v8c0 8-8 12-16 12s-16-4-16-12c0 8-8 12-16 12s-16-4-16-12c0 8-8 12-16 12s-16-4-16-12c0 8-8 12-16 12s-16-4-16-12z" fill="${a}" opacity=".75"/><g transform="translate(62 104) scale(.38)">${motif}</g></g>`
      : motif
    return `<svg class="ph ${cls}" viewBox="0 0 200 200" role="img" aria-label="No image provided"><rect width="200" height="200" fill="${b}"/>${shape}<text x="100" y="186" text-anchor="middle" font-size="9" fill="${a}" font-family="sans-serif" letter-spacing="1.6">${caption}</text></svg>`
  }
  const image = (item, cls = '') => item.image
    ? `<img src="${attr(item.image)}" alt="${attr(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="${cls}">`
    : placeholder(item, cls)
  const saveData = item => attr(JSON.stringify({ id: item.id, kind: item.kind, title: item.title, image: item.image || '', category: item.category || '' }))
  const saveBtn = (item, cls = 'save') => `<button type="button" class="${cls}" data-save="${saveData(item)}" aria-pressed="false" aria-label="Save ${attr(item.title)} to my list"><span class="ic" aria-hidden="true">♡</span><span class="tx">Save</span></button>`

  function metricChips(item, n = 2) {
    const entries = Object.entries(item.metrics || {}).slice(0, n)
    return entries.length ? `<div class="chips">${entries.map(([k, v]) => `<span>${esc(label(k))} <b>${esc(fmtVal(v))}</b></span>`).join('')}</div>` : ''
  }

  function keywordCard(p) {
    return `<article class="card rv">
      <a class="pic" href="/keywords/${encodeURIComponent(p.id)}" tabindex="-1" aria-hidden="true">${image(p)}</a>
      ${isNew(p) ? '<span class="badge">New</span>' : ''}
      ${saveBtn(p, 'save heart')}
      <div class="body">
        <span class="cat">${esc(p.category || 'Etsy keyword')}</span>
        <h3><a href="/keywords/${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3>
        ${p.shopName ? `<p class="by">by ${esc(p.shopName)}</p>` : ''}
        ${metricChips(p)}
        <p class="date">Updated ${esc(fmtDate(p.lastSeenAt || p.discoveredAt))}</p>
      </div>
    </article>`
  }
  function shopCard(s, keywordCount = 0) {
    return `<article class="card shop rv">
      <a class="pic" href="/shops/${encodeURIComponent(s.id)}" tabindex="-1" aria-hidden="true">${image(s)}</a>
      ${isNew(s) ? '<span class="badge">New</span>' : ''}
      ${saveBtn(s, 'save heart')}
      <div class="body">
        <span class="cat">${esc(s.category || 'Etsy shop')}</span>
        <h3><a href="/shops/${encodeURIComponent(s.id)}">${esc(s.title)}</a></h3>
        ${keywordCount ? `<p class="by">${keywordCount} trending keyword${keywordCount > 1 ? 's' : ''}</p>` : ''}
        ${metricChips(s)}
        <p class="date">Found ${esc(fmtDate(s.discoveredAt))}</p>
      </div>
    </article>`
  }

  function layout({ title, description, path, body, noindex = false, active = '' }) {
    const fullTitle = title ? `${title} — ${cfg.siteName}` : `${cfg.siteName} — Discover what's trending on Etsy`
    const nav = (href, text, key) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${text}</a>`
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
${cfg.siteUrl && path ? `<link rel="canonical" href="${attr(url(path))}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(cfg.siteName)}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description)}">
${cfg.siteUrl && path ? `<meta property="og:url" content="${attr(url(path))}">` : ''}
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#f1ece4">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,600&family=Newsreader:ital,opsz,wght@1,6..72,300&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/styles.css?v=${cfg.assetVersion}">
<script src="/static/app.js?v=${cfg.assetVersion}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="announce">Discover shops · Explore keywords refreshed weekly · No account needed to save ideas</div>
<header class="nav">
  <div class="wrap">
    <nav class="links" aria-label="Main">${nav('/shops', 'Shops', 'shops')}${nav('/keywords', 'Keywords', 'keywords')}${nav('/#how', 'How it works', 'how')}</nav>
    <a class="logo" href="/">${esc(cfg.siteName)}<span>.</span></a>
    <div class="right"><a class="cta-link" href="/request">Get a workflow</a><button class="bag" id="listBtn" type="button" aria-haspopup="dialog" aria-controls="drawer">My list <b id="listCount">0</b></button></div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <div><a class="logo" href="/">${esc(cfg.siteName)}<span>.</span></a><p>Daily Etsy trend discoveries, and a practical first step for people starting out.</p></div>
    <nav aria-label="Footer"><a href="/shops">Shops</a><a href="/keywords">Keywords</a><a href="/request">Get a workflow</a><a href="/privacy">Privacy</a></nav>
    <p class="legal">Trend signals come from public Etsy pages and are a starting point for research, not a promise of sales or income. Etsy is a trademark of Etsy, Inc. ${esc(cfg.siteName)} is independent and is not affiliated with, sponsored or endorsed by Etsy. © ${new Date().getFullYear()} ${esc(cfg.siteName)}.</p>
  </div>
</footer>
<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="listTitle" tabindex="-1">
  <header><span id="listTitle">My opportunity list</span><button type="button" id="closeList" aria-label="Close list">×</button></header>
  <div class="items" id="listItems"></div>
  <footer><a class="btn" href="/request" id="listCta">Get your startup workflow</a><p class="note">Saved in this browser only. Nothing is sent until you submit a request.</p></footer>
</aside>
</body>
</html>`
  }

  const emptyShelf = (title, text) => `<div class="empty rv"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`

  /* ---------- Pages ---------- */
  function home({ featured, radarKeywords = featured, shops, counts, lastReport, shopKeywordCounts }) {
    const updated = lastReport ? fmtDate(lastReport.generated_at || lastReport.received_at) : ''
    const pool = [...new Set(radarKeywords.map(p => p.title))]
    const shuffled = [...pool]
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    const heroThumbs = shuffled.slice(0, 15)
    return layout({
      title: '', path: '/',
      description: "Explore trending Etsy keywords and shops discovered by our research. Find inspiration, discover opportunities, and get a practical workflow to start your own business.",
      body: `
<section class="hero">
  <div class="text">
    <span class="kicker rv">Etsy Surveillance Radar · ${updated ? `updated ${esc(updated)}` : 'weekly keyword research'}</span>
    <h1 class="rv">Discover what's trending on Etsy. <span class="it">Find your next business opportunity.</span></h1>
    <div class="rv" style="--d:.12s">
      <p class="lead">Explore trending Etsy keywords and shops discovered by our research. Find inspiration, discover opportunities, and get a practical workflow to start your own business.</p>
      <div class="ctas"><a class="btn" href="/shops">Explore shops</a><a class="btn line" href="/keywords">Browse keywords</a></div>
    </div>
  </div>
  <div class="stage" aria-hidden="true">
    <div class="radar"><i></i><b></b><b></b><b></b></div>
    <div class="radar-keywords" data-radar-pool="${attr(JSON.stringify(pool))}">${heroThumbs.map((title, i) => `<div class="radar-keyword" style="--phase:-${(i * 1.7).toFixed(1)}s"><span>${esc(title)}</span></div>`).join('')}</div>
    <span class="tag">${counts.products ? `${counts.products} keywords · ${counts.shops} shops tracked` : 'Explore shops and weekly keywords'}</span>
  </div>
</section>

<div class="marquee" aria-hidden="true"><div class="track">
  ${['Keywords updated weekly', 'Real Etsy listings only', 'Save without an account', 'Affordable startup workflows', 'Reviewed by our team'].concat(['Keywords updated weekly', 'Real Etsy listings only', 'Save without an account', 'Affordable startup workflows', 'Reviewed by our team']).map(t => `<span>${t}</span>`).join('')}
</div></div>

<section class="radar-intro">
  <div class="wrap split">
    <div><span class="kicker rv">Shop & keyword research</span><h2 class="rv">We watch Etsy <span class="it">so you don't have to</span></h2></div>
    <div class="rv" style="--d:.1s">
      <p class="lead">Our Etsy Surveillance Radar tracks Etsy shops and keywords and flags keywords and shops that are gaining attention. Our team reviews each discovery before it appears here, so you only see real listings with links straight to Etsy.</p>
      <div class="stats">
        <div><b>${counts.products}</b><span>trending keywords</span></div>
        <div><b>${counts.shops}</b><span>trending shops</span></div>
        <div><b>${updated ? esc(updated) : '—'}</b><span>latest scan</span></div>
      </div>
    </div>
  </div>
</section>

<section class="shelf" style="padding-top:0">
  <div class="wrap">
    <div class="shelf-head"><h2 class="rv">Shops <span class="it">worth watching</span></h2><a class="more rv" href="/shops">All shops →</a></div>
    ${shops.length ? `<div class="grid four">${shops.map(s => shopCard(s, shopKeywordCounts[s.id] || 0)).join('')}</div>` : emptyShelf('No shops published yet.', 'Trending shops appear here once the Radar reports them.')}
  </div>
</section>

<section class="shelf" style="padding-top:0">
  <div class="wrap">
    <div class="shelf-head"><h2 class="rv">Keywords <span class="it">to explore</span></h2><a class="more rv" href="/keywords">All keywords →</a></div>
    ${featured.length ? `<div class="grid">${featured.map(keywordCard).join('')}</div>` : emptyShelf('The first discoveries are on their way.', 'Keywords appear here as soon as our Radar delivers a report and our team approves it.')}
  </div>
</section>

<section class="how" id="how">
  <div class="wrap">
    <span class="kicker rv" style="color:var(--clay)">How it works</span>
    <h2 class="rv" style="margin-top:12px">From a trending listing <span class="it">to your first step</span></h2>
    <ol class="steps">
      <li class="rv"><span>01</span><h3>We research Etsy</h3><p>Our research looks for shops and keywords that are picking up attention.</p></li>
      <li class="rv" style="--d:.08s"><span>02</span><h3>We review the finds</h3><p>Our team checks each discovery before it's published here.</p></li>
      <li class="rv" style="--d:.16s"><span>03</span><h3>You shortlist ideas</h3><p>Save the keywords and shops that interest you. No account needed.</p></li>
      <li class="rv" style="--d:.24s"><span>04</span><h3>We send a workflow</h3><p>Our team reviews your picks and contacts you with a practical, step-by-step plan to start.</p></li>
    </ol>
  </div>
</section>

<section class="offer">
  <div class="wrap split">
    <div>
      <span class="kicker rv">Startup workflow</span>
      <h2 class="rv">A practical plan, <span class="it">at a modest cost</span></h2>
      <p class="lead rv" style="--d:.1s">Tell us which keywords or shops caught your eye and what you want to achieve. We'll reply with a step-by-step workflow for getting started on that niche, built to keep your upfront spending low.</p>
      <div class="ctas rv" style="--d:.15s"><a class="btn" href="/request">Get your startup workflow</a></div>
    </div>
    <ul class="checks rv" style="--d:.2s">
      <li><b>Built around your shortlist</b>We look at the exact keywords and shops you picked.</li>
      <li><b>Affordable by design</b>We start from tools and steps that keep costs low, and we tell you the price before any work begins.</li>
      <li><b>Honest expectations</b>No guaranteed sales or income. Trends change, and we'll say so.</li>
      <li><b>One clear contact</b>Reply on email, WhatsApp or phone, whichever you prefer.</li>
    </ul>
  </div>
</section>

${workflowVideos()}
<section class="faq" style="padding-top:0">
  <div class="wrap split">
    <h2 class="rv">Questions, <span class="it">answered</span></h2>
    <div class="rv" style="--d:.1s">
      <details open><summary>Where does the data come from?</summary><p>From our own Etsy Surveillance Radar, which reviews public Etsy listings and shop pages. We only publish what the Radar actually reports, and every item links to the original page on Etsy.</p></details>
      <details><summary>Does "trending" mean it will sell for me?</summary><p>No. A trend shows that something is getting attention right now. It's a good place to start researching, but it is not a promise of sales, profit or income.</p></details>
      <details><summary>Do I need an account?</summary><p>No. Your list is saved in your browser. You only share your details when you choose to request a workflow.</p></details>
      <details><summary>What does the workflow cost?</summary><p>It depends on what you need. We'll tell you the price after reviewing your request, before you commit to anything.</p></details>
    </div>
  </div>
</section>`,
    })
  }

  function filterBar({ kind, params, categories, metricKeys, total }) {
    const sel = (name, value) => params[name] === value ? ' selected' : ''
    return `<form class="filters rv" method="get" action="/${kind === 'product' ? 'keywords' : 'shops'}" role="search">
      <label class="search"><span class="sr">Search</span><input type="search" name="q" value="${attr(params.q)}" placeholder="Search ${kind === 'product' ? 'keywords, shops or keywords' : 'shops or keywords'}…"></label>
      <label><span class="sr">Category</span><select name="category"><option value="">All categories</option>${categories.map(c => `<option${sel('category', c)}>${esc(c)}</option>`).join('')}</select></label>
      <label><span class="sr">Discovered</span><select name="when">
        <option value="">Any time</option><option value="new"${sel('when', 'new')}>Last ${cfg.newDays} days</option><option value="30d"${sel('when', '30d')}>Last 30 days</option><option value="older"${sel('when', 'older')}>Archive (older than ${cfg.newDays} days)</option>
      </select></label>
      <label><span class="sr">Sort</span><select name="sort">
        <option value="">Newest first</option><option value="oldest"${sel('sort', 'oldest')}>Oldest first</option><option value="seen"${sel('sort', 'seen')}>Recently updated</option>
        ${metricKeys.map(k => `<option value="m:${attr(k)}"${sel('sort', 'm:' + k)}>${esc(label(k))}, high to low</option>`).join('')}
      </select></label>
      <button class="btn small" type="submit">Apply</button>
      <span class="count">${total} result${total === 1 ? '' : 's'}${params.q || params.category || params.when ? ` · <a href="/${kind === 'product' ? 'keywords' : 'shops'}">Clear</a>` : ''}</span>
    </form>`
  }

  function pager(base, params, page, pages) {
    if (pages <= 1) return ''
    const link = n => { const p = new URLSearchParams(Object.entries({ ...params, page: n }).filter(([, v]) => v)); return `${base}?${p}` }
    return `<nav class="pager" aria-label="Pages">${page > 1 ? `<a href="${attr(link(page - 1))}">← Newer</a>` : '<span></span>'}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${attr(link(page + 1))}">Older →</a>` : '<span></span>'}</nav>`
  }

  function listing({ kind, items, params, categories, metricKeys, total, page, pages, shopKeywordCounts = {} }) {
    const isKeyword = kind === 'product'
    const archive = params.when === 'older'
    return layout({
      title: archive ? `${isKeyword ? 'Keyword' : 'Shop'} archive` : `Trending Etsy ${isKeyword ? 'keywords' : 'shops'}`,
      description: isKeyword ? 'Browse trending Etsy keywords found by our research. Search by keyword, filter by category and date, and save ideas to your list.' : 'Explore Etsy shops gaining momentum, see their trending keywords, and shortlist the ones you want to learn from.',
      path: isKeyword ? '/keywords' : '/shops', active: isKeyword ? 'keywords' : 'shops',
      body: `
<section class="page-head"><div class="wrap">
  <span class="kicker rv">${archive ? 'Archive' : 'Discovered by the Radar'}</span>
  <h1 class="rv">${isKeyword ? `Trending <span class="it">keywords</span>` : `Trending <span class="it">shops</span>`}</h1>
  ${filterBar({ kind, params, categories, metricKeys, total })}
</div></section>
<section class="shelf" style="padding-top:20px"><div class="wrap">
  ${items.length ? `<div class="grid${isKeyword ? '' : ' four'}">${items.map(i => isKeyword ? keywordCard(i) : shopCard(i, shopKeywordCounts[i.id] || 0)).join('')}</div>` :
    emptyShelf(params.q || params.category || params.when ? 'Nothing matches those filters.' : 'Nothing published yet.', params.q || params.category || params.when ? 'Try a different keyword, or clear the filters.' : 'New discoveries appear here after the Radar reports them and our team approves them.')}
  ${pager(isKeyword ? '/keywords' : '/shops', params, page, pages)}
</div></section>`,
    })
  }

  function metricsTable(item, history) {
    const m = Object.entries(item.metrics || {})
    const keys = [...new Set(history.flatMap(h => Object.keys(h.metrics)))].slice(0, 6)
    return `${m.length ? `<table class="metrics"><caption>Latest trend information</caption><tbody>${m.map(([k, v]) => `<tr><th scope="row">${esc(label(k))}</th><td>${esc(fmtVal(v))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">The Radar did not report trend metrics for this item.</p>'}
    ${history.length > 1 && keys.length ? `<details class="history"><summary>Trend history (${history.length} reports)</summary><div class="scroll"><table><thead><tr><th>Report date</th>${keys.map(k => `<th>${esc(label(k))}</th>`).join('')}</tr></thead><tbody>${history.map(h => `<tr><td>${esc(fmtDate(h.seenAt))}</td>${keys.map(k => `<td>${h.metrics[k] !== undefined ? esc(fmtVal(h.metrics[k])) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}`
  }

  function detail({ item, history, shop, related, relatedTitle }) {
    const isKeyword = item.kind === 'product'
    const etsyLink = isKeyword ? `https://www.etsy.com/search?q=${encodeURIComponent(item.title)}` : item.shopUrl
    const base = isKeyword ? '/keywords' : '/shops'
    const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: url('/') },
      { '@type': 'ListItem', position: 2, name: isKeyword ? 'Keywords' : 'Shops', item: url(base) },
      { '@type': 'ListItem', position: 3, name: item.title }] }
    return layout({
      title: item.title.length > 70 ? item.title.slice(0, 67).replace(/[\s,|]+\S*$/, '') + '…' : item.title, path: `${base}/${encodeURIComponent(item.id)}`, active: isKeyword ? 'keywords' : 'shops',
      description: `${item.title}${item.category ? ` (${item.category})` : ''}: a trending Etsy ${isKeyword ? 'keyword' : 'shop'} discovered ${fmtDate(item.discoveredAt)}. See the latest trend information and save it to your opportunity list.`,
      body: `
<script type="application/ld+json">${JSON.stringify(crumbs).replace(/</g, '\\u003c')}</script>
<section class="detail"><div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="${base}">${isKeyword ? 'Keywords' : 'Shops'}</a> / <span>${esc(item.title)}</span></nav>
  <div class="detail-grid">
    <div class="detail-pic rv">${image(item, 'big')}${isNew(item) ? '<span class="badge">New</span>' : ''}</div>
    <div class="detail-info rv" style="--d:.1s">
      <span class="cat">${esc(item.category || (isKeyword ? 'Etsy keyword' : 'Etsy shop'))}</span>
      <h1>${esc(item.title)}</h1>
      ${isKeyword && (item.shopName || item.shopUrl) ? `<p class="by">by ${shop ? `<a href="/shops/${encodeURIComponent(shop.id)}">${esc(item.shopName || shop.title)}</a>` : item.shopUrl ? `<a href="${attr(item.shopUrl)}" target="_blank" rel="nofollow noopener noreferrer">${esc(item.shopName || 'View shop')} ↗</a>` : esc(item.shopName)}</p>` : ''}
      <div class="detail-actions">${saveBtn(item, 'btn save-big')}${etsyLink ? `<a class="btn line" href="${attr(etsyLink)}" target="_blank" rel="nofollow noopener noreferrer">${isKeyword ? 'Search on Etsy' : 'View shop on Etsy'} ↗</a>` : ''}</div>
      <dl class="facts">
        <div><dt>First discovered</dt><dd>${esc(fmtDate(item.discoveredAt))}</dd></div>
        <div><dt>Last seen by the Radar</dt><dd>${esc(fmtDate(item.lastSeenAt))}</dd></div>
      </dl>
      ${item.note ? `<div class="team-note"><b>Our team's note</b><p>${esc(item.note)}</p></div>` : ''}
      ${metricsTable(item, history)}
      ${item.keywords?.length ? `<div class="keywords"><span class="muted">Keywords</span>${item.keywords.map(k => `<a href="/keywords?q=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>` : ''}
      <p class="disclaimer">Trend data is a snapshot from public Etsy pages and can change quickly. Use it as a starting point for your own research.</p>
      <a class="workflow-link" href="/request">Interested? Get a startup workflow for this →</a>
    </div>
  </div>
</div></section>
${related.length ? `<section class="shelf" style="padding-top:0"><div class="wrap"><div class="shelf-head"><h2 class="rv">${relatedTitle}</h2></div><div class="grid">${related.map(keywordCard).join('')}</div></div></section>` : ''}`,
    })
  }


  function workflowVideos() {
    const slots = [1, 2].map(n => {
      const raw = cfg.workflowVideos?.[n - 1] || ''
      let player = ''
      try {
        const u = new URL(raw)
        if (u.protocol === 'https:') {
          const yt = ['www.youtube.com', 'youtube.com'].includes(u.hostname) ? (u.searchParams.get('v') || u.pathname.split('/').pop()) : u.hostname === 'youtu.be' ? u.pathname.slice(1) : ''
          if (/^[\w-]{11}$/.test(yt)) player = `<iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="Workflow video ${n}" loading="lazy" allowfullscreen></iframe>`
          else if (/\.mp4$/i.test(u.pathname)) player = `<video controls preload="metadata" src="${attr(u.href)}" aria-label="Workflow video ${n}"></video>`
        }
      } catch {}
      return `<article class="workflow-video">${player || `<div class="video-placeholder"><span aria-hidden="true">▷</span><p>Video ${n} · Coming soon</p></div>`}<h3>${n === 1 ? 'How your startup workflow works' : 'What happens after you choose a niche'}</h3></article>`
    })
    return `<section class="workflow-videos"><div class="wrap"><span class="kicker">Watch & learn</span><h2>Take a look <span class="it">before you begin</span></h2><div class="video-grid">${slots.join('')}</div></div></section>`
  }

  function requestPage({ contact }) {
    return layout({
      title: 'Get your startup workflow', path: '/request', active: 'request',
      description: 'Send us your shortlisted Etsy keywords and shops. Our team will reply with a practical, affordable step-by-step workflow to get started.',
      body: `
<section class="page-head"><div class="wrap">
  <span class="kicker rv">Startup workflow</span>
  <h1 class="rv">Get your startup <span class="it">workflow</span></h1>
  <p class="lead rv" style="--d:.1s;max-width:640px">Tell us a little about yourself and what you want to build. Our team reviews your selections and replies with a practical, step-by-step plan that keeps your starting costs low.</p>
</div></section>
${workflowVideos()}
<section style="padding-top:10px"><div class="wrap request-grid">
  <div class="rv">
    <h2 class="small-h">Your selections</h2>
    <div id="requestList" class="request-list"><p class="muted">Loading your list…</p></div>
    <p class="muted small">Nothing selected yet? <a href="/keywords">Browse keywords</a> or <a href="/shops">shops</a> and tap Save. You can also send a request with just your questions.</p>
  </div>
  <form class="request-form rv" style="--d:.1s" method="post" action="/request" id="requestForm" novalidate>
    <input type="hidden" name="selected" id="selectedField" value="[]">
    <label class="hp" aria-hidden="true">Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
    <label>Your name<input name="name" required maxlength="120" autocomplete="name"></label>
    <fieldset><legend>Preferred contact method</legend>
      <div class="radios"><label><input type="radio" name="contactMethod" value="Email" checked> Email</label><label><input type="radio" name="contactMethod" value="WhatsApp"> WhatsApp</label><label><input type="radio" name="contactMethod" value="Phone"> Phone</label></div>
    </fieldset>
    <label><span id="contactLabel">Email address</span><input name="contact" id="contactField" required maxlength="240" autocomplete="email" inputmode="email"></label>
    <label>Your goals or questions <span class="muted">(optional)</span><textarea name="goal" rows="5" maxlength="3000" placeholder="e.g. I have a small budget and want to start with digital downloads. Which of these could I realistically begin with?"></textarea></label>
    <label class="consent"><input type="checkbox" name="consent" value="yes" required> I agree that ${esc(cfg.siteName)} may store these details and contact me about this request. See our <a href="/privacy">privacy note</a>.</label>
    <p class="form-error" id="formError" role="alert"></p>
    <button class="btn" type="submit">Send my request</button>
    <p class="muted small">We'll confirm the price before any paid work starts. No sales or income guarantees, ever.</p>
  </form>
</div></section>`,
    })
  }

  function thanksPage({ request, contact }) {
    const lines = [contact.email && `Email: <a href="mailto:${attr(contact.email)}?subject=${encodeURIComponent('Workflow request ' + request.ref)}">${esc(contact.email)}</a>`,
      contact.whatsapp && `WhatsApp: <a href="https://wa.me/${attr(contact.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent('Hi, my workflow request reference is ' + request.ref)}" rel="noopener">${esc(contact.whatsapp)}</a>`].filter(Boolean)
    return layout({
      title: 'Request received', path: '/request/thanks', noindex: true,
      description: 'Your workflow request was received.',
      body: `
<section class="thanks"><div class="wrap narrow">
  <span class="kicker rv">Request received</span>
  <h1 class="rv">Thank you, ${esc(request.name.split(' ')[0])}. <span class="it">We're on it.</span></h1>
  <div class="ref rv" style="--d:.1s"><span>Your reference</span><b>${esc(request.ref)}</b></div>
  <ol class="next rv" style="--d:.15s">
    <li>Our team reviews your ${request.selected.length ? `${request.selected.length} selected opportunit${request.selected.length === 1 ? 'y' : 'ies'}` : 'request'} and your goals.</li>
    <li>We contact you by <b>${esc(request.contactMethod)}</b>${cfg.replyDays ? ` within ${esc(cfg.replyDays)}` : ''}, with the price of your workflow before any paid work starts.</li>
    <li>You receive a practical, step-by-step workflow for your chosen niche.</li>
  </ol>
  ${lines.length ? `<p class="rv" style="--d:.2s">Want to reach us sooner? Quote <b>${esc(request.ref)}</b> and contact us directly:<br>${lines.join('<br>')}</p>` : ''}
  <div class="ctas rv" style="--d:.25s"><a class="btn line" href="/keywords">Keep exploring</a></div>
</div></section>`,
    })
  }

  function privacyPage({ contact }) {
    return layout({
      title: 'Privacy', path: '/privacy', description: `How ${cfg.siteName} handles your information.`,
      body: `<section class="page-head prose"><div class="wrap narrow">
  <h1>Privacy</h1>
  <p><b>Your list.</b> Keywords and shops you save are kept in your own browser (local storage). They are not sent to us unless you submit a workflow request.</p>
  <p><b>Workflow requests.</b> When you send a request we store your name, your contact detail and method, your goals and your selections, so our team can reply. We use them only for that and do not sell them.</p>
  <p><b>Discovery data.</b> Keyword and shop information comes from public Etsy pages via our Radar. If you are a seller and want something removed, ${contact.email ? `email <a href="mailto:${attr(contact.email)}">${esc(contact.email)}</a>` : 'contact us'} and we will take it down.</p>
  <p><b>Cookies.</b> The public site uses no tracking cookies. The admin area uses one strictly necessary sign-in cookie.</p>
  <p><b>Deletion.</b> Ask us at any time to delete a request you sent${contact.email ? ` at <a href="mailto:${attr(contact.email)}">${esc(contact.email)}</a>` : ''}.</p>
</div></section>`,
    })
  }

  function notFound() {
    return layout({ title: 'Not found', path: '', noindex: true, description: 'Page not found.', body: `<section class="thanks"><div class="wrap narrow"><span class="kicker">404</span><h1>This page has <span class="it">moved on</span>.</h1><p class="lead">The discovery may have been unpublished or the link is wrong.</p><div class="ctas"><a class="btn" href="/keywords">Browse trending keywords</a></div></div></section>` })
  }

  function adminShell() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Admin — ${esc(cfg.siteName)}</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/admin.css?v=${cfg.assetVersion}"><script src="/static/admin.js?v=${cfg.assetVersion}" defer></script></head>
<body><div id="app" data-site="${attr(cfg.siteName)}"><p class="boot">Loading…</p></div></body></html>`
  }

  return { home, listing, detail, requestPage, thanksPage, privacyPage, notFound, adminShell, layout }
}
