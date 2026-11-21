-- 公演情報 D1 スキーマ。日付・時刻は TEXT の ISO 形式、真偽値は INTEGER 0/1、
-- id は ULID 形式の文字列をアプリ側で採番する（observations / crawl_runs のみ AUTOINCREMENT）。

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name_ja TEXT NOT NULL,
  name_en TEXT,
  aliases TEXT NOT NULL DEFAULT '[]', -- JSON 配列
  prefecture TEXT NOT NULL,
  city TEXT,
  lat REAL,
  lng REAL,
  -- 不明な収容人数は推定せず、人が公式情報で埋める
  capacity INTEGER,
  official_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  -- Phase 0 でクラブを別集計するため
  venue_kind TEXT NOT NULL CHECK (venue_kind IN ('livehouse', 'club')),
  nearest_station TEXT -- 英語出力で使う
);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name_ja TEXT,
  name_en TEXT,
  name_kana TEXT,
  aliases TEXT NOT NULL DEFAULT '[]', -- JSON 配列
  country TEXT,
  mbid TEXT, -- MusicBrainz ID（任意）
  official_url TEXT
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues (id),
  date TEXT NOT NULL, -- 興行日 YYYY-MM-DD（JST、公式ページの表記のまま）
  open_time TEXT, -- 開場時刻の元表記
  start_at TEXT, -- 開演時刻（UTC の ISO 日時）。不明なら NULL
  start_text TEXT, -- 開演時刻の元表記（例 '24:30'）
  title_ja TEXT NOT NULL,
  title_en TEXT,
  price_text TEXT,
  price_min_jpy INTEGER,
  status TEXT CHECK (status IN ('upcoming', 'on_sale', 'sold_out', 'cancelled')),
  ticket_url TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fingerprint TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  source_url TEXT NOT NULL, -- 出典 URL。全公演に付ける（要件メモ）
  last_verified_at TEXT NOT NULL -- 最終確認日時。呼ぶ側が鮮度を判断する
);

CREATE TABLE event_artists (
  event_id TEXT NOT NULL REFERENCES events (id),
  artist_id TEXT NOT NULL REFERENCES artists (id),
  role TEXT NOT NULL CHECK (role IN ('headliner', 'support', 'guest')),
  billing_order INTEGER,
  PRIMARY KEY (event_id, artist_id, role)
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('venue', 'artist', 'promoter', 'feed')),
  url TEXT NOT NULL,
  parser TEXT NOT NULL CHECK (parser IN ('rule', 'llm')),
  config_json TEXT, -- 会場別の抽出設定（A）
  schedule_cron TEXT,
  robots_ok INTEGER NOT NULL DEFAULT 1 CHECK (robots_ok IN (0, 1)),
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  last_status INTEGER,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT
);

CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources (id),
  event_id TEXT REFERENCES events (id),
  raw_r2_key TEXT,
  extracted_json TEXT,
  extracted_at TEXT NOT NULL,
  confidence REAL
);

CREATE TABLE crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources (id),
  started_at TEXT NOT NULL,
  http_status INTEGER,
  bytes INTEGER,
  changed INTEGER CHECK (changed IN (0, 1)),
  error TEXT
);
