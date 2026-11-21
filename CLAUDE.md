# live-info-mcp 規約

東京の中小ライブ会場の公演情報を毎日クロールして D1 にまとめ、MCP で日英検索できるようにする。基盤は Cloudflare のみ。

## 優先順位

- 要件は `docs/requirements.md`、設計は `docs/design-v0.1.md`。食い違うときは **requirements.md が優先**
- 実装は設計書のタスク（T1〜T13）の受け入れ条件を満たすことを目標にする

## 構成

- `apps/crawler`: Cron・Queue コンシューマー・抽出（Worker）
- `apps/mcp`: MCP サーバー（`createMcpHandler` は `agents/mcp/server`、MCP SDK は v2 の `@modelcontextprotocol/server`）
- `packages/schema`: Zod スキーマと型（抽出と MCP で共通）
- `migrations/`: D1 マイグレーション

## コーディング

- TypeScript は strict。`any` を使わず、外部入力は `unknown` から Zod で絞る
- テストは vitest。振る舞い（契約）を固定し、時刻・ネットワーク・LLM は注入してオフラインで再現する
- 既存オブジェクトを書き換えず、新しいコピーを返す
- コメントは why だけ。`console.log` は Worker のスタブ以外では使わない
- 変更前に `npm run lint` / `npm run typecheck` / `npm test` を通す

## 依存と秘密情報

- **依存の追加は先に相談する**（`agents` が要求する `@modelcontextprotocol/server` はバージョンを固定する）
- 秘密情報（API キー・トークン・`.dev.vars`・`.env*`）をリポジトリに置かない。D1 の `database_id` など本番の ID はデプロイ時に設定する

## LLM の使い分け

- 開発（実装・設定 JSON・会場別コード）は Claude Code 上の Sonnet が行う
- 実行時の LLM は **Cloudflare Workers AI のみ**。実行時に Sonnet（Anthropic API）は呼ばない

## Git

- コミットメッセージは日本語の Conventional Commits（`feat:` `fix:` `docs:` `chore:` など）
- main へ直接コミットせず、`<type>/<短い説明>` のブランチから PR を出す
