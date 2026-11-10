# Connecting the Etsy Surveillance Radar

The website does not scan Etsy. It only receives and displays what your existing Radar reports. There are three ways to deliver a report; all three use the same JSON format and end up in the same place.

| Way | When to use it |
|---|---|
| **HTTP POST** (recommended) | The Radar can make a web request after each scan. Fully automatic. |
| **CLI import** | The Radar writes a JSON file on the same server. Run `npm run import -- path/to/report.json` from cron / Task Scheduler. |
| **Admin upload** | One-off or recovery: drag the JSON file onto *Admin → Radar reports*. |

## 0. GitHub data.json (how the Radar is connected today)

The Radar team pushes a new `data.json` each week to the GitHub repo **Moshsin1991/etsy-radar-data** (branch `main`). Etsscope pulls it; nothing has to run on the Radar side.

- **When:** Vercel Cron calls `/api/cron/radar-sync` once a day (01:30 UTC, about 06:30 Pakistan time). It downloads `data.json` and does nothing if the file is unchanged. *Admin → Overview → Sync now* does the same at any time (Shift-click re-imports an unchanged file).
- **What it does with a new file:**
  - The 40-ish `shops` go through the normal ingest (`source = github`). They are matched to existing shops by Etsy URL, then name, so they're updated rather than duplicated. They are published and become the featured shops, and the previous batch's shops stay published but are no longer featured.
  - `keywords` replace the weekly keyword list in rank order. The homepage radar opens on the top 15, and their research figures (shops, students, 90-day reviews, Etsy search results) show on each keyword page.
  - Only fields present in data.json are shown. Revenue and sales are labelled as estimates.
- **Settings (Vercel → Settings → Environment Variables):**
  | Variable | Needed? | Value |
  |---|---|---|
  | `CRON_SECRET` | Yes, for the daily run | any random string of 16+ characters. Vercel sends it automatically to the cron route. |
  | `RADAR_GITHUB_TOKEN` | Yes while the repo is private | a read-only GitHub token that can read the repo's contents. Leave it out if the repo is made public. |
  | `RADAR_DATA_URL` | No | defaults to `https://raw.githubusercontent.com/Moshsin1991/etsy-radar-data/main/data.json` |
  | `RADAR_SYNC_REVIEW` | No | `true` keeps new shops unpublished until approved in admin. Keywords still go live. |
- The result of the last check, plus any error, is shown in *Admin → Overview → Radar data from GitHub*.

## 1. HTTP POST

```
POST https://www.your-domain.com/api/radar/reports
Authorization: Bearer <RADAR_INGEST_TOKEN from the server's .env>
Content-Type: application/json
```

Responses:

| Status | Meaning |
|---|---|
| `202` | Stored. Body: `{ created, updated, skipped, problems[] }`. `problems` lists items that were skipped and why. |
| `400` | Not a valid report (for example, missing `products`/`shops` arrays). Nothing stored; the failure is logged in admin. |
| `401` | Token missing or wrong. |
| `413` | More than 2,000 items; split the report. |
| `429` | More than 60 reports per hour from one address. |

Python example (add after the Radar finishes its daily scan):

```python
import json, os, urllib.request
req = urllib.request.Request(
    "https://www.your-domain.com/api/radar/reports",
    data=json.dumps(report).encode(),
    headers={"Authorization": f"Bearer {os.environ['RADAR_INGEST_TOKEN']}", "Content-Type": "application/json"},
    method="POST")
print(urllib.request.urlopen(req, timeout=60).read().decode())
```

Node example:

```js
await fetch('https://www.your-domain.com/api/radar/reports', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.RADAR_INGEST_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(report),
})
```

## 2. Report format

```json
{
  "generatedAt": "2026-11-01T06:00:00Z",
  "products": [
    {
      "id": "1234567890",
      "title": "Product name",
      "listingUrl": "https://www.etsy.com/listing/1234567890/...",
      "image": "https://i.etsystatic.com/....jpg",
      "shopName": "ShopName",
      "shopUrl": "https://www.etsy.com/shop/ShopName",
      "category": "Paper & party",
      "keywords": ["printable", "planner"],
      "discoveredAt": "2026-10-31",
      "metrics": { "favorites": 1840, "reviews": 312, "trendScore": 92 }
    }
  ],
  "shops": [
    {
      "id": "ShopName",
      "title": "ShopName",
      "shopUrl": "https://www.etsy.com/shop/ShopName",
      "image": "https://i.etsystatic.com/....jpg",
      "category": "Paper & party",
      "keywords": ["printables"],
      "metrics": { "sales": 12400, "listings": 310 }
    }
  ]
}
```

Only `title` is required. Send whatever else the Radar actually has, and leave out what it doesn't. The site never makes up missing values.

| Field | Notes |
|---|---|
| `id` | **Strongly recommended.** Use the Etsy listing ID for products and the shop name for shops. A stable ID means the next day's report *updates* the item (refreshing its metrics and "last seen" date) instead of creating a duplicate. Without an ID, one is derived from the title and URL. |
| `title` (or `name`) | Required. Items without one are skipped and listed in `problems`. |
| `listingUrl` / `shopUrl` | Must be `https://` links on `etsy.com`; anything else is dropped. Products are linked to a shop page by matching `shopUrl` (or `shopName`). |
| `image` (or `imageUrl`) | Any `https://` image URL. Without one, the site draws a neutral placeholder. |
| `category`, `keywords` | Power the category filter, keyword search and keyword links. |
| `discoveredAt` | When the Radar first found it. Defaults to `generatedAt`. Only used the first time an item arrives. |
| `metrics` | **Free-form**: any keys with number or short text values (up to 24). They are shown exactly as sent, labelled from the key (`trendScore` becomes "Trend score"). Numeric metrics become sort options on the listing pages. Each report's metrics are kept as history on the detail page. |
| `generatedAt` | When the scan ran. Used as the report date and "last seen" date. Future dates are clamped to now. |

## 3. What happens after a report arrives

1. New items are stored **unpublished** (unless `AUTO_APPROVE=true`). Existing items are refreshed in place, keep their published/featured state, and get a new history row.
2. The report is logged in *Admin → Radar reports* with created/updated/skipped counts, or the reason it failed.
3. If `NOTIFY_WEBHOOK_URL` is set, the team gets a message.
4. If no successful report arrives within `STALE_AFTER_HOURS` (default 36), admin shows a warning and `/api/health` returns `"radarStale": true`, so an uptime monitor can alert you.
