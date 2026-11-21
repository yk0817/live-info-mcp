-- ローカル実行専用（本番には流さない）。5 会場の取得先を scripts/serve-fixtures.mjs のローカル URL に向ける。
-- フィクスチャは固定ページなので、月別の url_template は取り除く（残すと実サイトを取りに行ってしまう）。
-- seeds/source-configs.sql の後に流す。何度流しても同じ結果になる。
UPDATE sources
SET url = 'http://127.0.0.1:8899/' || substr(id, 5) || '/schedule.html',
    config_json = json_remove(config_json, '$.url_template')
WHERE id IN (
  'src_venue-shimokitazawa-shelter',
  'src_venue-shinjuku-loft',
  'src_venue-shibuya-duo',
  'src_venue-shibuya-womb',
  'src_venue-daikanyama-unit'
);
