-- Phase 0 の会場 5 件（ライブハウス 3、クラブ 2）。固定 id の INSERT OR IGNORE で何度流しても同じ。
-- capacity / lat / lng / official_url / nearest_station は推定せず NULL のまま、人が公式情報で埋める。
-- TODO(T13): 人が確認して埋める
INSERT OR IGNORE INTO venues (id, name_ja, name_en, prefecture, city, timezone, venue_kind, capacity, lat, lng, official_url, nearest_station) VALUES
  ('venue-shimokitazawa-shelter', '下北沢SHELTER', NULL, '東京都', '世田谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shinjuku-loft', '新宿LOFT', NULL, '東京都', '新宿区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-duo', '渋谷duo MUSIC EXCHANGE', 'duo MUSIC EXCHANGE', '東京都', '渋谷区', 'Asia/Tokyo', 'livehouse', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-womb', '渋谷WOMB', 'WOMB', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL),
  ('venue-shibuya-contact', '渋谷Contact', 'Contact', '東京都', '渋谷区', 'Asia/Tokyo', 'club', NULL, NULL, NULL, NULL, NULL);
