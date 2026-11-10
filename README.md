# etsy-radar-data
All About ETSY

# Etsy Radar – Category B, Phase 1

Public dataset for the Etsy Radar website: **40 shops** and **50 keywords** for digital, AI-makeable products (PNG, SVG, clipart, printables, planners, coloring pages, templates and similar). The data is in `data.json`, which has `metadata`, `keywords` and `shops`.

- **Data date:** 2026-11-10 (Asia/Karachi, UTC+5). Listing, tag and review evidence covers the 90-day window 2026-08-09 to 2026-11-07.
- **Sources:** research on the competitor shops chosen by accepted students in an Etsy research class, plus Etsy Open API v3 shop lookups made on 2026-11-10.

## Shop rules
- The shop is more than 3 months old (from its Etsy `create_date`).
- Estimated revenue is more than $400 a month.
- The shop is digital only: at least 90% of its active listings are digital downloads.
- No Halloween: fewer than 30% of the shop's 90-day reviews are on Halloween-themed listings. Halloween keywords are excluded too.
- Some very young, fast-growing shops are held back for a separate tier. They are left out of this dataset entirely, including keyword counts and examples.
- The 40 shops that remain are the top 40 by estimated monthly revenue.

## Revenue method
- **Estimated monthly sales** = the Etsy API's `transaction_sold_count` ÷ the shop's age in months (from `create_date` to 2026-11-10).
- **Estimated monthly revenue** = estimated monthly sales × average price. The average price is the mean USD price of the shop's active digital listings, weighted by each listing's 90-day reviews. Non-USD prices are converted at the 2026-11-10 exchange rate.
- **Assumptions:**
  - Sales are averaged evenly over the shop's whole life, so seasonal or older shops may be selling at a different pace today.
  - Figures are gross transactions, before discounts, fees and refunds.
  - Listings with reviews are taken to represent what the shop sells.
- The `review_crosscheck_monthly_revenue_usd` field is a second estimate, for comparison only: 90-day reviews ÷ 3 × 10 × average price, which assumes about 1 review per 10 digital sales.

## Keywords
- **These are listing-linked keyword candidates, not proven sales drivers.** They are exact Etsy tags found on listings that received reviews in the window. Search volume and keyword-attributed sales were not measured.
- `students` and `shops` count how many distinct students' research and how many distinct shops each tag appears in.
- Ranking is by shops, then students, then 90-day reviews on the tagged listings. Each keyword needs at least 3 shops, at least 3 students, and at least 1 linked shop among the 40.
- Excluded: Halloween terms, generic format-only tags such as "digital download", and PLR/MRR/resell-rights tags.
- Each example listing carries the tag, comes from one of the 40 shops, and is not a PLR/MRR/resell-rights product. When no listing qualifies, the example is left blank and `example_note` explains why.
- `competition_*` fields are an Etsy search result count, which measures supply, not demand. They are left blank where no check was run.
