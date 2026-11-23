// Shared test helpers: a throwaway app on a random port with its own SQLite file.
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../lib/app.mjs'

// Fake payment details used only by tests.
export const PAY_ENV = {
  PAY_BANK_NAME: 'Test Bank', PAY_BANK_ACCOUNT_TITLE: 'Test Account Title', PAY_BANK_IBAN: 'PK00TEST0000000000000000',
  PAY_EASYPAISA_NUMBER: '03000000000', PAY_EASYPAISA_TITLE: 'Test Easypaisa Title',
  PAY_JAZZCASH_NUMBER: '03110000000', PAY_JAZZCASH_TITLE: 'Test JazzCash Title',
}
export const MAIL_ENV = { SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'robot', SMTP_PASS: 'secret', MAIL_FROM: 'robot@test.invalid', NOTIFY_EMAIL: 'team@test.invalid' }
export const ADMIN_PASSWORD = 'test-admin-password'

export async function startApp(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'etsscope-test-'))
  const sent = []
  const app = createApp(root, { DATABASE_PATH: join(root, 'test.sqlite'), ADMIN_PASSWORD, ...env }, { sendMail: async (_cfg, message) => { sent.push(message) } })
  const server = createServer(app.handler)
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base, sent, app,
    get: (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' }),
    post: (path, fields, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() }),
    async adminCookie() {
      const res = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }) })
      return String(res.headers.get('set-cookie')).split(';')[0]
    },
    async close() {
      await new Promise(ok => server.close(ok))
      app.db.close()
      try { rmSync(root, { recursive: true, force: true }) } catch {}
    },
  }
}

export const validCheckout = (overrides = {}) => ({
  name: 'Ayesha Khan', email: 'ayesha@example.com', whatsapp: '+92 300 1234567', method: 'easypaisa',
  transactionId: 'tx 9a8b7c6d', payerAccount: 'Ayesha Khan 0300xxxx567', consent: 'yes', ...overrides,
})
