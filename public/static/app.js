// Public site behaviour: reveal-on-scroll, the shortlist drawer (stored in this browser only) and the request form.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const KEY = 'etsscope-list'
  try { // one-time carry-over of lists saved under the site's old name (Foundry)
    const old = localStorage.getItem('foundry-list')
    if (old && !localStorage.getItem(KEY)) localStorage.setItem(KEY, old)
    if (old) localStorage.removeItem('foundry-list')
  } catch {}
  const $ = (s, el = document) => el.querySelector(s)
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  /* ---------- Reveal ---------- */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: .08 }) : null
  document.querySelectorAll('.rv').forEach(el => io ? io.observe(el) : el.classList.add('in'))
  setTimeout(() => document.querySelectorAll('.rv:not(.in)').forEach(el => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in') }), 400)

  /* Rotate published keyword labels without duplicates or extra network calls. */
  const radarLabels = document.querySelector('.radar-keywords')
  if (radarLabels && !reduce) {
    let pool = []
    try { pool = JSON.parse(radarLabels.dataset.radarPool) } catch {}
    const labels = [...radarLabels.querySelectorAll('.radar-keyword')]
    if (labels.length && pool.length > labels.length) setInterval(() => {
      if (document.hidden) return
      const visible = new Set(labels.map(el => el.querySelector('span').textContent))
      const available = pool.filter(title => !visible.has(title))
      if (!available.length) return
      const el = labels[Math.floor(Math.random() * labels.length)]
      const title = available[Math.floor(Math.random() * available.length)]
      el.classList.add('changing')
      setTimeout(() => { el.querySelector('span').textContent = title; el.classList.remove('changing') }, 250)
    }, 2800)
  }

  /* ---------- Shortlist storage ---------- */
  let list = []
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]').filter(i => i && typeof i.id === 'string').slice(0, 50) } catch { list = [] }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {} }
  const has = id => list.some(i => i.id === id)

  const body = document.body, drawer = $('#drawer'), itemsEl = $('#listItems'), countEl = $('#listCount')
  let lastFocus = null
  const thumb = i => i.image ? `<img src="${esc(i.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<svg viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" fill="#e9d8c4"/><circle cx="5" cy="4.6" r="2.3" fill="#c8673c"/></svg>`
  const href = i => `/${i.kind === 'shop' ? 'shops' : 'keywords'}/${encodeURIComponent(i.id)}`
  const row = i => `<div class="item"><a class="thumb" href="${href(i)}">${thumb(i)}</a><div><a href="${href(i)}"><b>${esc(i.title)}</b></a><small>${i.kind === 'shop' ? 'Shop' : 'Keyword'}${i.category ? ' · ' + esc(i.category) : ''}</small></div><button type="button" class="rm" data-remove="${esc(i.id)}" aria-label="Remove ${esc(i.title)}">×</button></div>`

  function render() {
    if (countEl) countEl.textContent = list.length
    if (itemsEl) itemsEl.innerHTML = list.length ? list.map(row).join('') : '<p class="empty-list">Your list is empty.<br>Tap ♡ on any shop or keyword to save it here.</p>'
    const cta = $('#listCta'); if (cta) cta.textContent = list.length ? `Get a workflow for ${list.length} pick${list.length > 1 ? 's' : ''}` : 'Get your startup workflow'
    document.querySelectorAll('[data-save]').forEach(b => {
      let d; try { d = JSON.parse(b.dataset.save) } catch { return }
      const on = has(d.id)
      b.setAttribute('aria-pressed', on)
      const ic = b.querySelector('.ic'), tx = b.querySelector('.tx')
      if (ic) ic.textContent = on ? '♥' : '♡'
      if (tx) tx.textContent = on ? 'Saved to my list' : 'Save to my list'
    })
    const reqList = $('#requestList'), field = $('#selectedField')
    if (reqList) reqList.innerHTML = list.length ? list.map(row).join('') : '<p class="muted">You haven\'t saved anything yet.</p>'
    if (field) field.value = JSON.stringify(list.map(i => i.id))
  }
  function toggle(d) {
    if (has(d.id)) list = list.filter(i => i.id !== d.id)
    else { if (list.length >= 50) return; list.push({ id: d.id, kind: d.kind === 'shop' ? 'shop' : 'product', title: String(d.title).slice(0, 240), image: d.image || '', category: d.category || '' }) }
    save(); render()
    if (countEl) { countEl.classList.add('bump'); setTimeout(() => countEl.classList.remove('bump'), 300) }
  }
  function openList() { if (!drawer) return; lastFocus = document.activeElement; body.classList.add('open', 'lock'); drawer.focus() }
  function closeList() { body.classList.remove('open', 'lock'); if (lastFocus) lastFocus.focus() }

  document.addEventListener('click', e => {
    const s = e.target.closest('[data-save]')
    if (s) { e.preventDefault(); try { toggle(JSON.parse(s.dataset.save)) } catch {} return }
    const r = e.target.closest('[data-remove]')
    if (r) { list = list.filter(i => i.id !== r.dataset.remove); save(); render() }
  })
  $('#listBtn')?.addEventListener('click', openList)
  $('#closeList')?.addEventListener('click', closeList)
  $('#scrim')?.addEventListener('click', closeList)
  addEventListener('keydown', e => { if (e.key === 'Escape' && body.classList.contains('open')) closeList() })
  addEventListener('storage', e => { if (e.key === KEY) { try { list = JSON.parse(e.newValue || '[]') } catch { list = [] } render() } })
  render()

  /* ---------- Request form ---------- */
  const form = $('#requestForm')
  if (form) {
    const label = $('#contactLabel'), field = $('#contactField'), err = $('#formError')
    const setMethod = m => {
      label.textContent = m === 'Email' ? 'Email address' : `${m} number (with country code)`
      field.type = m === 'Email' ? 'email' : 'tel'
      field.inputMode = m === 'Email' ? 'email' : 'tel'
      field.autocomplete = m === 'Email' ? 'email' : 'tel'
      field.placeholder = m === 'Email' ? 'you@example.com' : '+92 300 0000000'
    }
    form.addEventListener('change', e => { if (e.target.name === 'contactMethod') setMethod(e.target.value) })
    setMethod(form.contactMethod.value)
    form.addEventListener('submit', async e => {
      e.preventDefault()
      err.textContent = ''
      const data = Object.fromEntries(new FormData(form))
      data.selected = list.map(i => i.id)
      if (!form.consent.checked) { err.textContent = 'Please tick the box so we can contact you about your request.'; return }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…'
      try {
        const res = await fetch('/request', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(data) })
        const out = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(out.error || 'Something went wrong. Please try again.')
        location.href = out.redirect
      } catch (error) {
        err.textContent = error.message
        btn.disabled = false; btn.textContent = 'Send my request'
      }
    })
  }
})()
