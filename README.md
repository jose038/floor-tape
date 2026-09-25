# Floor Tape

Mobile-first disclosure tracker for U.S. STOCK Act periodic transaction reports. Hypothetical mark-to-market from amount-range midpoints and public last closes. Not investment advice, and not a claim of official profit.

## Hosting

Production and pull-request previews run on Cloud Run in the same Google Cloud project as CardFlow. Previews get a stable `*.run.app` URL for the life of the PR. There is no load balancer and no reserved static IP. See [deploy/README.md](deploy/README.md).

## Run

```sh
./startup.sh
```

`npm run dev` serves `0.0.0.0:8080`. No `.env` file. Auth is off (`app-env.json`). Postgres is on for deploy; local preview uses PGLite under `.data/pglite`.

```sh
npm test
npm run build
npm run typecheck
```

## Sources

- House and Senate filings: [Hillscore trades.csv](https://hillscore.com/data/) (CC BY 4.0), filed since 2023. Most-active traders, not all 535 members. If that file is down, a labeled sample book is shown.
- White House Office periodic transaction reports: [whitehouse.gov/disclosures](https://www.whitehouse.gov/disclosures/). A report is included only when it parses into a securities transaction.
- Charles Kushner, when his public OGE Form 278-T parses, is labeled State (Ambassador to France and Monaco), not White House. No public transaction report was included for Jared Kushner (OGE FY26-109, 2026-09-14, no records; not on the White House index) or Ivanka Trump (not on that index).
- Official documents: [House Clerk](https://disclosures-clerk.house.gov/), [Senate eFD](https://efdsearch.senate.gov/), and the White House or OGE disclosure for White House filers. The congressional portals are linked, not scraped.
- Chamber: [congress-legislators](https://unitedstates.github.io/congress-legislators/legislators-current.json) current file, joined on bioguide. White House filers have no bioguide.
- Prices: Yahoo Finance spark, then the chart endpoint. `BRK.B` is requested as `BRK-B`.

## Hypothetical P&L

```
shares_est = amount_mid / trade_date_close
unrealized_est = shares_est * (last_close - trade_date_close)
return = last_close / trade_date_close - 1
```

Sells have no default cost basis. FIFO for the same member and ticker is experimental. Late means filed more than 45 days after the trade. Large means a reported minimum of at least $100,001.

Watches and alert rules live in `localStorage` only. Rows in Postgres have no `user_id`.
