import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp, PAY_ENV, PNG, PDF, validCheckout } from './helpers.mjs'
import { MAX_PROOF_BYTES, detectProof } from '../lib/premium.mjs'

describe('detectProof', () => {
  test('recognises JPG, PNG, WebP and PDF by content', () => {
    assert.equal(detectProof(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).mime, 'image/jpeg')
    assert.equal(detectProof(PNG).mime, 'image/png')
    assert.equal(detectProof(Buffer.from('RIFF0000WEBPVP8 ')).mime, 'image/webp')
    assert.equal(detectProof(PDF).mime, 'application/pdf')
  })
  test('refuses SVG, HTML and empty files', () => {
    for (const s of ['<svg onload="x">', '<html>', '', 'RIFF0000AVI ']) assert.equal(detectProof(Buffer.from(s)), null)
  })
})

describe('proof upload', () => {
  let t, n = 0
  // A fresh app per test keeps the 5-per-hour limit out of the way.
  const fresh = async fn => { t = await startApp({ ...PAY_ENV }); try { await fn() } finally { await t.close() } }
  const fields = () => validCheckout({ transactionId: `PROOF-${1000 + n++}` })
  const orders = async cookie => (await (await t.get('/api/admin/premium-orders', { cookie })).json()).orders

  test('the form accepts a file', () => fresh(async () => {
    const body = await (await t.get('/premium')).text()
    assert.match(body, /enctype="multipart\/form-data"/)
    assert.match(body, /type="file" name="proof"[^>]*required/)
    assert.match(await (await t.get('/privacy')).text(), /payment proof/)
  }))
  test('a proof is stored and comes back byte for byte, admin only', () => fresh(async () => {
    assert.equal((await t.checkout(fields())).status, 303)
    const cookie = await t.adminCookie()
    const [order] = await orders(cookie)
    assert.equal(order.proofMime, 'image/png')
    const url = `/api/admin/premium-orders/${order.id}/proof`
    assert.equal((await t.get(url)).status, 401)
    const res = await t.get(url, { cookie })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('content-security-policy'), /sandbox/)
    assert.match(res.headers.get('cache-control'), /no-store/)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
    assert.equal((await t.get('/api/admin/premium-orders/nope/proof', { cookie })).status, 404)
  }))
  test('a PDF is served as a download', () => fresh(async () => {
    assert.equal((await t.checkout(fields(), {}, { data: PDF, name: '../../x.pdf', type: 'text/html' })).status, 303)
    const cookie = await t.adminCookie(), [order] = await orders(cookie)
    const res = await t.get(`/api/admin/premium-orders/${order.id}/proof`, { cookie })
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="${order.ref}.pdf"`)
  }))
  test('a missing, empty or disguised file is refused and saves no order', () => fresh(async () => {
    for (const file of [null, { data: '', name: 'a.png', type: 'image/png' }, { data: '<script>alert(1)</script>', name: 'a.png', type: 'image/png' }]) {
      const res = await t.checkout(fields(), {}, file)
      assert.equal(res.status, 400)
      assert.match(await res.text(), /payment proof/i)
    }
    assert.equal((await orders(await t.adminCookie())).length, 0)
  }))
  test('the old urlencoded form cannot skip the proof', () => fresh(async () => {
    assert.equal((await t.post('/premium/checkout', fields())).status, 400)
  }))
  test('files over the limit get a readable 413', () => fresh(async () => {
    const res = await t.checkout(fields(), {}, { data: Buffer.concat([PNG, Buffer.alloc(MAX_PROOF_BYTES)]), name: 'big.png', type: 'image/png' })
    assert.equal(res.status, 413)
    assert.match(await res.text(), /4 MB/)
  }))
  test('a reused transaction ID leaves the first proof untouched', () => fresh(async () => {
    const f = fields()
    await t.checkout(f)
    assert.equal((await t.checkout(f, {}, { data: PDF, name: 'b.pdf', type: 'application/pdf' })).status, 409)
    const list = await orders(await t.adminCookie())
    assert.deepEqual(list.map(o => o.proofMime), ['image/png'])
  }))
})
