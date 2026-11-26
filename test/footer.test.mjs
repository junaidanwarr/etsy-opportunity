import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp } from './helpers.mjs'

describe('device footer', () => {
  let t, foot
  before(async () => {
    t = await startApp({})
    const body = await (await t.get('/keywords')).text()
    foot = body.match(/<footer class="foot[^"]*"[\s\S]*?<\/footer>/)?.[0] || ''
  })
  after(() => t.close())

  test('the footer is the keyboard device with an LCD strip, a 3D stage and a screen', () => {
    assert.match(foot, /class="device"/)
    assert.match(foot, /class="lcd"/)
    assert.match(foot, /class="scope"/)
  })
  test('the middle stage shows decorative 3D trend art, hidden from screen readers', () => {
    const stage = foot.match(/<div class="stage"[^>]*>/)?.[0] || ''
    assert.match(stage, /aria-hidden="true"/)
    assert.equal((foot.match(/class="bar /g) || []).length, 4, 'four chart bars')
    assert.ok((foot.match(/icon-sculpture/g) || []).length >= 3, 'shop and keyword sculptures')
    assert.ok(!/class="grille"/.test(foot), 'grille replaced')
  })
  test('each key is a link to a main page', () => {
    const keys = [...foot.matchAll(/<a class="key[^"]*" href="([^"]+)"/g)].map(m => m[1])
    for (const href of ['/', '/shops', '/keywords', '/premium', '/#how', '/privacy']) assert.ok(keys.includes(href), href)
  })
  test('keeps the Etsy disclaimer', () => {
    assert.match(foot, /not affiliated with, sponsored or endorsed by Etsy/)
  })
})
