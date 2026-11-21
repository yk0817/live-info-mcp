# D1 マイグレーション

- `0001_init.sql`: テーブル（venues / artists / events / event_artists / sources / observations / crawl_runs）
- `0002_indexes.sql`: 索引
- データは入れない。会場のシードは `../seeds/venues.sql`

## ローカルで適用する

`apps/crawler` で実行する（`wrangler.jsonc` の `migrations_dir` が `../../migrations`）。

```sh
cd apps/crawler
npx wrangler d1 migrations apply live-info --local
npx wrangler d1 execute live-info --local --file=../../seeds/venues.sql
```

シードは `INSERT OR IGNORE` なので繰り返し流してよい。
