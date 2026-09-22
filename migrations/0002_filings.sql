CREATE TABLE IF NOT EXISTS filings (
  id TEXT PRIMARY KEY,
  politician TEXT NOT NULL,
  member_id TEXT NOT NULL,
  bioguide_id TEXT,
  party TEXT,
  state TEXT,
  chamber TEXT NOT NULL,
  symbol TEXT,
  yahoo_symbol TEXT,
  asset_name TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  owner TEXT NOT NULL,
  owner_raw TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  lag_days INTEGER NOT NULL,
  late BOOLEAN NOT NULL,
  amount_min DOUBLE PRECISION NOT NULL,
  amount_max DOUBLE PRECISION NOT NULL,
  amount_mid DOUBLE PRECISION NOT NULL,
  price_on_trade_date DOUBLE PRECISION,
  official_url TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS filings_filed_idx ON filings (filed_date DESC);
CREATE INDEX IF NOT EXISTS filings_member_idx ON filings (member_id);
CREATE INDEX IF NOT EXISTS filings_symbol_idx ON filings (symbol);

CREATE TABLE IF NOT EXISTS ingest_state (
  id INTEGER PRIMARY KEY,
  last_ingest_at TEXT,
  source TEXT NOT NULL,
  labeled_sample BOOLEAN NOT NULL,
  row_count INTEGER NOT NULL
);
