// Admin dashboard: review Radar reports, publish/feature discoveries, and work through workflow requests.
(() => {
  const app = document.getElementById('app'), site = app.dataset.site
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const when = iso => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  const day = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  const ago = iso => { if (!iso) return 'never'; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago` }
  let state = { tab: 'overview', overview: null, discoveries: [], requests: [], statuses: [], reports: [], filter: 'pending', q: '', editing: null, reqFilter: 'open' }

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } })
    const out = await res.json().catch(() => ({}))
    if (res.status === 401 && path !== '/api/admin/login') { renderLogin(); throw new Error('Please sign in again.') }
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`)
    return out
  }
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2600) }

  /* ---------- Login ---------- */
  function renderLogin() {
    app.innerHTML = `<div class="login"><form id="login"><h1>${esc(site)} admin</h1><label class="muted" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required autofocus><p class="err" id="err" role="alert"></p><button class="btn" type="submit">Sign in</button></form></div>`
    document.getElementById('login').onsubmit = async e => {
      e.preventDefault()
      try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: document.getElementById('pw').value }) }); await loadAll(); renderShell() }
      catch (err) { document.getElementById('err').textContent = err.message }
    }
  }

  /* ---------- Data ---------- */
  async function loadAll() {
    const [o, d, r] = await Promise.all([api('/api/admin/overview'), api('/api/admin/discoveries'), api('/api/admin/requests')])
    state.overview = o; state.discoveries = d.discoveries; state.requests = r.requests; state.statuses = r.statuses
  }
  async function refresh() { await loadAll(); renderShell() }

  /* ---------- Shell ---------- */
  function renderShell() {
    const c = state.overview.counts
    const tab = (id, label, pill) => `<button class="tab" data-tab="${id}" aria-current="${state.tab === id}">${label}${pill ? `<span class="pill">${pill}</span>` : ''}</button>`
    app.innerHTML = `<div class="shell">
      <aside class="side"><div class="brand">${esc(site)}<span>.</span> admin</div>
        ${tab('overview', 'Overview')}${tab('discoveries', 'Discoveries', c.pending)}${tab('requests', 'Requests', c.newRequests)}${tab('reports', 'Radar reports')}
        <div class="bottom"><a href="/" target="_blank" rel="noopener">View site ↗</a><button id="logout">Sign out</button></div></aside>
      <main class="content" id="content"></main></div>`
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderShell() })
    document.getElementById('logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); renderLogin() }
    ;({ overview, discoveries, requests, reports })[state.tab]()
  }
  const content = () => document.getElementById('content')
  const radarBanner = o => o.radarStale
    ? `<div class="banner warn"><b>No Radar report in the last ${o.staleHours} hours.</b> Last successful report: ${esc(ago(o.lastReportAt))}. Check that the Radar ran and that it is sending to <code>${esc(o.siteUrl || location.origin)}/api/radar/reports</code> with the right token.${o.tokenConfigured ? '' : ' <b>RADAR_INGEST_TOKEN is not set on the server.</b>'}</div>`
    : `<div class="banner ok">Radar is reporting. Last report ${esc(ago(o.lastReportAt))}.</div>`
  const reportRows = rs => rs.length ? `<table><thead><tr><th>Received</th><th>Source</th><th>Items</th><th>New</th><th>Updated</th><th>Skipped</th><th>Status</th></tr></thead><tbody>${rs.map(r => `<tr><td>${esc(when(r.received_at))}</td><td>${esc(r.source)}</td><td>${r.products} products, ${r.shops} shops</td><td>${r.created}</td><td>${r.updated}</td><td>${r.skipped}</td><td><span class="st ${esc(r.status)}">${esc(r.status)}</span>${r.message ? `<div class="muted">${esc(r.message)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No reports received yet.</p>'

  function overview() {
    const o = state.overview, c = o.counts
    content().innerHTML = `<h2 class="title">Overview</h2>${radarBanner(o)}
      <div class="cards"><div><b>${c.products}</b><span>published products</span></div><div><b>${c.shops}</b><span>published shops</span></div><div><b>${c.pending}</b><span>waiting for review</span></div><div><b>${c.newRequests}</b><span>new workflow requests</span></div></div>
      ${c.pending ? `<div class="panel"><h3>${c.pending} discover${c.pending === 1 ? 'y needs' : 'ies need'} review</h3><p class="muted" style="margin-bottom:10px">New Radar finds stay hidden until approved${o.autoApprove ? ' (auto-approve is on, so this should normally be zero)' : ''}.</p><button class="btn" data-go="discoveries">Review discoveries</button></div>` : ''}
      ${c.newRequests ? `<div class="panel"><h3>${c.newRequests} new workflow request${c.newRequests === 1 ? '' : 's'}</h3><button class="btn" data-go="requests">Open requests</button></div>` : ''}
      <div class="panel"><h3>Email alerts</h3>
        ${o.email.ready
          ? `<p class="muted" style="margin-bottom:10px">Each new workflow request is emailed to <b>${esc(o.email.to)}</b> via ${esc(o.email.host)}.</p>`
          : `<p class="muted" style="margin-bottom:10px">Not set up yet. Add <code>NOTIFY_EMAIL</code>, <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> to <code>.env</code> and restart. Until then, new requests only appear here.</p>`}
        ${o.email.lastError ? `<div class="banner warn">Last email failed: ${esc(o.email.lastError)}</div>` : ''}
        ${o.email.ready ? '<button class="btn line" id="testEmail">Send a test email</button>' : ''}</div>
      <div class="panel"><h3>Recent Radar reports</h3>${reportRows(o.reports)}</div>`
    content().querySelectorAll('[data-go]').forEach(b => b.onclick = () => { state.tab = b.dataset.go; renderShell() })
    document.getElementById('testEmail')?.addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'Sending…'
      try { const r = await api('/api/admin/test-email', { method: 'POST' }); toast(`Test email sent to ${r.to}`); state.overview.email.lastError = '' }
      catch (err) { toast(err.message); state.overview.email.lastError = err.message }
      renderShell()
    })
  }

  /* ---------- Discoveries ---------- */
  function discoveries() {
    const q = state.q.toLowerCase()
    const list = state.discoveries.filter(d => (state.filter === 'all' || (state.filter === 'pending' && !d.approved) || (state.filter === 'published' && d.approved) || (state.filter === 'featured' && d.featured))
      && (!q || `${d.title} ${d.category} ${d.shopName} ${d.keywords.join(' ')}`.toLowerCase().includes(q)))
    const seg = (id, label) => `<button data-f="${id}" aria-pressed="${state.filter === id}">${label}</button>`
    content().innerHTML = `<h2 class="title">Discoveries</h2>
      <div class="toolbar"><div class="seg">${seg('pending', 'Waiting')}${seg('published', 'Published')}${seg('featured', 'Featured')}${seg('all', 'All')}</div>
        <input type="search" id="dq" placeholder="Search title, shop, keyword…" value="${esc(state.q)}">
        ${state.overview.counts.pending ? '<button class="btn line" id="approveAll">Approve all waiting</button>' : ''}
        <button class="btn line" id="stale">Unpublish stale…</button></div>
      <div class="panel">${list.length ? list.map(discRow).join('') : '<p class="muted">Nothing here.</p>'}</div>`
    content().querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.filter = b.dataset.f; discoveries() })
    const dq = document.getElementById('dq'); dq.oninput = () => { state.q = dq.value; const pos = dq.selectionStart; discoveries(); const n = document.getElementById('dq'); n.focus(); n.setSelectionRange(pos, pos) }
    document.getElementById('approveAll')?.addEventListener('click', async () => { if (!confirm('Publish every discovery that is waiting for review?')) return; const r = await api('/api/admin/discoveries/approve-all', { method: 'POST' }); toast(`${r.changed} published`); refresh() })
    document.getElementById('stale').onclick = async () => {
      const days = prompt('Unpublish discoveries the Radar has not seen for how many days?', '90'); if (!days) return
      const r = await api('/api/admin/discoveries/unpublish-stale', { method: 'POST', body: JSON.stringify({ days: Number(days) }) }); toast(`${r.changed} unpublished (not seen in ${r.days} days)`); refresh()
    }
    content().querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.id))
    content().querySelectorAll('form.edit').forEach(f => f.onsubmit = async e => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(f))
      await patchDisc(f.dataset.id, { title: fd.title, category: fd.category, note: fd.note }); state.editing = null; toast('Saved'); discoveries()
    })
  }
  function discRow(d) {
    const link = d.kind === 'product' ? d.listingUrl : d.shopUrl
    const metrics = Object.entries(d.metrics).slice(0, 4).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')
    return `<div class="disc"><div class="th">${d.image ? `<img src="${esc(d.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}</div>
      <div><b>${esc(d.title)}</b> <span class="st">${d.kind}</span>${d.featured ? ' <span class="st new">featured</span>' : ''}
        <div class="meta">${esc(d.category || 'no category')}${d.shopName && d.kind === 'product' ? ` · ${esc(d.shopName)}` : ''} · found ${esc(day(d.discoveredAt))} · last seen ${esc(day(d.lastSeenAt))}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Etsy ↗</a>` : ' · <i>no Etsy link</i>'}</div>
        ${metrics ? `<div class="meta">${metrics}</div>` : ''}${d.note ? `<div class="meta">Note: ${esc(d.note)}</div>` : ''}</div>
      <div class="acts"><button class="btn tiny line toggle" data-act="approve" data-id="${esc(d.id)}" aria-pressed="${d.approved}">${d.approved ? 'Published' : 'Publish'}</button>
        <button class="btn tiny line toggle feat" data-act="feature" data-id="${esc(d.id)}" aria-pressed="${d.featured}">${d.featured ? 'Featured' : 'Feature'}</button>
        <button class="btn tiny line" data-act="edit" data-id="${esc(d.id)}">Edit</button>
        ${d.approved ? `<a class="btn tiny line" href="/${d.kind === 'product' ? 'products' : 'shops'}/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">View</a>` : ''}
        <button class="btn tiny danger" data-act="delete" data-id="${esc(d.id)}">Delete</button></div>
      ${state.editing === d.id ? `<form class="edit" data-id="${esc(d.id)}"><input type="text" name="title" value="${esc(d.title)}" aria-label="Title"><input type="text" name="category" value="${esc(d.category)}" placeholder="Category" aria-label="Category"><textarea name="note" placeholder="Optional public note from your team (shown on the detail page)" aria-label="Team note">${esc(d.note)}</textarea><div><button class="btn tiny" type="submit">Save</button> <button class="btn tiny line" type="button" data-act="cancel" data-id="">Cancel</button></div></form>` : ''}</div>`
  }
  async function patchDisc(id, patch) {
    const { discovery } = await api(`/api/admin/discoveries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
    state.discoveries = state.discoveries.map(d => d.id === id ? discovery : d)
    state.overview.counts.pending = state.discoveries.filter(d => !d.approved).length
  }
  async function act(kind, id) {
    const d = state.discoveries.find(x => x.id === id)
    try {
      if (kind === 'approve') await patchDisc(id, { approved: !d.approved, ...(d.approved ? { featured: false } : {}) })
      if (kind === 'feature') await patchDisc(id, { featured: !d.featured, ...(!d.featured ? { approved: true } : {}) })
      if (kind === 'edit') state.editing = id
      if (kind === 'cancel') state.editing = null
      if (kind === 'delete') {
        if (!confirm(`Delete "${d.title}"? If the Radar reports it again it will come back as a new, unpublished discovery.`)) return
        await api(`/api/admin/discoveries/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.discoveries = state.discoveries.filter(x => x.id !== id); state.overview.counts.pending = state.discoveries.filter(x => !x.approved).length; toast('Deleted')
      }
      renderShell()
    } catch (err) { toast(err.message) }
  }

  /* ---------- Requests ---------- */
  function contactLink(r) {
    const ref = `Your ${site} workflow request ${r.ref}`
    if (r.contactMethod === 'Email') return `<a class="btn tiny" href="mailto:${esc(r.contact)}?subject=${encodeURIComponent(ref)}">Email ${esc(r.contact)}</a>`
    const digits = r.contact.replace(/\D/g, '').replace(/^0/, '92') // wa.me needs the international form; local 03xx numbers are Pakistani
    if (r.contactMethod === 'WhatsApp') return `<a class="btn tiny" href="https://wa.me/${digits}?text=${encodeURIComponent(`Hi ${r.name.split(' ')[0]}, this is ${site} about request ${r.ref}.`)}" target="_blank" rel="noopener">WhatsApp ${esc(r.contact)}</a>`
    return `<a class="btn tiny" href="tel:${esc(r.contact.replace(/[^\d+]/g, ''))}">Call ${esc(r.contact)}</a>`
  }
  function requests() {
    const list = state.requests.filter(r => state.reqFilter === 'all' || (state.reqFilter === 'open' ? !['completed', 'archived'].includes(r.status) : r.status === state.reqFilter))
    const seg = (id, label) => `<button data-rf="${id}" aria-pressed="${state.reqFilter === id}">${label}</button>`
    content().innerHTML = `<h2 class="title">Workflow requests</h2>
      <div class="toolbar"><div class="seg">${seg('open', 'Open')}${seg('new', 'New')}${seg('completed', 'Completed')}${seg('archived', 'Archived')}${seg('all', 'All')}</div></div>
      ${list.length ? list.map(r => `<article class="req">
        <header><h4>${esc(r.name)} <span class="st ${esc(r.status)}">${esc(r.status)}</span></h4><span class="muted">${esc(r.ref)} · ${esc(when(r.createdAt))}</span></header>
        <div class="row">${contactLink(r)}<span class="muted">prefers ${esc(r.contactMethod)}</span></div>
        ${r.goal ? `<div class="goal">${esc(r.goal)}</div>` : '<div class="muted">No goals or questions given.</div>'}
        ${r.selected.length ? `<div><b>Selections (${r.selected.length})</b><ul>${r.selected.map(s => `<li>${esc(s.title)} <span class="muted">(${esc(s.kind)})</span>${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Etsy ↗</a>` : ''}</li>`).join('')}</ul></div>` : '<div class="muted">No products or shops selected.</div>'}
        <label class="muted" for="n-${esc(r.id)}">Internal notes (never shown to the customer)</label>
        <textarea id="n-${esc(r.id)}" data-notes="${esc(r.id)}">${esc(r.notes)}</textarea>
        <div class="row"><select data-status="${esc(r.id)}" aria-label="Status">${state.statuses.map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select><button class="btn tiny" data-saveReq="${esc(r.id)}">Save</button><span class="muted">Updated ${esc(when(r.updatedAt))}</span></div>
      </article>`).join('') : '<div class="panel"><p class="muted">No requests in this view.</p></div>'}`
    content().querySelectorAll('[data-rf]').forEach(b => b.onclick = () => { state.reqFilter = b.dataset.rf; requests() })
    content().querySelectorAll('[data-savereq]').forEach(b => b.onclick = async () => {
      const id = b.dataset.savereq
      try {
        const { request } = await api(`/api/admin/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: content().querySelector(`[data-status="${id}"]`).value, notes: content().querySelector(`[data-notes="${id}"]`).value }) })
        state.requests = state.requests.map(r => r.id === id ? request : r)
        state.overview.counts.newRequests = state.requests.filter(r => r.status === 'new').length
        toast('Request updated'); renderShell()
      } catch (err) { toast(err.message) }
    })
  }

  /* ---------- Reports ---------- */
  async function reports() {
    const o = state.overview
    const endpoint = `${o.siteUrl || location.origin}/api/radar/reports`
    content().innerHTML = `<h2 class="title">Radar reports</h2>${radarBanner(o)}
      <div class="panel"><h3>Upload a report manually</h3><p class="muted" style="margin-bottom:10px">Use this if the Radar saved a JSON file instead of sending it. New items arrive unpublished unless auto-approve is on.</p>
        <div class="drop" id="drop">Drop a Radar JSON file here, or <label style="text-decoration:underline;cursor:pointer">choose a file<input type="file" id="file" accept=".json,application/json" hidden></label></div><p class="err" id="upErr" role="alert"></p></div>
      <div class="panel"><h3>Connect the Radar</h3><p class="muted" style="margin-bottom:10px">After each daily scan, the Radar sends one POST request. The token is the <code>RADAR_INGEST_TOKEN</code> value in the server's <code>.env</code>. Full field reference: <code>RADAR-INTEGRATION.md</code>.</p>
<pre class="code">POST ${esc(endpoint)}
Authorization: Bearer &lt;RADAR_INGEST_TOKEN&gt;
Content-Type: application/json

{ "generatedAt": "2026-11-01T06:00:00Z",
  "products": [{ "id": "1234567890", "title": "…", "listingUrl": "https://www.etsy.com/listing/…",
                 "image": "https://i.etsystatic.com/…", "shopName": "…", "shopUrl": "https://www.etsy.com/shop/…",
                 "category": "…", "keywords": ["…"], "metrics": { "favorites": 1520 } }],
  "shops":    [{ "id": "ShopName", "title": "ShopName", "shopUrl": "https://www.etsy.com/shop/…", "metrics": { "sales": 4210 } }] }</pre></div>
      <div class="panel"><h3>Report history</h3><div id="hist"><p class="muted">Loading…</p></div></div>`
    const upload = async file => {
      const err = document.getElementById('upErr'); err.textContent = ''
      try {
        const body = JSON.parse(await file.text())
        const r = await api('/api/admin/reports', { method: 'POST', body: JSON.stringify(body) })
        toast(`Imported: ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}`); await refresh()
      } catch (e) { err.textContent = e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message }
    }
    document.getElementById('file').onchange = e => e.target.files[0] && upload(e.target.files[0])
    const drop = document.getElementById('drop')
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over') }
    drop.ondragleave = () => drop.classList.remove('over')
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]) }
    try { const { reports } = await api('/api/admin/reports'); document.getElementById('hist').innerHTML = reportRows(reports) } catch (e) { toast(e.message) }
  }

  /* ---------- Boot ---------- */
  loadAll().then(renderShell).catch(() => renderLogin())
})()
