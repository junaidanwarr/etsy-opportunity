import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp, PAY_ENV, MAIL_ENV, validCheckout } from './helpers.mjs'
import { PREMIUM_BENEFITS, addMonths } from '../lib/premium.mjs'

const htmlText = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')

describe('premium pages', () => {
  let t
  before(async () => { t = await startApp({ ...PAY_ENV }) })
  after(() => t.close())

  test('homepage has a Premium section with all benefits, the price and a link to /premium', async () => {
    const body = htmlText(await (await t.get('/')).text())
    assert.match(body, /<section class="premium[^"]*" id="premium"/)
    for (const b of PREMIUM_BENEFITS) assert.ok(body.includes(b), b)
    assert.ok(body.includes('PKR 6,500'))
    assert.match(body, /href="\/premium"/)
  })
  test('main navigation links to Premium', async () => {
    assert.match(await (await t.get('/keywords')).text(), /<nav class="links"[^>]*>.*href="\/premium"[^>]*>Premium</s)
  })
  test('/premium shows benefits, price, every configured payment method and the checkout form', async () => {
    const res = await t.get('/premium')
    assert.equal(res.status, 200)
    const body = htmlText(await res.text())
    for (const b of PREMIUM_BENEFITS) assert.ok(body.includes(b), b)
    for (const s of ['PKR 6,500', 'Bank transfer', 'Easypaisa', 'JazzCash', PAY_ENV.PAY_BANK_IBAN, PAY_ENV.PAY_EASYPAISA_TITLE, PAY_ENV.PAY_JAZZCASH_NUMBER]) assert.ok(body.includes(s), s)
    assert.match(body, /<form[^>]+action="\/premium\/checkout"/)
    for (const f of ['name', 'email', 'whatsapp', 'method', 'transactionId', 'payerAccount', 'consent']) assert.match(body, new RegExp(`name="${f}"`), f)
  })
  test('the privacy note explains what Premium payments store', async () => {
    assert.match(await (await t.get('/privacy')).text(), /Premium payments\.<\/b>.*transaction ID/s)
  })
  test('sitemap lists /premium', async () => {
    assert.match(await (await t.get('/sitemap.xml')).text(), /\/premium<\/loc>/)
  })
})

describe('premium page without payment details', () => {
  let t
  before(async () => { t = await startApp({ PAY_EASYPAISA_NUMBER: '03000000000', PAY_EASYPAISA_TITLE: '<b>Shady & Co</b>' }) })
  after(() => t.close())

  test('hides methods with no account details', async () => {
    const body = await (await t.get('/premium')).text()
    assert.ok(body.includes('Easypaisa'))
    assert.ok(!body.includes('JazzCash number'))
    assert.ok(!body.includes('IBAN'))
  })
  test('escapes account details taken from settings', async () => {
    const body = await (await t.get('/premium')).text()
    assert.ok(body.includes('&lt;b&gt;Shady &amp; Co&lt;/b&gt;'))
    assert.ok(!body.includes('<b>Shady'))
  })
})

describe('premium checkout', () => {
  let t
  before(async () => { t = await startApp({ ...PAY_ENV, ...MAIL_ENV }) })
  after(() => t.close())

  test('a valid checkout creates a pending order, emails team and buyer, and shows the reference', async () => {
    const res = await t.checkout(validCheckout({ transactionId: 'EP12345678', amount: '1' }))
    assert.equal(res.status, 303)
    const location = res.headers.get('location')
    const ref = location.match(/ref=(PM-[A-Z2-9]{5})/)?.[1]
    assert.ok(ref, location)
    const page = htmlText(await (await t.get(location)).text())
    for (const s of [ref, 'PKR 6,500', 'Easypaisa']) assert.ok(page.includes(s), s)
    const toTeam = t.sent.find(m => m.to === MAIL_ENV.NOTIFY_EMAIL && m.subject.includes(ref))
    const toBuyer = t.sent.find(m => m.to === 'ayesha@example.com' && m.subject.includes(ref))
    assert.ok(toTeam, 'team email')
    assert.ok(toBuyer, 'buyer email')
    assert.ok(toTeam.text.includes('EP12345678'))
  })
  test('the amount always comes from the server, never the form', async () => {
    const res = await t.checkout(validCheckout({ transactionId: 'EP-AMOUNT-1', amount: '1', amountPkr: '1' }))
    const ref = res.headers.get('location').match(/ref=(PM-\w+)/)[1]
    const cookie = await t.adminCookie()
    const { orders } = await (await t.get('/api/admin/premium-orders', { cookie })).json()
    assert.equal(orders.find(o => o.ref === ref).amountPkr, 6500)
  })
  test('a reused transaction ID is refused with 409', async () => {
    await t.checkout(validCheckout({ transactionId: 'EP-DUP-777' }))
    const res = await t.checkout(validCheckout({ transactionId: 'ep dup 777'.replace(/ /g, '-') }))
    assert.equal(res.status, 409)
    assert.match(await res.text(), /already been used/)
  })
  test('invalid input gets a 400 with a helpful message', async () => {
    const res = await t.checkout(validCheckout({ method: 'paypal', transactionId: 'EP-BAD-METHOD' }))
    assert.equal(res.status, 400)
    assert.match(await res.text(), /payment method/i)
  })
  test('cross-site form posts are blocked', async () => {
    const res = await t.checkout(validCheckout({ transactionId: 'EP-CSRF-001' }), { origin: 'https://evil.example' })
    assert.equal(res.status, 403)
  })
  test('the thanks page only shows real references', async () => {
    const res = await t.get('/premium/thanks?ref=PM-NOPE2')
    assert.equal(res.status, 303)
  })
})

describe('premium checkout limits', () => {
  let t
  before(async () => { t = await startApp({ ...PAY_ENV }) })
  after(() => t.close())

  test('more than 5 checkouts an hour from one address are refused', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await t.checkout(validCheckout({ transactionId: `EP-RATE-00${i}` }))).status, 303)
    assert.equal((await t.checkout(validCheckout({ transactionId: 'EP-RATE-999' }))).status, 429)
  })
})

describe('checkout with no payment methods set', () => {
  let t
  before(async () => { t = await startApp({}) })
  after(() => t.close())

  test('the page says payments are not open yet and checkout is refused', async () => {
    assert.match(await (await t.get('/premium')).text(), /not open yet/i)
    assert.equal((await t.checkout(validCheckout())).status, 503)
  })
})

describe('admin premium orders', () => {
  let t, cookie, orderId, ref
  before(async () => {
    t = await startApp({ ...PAY_ENV, ...MAIL_ENV })
    const res = await t.checkout(validCheckout({ transactionId: 'JC-ADMIN-01', method: 'jazzcash' }))
    ref = res.headers.get('location').match(/ref=(PM-\w+)/)[1]
    cookie = await t.adminCookie()
    orderId = (await (await t.get('/api/admin/premium-orders', { cookie })).json()).orders.find(o => o.ref === ref).id
  })
  after(() => t.close())
  const patch = (id, body, headers = {}) => fetch(`${t.base}/api/admin/premium-orders/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) })

  test('listing orders needs the admin sign-in', async () => {
    assert.equal((await t.get('/api/admin/premium-orders')).status, 401)
  })
  test('the overview counts pending Premium orders', async () => {
    const o = await (await t.get('/api/admin/overview', { cookie })).json()
    assert.equal(o.counts.pendingPremium, 1)
  })
  test('unknown actions and orders are refused', async () => {
    assert.equal((await patch(orderId, { action: 'refund' })).status, 400)
    assert.equal((await patch('missing-id', { action: 'verify' })).status, 404)
  })
  test('verifying starts a 4-month membership and emails the buyer', async () => {
    const res = await patch(orderId, { action: 'verify', notes: 'Seen on JazzCash statement' })
    assert.equal(res.status, 200)
    const { order } = await res.json()
    assert.equal(order.status, 'verified')
    assert.equal(order.expiresAt, addMonths(order.startsAt, 4).toISOString())
    assert.ok(t.sent.some(m => m.to === 'ayesha@example.com' && /is active/.test(m.subject) && m.subject.includes(ref)))
  })
  test('a verified order cannot be verified again', async () => {
    assert.equal((await patch(orderId, { action: 'verify' })).status, 409)
  })
})
