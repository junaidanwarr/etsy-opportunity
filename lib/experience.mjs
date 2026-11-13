export function renderExplorers(items, { esc, image, saveBtn, metricChips, allShops = [] }) {
  const href = p => `/${p.kind === 'shop' ? 'shops' : 'keywords'}/${encodeURIComponent(p.id)}`
  const picks = items.slice(0, 12)
  const sourceCategory = p => allShops.find(s => p.sourceShopIds?.includes(s.id) && s.category)?.category || p.category || 'Uncategorised'
  const mapItems = items.filter(p => p.kind !== 'shop').slice(0, 48)
  const categories = [...new Set(mapItems.map(sourceCategory))]
  const carousel = picks.length ? `<section class="opportunities" id="opportunities"><div class="wrap">
    <div class="experience-heading"><div><p class="kicker">Your next idea starts here</p><h2>A closer look at this week's finds</h2></div><p>Drag the cards to explore. Bring an idea forward, then see the research behind it.</p></div>
    <div class="opportunity-stage" aria-label="Opportunity carousel" tabindex="0"><div class="opportunity-track">${picks.map((p, i) => `<article class="opportunity-card" data-index="${i}"><button class="opportunity-pick" type="button" aria-label="Select ${esc(p.title)}">${image(p)}<span>${esc(p.kind === 'shop' ? 'Shop' : 'Keyword')}</span><h3>${esc(p.title)}</h3></button></article>`).join('')}</div></div>
    <div class="carousel-controls"><button class="round-control" data-carousel-step="-1" aria-label="Previous opportunity">←</button><p id="carousel-position" aria-live="polite"></p><button class="round-control" data-carousel-step="1" aria-label="Next opportunity">→</button></div>
    <div class="opportunity-details">${picks.map((p, i) => `<div data-opportunity-detail="${i}" ${i ? 'hidden' : ''}><div><span class="kicker">${esc(p.category || (p.kind === 'shop' ? 'Etsy shop' : 'Etsy keyword'))}</span><h3>${esc(p.title)}</h3>${metricChips(p, 3)}</div><div class="ctas"><a class="btn" href="${href(p)}">View research</a>${saveBtn(p, 'btn line')}</div></div>`).join('')}</div>
  </div></section>` : ''
  const constellation = categories.length ? `<section class="constellation-section" id="categories"><div class="wrap"><div class="experience-heading"><div><p class="kicker">Find your direction</p><h2>Follow a thread of ideas</h2></div><p>Explore a selection of published keywords, grouped by the recorded category of their first linked shop. Select a category to follow its ideas.</p></div>
  <div class="category-filters" aria-label="Keyword categories"><button type="button" data-category="*" aria-pressed="true">All categories</button>${categories.map(c => `<button type="button" data-category="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}</div>
  <div class="constellation" aria-label="Keyword category constellation"><svg class="constellation-lines" aria-hidden="true" viewBox="0 0 1000 540" preserveAspectRatio="none"></svg>${mapItems.map(p => `<a class="constellation-node" data-category="${esc(sourceCategory(p))}" href="${href(p)}">${esc(p.title)}</a>`).join('')}</div><p class="category-summary" aria-live="polite"></p><a class="constellation-more" href="/keywords">Browse all keywords →</a></div></section>` : ''
  return { carousel, constellation }
}

export function renderDesk(esc) {
  const steps = [
    ['Research sheet', 'We research Etsy', 'Explore the published keywords and shops, then open the research for anything that interests you.', 'Browse keywords', '/keywords', 'sheet'],
    ['Review card', 'We review the finds', 'Our team checks discoveries before they are published. Compare the reported details and visit the original Etsy pages as part of your research.', 'Explore shops', '/shops', 'review'],
    ['Shortlist folder', 'You shortlist ideas', 'Save keywords and shops with the heart button. Your shortlist stays in this browser, ready when you want a workflow.', 'Browse ideas', '#opportunities', 'folder'],
    ['Workflow booklet', 'We send a workflow', 'Send us your shortlist and goals. Our team will contact you with a practical plan and a price before any work begins.', 'Request a workflow', '/request', 'booklet']
  ]
  return `<section class="workflow-desk" id="how"><div class="wrap"><div class="experience-heading"><div><p class="kicker">How it works</p><h2>From a discovery to your first step</h2></div><p>Four steps, laid out on your desk. Pick up an object to see what comes next.</p></div><div class="desk-surface"><div class="desk-grain" aria-hidden="true"></div>${steps.map(([object, title, , , , cls], i) => `<button type="button" class="desk-object ${cls}" data-desk-step="${i}" aria-pressed="${i === 0}" aria-controls="desk-detail"><span class="desk-number">0${i + 1}</span><span class="object-drawing" aria-hidden="true">${i === 0 ? '▤' : i === 1 ? '✓' : i === 2 ? '♡' : 'E'}</span><strong>${object}</strong><small>${title}</small></button>`).join('')}</div><div class="desk-detail" id="desk-detail" aria-live="polite">${steps.map(([,title,text,label,href],i)=>`<div data-desk-panel="${i}" ${i ? 'hidden' : ''}><span class="desk-detail-number">0${i+1}</span><div><h3>${title}</h3><p>${esc(text)}</p></div><a class="btn line" href="${href}">${label}</a></div>`).join('')}</div></div></section>`
}
