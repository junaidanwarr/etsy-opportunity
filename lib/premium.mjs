// Premium membership: benefits, price and payment-method config, checkout validation and emails.
// Payment is manual: the buyer pays to an account set in env, submits the transaction ID, and admin verifies it.
import { safeText } from './db.mjs'
import { addMonths } from './dates.mjs'

export { addMonths }

export const PREMIUM_MONTHS = 4
export const PREMIUM_BENEFITS = [
  '4-month membership',
  'Keyword and title sets for 30 listings a month',
  'Trending keywords',
  'Ready-to-publish titles',
  'Digital product prompt packs',
]
export const DEFAULT_PRICE_PKR = 6500

export const formatPkr = amount => `PKR ${Number(amount).toLocaleString('en-US')}`

/** Price and the payment methods that have their account details set. Account details only ever come from env. */
export function premiumConfigFromEnv(env) {
  const price = Number(env.PREMIUM_PRICE_PKR)
  const v = key => safeText(env[key] || '', 120)
  const methods = [
    v('PAY_BANK_NAME') && v('PAY_BANK_ACCOUNT_TITLE') && v('PAY_BANK_IBAN') && { id: 'bank', label: 'Bank transfer',
      details: [['Bank', v('PAY_BANK_NAME')], ['Account title', v('PAY_BANK_ACCOUNT_TITLE')], ['IBAN', v('PAY_BANK_IBAN')], ...(v('PAY_BANK_ACCOUNT_NUMBER') ? [['Account number', v('PAY_BANK_ACCOUNT_NUMBER')]] : [])] },
    v('PAY_EASYPAISA_NUMBER') && v('PAY_EASYPAISA_TITLE') && { id: 'easypaisa', label: 'Easypaisa',
      details: [['Easypaisa number', v('PAY_EASYPAISA_NUMBER')], ['Account title', v('PAY_EASYPAISA_TITLE')]] },
    v('PAY_JAZZCASH_NUMBER') && v('PAY_JAZZCASH_TITLE') && { id: 'jazzcash', label: 'JazzCash',
      details: [['JazzCash number', v('PAY_JAZZCASH_NUMBER')], ['Account title', v('PAY_JAZZCASH_TITLE')]] },
  ].filter(Boolean)
  return { pricePkr: Number.isInteger(price) && price > 0 ? price : DEFAULT_PRICE_PKR, months: PREMIUM_MONTHS, methods }
}

/** Validate the checkout form. The amount is never read from the form; the server sets it. */
export function validateCheckout(body, methodIds) {
  const fail = error => ({ ok: false, error })
  const name = safeText(body.name, 120), email = safeText(body.email, 200), whatsapp = safeText(body.whatsapp, 40)
  const method = safeText(body.method, 20), payerAccount = safeText(body.payerAccount, 120)
  const transactionId = safeText(body.transactionId, 80).toUpperCase().replace(/\s+/g, '')
  if (name.length < 2) return fail('Please enter your name.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Please enter a valid email address.')
  if (whatsapp.replace(/\D/g, '').length < 10) return fail('Please enter your WhatsApp number, including the country code.')
  if (!methodIds.includes(method)) return fail('Please choose a payment method.')
  if (!/^[A-Z0-9-]{6,40}$/.test(transactionId)) return fail('Please enter the transaction ID from your payment receipt (letters and numbers, at least 6).')
  if (payerAccount.length < 2) return fail('Please enter the name or number of the account you paid from.')
  if (body.consent !== 'yes' && body.consent !== true) return fail('Please agree to the membership terms.')
  return { ok: true, data: { name, email, whatsapp, method, transactionId, payerAccount } }
}

const longDate = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' })

export function orderReceivedEmail(order, { siteName, methodLabel }) {
  return {
    to: order.email,
    subject: `${siteName} Premium: payment received for checking (${order.ref})`,
    text: [`Hi ${order.name.split(' ')[0]},`, '',
      `Thank you for joining ${siteName} Premium. We have your order and will check your payment.`, '',
      `Order reference: ${order.ref}`, `Amount: ${formatPkr(order.amountPkr)}`, `Paid by: ${methodLabel}`, `Transaction ID: ${order.transactionId}`, '',
      `Once we find the payment in our account, your ${PREMIUM_MONTHS}-month membership starts and we will email you again.`,
      'If anything looks wrong, reply to this email and quote your order reference.'].join('\n'),
  }
}

export function teamOrderEmail(order, { siteName, methodLabel, adminUrl, to }) {
  return {
    to, replyTo: order.email,
    subject: `New Premium order ${order.ref} from ${order.name} (${formatPkr(order.amountPkr)})`,
    text: [`New ${siteName} Premium order ${order.ref}`, '',
      `Name: ${order.name}`, `Email: ${order.email}`, `WhatsApp: ${order.whatsapp}`, '',
      `Amount due: ${formatPkr(order.amountPkr)}`, `Method: ${methodLabel}`, `Transaction ID: ${order.transactionId}`, `Paid from: ${order.payerAccount}`, '',
      `Check your ${methodLabel} statement for this payment, then verify or reject it in admin: ${adminUrl}`].join('\n'),
  }
}

export function membershipActiveEmail(order, { siteName }) {
  return {
    to: order.email,
    subject: `${siteName} Premium is active (${order.ref})`,
    text: [`Hi ${order.name.split(' ')[0]},`, '',
      `We found your payment. Your ${siteName} Premium membership is now active until ${longDate(order.expiresAt)}.`, '',
      'Each month you get:', ...PREMIUM_BENEFITS.slice(1).map(b => `- ${b}`), '',
      'Our team will contact you on WhatsApp or email with your first set.', `Order reference: ${order.ref}`].join('\n'),
  }
}
