(() => {
  const $ = s => document.querySelector(s)
  const all = s => [...document.querySelectorAll(s)]
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduce) {
    all('.icon-sculpture').forEach(icon => {
      const target = icon.closest('.card,.opportunity-pick') || icon
      target.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return
        const r = icon.getBoundingClientRect()
        icon.style.setProperty('--icon-rx', `${(0.5-(e.clientY-r.top)/r.height)*18}deg`)
        icon.style.setProperty('--icon-ry', `${((e.clientX-r.left)/r.width-0.5)*22}deg`)
        icon.style.setProperty('--icon-lift','-5px')
      }, {passive:true})
      target.addEventListener('pointerleave', () => {
        icon.style.setProperty('--icon-rx','0deg'); icon.style.setProperty('--icon-ry','0deg'); icon.style.setProperty('--icon-lift','0px')
      })
    })
  }

  const stage = $('.opportunity-stage')
  if (stage) {
    const cards = all('.opportunity-card'), panels = all('[data-opportunity-detail]')
    let selected = 0, down = null, dragged = false
    stage.classList.add('enhanced')
    const select = index => {
      selected = Math.max(0, Math.min(cards.length - 1, index))
      cards.forEach((card, i) => {
        const offset = i - selected, distance = Math.abs(offset)
        card.style.setProperty('--offset', offset)
        card.style.setProperty('--distance', distance)
        card.style.setProperty('--layer', 20 - distance)
        card.style.setProperty('--visibility', distance > 2 ? 0 : 1 - distance * .19)
        card.inert = distance > 2
        card.classList.toggle('selected', i === selected)
        card.querySelector('button').setAttribute('aria-pressed', i === selected)
      })
      panels.forEach((panel, i) => panel.hidden = i !== selected)
      $('#carousel-position').textContent = `${selected + 1} / ${cards.length}`
      all('[data-carousel-step]').forEach(b => b.disabled = +b.dataset.carouselStep < 0 ? selected === 0 : selected === cards.length - 1)
    }
    all('[data-carousel-step]').forEach(b => b.addEventListener('click', () => select(selected + Number(b.dataset.carouselStep))))
    stage.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); select(e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : selected + (e.key === 'ArrowRight' ? 1 : -1)) } })
    stage.addEventListener('click', e => { if (dragged) { e.preventDefault(); dragged = false; return }; const card = e.target.closest('[data-index]'); if (card) select(Number(card.dataset.index)) })
    stage.addEventListener('pointerdown', e => { if (e.button !== 0) return; down = { x:e.clientX, y:e.clientY, id:e.pointerId }; dragged = false })
    stage.addEventListener('pointermove', e => { if (!down) return; if (Math.abs(e.clientX - down.x) > 12 && Math.abs(e.clientX - down.x) > Math.abs(e.clientY - down.y)) { dragged = true; stage.classList.add('dragging'); stage.setPointerCapture(e.pointerId) } })
    stage.addEventListener('pointerup', e => { if (down && dragged) select(selected + (e.clientX < down.x ? 1 : -1)); down = null; stage.classList.remove('dragging') })
    stage.addEventListener('pointercancel', () => { down = null; dragged = false; stage.classList.remove('dragging') })
    stage.addEventListener('dragstart', e => e.preventDefault())
    select(0)
  }

  const globe = $('#globe'), preview = $('.globe-preview')
  if (globe && preview) {
    all('[data-globe-filter]').forEach(button => button.addEventListener('click', () => {
      const filter = button.dataset.globeFilter
      all('[data-globe-filter]').forEach(b => b.setAttribute('aria-pressed', b === button))
      all('.globe-tag').forEach(tag => tag.hidden = filter !== 'all' && !tag.classList.contains(filter))
      globe.dispatchEvent(new Event('globe-update'))
    }))
    const pause = $('[data-globe-pause]')
    if (reduce) { globe.dataset.paused = 'true'; pause.setAttribute('aria-pressed','true'); pause.textContent = 'Motion reduced'; pause.disabled = true }
    pause.addEventListener('click', () => {
      const paused = globe.dataset.paused !== 'true'
      globe.dataset.paused = String(paused); pause.setAttribute('aria-pressed', paused)
      pause.textContent = paused ? 'Resume rotation' : 'Pause rotation'
      globe.dispatchEvent(new Event('globe-update'))
    })
    globe.addEventListener('click', e => {
      const tag = e.target.closest('.globe-tag')
      if (!tag || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey) return
      e.preventDefault()
      let item; try { item = JSON.parse(tag.dataset.preview) } catch { return }
      all('.globe-tag').forEach(t => t.classList.toggle('selected', t === tag))
      preview.replaceChildren()
      const type = document.createElement('span'); type.className = 'kicker'; type.textContent = item.kind === 'shop' ? 'Shop preview' : 'Keyword preview'
      const title = document.createElement('h3'); title.textContent = item.title
      const category = document.createElement('p'); category.textContent = item.category || 'Published Etsy research'
      const actions = document.createElement('div'); actions.className = 'ctas'
      const link = document.createElement('a'); link.className = 'btn'; link.href = tag.href; link.textContent = 'View research'
      const save = document.createElement('button'); save.type = 'button'; save.className = 'btn line'; save.dataset.save = JSON.stringify(item); save.setAttribute('aria-label', `Save ${item.title} to my list`)
      const icon = document.createElement('span'); icon.className = 'ic'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '♡'
      const label = document.createElement('span'); label.className = 'tx'; label.textContent = 'Save to my list'
      save.append(icon, label); actions.append(link, save); preview.append(type, title, category, actions)
      document.dispatchEvent(new Event('shortlist-refresh'))
    })
  }

  all('[data-desk-step]').forEach(button => button.addEventListener('click', () => {
    all('[data-desk-step]').forEach(b => b.setAttribute('aria-pressed', b === button))
    all('[data-desk-panel]').forEach(p => p.hidden = p.dataset.deskPanel !== button.dataset.deskStep)
  }))

  let toastTimer
  document.addEventListener('shortlist-added', e => {
    const {button,item} = e.detail
    let toast = $('.save-toast')
    if (!toast) { toast = document.createElement('div'); toast.className = 'save-toast'; toast.setAttribute('role','status'); document.body.append(toast) }
    toast.textContent = `${item.title} saved to My list`; toast.hidden = false
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 3000)
    const bag = $('#listBtn'); if (!bag || reduce) return
    const start = button.getBoundingClientRect(), end = bag.getBoundingClientRect()
    const flight = document.createElement('div'); flight.className = 'save-flight'; flight.setAttribute('aria-hidden','true')
    const source = button.closest('.card')?.querySelector('.pic img,.pic svg') || (button.closest('.opportunity-details') ? document.querySelector('.opportunity-card.selected img,.opportunity-card.selected svg') : null)
    if (source) flight.append(source.cloneNode(true)); else flight.textContent = '♥'
    flight.style.left = `${start.left}px`; flight.style.top = `${start.top}px`; document.body.append(flight)
    const dx = end.left + end.width / 2 - start.left - 29, dy = end.top + end.height / 2 - start.top - 29
    flight.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx*.45}px,${dy*.55-65}px) scale(.8)`,opacity:1},{transform:`translate(${dx}px,${dy}px) scale(.15)`,opacity:.3}], {duration:700,easing:'cubic-bezier(.3,.1,.3,1)'}).finished.then(() => { flight.remove(); bag.animate([{transform:'scale(1)'},{transform:'scale(1.09)'},{transform:'scale(1)'}],{duration:300}) })
  })

  if (!reduce && matchMedia('(hover:hover) and (pointer:fine)').matches) {
    document.addEventListener('pointermove', e => {
      const surface = e.target.closest('.opportunity-pick,.desk-object')
      if (!surface) return
      const r = surface.getBoundingClientRect(); surface.style.setProperty('--light-x',`${(e.clientX-r.left)/r.width*100}%`); surface.style.setProperty('--light-y',`${(e.clientY-r.top)/r.height*100}%`)
    },{passive:true})
  }
})()
