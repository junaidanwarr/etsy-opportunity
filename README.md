# Foundry: Etsy trend discovery site

The public website for the Etsy Surveillance Radar. Visitors browse trending Etsy products and shops, save the ones they like to a list (no account needed), and send that list to your team as a **startup workflow request**. Your team reviews Radar reports, publishes discoveries and works through requests in a small admin area.

The design follows the Kiln template: warm paper tones, Bricolage Grotesque with Newsreader italics, and a slide-in drawer (Kiln's cart) used here as the opportunity list.

- **No build step, one dependency** (`@libsql/client`). Data lives in **Turso** in production (`TURSO_DATABASE_URL`), or in a local SQLite file (`data/foundry.sqlite`) when that isn't set.
- **Runs on Vercel** (serverless, see **DEPLOY-VERCEL.md**) or as a normal Node server (`npm start`) on any VPS.
- **Server-rendered pages**, so search engines see real content: meta descriptions, Open Graph tags, canonical URLs, `sitemap.xml`, `robots.txt` and breadcrumb structured data.
- **Only real Radar data is shown.** Nothing is published until it is approved (or `AUTO_APPROVE=true`), and missing fields stay missing.

## Run it locally

```bash
cp .env.example .env
```

```bash
npm run load-samples
```

```bash
npm run dev
```

Then open http://localhost:4174, and http://localhost:4174/admin with the `ADMIN_PASSWORD` from `.env`.

The local database currently holds **real research data**: 34 shops and 11 best-selling products from research sheet batch 12 (`samples/research-batch-12.json`, loadable with `npm run load-research`). Each item has its real Etsy link, sales/rating/review figures, and the researcher's reason as the team note. The sheet has no images, so cards use category placeholder art until the Radar supplies image URLs. The researcher's name and phone number from the sheet header are deliberately not imported.

`npm run load-samples` instead adds 12 clearly marked **[Sample]** fictional items with no Etsy links. They land unpublished like any real report: approve them in admin to see the site filled in. Remove them before launch with `npm run clear-samples`.

## What's where

| Path | What it does |
|---|---|
| `lib/app.mjs` | The whole site as one request handler: routes, security headers, admin, Radar ingest, email alerts |
| `server.mjs` | Local / VPS entry (`npm run dev`, `npm start`) |
| `api/index.mjs`, `vercel.json` | Vercel entry: every non-static path is rewritten to the handler |
| `lib/db.mjs` | Schema, report import (one atomic batch), requests, plus admin sessions and rate limits stored in the DB |
| `lib/views.mjs` | All public HTML pages |
| `lib/mail.mjs` | Built-in SMTP client for the email alerts |
| `public/static/` | `styles.css`, `app.js` (list drawer + request form), `admin.js`/`admin.css` (served by Vercel's CDN) |
| `scripts/` | `import-report.mjs` (CLI import), `clear-samples.mjs`, `migrate-to-turso.mjs` |
| `DEPLOY-VERCEL.md` | **Step-by-step Vercel + Turso deployment** |
| `RADAR-INTEGRATION.md` | **How the Radar sends reports**, plus the field reference |
| `deploy/` | Caddy (HTTPS) and systemd files |
| `_old-react-prototype/` | The earlier React mock-up, kept for reference; not used |

## Pages

`/` home · `/products` and `/shops` (search, category, date and archive filters, sort by any numeric Radar metric, pagination) · `/products/:id` and `/shops/:id` (details, Etsy link, latest metrics, trend history, related items) · `/request` (workflow request) · `/request/thanks` (reference number and next steps) · `/privacy` · `/admin`.

## The visitor journey

1. The Radar posts its daily report (see `RADAR-INTEGRATION.md`).
2. New discoveries wait in *Admin → Discoveries*. Publish them, feature the best ones on the home page, add an optional public note.
3. Visitors browse, filter, and tap ♡ to save products and shops (stored in their browser).
4. They open their list and choose **Get your startup workflow**: name, contact method (Email, WhatsApp or Phone), contact detail, goals, consent.
5. The server stores the request with its current titles and Etsy links (it re-checks each item, so a visitor can't inject fake selections), shows a reference such as `FD-7K3QX`, and optionally pings your team webhook.
6. In *Admin → Requests* your team sees the picks, contacts the visitor in one click (mailto / WhatsApp / tel), keeps internal notes and moves the status from new → reviewing → contacted → completed.

## Email alerts for new requests

Each new workflow request is emailed to `NOTIFY_EMAIL` (team@100daysforai.com) with the visitor's name, contact details (plus a ready WhatsApp link for WhatsApp contacts), goals and selected Etsy links. For email contacts the alert's Reply-To is the visitor, so pressing Reply answers them directly. The email is sent in the background, so visitors never wait for it. A failed send is logged and shown in *Admin → Overview*, and the request is always saved in admin either way.

It sends through your own mailbox using the built-in SMTP client (`lib/mail.mjs`, no dependencies). The settings are already in `.env`. Only `SMTP_PASS` is missing: put the team@100daysforai.com mailbox password there, restart, then press **Send a test email** in *Admin → Overview*.

Why `premium164.web-hosting.com` and not `mail.100daysforai.com`: the domain uses Cloudflare, which proxies web traffic only, so `mail.100daysforai.com` can't carry email. The Namecheap server name was confirmed live on ports 465 and 587, with a valid certificate and `AUTH LOGIN` support. If Namecheap ever moves your account to another server, the new name is in cPanel → Email Accounts → Connect Devices.

## Deploy on your own domain

**Vercel + Turso (free tiers):** follow **DEPLOY-VERCEL.md**.

**Or a VPS:** any small Linux VPS works (1 vCPU / 1 GB RAM is plenty). The example below uses Ubuntu.

1. Point your domain's DNS **A record** (and `www`) at the server's IP.
2. Install Node 24 and Caddy:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs caddy
   ```
3. Copy the project to `/opt/foundry` (without `node_modules`, `data/` or `_old-react-prototype/`) and create the service user:
   ```bash
   sudo useradd --system --home /opt/foundry foundry && sudo mkdir -p /opt/foundry/data && sudo chown -R foundry /opt/foundry
   ```
4. Create `/opt/foundry/.env` from `.env.example` with `NODE_ENV=production`, your `SITE_URL`, contact details, `TRUST_PROXY=true`, and **new** long random values for `ADMIN_PASSWORD` and `RADAR_INGEST_TOKEN`. The server refuses to start in production with short ones.
5. Install the service and HTTPS:
   ```bash
   sudo cp deploy/foundry.service /etc/systemd/system/ && sudo systemctl enable --now foundry
   ```
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
   ```
   (Edit the domain in the Caddyfile first.)
6. Give the Radar the URL `https://www.your-domain.com/api/radar/reports` and the token.
7. Back up `data/foundry.sqlite` daily (e.g. `sqlite3 data/foundry.sqlite ".backup backup-$(date +%F).sqlite"`), or set `TURSO_DATABASE_URL` and let Turso hold the data.
8. Optional: add an uptime monitor on `https://www.your-domain.com/api/health` that alerts when `radarStale` is `true`.

To update later, copy the new files over and run `sudo systemctl restart foundry`. The database schema is created automatically.

## Security notes

- Admin: a single password from `.env`, compared in constant time. Sign-in is rate-limited (8 tries per 15 minutes), and the session cookie is HttpOnly, SameSite=Strict and Secure in production, lasting 8 hours. Admin write requests from other sites are rejected.
- Radar: a bearer token, a 60-reports-per-hour limit and an 8 MB body limit. Only `https://*.etsy.com` links and `https://` images are accepted, and all text is length-capped and HTML-escaped when shown.
- Public form: same-origin check, a hidden honeypot field against bots, 5 requests per hour per IP, server-side validation.
- Headers: a strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, `nosniff`, and HSTS in production.
- The footer states that the site is independent of Etsy, Inc., and that trends are not a promise of sales.

Admin sessions and rate-limit counters are stored in the database (hashed tokens only), so they work across Vercel's short-lived instances and server restarts.

## Weekly keywords and workflow videos
The public navigation is Shops, then Keywords. Keywords initially come from the existing research tags. Counts show shops in the published research, not Etsy search volume. Legacy product records remain in storage for compatibility.

To replace the list each week, create a JSON file such as:
```json
{"keywords":["watercolor clipart","crochet pattern","wedding invitation"]}
```
Run `npm run update-keywords -- path/to/keywords.json` from this project. It updates Turso when configured in .env; otherwise it updates the local database. This publishes the supplied list immediately and records its update date. There is no automatic weekly job until a data source is connected.

Two video slots appear on the home workflow section and /request. Set WORKFLOW_VIDEO_1_URL and WORKFLOW_VIDEO_2_URL in Vercel, then redeploy. Accepted formats: HTTPS YouTube watch/share links or direct HTTPS .mp4 URLs. Unconfigured slots say Coming soon. Videos load without autoplay. No domain or Radar connection changes are required.
