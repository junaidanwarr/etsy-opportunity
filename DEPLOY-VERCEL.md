# Deploying Foundry on Vercel + Turso (free tiers)

Vercel runs the site and Turso stores the data. Both free tiers are far above what this site needs.
Budget about 20 minutes. You need your GitHub login and the values in your local `.env`.

> **Heads-up on Vercel's free (Hobby) plan:** its terms allow personal, **non-commercial** use only. Foundry sells
> workflows, so for a live business Vercel expects the Pro plan ($20/month). The free plan is fine for setting up
> and testing. Nothing in the code changes if you upgrade later.

---

## Step 1 — Create the Turso database (5 min)

1. Go to **https://turso.tech** → **Sign up** → *Continue with GitHub*.
2. Click **Create Database**.
   - Name: `foundry`
   - Location: **AWS ap-south-1 (Mumbai)**, the same area as the Vercel region in `vercel.json` (`bom1`), so every page loads fast.
3. Open the new database and copy its **URL**. It looks like `libsql://foundry-yourname.aws-ap-south-1.turso.io`.
4. Click **Create Token** (or *Generate Token*) → expiry **Never** → access **Read & Write** → copy the token. It's shown only once, so keep it somewhere safe.

## Step 2 — Copy your current data into Turso (2 min)

This moves the 34 research shops, 11 products, team notes and featured picks from your local database into Turso.

1. Open `EtsyOpportunity/.env` and add these two lines (with your values):
   ```
   TURSO_DATABASE_URL=libsql://foundry-yourname.aws-ap-south-1.turso.io
   TURSO_AUTH_TOKEN=your-token
   ```
2. In a terminal in the `EtsyOpportunity` folder, run:
   ```bash
   npm run migrate-to-turso
   ```
   You should see `discoveries: copied 45, Turso now has 45` and similar lines. It's safe to run twice.
3. While those two lines are in `.env`, your **local** site also uses Turso, the same data as the live site. To go back
   to the local file for experiments, put `#` in front of both lines.

## Step 3 — Import the project into Vercel (5 min)

1. Go to **https://vercel.com/signup** → *Continue with GitHub* → choose the **Hobby** plan.
2. **Add New… → Project** → find **junaidanwarr/etsy-opportunity** → **Import**.
   (If it's not listed, click *Adjust GitHub App Permissions* and give Vercel access to that repo.)
3. On the configure screen:
   - **Framework Preset:** `Other`
   - **Root Directory:** leave as `./`
   - **Build and Output Settings:** leave as they are (`vercel.json` already sets them)
4. Open **Environment Variables** and add the variables below. Tip: you can paste several `KEY=value` lines at once
   into the first box and Vercel splits them.

   | Name | Value |
   |---|---|
   | `SITE_NAME` | `Foundry` |
   | `SITE_URL` | leave empty for now (set in Step 5) |
   | `CONTACT_EMAIL` | `team@100daysforai.com` |
   | `CONTACT_WHATSAPP` | `+92 311 3150345` |
   | `REPLY_TIME` | `2 working days` |
   | `ADMIN_PASSWORD` | a **new** long password (12+ characters). This is what you'll type at `/admin` |
   | `RADAR_INGEST_TOKEN` | a **new** long random token (24+ characters), given to the Radar |
   | `TURSO_DATABASE_URL` | from Step 1 |
   | `TURSO_AUTH_TOKEN` | from Step 1 |
   | `AUTO_APPROVE` | `false` |
   | `NEW_DAYS` | `7` |
   | `STALE_AFTER_HOURS` | `36` |
   | `NOTIFY_EMAIL` | `team@100daysforai.com` |
   | `MAIL_FROM` | `Foundry <team@100daysforai.com>` |
   | `SMTP_HOST` | `premium164.web-hosting.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `team@100daysforai.com` |
   | `SMTP_PASS` | your mailbox password (same as in `.env`) |

   Don't add `NODE_ENV`, `HOST`, `PORT`, `DATABASE_PATH` or `TRUST_PROXY`: Vercel handles those.

   To generate a strong random value for the password or token, run this locally and copy the output:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
5. Click **Deploy**. It takes about a minute, then Vercel shows your address, e.g. `https://etsy-opportunity.vercel.app`.

## Step 4 — Check it works (3 min)

1. Open the Vercel address: the home page should show the trending products and shops.
2. Open `/admin` and sign in with the new `ADMIN_PASSWORD`.
3. **Admin → Overview → Send a test email** should arrive at team@100daysforai.com.
4. Optional: submit a test request at `/request`. It appears in *Admin → Requests* and you get the email alert.
   Archive it afterwards.

If a page shows "Something went wrong", open Vercel → your project → **Logs**: the exact error is there
(usually a typo in `TURSO_DATABASE_URL` or the token).

## Step 5 — Use your own domain (5 min)

`100daysforai.com` already hosts your academy site, so give Foundry a **subdomain**, for example
`foundry.100daysforai.com`. (A separate domain works the same way.)

1. Vercel → your project → **Settings → Domains** → type `foundry.100daysforai.com` → **Add**.
   Vercel shows a **CNAME** record to create, usually `cname.vercel-dns.com`.
2. Your domain's DNS is on **Cloudflare**. Cloudflare → `100daysforai.com` → **DNS → Add record**:
   - Type `CNAME`, Name `foundry`, Target `cname.vercel-dns.com`
   - Proxy status: **DNS only (grey cloud)**. Vercel needs this to issue the HTTPS certificate.
3. Wait until Vercel shows the domain as **Valid** (usually a few minutes).
4. Vercel → **Settings → Environment Variables** → set `SITE_URL` to `https://foundry.100daysforai.com` →
   then **Deployments → ⋯ → Redeploy** so the change takes effect. This fixes canonical links, the sitemap and admin links in emails.

## Step 6 — Connect the Radar

Give the Radar the endpoint `https://foundry.100daysforai.com/api/radar/reports` and the `RADAR_INGEST_TOKEN`
from Step 3. Format and examples are in `RADAR-INTEGRATION.md`. Vercel accepts request bodies up to 4.5 MB, roughly
3,000 discoveries, so send larger scans in parts.

---

## Updating the site later

Every push to the `main` branch on GitHub deploys automatically. Changing an environment variable needs a
**Redeploy** (Deployments → ⋯ → Redeploy).

## Backups

Turso keeps point-in-time history on its free plan. For your own copy, run `turso db shell foundry .dump > backup.sql`
with the Turso CLI, or copy the Radar report JSON files you already have.
