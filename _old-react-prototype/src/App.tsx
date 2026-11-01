import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronDown, CircleHelp, Compass, Filter, Heart, Leaf, Menu, Search, Send, ShoppingBag, Sparkles, Store, X } from 'lucide-react'

type Discovery = { id: string; title: string; category: string; discoveredAt: string; image?: string; listingUrl?: string; shopName?: string; shopUrl?: string; keywords?: string[]; metrics?: Record<string, string | number> }
type Feed = { products: Discovery[]; shops: Discovery[]; updatedAt?: string; source?: string }
const defaultFeed: Feed = { products: [], shops: [], source: 'Not connected' }
const categories = ['All categories', 'Home & living', 'Jewelry', 'Paper & party', 'Clothing', 'Craft supplies', 'Art & collectibles']

function readFeed(): Feed {
  try { return { ...defaultFeed, ...JSON.parse(localStorage.getItem('foundry-feed') || '{}') } } catch { return defaultFeed }
}

export default function App() {
  const [feed, setFeed] = useState<Feed>(readFeed)
  const [activeTab, setActiveTab] = useState<'products' | 'shops'>('products')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All categories')
  const [saved, setSaved] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('foundry-saved') || '[]') } catch { return [] } })
  const [showSaved, setShowSaved] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [requestSent, setRequestSent] = useState(false)
  const [requestError, setRequestError] = useState('')
  const discoveries = activeTab === 'products' ? feed.products : feed.shops
  const filtered = useMemo(() => discoveries.filter(item => {
    const matchesQuery = `${item.title} ${item.category} ${item.shopName || ''} ${(item.keywords || []).join(' ')}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (category === 'All categories' || item.category === category)
  }), [discoveries, query, category])
  const savedItems = [...feed.products, ...feed.shops].filter(item => saved.includes(item.id))
  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600) }

  function toggleSaved(item: Discovery) {
    const next = saved.includes(item.id) ? saved.filter(id => id !== item.id) : [...saved, item.id]
    setSaved(next); localStorage.setItem('foundry-saved', JSON.stringify(next))
    notify(next.includes(item.id) ? 'Saved to your opportunity list' : 'Removed from your list')
  }
  function openRequest() { setShowSaved(false); setShowRequest(true); setRequestSent(false); setRequestError('') }
  function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const entry = { name: data.get('name'), contact: data.get('contact'), contactMethod: data.get('contactMethod'), goal: data.get('goal'), selected: savedItems.map(item => ({ id: item.id, title: item.title, type: feed.products.some(product => product.id === item.id) ? 'product' : 'shop' })), createdAt: new Date().toISOString() }
    const previous = JSON.parse(localStorage.getItem('foundry-requests') || '[]')
    localStorage.setItem('foundry-requests', JSON.stringify([...previous, entry]))
    setRequestSent(true)
    setRequestError('Your request is saved in this browser. Connect a secure delivery service before launch to receive it as a team.')
  }
  function importFeed(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Feed
        if (!Array.isArray(parsed.products) || !Array.isArray(parsed.shops)) throw new Error('Expected products and shops arrays.')
        const next = { ...parsed, source: file.name }
        localStorage.setItem('foundry-feed', JSON.stringify(next)); setFeed(next); setShowConnect(false); notify('Radar report loaded')
      } catch (error) { setRequestError(error instanceof Error ? error.message : 'Could not read this report.') }
    }
    reader.readAsText(file)
  }
  function navTo(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); setMobileMenu(false) }

  return <div className="site-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Foundry home"><span className="brand-mark"><Leaf size={20} strokeWidth={2.5} /></span><span>foundry<span className="brand-period">.</span></span></a>
      <nav className={mobileMenu ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
        <button onClick={() => navTo('discover')}>Discover</button><button onClick={() => navTo('how-it-works')}>How it works</button><button onClick={() => setShowConnect(true)}>For Radar owners</button>
      </nav>
      <div className="header-actions"><button className="saved-trigger" onClick={() => setShowSaved(true)}><Bookmark size={17} /><span>My list</span>{saved.length > 0 && <b>{saved.length}</b>}</button><button className="contact-top" onClick={openRequest}>Get a workflow <ArrowUpRight size={15} /></button><button className="menu-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle menu">{mobileMenu ? <X /> : <Menu />}</button></div>
    </header>

    <main id="top">
      <section className="hero">
        <div className="hero-copy"><div className="live-note"><span className={feed.products.length || feed.shops.length ? 'live-dot connected' : 'live-dot'} />{feed.products.length || feed.shops.length ? 'Radar report connected' : 'A calmer way to find your next move'}</div>
          <h1>Good ideas are<br />already <em>growing.</em></h1>
          <p className="hero-lede">Find Etsy products and shops gaining momentum. Then turn what catches your eye into a practical first step for your own business.</p>
          <div className="hero-buttons"><button className="button-primary" onClick={() => navTo('discover')}>Explore opportunities <ArrowDown size={16} /></button><button className="text-button" onClick={() => navTo('how-it-works')}>See how it works <ArrowRight size={16} /></button></div>
          <div className="hero-footnote"><span><Check size={14} /> No account needed</span><span><Check size={14} /> No sales promises</span></div>
        </div>
        <div className="hero-art" aria-label="Illustration of a maker’s desk"><div className="art-caption">A good place to begin</div><div className="sun-disc" /><div className="paper-shadow" /><div className="paper"><span className="paper-stamp">FIELD<br />NOTES</span><div className="paper-line long"/><div className="paper-line"/><div className="paper-line short"/><div className="paper-scribble">an idea<br />worth exploring</div><div className="paper-leaf"><Leaf size={75} strokeWidth={1.15} /></div></div><div className="sparkle sparkle-one"><Sparkles size={20}/></div><div className="sparkle sparkle-two">✳</div><div className="art-label">Watch the small things<br />before they become big.</div><div className="art-stem"><i/><i/><i/><i/><i/></div><span className="art-ground" /></div>
      </section>

      <section className="discovery-section" id="discover">
        <div className="section-top"><div><p className="eyebrow">The discovery shelf</p><h2>Worth a closer look</h2><p className="section-intro">Fresh finds from Etsy sellers and categories worth watching.</p></div><button className="feed-status" onClick={() => setShowConnect(true)}><span className={feed.products.length || feed.shops.length ? 'status-dot connected' : 'status-dot'} />{feed.products.length || feed.shops.length ? `${feed.products.length + feed.shops.length} discoveries loaded` : 'Connect a Radar report'}<ArrowUpRight size={14}/></button></div>
        <div className="discovery-controls"><div className="tabs" role="tablist"><button className={activeTab === 'products' ? 'tab active' : 'tab'} onClick={() => setActiveTab('products')} role="tab"><ShoppingBag size={16}/>Products <span>{feed.products.length}</span></button><button className={activeTab === 'shops' ? 'tab active' : 'tab'} onClick={() => setActiveTab('shops')} role="tab"><Store size={16}/>Shops <span>{feed.shops.length}</span></button></div><div className="filters"><label className="search-field"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${activeTab}…`} aria-label={`Search ${activeTab}`} /></label><label className="select-field"><Filter size={15}/><select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter by category">{categories.map(value => <option key={value}>{value}</option>)}</select><ChevronDown size={15}/></label></div></div>
        {filtered.length > 0 ? <div className="discovery-grid">{filtered.map((item, index) => <article className="discovery-card" key={item.id}><div className="discovery-image" style={item.image ? { backgroundImage: `url(${item.image})` } : undefined}>{!item.image && <div className={`image-placeholder tone-${index % 4}`}><span>{item.category || (activeTab === 'products' ? 'Product' : 'Shop')}</span><Sparkles size={31}/></div>}<button className={saved.includes(item.id) ? 'save-button saved' : 'save-button'} onClick={() => toggleSaved(item)} aria-label={saved.includes(item.id) ? 'Remove from list' : 'Save to list'}><Heart size={17} fill={saved.includes(item.id) ? 'currentColor' : 'none'}/></button>{item.discoveredAt && <span className="discovery-date">Found {item.discoveredAt}</span>}</div><div className="discovery-card-body"><div className="card-type">{item.category || (activeTab === 'products' ? 'Etsy product' : 'Etsy shop')}</div><h3>{item.title}</h3>{item.shopName && <p className="seller-line">by {item.shopName}</p>}{item.keywords?.length ? <div className="tag-list">{item.keywords.slice(0, 3).map(word => <span key={word}>{word}</span>)}</div> : null}{item.metrics && <div className="metric-list">{Object.entries(item.metrics).slice(0, 2).map(([key, value]) => <span key={key}>{key}: <b>{value}</b></span>)}</div>}<div className="card-links">{(item.listingUrl || item.shopUrl) && <a href={item.listingUrl || item.shopUrl} target="_blank" rel="noreferrer">View on Etsy <ArrowUpRight size={14}/></a>}<button onClick={() => toggleSaved(item)}>{saved.includes(item.id) ? 'Saved' : 'Save'} <Bookmark size={13}/></button></div></div></article>)}</div> : <div className="empty-shelf"><div className="empty-illustration"><Compass size={26}/><span className="empty-star">✳</span></div><div className="empty-copy"><h3>{query || category !== 'All categories' ? 'No discoveries match that search.' : activeTab === 'products' ? 'Your first discoveries will land here.' : 'No shops in the feed yet.'}</h3><p>{query || category !== 'All categories' ? 'Try another keyword or clear the category filter.' : 'This shelf only shows real opportunities from your Etsy Radar. Connect a report to bring in discoveries.'}</p></div><button className="empty-action" onClick={() => query || category !== 'All categories' ? (setQuery(''), setCategory('All categories')) : setShowConnect(true)}>{query || category !== 'All categories' ? 'Clear filters' : 'Connect Radar'} <ArrowRight size={15}/></button></div>}
        <div className="shelf-note"><CircleHelp size={15}/><span>Trend signals are a starting point for research—not a promise of future sales.</span><button onClick={() => setShowConnect(true)}>About the data <ArrowRight size={14}/></button></div>
      </section>

      <section className="why-section" id="how-it-works"><div className="why-heading"><p className="eyebrow">From curiosity to a first step</p><h2>Find a direction.<br /><em>Make it yours.</em></h2><p>We make the research easier to browse, and help you decide what to do next.</p></div><div className="steps-list"><div className="step-row"><span className="step-icon"><Search size={18}/></span><div><h3>Notice what’s moving</h3><p>Browse real products and shops surfaced by the daily Radar scan.</p></div><span className="step-index">A</span></div><div className="step-row"><span className="step-icon"><Bookmark size={18}/></span><div><h3>Save what feels promising</h3><p>Build a shortlist of ideas you want to explore—no sign-up required.</p></div><span className="step-index">B</span></div><div className="step-row"><span className="step-icon"><Compass size={18}/></span><div><h3>Get a practical next step</h3><p>Ask our team for a grounded workflow tailored to your interests and goals.</p></div><span className="step-index">C</span></div></div></section>

      <section className="closing-cta"><div className="closing-mark"><Leaf size={25}/></div><div><p className="eyebrow">You don’t need the whole plan today</p><h2>Start with one good question.</h2><p>Tell us what you’re exploring. We’ll help shape a practical, affordable way to begin.</p></div><button className="button-dark" onClick={openRequest}>Get your startup workflow <ArrowUpRight size={16}/></button></section>
    </main>
    <footer className="footer"><a className="brand" href="#top"><span className="brand-mark"><Leaf size={17}/></span><span>foundry<span className="brand-period">.</span></span></a><span>Independent research for thoughtful makers.</span><button onClick={() => setShowConnect(true)}>Radar connection</button><small>© {new Date().getFullYear()} Foundry</small></footer>

    {showConnect && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowConnect(false) }}><section className="dialog connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title"><button className="dialog-close" onClick={() => setShowConnect(false)} aria-label="Close"><X size={19}/></button><div className="dialog-icon"><Compass size={21}/></div><p className="eyebrow">For your Radar system</p><h2 id="connect-title">Bring your discoveries in.</h2><p className="dialog-lede">The public website is ready to receive Etsy Radar reports. Until the system is added, no product or shop data is shown.</p><div className="integration-steps"><div><span>1</span><p><b>Export a JSON report</b><br/>Keep discoveries in the format below.</p></div><div><span>2</span><p><b>Load it here for a preview</b><br/>A later server connection can automate delivery.</p></div></div><div className="format-box"><div className="format-heading">Expected report shape <button onClick={() => { navigator.clipboard?.writeText('{ "products": [], "shops": [], "updatedAt": "2026-01-01T00:00:00Z" }'); notify('Format copied') }}>Copy</button></div><code>{`{\n  "products": [{ "id", "title", "category", "image", "listingUrl", "discoveredAt", "keywords", "metrics" }],\n  "shops": [{ "id", "title", "category", "image", "shopUrl", "discoveredAt", "keywords", "metrics" }],\n  "updatedAt": "ISO date"\n}`}</code></div><label className="upload-button">Choose Radar JSON report<input type="file" accept="application/json,.json" onChange={importFeed}/><ArrowUpRight size={15}/></label><p className="privacy-note"><CircleHelp size={13}/>This preview stores report data in this browser only. Do not load private or unapproved information.</p>{requestError && !requestSent && <p className="inline-error">{requestError}</p>}</section></div>}

    {showSaved && <div className="modal-backdrop drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowSaved(false) }}><aside className="saved-drawer" role="dialog" aria-modal="true" aria-labelledby="saved-title"><div className="drawer-header"><div><p className="eyebrow">Your shortlist</p><h2 id="saved-title">My opportunities <span>{savedItems.length}</span></h2></div><button className="dialog-close" onClick={() => setShowSaved(false)} aria-label="Close"><X size={19}/></button></div>{savedItems.length ? <><div className="saved-list">{savedItems.map(item => <div className="saved-item" key={item.id}><span className="saved-thumb">{item.image ? <img src={item.image} alt=""/> : <Sparkles size={18}/>}</span><span><b>{item.title}</b><small>{feed.products.some(product => product.id === item.id) ? 'Product' : 'Shop'}{item.category ? ` · ${item.category}` : ''}</small></span><button onClick={() => toggleSaved(item)} aria-label={`Remove ${item.title}`}><X size={16}/></button></div>)}</div><button className="button-primary drawer-cta" onClick={openRequest}>Get a workflow for these <ArrowRight size={16}/></button></> : <div className="drawer-empty"><Bookmark size={25}/><h3>Your list is ready when you are.</h3><p>Save products and shops that interest you. You can ask our team about them when you’re ready.</p><button className="button-primary" onClick={() => { setShowSaved(false); navTo('discover') }}>Explore discoveries <ArrowRight size={15}/></button></div>}</aside></div>}

    {showRequest && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowRequest(false) }}><section className="dialog request-dialog" role="dialog" aria-modal="true" aria-labelledby="request-title"><button className="dialog-close" onClick={() => setShowRequest(false)} aria-label="Close"><X size={19}/></button>{requestSent ? <div className="success-state"><div className="success-icon"><Check size={26}/></div><p className="eyebrow">Request prepared</p><h2 id="request-title">Your next step starts here.</h2><p>Your request and {savedItems.length} saved {savedItems.length === 1 ? 'opportunity are' : 'opportunities are'} saved in this browser.</p><div className="local-warning">{requestError}</div><button className="button-primary" onClick={() => setShowRequest(false)}>Done <Check size={16}/></button></div> : <><p className="eyebrow">A practical start, built around you</p><h2 id="request-title">Get your startup workflow.</h2><p className="dialog-lede">Share a little about what you’re exploring. We’ll use it to shape a realistic next-step plan.</p><div className="request-selection"><Bookmark size={15}/><span>{savedItems.length ? `${savedItems.length} saved ${savedItems.length === 1 ? 'opportunity' : 'opportunities'} included` : 'No opportunities selected yet'}</span><button onClick={() => { setShowRequest(false); setShowSaved(true) }}>{savedItems.length ? 'Review' : 'Browse'}</button></div><form onSubmit={submitRequest}><label>Your name<input name="name" required placeholder="How should we address you?" /></label><label>Preferred contact method<select name="contactMethod"><option>Email</option><option>WhatsApp</option><option>Phone</option></select></label><label>Contact detail<input name="contact" required placeholder="Email address or phone number" /></label><label>What are you hoping to build?<textarea name="goal" rows={3} placeholder="Your goals, questions, or what caught your eye…" /></label><button className="button-primary submit-request" type="submit">Prepare my request <Send size={15}/></button><p className="form-disclaimer">Your details stay in this browser in this prototype. Secure team delivery must be connected before launch.</p></form></>}</section></div>}
    {toast && <div role="status" className="toast"><Check size={15}/>{toast}</div>}
  </div>
}
