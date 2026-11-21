# apps/mcp

MCP サーバー（Streamable HTTP の `/mcp`）。実行時に LLM は呼ばず、D1 の事実だけを返す。

## ツール

| ツール | 入力 | 返すもの |
| --- | --- | --- |
| `search_events` | `keyword` `venue` `date_from` `date_to` `lang`(ja/en) `limit`(既定 20・上限 50) | 公演の一覧（日付順）。`has_more` で打ち切りも分かる |
| `get_event` | `event_id` `lang` | 公演 1 件の詳細（`open_time` `price_text` `price_min_jpy` を含む） |
| `search_venues` | `name` `kind`(livehouse/club) `limit` | 会場候補。`capacity` は不明なら `null` |
| `ping` | `message` | ヘルスチェック |

日付は JST の `YYYY-MM-DD`。省略時は「今日から 30 日」。結果は `structuredContent`（`outputSchema` 付き）と短い text の両方で返す。

## 認証

`Authorization: Bearer <token>` を、シークレット `MCP_TOKENS`（カンマ区切り）と定数時間で比較する。トークン無し・不一致は 401、`MCP_TOKENS` が未設定・空のときは 503（開けっ放しにしない）。

- ローカル: `apps/mcp/.dev.vars.example` を `.dev.vars` にコピーして値を入れる（gitignore 済み）
- 本番: `wrangler secret put MCP_TOKENS`（デプロイ時にユーザーが行う）

## ローカルで動かす（クローラーと D1 を共有する）

`wrangler dev` のローカル D1 は、永続化ディレクトリ（既定は各アプリの `.wrangler/state`）に `database_id` ごとに置かれる。crawler と mcp は同じ `database_id`（プレースホルダー）なので、**永続化先を同じディレクトリに揃えれば同じ DB を見る**。リポジトリ直下の `.wrangler/state` に揃える（`.wrangler` は gitignore 済み）。

```sh
cd apps/mcp
cp .dev.vars.example .dev.vars   # MCP_TOKENS を適当な文字列に書き換える
npx wrangler d1 migrations apply live-info --local --persist-to ../../.wrangler/state
npx wrangler d1 execute live-info --local --persist-to ../../.wrangler/state --file ../../seeds/venues.sql
npx wrangler dev --port 8791 --persist-to ../../.wrangler/state
```

crawler 側も `--persist-to ../../.wrangler/state` を付けて起動すると、クローラーが書いた公演を MCP が引ける。

動作確認（`$T` は `.dev.vars` のトークン）:

```sh
curl -s -X POST localhost:8791/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $T" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_events","arguments":{"lang":"en"}}}'
```

## テスト

`npm test`（リポジトリ直下）。`test-utils/d1.ts` の `createMigratedDb()` が、本物のマイグレーションを流した `node:sqlite` の D1 互換 DB を返す。
