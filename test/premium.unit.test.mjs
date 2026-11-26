import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PREMIUM_BENEFITS, PREMIUM_MONTHS, addMonths, formatPkr, premiumConfigFromEnv, validateCheckout, orderReceivedEmail, membershipActiveEmail } from '../lib/premium.mjs'
import { ensureSchema, makePremiumOrders, openDatabase } from '../lib/db.mjs'
import { PAY_ENV } from './helpers.mjs'

describe('premium constants', () => {
  test('lists the five agreed benefits in order', () => {
    assert.deepEqual(PREMIUM_BENEFITS, ['4-month membership', 'Keyword and title sets for 30 listings a month', 'Trending keywords', 'Ready-to-publish titles', 'Digital product prompt packs'])
  })
  test('membership lasts 4 months', () => assert.equal(PREMIUM_MONTHS, 4))
  test('formats rupees with thousands separators', () => assert.equal(formatPkr(6500), 'PKR 6,500'))
})

describe('addMonths', () => {
  test('keeps the same day when it exists', () => assert.equal(addMonths('2026-01-15T10:00:00.000Z', 4).toISOString(), '2026-05-15T10:00:00.000Z'))
  test('clamps to the last day of a shorter month', () => assert.equal(addMonths('2026-10-31T10:00:00.000Z', 4).toISOString(), '2027-02-28T10:00:00.000Z'))
  test('handles leap years', () => assert.equal(addMonths('2027-10-31T10:00:00.000Z', 4).toISOString(), '2028-02-29T10:00:00.000Z'))
})

describe('premiumConfigFromEnv', () => {
  test('defaults the price to PKR 6,500 and has no payment methods without details', () => {
    const c = premiumConfigFromEnv({})
    assert.equal(c.pricePkr, 6500)
    assert.deepEqual(c.methods, [])
  })
  test('ignores an invalid price', () => assert.equal(premiumConfigFromEnv({ PREMIUM_PRICE_PKR: 'abc' }).pricePkr, 6500))
  test('reads a custom whole-rupee price', () => assert.equal(premiumConfigFromEnv({ PREMIUM_PRICE_PKR: '7000' }).pricePkr, 7000))
  test('only offers methods whose account details are set', () => {
    const c = premiumConfigFromEnv({ PAY_EASYPAISA_NUMBER: '03000000000', PAY_EASYPAISA_TITLE: 'Title', PAY_BANK_NAME: 'Bank only, no IBAN' })
    assert.deepEqual(c.methods.map(m => m.id), ['easypaisa'])
  })
  test('offers only Easypaisa and JazzCash, ignoring bank settings even when they are set', () => {
    const c = premiumConfigFromEnv(PAY_ENV)
    assert.deepEqual(c.methods.map(m => m.id), ['easypaisa', 'jazzcash'])
    assert.deepEqual(c.methods.map(m => m.label), ['Easypaisa', 'JazzCash'])
    assert.ok(c.methods[1].details.some(([k, v]) => k === 'JazzCash number' && v === PAY_ENV.PAY_JAZZCASH_NUMBER))
  })
})

describe('validateCheckout', () => {
  const methods = ['easypaisa', 'jazzcash']
  const good = { name: 'Ayesha Khan', email: 'ayesha@example.com', whatsapp: '+92 300 1234567', method: 'easypaisa', transactionId: ' tx 9a8b-7c6d ', payerAccount: 'Ayesha 0300', consent: 'yes' }
  test('accepts a complete checkout and normalises the transaction ID', () => {
    const r = validateCheckout(good, methods)
    assert.equal(r.ok, true)
    assert.equal(r.data.transactionId, 'TX9A8B-7C6D')
    assert.equal(r.data.method, 'easypaisa')
  })
  test('never takes an amount from the form', () => {
    const r = validateCheckout({ ...good, amount: '1', amountPkr: '1' }, methods)
    assert.equal(r.ok, true)
    assert.equal('amount' in r.data || 'amountPkr' in r.data, false)
  })
  const bad = [
    ['a missing name', { name: ' ' }, /name/i],
    ['an invalid email', { email: 'not-an-email' }, /email/i],
    ['a short WhatsApp number', { whatsapp: '12345' }, /WhatsApp/i],
    ['an unconfigured method', { method: 'paypal' }, /payment method/i],
    ['a transaction ID with odd characters', { transactionId: '<script>' }, /transaction ID/i],
    ['a too-short transaction ID', { transactionId: 'AB1' }, /transaction ID/i],
    ['no sender account', { payerAccount: '' }, /account/i],
    ['no consent', { consent: '' }, /agree/i],
  ]
  for (const [label, change, message] of bad) test(`rejects ${label}`, () => {
    const r = validateCheckout({ ...good, ...change }, methods)
    assert.equal(r.ok, false)
    assert.match(r.error, message)
  })
})

describe('emails', () => {
  const order = { ref: 'PM-ABC23', name: 'Ayesha Khan', email: 'ayesha@example.com', whatsapp: '+923001234567', method: 'easypaisa', amountPkr: 6500, transactionId: 'TX9A8B7C6D', payerAccount: 'Ayesha', status: 'pending', startsAt: null, expiresAt: null }
  test('order-received email names the reference, amount and method', () => {
    const m = orderReceivedEmail(order, { siteName: 'Etsscope', methodLabel: 'Easypaisa' })
    assert.equal(m.to, 'ayesha@example.com')
    assert.match(m.subject, /PM-ABC23/)
    for (const s of ['PM-ABC23', 'PKR 6,500', 'Easypaisa', 'TX9A8B7C6D']) assert.ok(m.text.includes(s), s)
  })
  test('membership-active email gives the end date', () => {
    const m = membershipActiveEmail({ ...order, status: 'verified', startsAt: '2026-11-23T10:00:00.000Z', expiresAt: '2027-03-23T10:00:00.000Z' }, { siteName: 'Etsscope' })
    assert.equal(m.to, 'ayesha@example.com')
    assert.match(m.text, /23 March 2027/)
  })
})

describe('premium orders store', () => {
  const root = mkdtempSync(join(tmpdir(), 'etsscope-store-'))
  const db = openDatabase(root, { DATABASE_PATH: join(root, 'store.sqlite') })
  const orders = makePremiumOrders(db)
  const base = { name: 'Ayesha', email: 'a@example.com', whatsapp: '+923001234567', method: 'easypaisa', amountPkr: 6500, payerAccount: 'Ayesha' }
  after(() => { db.close(); try { rmSync(root, { recursive: true, force: true }) } catch {} })

  test('creates a pending order with a PM- reference', async () => {
    await ensureSchema(db)
    const { id, ref } = await orders.create({ ...base, transactionId: 'TXN000111' })
    assert.match(ref, /^PM-[A-Z2-9]{5}$/)
    const o = await orders.byRef(ref)
    assert.equal(o.id, id)
    assert.equal(o.status, 'pending')
    assert.equal(o.amountPkr, 6500)
    assert.equal(o.startsAt, null)
  })
  test('refuses a transaction ID that was already used', async () => {
    await ensureSchema(db)
    await orders.create({ ...base, transactionId: 'TXN222333' })
    await assert.rejects(orders.create({ ...base, transactionId: 'TXN222333' }), err => err.code === 'DUPLICATE_TRANSACTION')
  })
  test('verifying starts a 4-month membership', async () => {
    await ensureSchema(db)
    const { id } = await orders.create({ ...base, transactionId: 'TXN444555' })
    const r = await orders.setStatus(id, 'verify', 'Matched statement')
    assert.equal(r.order.status, 'verified')
    assert.equal(r.order.notes, 'Matched statement')
    assert.equal(r.order.expiresAt, addMonths(r.order.startsAt, 4).toISOString())
  })
  test('an order cannot be verified twice', async () => {
    await ensureSchema(db)
    const { id } = await orders.create({ ...base, transactionId: 'TXN666777' })
    await orders.setStatus(id, 'verify')
    assert.deepEqual(await orders.setStatus(id, 'verify'), { error: 'invalid_transition' })
  })
  test('rejecting sets no membership dates', async () => {
    await ensureSchema(db)
    const { id } = await orders.create({ ...base, transactionId: 'TXN888999' })
    const r = await orders.setStatus(id, 'reject', 'Not on statement')
    assert.equal(r.order.status, 'rejected')
    assert.equal(r.order.expiresAt, null)
  })
  test('unknown orders and actions are reported', async () => {
    await ensureSchema(db)
    assert.deepEqual(await orders.setStatus('nope', 'verify'), { error: 'not_found' })
    const { id } = await orders.create({ ...base, transactionId: 'TXN121212' })
    assert.deepEqual(await orders.setStatus(id, 'refund'), { error: 'invalid_action' })
  })
})
