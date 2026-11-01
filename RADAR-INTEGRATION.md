# Connecting the Etsy Surveillance Radar

The website does not scan Etsy. It only receives and displays what your existing Radar reports. There are three ways to deliver a report; all three use the same JSON format and end up in the same place.

| Way | When to use it |
|---|---|
| **HTTP POST** (recommended) | The Radar can make a web request after each scan. Fully automatic. |
| **CLI import** | The Radar writes a JSON file on the same server. Run `npm run import -- path/to/report.json` from cron / Task Scheduler. |
| **Admin upload** | One-off or recovery: drag the JSON file onto *Admin → Radar reports*. |

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
