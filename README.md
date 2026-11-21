# live-info-mcp

東京の中小ライブ会場（収容 50〜1000 人）の公演情報を毎日クロールして D1 にまとめ、MCP で日英検索できるようにする。基盤は Cloudflare のみ。

- 要件（合意事項）: [docs/requirements.md](docs/requirements.md)
- 元の設計書: [docs/design-v0.1.md](docs/design-v0.1.md)。要件メモと食い違う箇所は、要件メモが優先

状態: 要件の合意まで。実装は T1 から。

## 開発

Node 22 以上と npm が要る（`.nvmrc` は 22）。

```sh
npm ci                # 依存のインストール
npm run lint          # ESLint
npm run typecheck     # 全ワークスペースの tsc
npm test              # vitest
npm run dev:mcp       # MCP サーバーを起動（既定 http://localhost:8787/mcp）
npm run dev:crawler   # クローラーを起動（--test-scheduled 付き）
```

クローラーの Cron は `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` で手動実行できる。ポートが重なるときは各 `apps/*` で `npx wrangler dev --port <番号>` を使う。D1・R2・Queues はローカルの永続化で動く。Workers AI のバインディングだけは常にリモートを使う。
