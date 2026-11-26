# TDD evidence: Premium membership (PKR 6,500 / 4 months, manual-verify checkout)

**Source plan:** the plan approved in chat on 23 Nov 2026 (homepage section + `/premium` page, Easypaisa / JazzCash with manual admin verification (bank transfer removed 26 Nov 2026), keyword and title sets for 30 listings a month). No `*.plan.md` file.
**Branch:** `feat/premium-membership`
**Runner:** Node built-in `node:test` (`npm test`, `npm run test:coverage`), no new dependencies.

## User journeys
1. As a visitor, I see the Premium benefits and the PKR 6,500 price on the homepage and on `/premium`.
2. As a buyer, I pick Easypaisa or JazzCash, pay to the account shown, submit my transaction ID and details, and get an order reference and an email.
3. As the owner, I verify or reject each order in `/admin`. Verifying starts a 4-month membership and emails the buyer.

## Checkpoints (all on `feat/premium-membership`)
| Stage | Commit | Evidence |
|---|---|---|
| RED (unit) | `0f6e873` | `npm test` failed with `ERR_MODULE_NOT_FOUND` for `lib/premium.mjs` (not yet written) |
| GREEN (unit) | `78ea613` | `npm test`: 29 tests, 29 pass, 0 fail |
| RED (HTTP) | `d436f2d` | `npm test`: 48 tests, 29 pass, 14 fail, 5 cancelled (no premium section, page, routes or admin API yet) |
| GREEN (HTTP) | `628f5c0` | `npm test`: 48 tests, 48 pass, 0 fail |
| Refactor | `9b87ae3` | `npm test`: 49 tests, 49 pass, 0 fail |

## What is guaranteed
| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | The five benefits are listed in the agreed order | `premium.unit` / lists the five agreed benefits | unit | PASS |
| 2 | Price defaults to PKR 6,500; a bad `PREMIUM_PRICE_PKR` is ignored | `premiumConfigFromEnv` tests | unit | PASS |
| 3 | A payment method only appears when all its account details are set | `premiumConfigFromEnv` + "hides methods with no account details" | unit + http | PASS |
| 4 | Membership end date = start + 4 calendar months (end-of-month and leap-year safe) | `addMonths` tests, "verifying starts a 4-month membership" | unit + http | PASS |
| 5 | Checkout rejects missing or invalid name, email, WhatsApp, method, transaction ID, payer account or consent | `validateCheckout` rejects ... (8 cases) | unit | PASS |
| 6 | The amount always comes from the server, never the form | "never takes an amount from the form", "the amount always comes from the server" | unit + http | PASS |
| 7 | A transaction ID can only be used once (409) | store + "a reused transaction ID is refused with 409" | unit + http | PASS |
| 8 | Cross-site posts are blocked (403); more than 5 checkouts per hour per IP get 429 | "cross-site form posts are blocked", "more than 5 checkouts an hour" | http | PASS |
| 9 | With no payment details set, the page says payments are not open and checkout returns 503 | "checkout with no payment methods set" | http | PASS |
| 10 | Account details from settings are HTML-escaped | "escapes account details taken from settings" | http | PASS |
| 11 | A valid checkout redirects to a thank-you page with the reference and emails both the team and the buyer | "a valid checkout creates a pending order ..." | http | PASS |
| 12 | Admin order endpoints need sign-in; unknown action 400, unknown order 404, re-verify 409 | admin premium orders suite | http | PASS |
| 13 | Verifying emails the buyer that membership is active | "verifying starts a 4-month membership and emails the buyer" | http | PASS |
| 14 | Homepage, nav, sitemap and privacy note include Premium | premium pages suite | http | PASS |

## Coverage (`npm run test:coverage`)
- `lib/premium.mjs`: 100% lines, 97.4% branches. `lib/dates.mjs`: 100%.
- New Premium code in `app.mjs`, `db.mjs` and `views.mjs` is exercised by the HTTP suite. The one uncovered Premium line is the re-throw of unexpected database errors in `/premium/checkout`.
- Whole-repo totals (about 62% lines) are pulled down by older features that had no tests before this change (Radar import, listings, detail pages). They are out of scope here.

## Manual check (local preview, fake payment details in a git-ignored `.env`)
- `/premium` on desktop and at 375px wide: all three payment cards visible, no horizontal scroll.
- Submitted test order PM-USQW4 (Easypaisa, made-up transaction ID) -> thank-you page with reference -> admin Premium tab showed it as pending -> Verify -> active from 23 Nov 2026 to 23 Mar 2027.

## Known gaps / follow-ups
- Admin UI (`public/static/admin.js`) has no automated browser test. It was checked by hand above.
- Monthly benefits are delivered by the team by hand. There is no member login or members area.
- JazzCash / Easypaisa gateway APIs can be added later as further payment methods once merchant accounts exist.
