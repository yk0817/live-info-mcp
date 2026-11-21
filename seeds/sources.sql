-- Phase 0 の取得元（会場ごとに 1 件）。固定 id の INSERT OR IGNORE で何度流しても同じ。
-- venue id は seeds/venues.sql と一致させる。robots_ok は 2026-11-21 に robots.txt を確認した結果。
-- TODO(T13): URL は人が確認する
INSERT OR IGNORE INTO sources (id, kind, url, parser, config_json, robots_ok, needs_review) VALUES
  ('src_venue-shimokitazawa-shelter', 'venue', 'https://www.loft-prj.co.jp/schedule/shelter/schedule', 'rule', NULL, 1, 1),
  ('src_venue-shinjuku-loft', 'venue', 'https://www.loft-prj.co.jp/schedule/loft/schedule', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-duo', 'venue', 'https://www.duomusicexchange.com/schedule/2026/index_2026-11.html', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-womb', 'venue', 'https://www.womb.co.jp/ja/events', 'rule', NULL, 1, 1),
  ('src_venue-daikanyama-unit', 'venue', 'https://www.unit-tokyo.com/schedule/', 'rule', NULL, 1, 1);
