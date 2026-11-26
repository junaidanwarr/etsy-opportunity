import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp, PAY_ENV } from './helpers.mjs'

describe('request page without the contact form', () => {
  let t
  before(async () => { t = await startApp({ ...PAY_ENV }) })
  after(() => t.close())

  test('the page still loads but the contact form and selections are gone', async () => {
    const res = await t.get('/request')
    assert.equal(res.status, 200)
    const body = await res.text()
    for (const s of ['id="requestForm"', 'name="contactMethod"', 'Send my request', 'id="requestList"']) assert.ok(!body.includes(s), `no ${s}`)
  })
  test('the heading and intro describe Premium, not the old workflow request', async () => {
    const body = (await (await t.get('/request')).text()).replace(/&#39;/g, "'")
    assert.match(body, /<title>Get started with Premium — /)
    assert.match(body, /<h1[^>]*>Get started with <span class="it">Premium<\/span><\/h1>/)
    assert.ok(body.includes('Watch the two short videos below'))
    const head = body.slice(body.indexOf('<section class="page-head">'), body.indexOf('</section>', body.indexOf('<section class="page-head">')))
    for (const s of ['Get your startup', 'Tell us a little about yourself', 'reviews your selections']) assert.ok(!head.includes(s), `no ${s}`)
  })
  test('it sends visitors to the Premium page instead', async () => {
    assert.match(await (await t.get('/request')).text(), /<a class="btn" href="\/premium">/)
  })
  test('old form posts no longer create requests and go to Premium', async () => {
    const res = await t.post('/request', { name: 'Ayesha', contactMethod: 'Email', contact: 'a@example.com', consent: 'yes' })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/premium')
    const cookie = await t.adminCookie()
    assert.equal((await (await t.get('/api/admin/requests', { cookie })).json()).requests.length, 0)
  })
})
