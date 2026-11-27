-- Phase 0 の取得元（会場ごとに 1 件）。固定 id の INSERT OR IGNORE で何度流しても同じ。
-- venue id は seeds/venues.sql と一致させる。robots_ok は 2026-11-21 に robots.txt を確認した結果。
-- TODO(T13): URL は人が確認する
INSERT OR IGNORE INTO sources (id, kind, url, parser, config_json, robots_ok, needs_review) VALUES
  ('src_venue-shimokitazawa-shelter', 'venue', 'https://www.loft-prj.co.jp/schedule/shelter/schedule', 'rule', NULL, 1, 1),
  ('src_venue-shinjuku-loft', 'venue', 'https://www.loft-prj.co.jp/schedule/loft/schedule', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-duo', 'venue', 'https://www.duomusicexchange.com/schedule/2026/index_2026-11.html', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-womb', 'venue', 'https://www.womb.co.jp/ja', 'rule', NULL, 1, 1),
  ('src_venue-daikanyama-unit', 'venue', 'https://www.unit-tokyo.com/schedule/', 'rule', NULL, 1, 1);

-- batch 1（渋谷近郊の 10 件）。robots_ok は 2026-11-27 に robots.txt を確認した結果（404 は制限なしとして 1）。
-- 月別 URL の会場は venue-configs の url_template が優先され、ここの URL は当月の入口。
INSERT OR IGNORE INTO sources (id, kind, url, parser, config_json, robots_ok, needs_review) VALUES
  ('src_venue-shibuya-o-nest', 'venue', 'https://shibuya-o.com/nest/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-o-crest', 'venue', 'https://shibuya-o.com/crest/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-o-west', 'venue', 'https://shibuya-o.com/west/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-quattro', 'venue', 'https://www.club-quattro.com/shibuya/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-lamama', 'venue', 'https://www.lamama.net/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-daikanyama-spaceodd', 'venue', 'https://spaceodd.jp/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-circus', 'venue', 'https://circus-tokyo.jp/schedule/', 'rule', NULL, 1, 1),
  ('src_venue-ebisu-batica', 'venue', 'https://batica.jp/events/', 'rule', NULL, 1, 1),
  ('src_venue-nakameguro-solfa', 'venue', 'https://nakameguro-solfa.com/events/', 'rule', NULL, 1, 1),
  ('src_venue-shibuya-theroom', 'venue', 'https://theroom.jp/schedule/', 'rule', NULL, 1, 1);
