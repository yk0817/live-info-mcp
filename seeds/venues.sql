-- Phase 0 の会場 5 件（ライブハウス 3、クラブ 2）。固定 id の INSERT OR IGNORE で何度流しても同じ。
-- capacity / lat / lng / official_url / nearest_station は推定せず NULL のまま、人が公式情報で埋める。
-- TODO(T13): 人が確認して埋める
INSERT OR IGNORE INTO venues (id, name_ja, name_en, prefecture, city, timezone, venue_kind, capacity, lat, lng, official_url, nearest_station) VALUES
  ('venue-shimokitazawa-shelter', '下北沢SHELTER', NULL, '東京都', '世田谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shinjuku-loft', '新宿LOFT', NULL, '東京都', '新宿区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-duo', '渋谷duo MUSIC EXCHANGE', 'duo MUSIC EXCHANGE', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-womb', '渋谷WOMB', 'WOMB', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL),
  ('venue-daikanyama-unit', '代官山UNIT', 'UNIT', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL);

-- batch 1（渋谷近郊の 10 件。ライブハウス 6、クラブ 4）。調査メモは docs/venues-batch-1.md。
-- capacity は公式サイトに書いてあるものだけ入れる（La.mama の「スタンディング 230」）。ほかは NULL のまま。
INSERT OR IGNORE INTO venues (id, name_ja, name_en, prefecture, city, timezone, venue_kind, capacity, lat, lng, official_url, nearest_station) VALUES
  ('venue-shibuya-o-nest', '渋谷O-nest', 'O-nest', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-o-crest', '渋谷O-Crest', 'O-Crest', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-o-west', '渋谷O-WEST', 'O-WEST', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-quattro', '渋谷CLUB QUATTRO', 'SHIBUYA CLUB QUATTRO', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-lamama', '渋谷La.mama', 'La.mama', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', 230, NULL, NULL, NULL, NULL),
  ('venue-daikanyama-spaceodd', '代官山SPACE ODD', 'SPACE ODD', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-circus', '渋谷Circus Tokyo', 'Circus Tokyo', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL),
  ('venue-ebisu-batica', '恵比寿BATICA', 'BATICA', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL),
  ('venue-nakameguro-solfa', '中目黒solfa', 'solfa', '東京都', '目黒区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-theroom', '渋谷THE ROOM', 'THE ROOM', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL);
