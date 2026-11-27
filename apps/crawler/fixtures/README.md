# フィクスチャ

テストと抽出ロジックの開発用の**合成（架空）HTML**。各会場の公式スケジュールページの DOM 構造（`venue-configs/*.json` のセレクタと正規表現が当たる部分）だけを模して手で書いたもので、**実在の公演・人物・団体ではない**。出演者名・公演名・詳細 URL の末尾 id・チケット URL（`tickets.example.com`）はすべて架空で、元ページの本文・画像・スクリプト・連絡先は含まない。

各ファイルには、抽出エンジンとパイプラインのテストが固定している振る舞いのケース（時刻なしのカード、同じ日の複数公演、`24:00` の深夜開演、`9:00` の 1 桁時、`23:00-4:30` の終了つき表記、年なし日付と年越し、`【公演中止】`、メンテナンスカードの skip、省略記号の出演者除外、過去日のカードなど）を入れてある。日付はテストの now（2026-11-21 JST）に合わせ、過去日と今日以降の両方を含む。

構造を変えるとき（会場のページ改修に追従するとき）は、実ページの構造だけを写し、本文は架空のまま保つ。メールアドレス・電話番号・実在の人名は入れない。

| ファイル | 構造を模した元ページ |
|---|---|
| `venue-shimokitazawa-shelter/schedule.html` | `https://www.loft-prj.co.jp/schedule/shelter/schedule`（2026-11） |
| `venue-shinjuku-loft/schedule.html` | `https://www.loft-prj.co.jp/schedule/loft/schedule`（2026-11） |
| `venue-shibuya-duo/schedule.html` | `https://www.duomusicexchange.com/schedule/2026/index_2026-11.html` |
| `venue-shibuya-womb/schedule.html` | `https://www.womb.co.jp/ja`（トップの直近イベントカード） |
| `venue-daikanyama-unit/schedule.html` | `https://www.unit-tokyo.com/schedule/`（2026-11） |
| `venue-shibuya-o-nest/schedule.html` | `https://shibuya-o.com/nest/schedule/`（2026-11） |
| `venue-shibuya-o-crest/schedule.html` | `https://shibuya-o.com/crest/schedule/`（2026-11） |
| `venue-shibuya-o-west/schedule.html` | `https://shibuya-o.com/west/schedule/`（2026-11） |
| `venue-shibuya-quattro/schedule.html` | `https://www.club-quattro.com/shibuya/schedule/`（2026-11） |
| `venue-shibuya-lamama/schedule.html` | `https://www.lamama.net/schedule/`（2026-11） |
| `venue-daikanyama-spaceodd/schedule.html` | `https://spaceodd.jp/schedule/`（2026-11） |
| `venue-shibuya-circus/schedule.html` | `https://circus-tokyo.jp/schedule/`（直近一覧） |
| `venue-ebisu-batica/schedule.html` | `https://batica.jp/events/`（The Events Calendar の月表示） |
| `venue-nakameguro-solfa/schedule.html` | `https://nakameguro-solfa.com/events/`（同上） |
| `venue-shibuya-theroom/schedule.html` | `https://theroom.jp/schedule/`（2026-11） |

実ページの HTML を手元で使うときは `apps/crawler/fixtures-local/` に置く（.gitignore 済みでコミットされない）。batch 1 の調査メモは `docs/venues-batch-1.md`。
