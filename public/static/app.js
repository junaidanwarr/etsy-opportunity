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
  const countUp = el => {
    const end = Number(el.dataset.count)
    if (reduce || !Number.isFinite(end) || end <= 0) return
    const t0 = performance.now(), dur = 1400
    const tick = now => { const p = Math.min((now - t0) / dur, 1); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString(); if (p < 1) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }
  const reveal = el => { el.classList.add('in'); el.querySelectorAll('[data-count]').forEach(countUp) }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target) } }), { threshold: .08 }) : null
  document.querySelectorAll('.rv, .rv-path').forEach(el => io ? io.observe(el) : reveal(el))
  setTimeout(() => document.querySelectorAll('.rv:not(.in), .rv-path:not(.in)').forEach(el => { if (el.getBoundingClientRect().top < innerHeight) reveal(el) }), 400)

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

  /* ---------- Cards tilt toward the pointer (mouse only) ---------- */
  if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let cur = null
    const drop = () => { if (cur) { cur.classList.remove('is-tilt'); cur = null } }
    document.addEventListener('pointermove', e => {
      const card = e.target.closest ? e.target.closest('.card') : null
      if (card !== cur) { drop(); cur = card; if (cur) cur.classList.add('is-tilt') }
      if (!cur) return
      const r = cur.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
      cur.style.setProperty('--tx', ((x - .5) * 11).toFixed(2) + 'deg')
      cur.style.setProperty('--ty', ((.5 - y) * 9).toFixed(2) + 'deg')
      cur.style.setProperty('--gx', (x * 100).toFixed(1) + '%')
      cur.style.setProperty('--gy', (y * 100 * r.height / (cur.querySelector('.pic')?.offsetHeight || r.height)).toFixed(1) + '%')
    }, { passive: true })
    document.addEventListener('pointerleave', drop)
    addEventListener('blur', drop)
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

  /* ---------- Scroll scenes: feed each tall section its own progress (0 to 1) as --p ---------- */
  const scrubs = [...document.querySelectorAll('[data-scrub]')]
  if (scrubs.length && !reduce) {
    const wide = matchMedia('(min-width: 1081px)') // the deck deals into four columns, which only exist above this width
    let ticking = false
    const update = () => {
      ticking = false
      for (const s of scrubs) {
        if (!s.classList.contains('live')) continue
        const r = s.getBoundingClientRect(), span = r.height - (innerHeight - 68)
        const p = span > 0 ? Math.max(0, Math.min(1, (68 - r.top) / span)) : 0
        if (s._p !== p) { s._p = p; s.style.setProperty('--p', p.toFixed(4)) }
      }
    }
    // The card deck needs room to deal sideways, so it only runs on wide screens.
    const setLive = () => { scrubs.forEach(s => s.classList.toggle('live', s.id !== 'how' || wide.matches)); update() }
    wide.addEventListener('change', setLive)
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update) } }, { passive: true })
    addEventListener('resize', update)
    setLive()
  }

  /* ---------- Globe of keywords and shops: spins slowly, drag to turn it ---------- */
  const globe = $('#globe')
  if (globe && globe.children.length) {
    const tags = [...globe.querySelectorAll('.globe-tag')], n = tags.length
    // Coarse land map: for each 6-degree band of latitude (north to south), the longitude ranges that are land.
    const LAND = [[], [[-90, -65], [-60, -20]], [[-120, -80], [-60, -20], [55, 65], [90, 110]], [[-163, -68], [-52, -22], [15, 180]],
      [[-165, -93], [-78, -65], [-50, -41], [-23, -14], [6, 178]], [[-160, -153], [-135, -95], [-78, -62], [-6, -2], [9, 140], [156, 162]],
      [[-128, -56], [-10, 1], [3, 140], [142, 143], [155, 158]], [[-124, -62], [-1, 135], [141, 145]], [[-123, -75], [-9, 0], [13, 17], [20, 24], [27, 122], [126, 129], [139, 141]],
      [[-117, -80], [-8, 25], [35, 121], [131, 136]], [[-113, -97], [-82, -80], [-13, 34], [36, 120]], [[-105, -97], [-90, -87], [-84, -75], [-17, 37], [39, 58], [70, 87], [92, 110]],
      [[-97, -84], [-17, 40], [43, 52], [74, 80], [96, 109], [120, 124]], [[-84, -61], [-13, 50], [76, 80], [99, 106], [123, 126]], [[-78, -51], [9, 46], [96, 104], [109, 118]],
      [[-80, -40], [10, 41], [101, 106], [110, 117], [119, 122], [131, 141]], [[-79, -35], [13, 40], [106, 115], [141, 148]], [[-76, -39], [12, 40], [47, 50], [124, 136], [142, 145]],
      [[-70, -40], [14, 35], [44, 48], [115, 149]], [[-71, -48], [15, 33], [114, 153]], [[-72, -53], [18, 28], [116, 124], [134, 151]], [[-73, -62], [141, 147], [175, 177]],
      [[-74, -66], [145, 148], [168, 171]], [[-74, -69]], [], [[-62, -57]], [[-70, -62], [-10, 160]], [[-150, 170]], [[-180, 180]], [[-180, 180]]]
    const land = []
    for (let lat = 86; lat >= -86; lat -= 3.6) {
      const bands = LAND[Math.min(29, Math.floor((90 - lat) / 6))], c = Math.cos(lat * Math.PI / 180), stepLon = 3.6 / Math.max(c, .12)
      for (let lon = -180; lon < 180; lon += stepLon) {
        if (bands.some(([a, b]) => lon >= a && lon <= b)) { const l = lon * Math.PI / 180; land.push({ x: c * Math.sin(l), y: -Math.sin(lat * Math.PI / 180), z: c * Math.cos(l) }) }
      }
    }
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
    canvas.setAttribute('aria-hidden', 'true')
    globe.prepend(canvas)
    let size = 0
    const gcd = (a, b) => b ? gcd(b, a % b) : a
    const stride = [17, 13, 11, 7, 5, 3, 1].find(s => gcd(s, n) === 1) // spreads shops among keywords
    const pts = tags.map((el, i) => {
      const k = (i * stride) % n, y = 1 - (k + .5) * 2 / n, r = Math.sqrt(1 - y * y), a = k * 2.39996
      return { el, x: Math.cos(a) * r, y, z: Math.sin(a) * r }
    })
    const AUTO = reduce ? 0 : .0022
    let vy = AUTO, vx = 0, raf = 0, visible = false, hold = false, drag = null, suppressClick = false
    const draw = () => {
      const R = globe.clientWidth * .41, cy = Math.cos(vy), sy = Math.sin(vy), cx = Math.cos(vx), sx = Math.sin(vx)
      for (const p of pts) {
        const x = p.x * cy + p.z * sy, z0 = p.z * cy - p.x * sy
        const y = p.y * cx - z0 * sx, z = p.y * sx + z0 * cx
        p.x = x; p.y = y; p.z = z
        const depth = (z + 1) / 2
        p.el.style.transform = `translate(-50%,-50%) translate3d(${(x * R).toFixed(1)}px,${(y * R).toFixed(1)}px,0) scale(${(.66 + .44 * depth).toFixed(3)})`
        p.el.style.opacity = Math.max(0, Math.min(1, (z + .12) * 3)).toFixed(2) // tags behind the globe are hidden by it
        p.el.style.zIndex = Math.round(depth * 100) + 1
        p.el.style.pointerEvents = z > .1 ? '' : 'none'
      }
      // The globe itself: a shaded sphere with the continents as dots, turning with the tags.
      const w = globe.clientWidth, dpr = Math.min(devicePixelRatio || 1, 2)
      if (w !== size) { size = w; canvas.width = canvas.height = Math.round(w * dpr) }
      const c = w / 2, G = w * .36
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, w)
      const sea = ctx.createRadialGradient(c - G * .35, c - G * .4, G * .1, c, c, G)
      sea.addColorStop(0, '#fdfaf4'); sea.addColorStop(.7, '#efe2d2'); sea.addColorStop(1, '#dcc8b2')
      ctx.beginPath(); ctx.arc(c, c, G, 0, 7); ctx.fillStyle = sea; ctx.fill()
      ctx.strokeStyle = 'rgba(121,90,69,.25)'; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = '#c8673c'
      const dot = G * .021
      for (const p of land) {
        const x = p.x * cy + p.z * sy, z0 = p.z * cy - p.x * sy
        const y = p.y * cx - z0 * sx, z = p.y * sx + z0 * cx
        p.x = x; p.y = y; p.z = z
        if (z <= .02) continue
        ctx.globalAlpha = .25 + .6 * z
        ctx.beginPath(); ctx.arc(c + x * G, c + y * G, dot * (.55 + .45 * z), 0, 7); ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    const frame = () => {
      raf = 0
      if (!drag?.live) { const rest = hold ? 0 : AUTO; vy += (rest - vy) * .04; vx *= .94 }
      draw()
      if (visible && (Math.abs(vy) > .0002 || Math.abs(vx) > .0002 || drag?.live)) kick()
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame) }
    globe.classList.add('live')
    draw()
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick() }).observe(globe)
    else { visible = true; kick() }
    globe.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') hold = true })
    globe.addEventListener('pointerleave', () => { hold = false; kick() })
    globe.addEventListener('focusin', () => { hold = true })
    globe.addEventListener('focusout', () => { hold = false; kick() })
    globe.addEventListener('pointerdown', e => { if (e.button === 0) { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, live: false, id: e.pointerId, touch: e.pointerType === 'touch' }; suppressClick = false } })
    globe.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return
      if (!drag.live && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) { drag.live = true; suppressClick = true; globe.classList.add('dragging'); try { globe.setPointerCapture(e.pointerId) } catch {} }
      if (!drag.live) return
      const lim = v => Math.max(-.12, Math.min(.12, v))
      vy = lim((e.clientX - drag.x) * .006); vx = drag.touch ? 0 : lim((e.clientY - drag.y) * -.006)
      drag.x = e.clientX; drag.y = e.clientY; kick()
    })
    const endDrag = () => { if (drag) { drag = null; globe.classList.remove('dragging'); kick() } }
    globe.addEventListener('pointerup', endDrag)
    globe.addEventListener('pointercancel', endDrag)
    globe.addEventListener('click', e => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false } }, true)
  }

  /* ---------- Weighted wheel scrolling (mouse only; touch, keyboard and nested scrollers are left alone) ---------- */
  if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let target = 0, cur = 0, running = false
    const run = () => {
      cur += (target - cur) * .14
      if (Math.abs(target - cur) < .5) { cur = target; running = false }
      scrollTo({ top: cur, behavior: 'instant' })
      if (running) requestAnimationFrame(run)
    }
    addEventListener('wheel', e => {
      if (e.ctrlKey || e.defaultPrevented || document.body.classList.contains('lock') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      for (let el = e.target; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return
      }
      e.preventDefault()
      if (!running) cur = target = scrollY
      const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY
      target = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, target + d))
      if (!running) { running = true; requestAnimationFrame(run) }
    }, { passive: false })
  }

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
