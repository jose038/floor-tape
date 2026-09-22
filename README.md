# Floor Tape

Mobile-first disclosure tracker for U.S. STOCK Act periodic transaction reports. Hypothetical mark-to-market from amount-range midpoints and public last closes. Not investment advice, and not a claim of official profit.

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

- Filings: [Hillscore trades.csv](https://hillscore.com/data/) (CC BY 4.0), filed since 2023. Most-active traders, not all 535 members. If that file is down, a labeled sample book is shown.
- Official documents: [House Clerk](https://disclosures-clerk.house.gov/) and [Senate eFD](https://efdsearch.senate.gov/). Those portals are linked, not scraped.
- Chamber: [congress-legislators](https://unitedstates.github.io/congress-legislators/legislators-current.json) current file, joined on bioguide.
- Prices: Yahoo Finance spark, then the chart endpoint. `BRK.B` is requested as `BRK-B`.

## Hypothetical P&L

```
shares_est = amount_mid / trade_date_close
unrealized_est = shares_est * (last_close - trade_date_close)
return = last_close / trade_date_close - 1
```

Sells have no default cost basis. FIFO for the same member and ticker is experimental. Late means filed more than 45 days after the trade. Large means a reported minimum of at least $100,001.

Watches and alert rules live in `localStorage` only. Rows in Postgres have no `user_id`.
