// Minimal SMTP client (no dependencies). Supports implicit TLS (port 465) and STARTTLS (port 587) with AUTH LOGIN.
// Enough for sending team alerts through a normal mailbox such as cPanel/Namecheap, Gmail or Brevo.
import net from 'node:net'
import tls from 'node:tls'
import { randomBytes } from 'node:crypto'

const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim() // blocks header injection
const b64 = v => Buffer.from(String(v), 'utf8').toString('base64')
const encodeHeader = v => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n')

export function mailConfigFromEnv(env) {
  const port = Number(env.SMTP_PORT) || 465
  return {
    host: env.SMTP_HOST || '', port, user: env.SMTP_USER || '', pass: env.SMTP_PASS || '',
    secure: env.SMTP_SECURE ? env.SMTP_SECURE : port === 465 ? 'tls' : 'starttls', // tls | starttls | none (none: localhost testing only)
    from: env.MAIL_FROM || env.SMTP_USER || '', to: env.NOTIFY_EMAIL || '',
  }
}
export const mailReady = c => Boolean(c.host && c.from && c.to && (c.secure === 'none' || (c.user && c.pass)))

export function sendMail(cfg, { to, subject, text, replyTo }) {
  if (cfg.secure === 'none' && !['127.0.0.1', 'localhost', '::1'].includes(cfg.host)) return Promise.reject(new Error('Unencrypted SMTP is only allowed to localhost.'))
  const recipients = clean(to).split(/\s*,\s*/).filter(Boolean)
  const fromAddr = clean(cfg.from).match(/<([^>]+)>/)?.[1] || clean(cfg.from)
  const msg = [
    `From: ${clean(cfg.from)}`, `To: ${recipients.join(', ')}`, ...(replyTo ? [`Reply-To: ${clean(replyTo)}`] : []),
    `Subject: ${encodeHeader(clean(subject))}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${fromAddr.split('@')[1] || 'localhost'}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
  ].join('\r\n')

  return new Promise((resolve, reject) => {
    let socket, buffer = '', waiter = null, done = false
    const finish = err => { if (done) return; done = true; clearTimeout(timer); try { socket?.end() } catch {} err ? reject(err) : resolve() }
    const timer = setTimeout(() => finish(new Error('SMTP timed out after 20 s.')), 20_000)
    const onData = chunk => {
      buffer += chunk.toString('utf8')
      // A reply is complete when its last line has "NNN " (space, not dash) after the code.
      const lines = buffer.split('\r\n'); const last = lines[lines.length - 2]
      if (last && /^\d{3} /.test(last) && waiter) { const reply = buffer; buffer = ''; const w = waiter; waiter = null; w(reply) }
    }
    const read = () => new Promise(r => { waiter = r; onData(Buffer.alloc(0)) })
    const cmd = async (line, ok, label = line.split(' ')[0]) => {
      if (line !== null) socket.write(line + '\r\n')
      const reply = await read(), code = Number(reply.slice(0, 3))
      if (!ok.includes(code)) throw new Error(`SMTP ${label} failed: ${reply.trim().split('\r\n').pop()}`)
      return reply
    }
    const attach = s => { socket = s; s.on('data', onData); s.on('error', e => finish(new Error(`SMTP connection error: ${e.message}`))) }
    const connectOpts = { host: cfg.host, port: cfg.port, servername: cfg.host }
    attach(cfg.secure === 'tls' ? tls.connect(connectOpts) : net.connect(connectOpts))
    ;(async () => {
      await cmd(null, [220], 'greeting')
      const ehlo = await cmd(`EHLO ${fromAddr.split('@')[1] || 'localhost'}`, [250])
      if (cfg.secure === 'starttls') {
        if (!/STARTTLS/i.test(ehlo)) throw new Error('Server does not offer STARTTLS.')
        await cmd('STARTTLS', [220])
        socket.removeAllListeners('data')
        await new Promise((ok, fail) => { const t = tls.connect({ socket, servername: cfg.host }, ok); t.once('error', fail); attach(t) })
        await cmd(`EHLO ${fromAddr.split('@')[1] || 'localhost'}`, [250])
      }
      if (cfg.user) {
        await cmd('AUTH LOGIN', [334])
        await cmd(b64(cfg.user), [334], 'AUTH (username)')
        await cmd(b64(cfg.pass), [235], 'AUTH (password)')
      }
      await cmd(`MAIL FROM:<${fromAddr}>`, [250], 'MAIL FROM')
      for (const r of recipients) await cmd(`RCPT TO:<${r.match(/<([^>]+)>/)?.[1] || r}>`, [250, 251], 'RCPT TO')
      await cmd('DATA', [354])
      await cmd(msg.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250], 'message')
      socket.write('QUIT\r\n')
      finish()
    })().catch(finish)
  })
}
