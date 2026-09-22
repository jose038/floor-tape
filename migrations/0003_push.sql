CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notify_cursor (
  id INTEGER PRIMARY KEY,
  csv_hash TEXT,
  seen_ids TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
