# ライブ情報MCP 設計書 v0.1

Nov 20, 2026 · @Ken Yamamoto

## 概要

国内ライブ会場の公演情報を毎日クロールして1つのDBにまとめ、MCP経由で「いつ・どこで・誰が出るか」を日本語と英語で引けるようにする。基盤はCloudflareだけで組む。最終目標は全国の全会場だが、MVPは首都圏の約100会場から始める。

### 想定ユーザー

- 国内のライブ好き：Claudeなどに「今週末、渋谷で当日券のあるロックのライブは？」と聞く
- 来日公演目当ての海外ファン：英語で「Who is playing in Tokyo in March 2027?」と聞く
- 将来：旅行・インバウンド事業者、メディアへのAPI提供（副業の収益化ルート）

### MVPに含める

- 会場マスタ：名前（日英）、住所、緯度経度、キャパ、公式URL
- 公演：日付、開場・開演時刻、出演者、料金、チケット販売ページへのリンク、状態（発売前・販売中・完売・中止）
- 出演者の名寄せ：表記ゆれ（「BUMP OF CHICKEN」「バンプ」など）を1人に寄せる
- 英語表記：会場名・出演者名のローマ字／公式英語名

### MVPに含めない

- チケット販売、在庫の代行、転売情報
- 公式ページの本文やフライヤー画像の転載（事実情報とリンクだけ持つ）
- 個人向け通知（推しの来日決定アラートなど）はフェーズ2

## 全体アーキテクチャ

Workerは収集用と提供用の2つに分け、間はD1だけでつなぐ。収集側が止まっても、MCPは最後に取れたデータで答え続けられる。

&#91;embedded content: 全体構成 · 収集Worker、保存、MCP Worker\]

JSが必要なページだけ取得の中でBrowser Runを使い、LLM抽出はWorkers AIで試して検証に落ちたものだけSonnetに回す。

| 部品 | 用途 |
| --- | --- |
| Cron Triggers | 毎時の起動。1時間以上の間隔ならCPU時間は1回15分まで使える（[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)） |
| Queues | 取得ジョブの分配と失敗時の再試行 |
| Durable Objects | ドメインごとのアクセス間隔を1か所で管理する |
| Browser Run | JS描画が必要なページの取得 |
| R2 | 生HTMLの一時保存（30日） |
| D1 | 公演・会場・出演者の本体DB |
| Workers AI | 抽出の一次処理、英語表記の生成 |
| Vectorize | 出演者名の類似検索（名寄せ用、Phase 1後半） |

## データモデル

D1（SQLite）に正規化して持ち、生HTMLはR2に置く。「公演（event）」と「その情報をどこで見たか（observation）」を分けるのが要点で、同じ公演を会場サイトとアーティストサイトの両方で見つけても1件にまとまる。

| テーブル | 主な列 | 役割 |
| --- | --- | --- |
| venues | id, name\_ja, name\_en, aliases(JSON), prefecture, city, lat, lng, capacity, official\_url, timezone | 会場マスタ。手動・半自動で整備 |
| artists | id, name\_ja, name\_en, name\_kana, aliases(JSON), country, mbid, official\_url | 出演者マスタ。mbidはMusicBrainz ID（任意） |
| events | id, venue\_id, date, open\_time, start\_time, title\_ja, title\_en, price\_text, price\_min\_jpy, status, ticket\_url, first\_seen\_at, updated\_at, fingerprint | 公演の確定版。1会場・1日・1公演（1部／2部は別行） |
| event\_artists | event\_id, artist\_id, role(headliner/support/guest), billing\_order | 公演と出演者の多対多 |
| sources | id, kind(venue/artist/promoter/feed), url, parser(rule/llm), schedule\_cron, robots\_ok, last\_status, etag, last\_modified, content\_hash | クロール対象の台帳 |
| observations | id, source\_id, event\_id, raw\_r2\_key, extracted\_json, extracted\_at, confidence | どのページから何を抽出したかの証跡 |
| crawl\_runs | id, source\_id, started\_at, http\_status, bytes, changed(bool), error | 実行ログと監視用 |

### 名寄せの方針

- 公演の同一判定は `venue_id + date + start_time` を主キー候補にし、出演者集合の重なりで確認する（fingerprint列）
- 出演者名は NFKC正規化・大文字小文字・全角半角を揃えたうえで別名辞書を引く。辞書にないものだけVectorizeの類似検索とLLMで判定し、自信度が低いものは保留キューへ
- 英語名は公式表記を優先し、なければヘボン式ローマ字を自動生成（生成したものはフラグを立てる）
- 日付はすべてJSTのISO形式。「深夜24:30開演」は前日のdateと `start_time = 24:30` で持つ

規模の目安：全国約2,000会場 × 年300公演としても年60万行程度で、D1の1DB上限10GBに十分収まる（[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)）。

## クローリング設計

会場の公式スケジュールページを一次情報源にし、ページが変わったときだけ抽出する。大半のアクセスは「変化なし」で終わるので、LLMの費用は小さく抑えられる。クローラー本体は1つの汎用実装にし、会場ごとの違いは設定（JSON）で吸収する。

### 情報源の優先順位

| 優先 | 情報源 | 強み | 収集方式 |
| --- | --- | --- | --- |
| 1 | 構造化データ（schema.orgのMusicEvent、iCal、RSS、公開API） | そのまま読め、LLM不要 | fetch + パーサー |
| 2 | 会場の公式スケジュールページ | その会場の公演を網羅でき、正確 | fetch + 会場別ルール、駄目ならLLM |
| 3 | 招聘元・プロモーターの公演一覧 | 海外アーティストの来日公演がまとまる | fetch + LLM |
| 4 | アーティスト公式のLIVE／TOURページ | ツアー全体、当日の変更を拾える | fetch + LLM（注目アーティストのみ） |

チケット販売サイトはクロールしない。利用規約で自動取得を制限していることが多いため、公式ページに載っている販売URLをリンクとして持つだけにする。

### 収集の流れ

1. **スケジューラー（Cron Trigger、毎時）**：sourcesから今回回す分を選んでQueueに積む。通常は1日1回、更新が多い会場は1日3回、変化が少ない情報源は週1回に自動で落とす
2. **取得（Queueコンシューマー）**：robots.txtを確認（24時間キャッシュ）し、ETag・Last-Modifiedを使った条件付きGETを送る。同一ドメインは同時接続1、間隔5秒以上
3. **JSが必要なページだけブラウザで描画**：Browser Run（旧Browser Rendering）を使う。課金はブラウザ稼働1時間あたり0.09ドルで、普通のページでは使わない
4. **変化検知**：ヘッダー・広告などを除いた本文のハッシュを前回と比べる。同じならここで終了し、変わっていれば生HTMLをR2に保存する
5. **抽出**：構造化データ→会場別ルール（CSSセレクタ）→LLMの順に試す。LLMはHTMLをMarkdownに落としてからJSONスキーマ付きで抽出させる。まずWorkers AIの小型モデル、検証に落ちたものだけSonnetに回す
6. **検証**：Zodで型を確認し、過去日・2年以上先・会場不一致・出演者空を弾く
7. **マージ**：eventsをupsertし、observationsに証跡を残す。中止・完売・追加公演は変更履歴として記録する
8. **名寄せ**：出演者名をartistsに寄せる（データモデル節の方針どおり）

### 会場リストとルールの作り方

- 最初の約100会場は自分で選ぶ。LLMに会場名から公式スケジュールのURLを候補出しさせ、人が確認してsourcesに登録する
- 会場別ルールもLLMに書かせる。ページを渡してCSSセレクタの設定JSONを出させ、過去のLLM抽出結果と照合して一致したら採用する
- ルールが壊れたら（件数が急減、検証エラー増加）自動でLLM抽出に戻し、ルール再生成を保留キューに入れる

### 法務とマナー

- robots.txtと利用規約を守る。禁止されているサイトは台帳で `robots_ok = false` にして取得しない
- User-Agentにサービス名と連絡先URLを入れ、掲載停止の申し出窓口を用意する
- 低頻度でも相手のサーバーが弱いと障害になる。過去に公共図書館サイトへの収集で利用者が逮捕された例もあるため、ドメインごとの間隔とエラー時の指数バックオフを必須にする
- 公演日・会場・出演者などの事実と出典URLだけを提供し、本文や画像は再配信しない。生HTMLは解析用に限り30日で削除する
- 検索用データベース作成のための複製は、文化庁が著作権法47条の5の適用例として挙げている（[文化審議会 法制度小委員会 第4回](https://www.bunka.go.jp/seisaku/bunkashingikai/chosakuken/hoseido/r05_04/)）。公開前に弁護士に一度確認する

## MCPサーバー設計

検索系6本と新着系1本の計7ツールを、Streamable HTTPの `/mcp` で公開する。サーバー側ではLLMを動かさず、構造化した結果を返して、言い換えや推薦は呼ぶ側のLLMに任せる。

実装はCloudflare Agents SDKの `createMcpHandler`（`agents/mcp/server`）とMCP SDK v2を使う。古い `McpAgent` は新規サーバーでは非推奨になっている（[Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)）。

| ツール | 主な入力 | 返すもの |
| --- | --- | --- |
| search\_events | keyword, artist, venue, prefecture, city, date\_from, date\_to, status, lang, limit, cursor | 公演の一覧（日時・会場・出演者・状態・販売URL） |
| get\_event | event\_id, lang | 公演1件の詳細と出典URL、最終確認日時 |
| search\_artists | name（日英・かな・別名可） | 出演者候補と今後の公演数 |
| get\_artist\_schedule | artist\_id, date\_from, date\_to | その出演者の国内公演一覧 |
| search\_venues | name, prefecture, city, capacity\_min, capacity\_max | 会場候補（住所・キャパ・公式URL） |
| get\_venue\_schedule | venue\_id, date\_from, date\_to | その会場の公演一覧 |
| whats\_new | since, kind（新規・中止・完売・追加公演）, country | 指定日以降の変更。「来日決定」の検知に使う |

### 共通仕様

- 入力はZodで定義し、日付はISO形式。省略時は「今日から30日」、limitは既定20・上限50
- すべての公演に `source_url` と `last_verified_at` を付け、呼ぶ側が情報の鮮度を判断できるようにする
- `lang=en` のときは英語名を主にし、日本語名も併記する。会場には最寄駅を付ける（海外ファン向け）
- 結果は小さなJSONにしてトークンを節約する。詳細はget\_系で取り直す設計
- 同じハンドラーをREST API（`/api/v1/...`）でも公開し、将来のB2B提供に備える

### 認証と利用制限

- MVPは認証なしで公開し、IPごとのレート制限だけかける
- 外部に広げる段階で `@cloudflare/workers-oauth-provider` を被せ、無料枠と有料キーに分ける

## 実装の分担

設計・レビュー・抽出プロンプトのような「判断」は上位モデル、型の決まった実装はSonnet、件数が多く単純な作業はローカルLLMに振る。各タスクは「この設計書の該当節＋受け入れ条件＋テスト」を渡して1 PRで返してもらう。

### リポジトリ構成

- `apps/crawler`：Cron・Queueコンシューマー・抽出
- `apps/mcp`：MCPサーバーとREST API
- `packages/schema`：Zodスキーマと型（抽出とMCPで共通）
- `migrations/`：D1のマイグレーション
- `CLAUDE.md`：規約（TypeScript strict、vitest、依存追加は要相談、秘密情報禁止）を書き、どのモデルも同じルールで動かす

### タスク一覧

| ID | タスク | 担当 | 受け入れ条件 |
| --- | --- | --- | --- |
| T1 | リポジトリ雛形、wrangler設定（D1・R2・Queues・Cron）、CI | Sonnet | `wrangler dev` が起動しCIが通る |
| T2 | D1マイグレーションと索引、会場5件のシード | Sonnet | データモデル節の列がすべてある |
| T3 | `packages/schema` のZod定義 | Sonnet | 抽出とMCPの両方からimportできる |
| T4 | 取得部（robots.txt、条件付きGET、ドメインごとの間隔制御） | Sonnet、上位モデルがレビュー | モックサーバーで禁止パス・304・429の挙動をテスト |
| T5 | 変化検知とR2保存 | ローカルLLM | 同一本文では抽出が走らない |
| T6 | 抽出チェーン（JSON-LD→ルール→LLM） | Sonnet | 各段の切り替えをテスト |
| T7 | LLM抽出プロンプトと正解データ30ページ | 上位モデルが設計、Sonnetが評価ハーネス | 日付・会場・出演者のF1が0.9以上 |
| T8 | 会場別ルールの自動生成 | ローカルLLM（会場ごとにバッチ実行） | 直近3回のLLM抽出と結果が一致 |
| T9 | マージと変更履歴 | Sonnet | 同一公演が二重登録されない |
| T10 | 出演者の名寄せ | Sonnet、上位モデルがレビュー | 表記ゆれ50件のテストケースを通る |
| T11 | MCPサーバー7ツールとREST API | Sonnet | MCP Inspectorで全ツールが動き、契約テストが通る |
| T12 | 監視（失敗率・件数急減のアラート） | ローカルLLM | ルール破損を翌日までに検知できる |
| T13 | 首都圏100会場のスケジュールURL候補 | ローカルLLMが候補、Kenが確認 | sourcesに100件登録 |

### 進め方

1. タスクごとにIssueを立て、設計書の該当節と受け入れ条件を貼る
2. SonnetかローカルLLMが実装し、テスト付きでPRを出す
3. 上位モデルがPRをレビューし、設計とのずれだけ指摘する
4. Kenがマージする。T4・T7・T10はロジックが難しいので必ず自分でも読む

依存関係は T1 → T2・T3 → T4〜T6 → T7・T9 → T8・T10・T11 の順。T13は最初から並行で進められる。

## ロードマップとコスト

MVP（首都圏100会場）はWorkers Paidの月額5ドルに、LLMとブラウザの従量課金を足して月間およそ5〜15ドルの見込み。全国に広げても取得回数は無料枠の中に収まり、費用が増えるのは主にLLM抽出の件数。

### フェーズ

1. **Phase 0：検証**——5会場で取得→抽出→MCPまで通し、Claudeから実際に引けることを確認する（T1〜T6、T11の一部）
2. **Phase 1：MVP**——首都圏100会場、名寄せ、英語表記、監視。自分と知人で毎日使う
3. **Phase 2：拡大**——大阪・名古屋・福岡などへ広げ、招聘元サイトで来日公演を溶り、whats\_newで通知を始める
4. **Phase 3：収益化**——OAuthとAPIキー、海外向けのWebページ、旅行・インバウンド事業者へのAPI提供

### 月額コストの見積もり（MVP）

| 項目 | 前提 | 月額の目安 |
| --- | --- | --- |
| Workers Paid | リクエスト1,000万回・CPU 3,000万ミリ秒を含む | 5ドル |
| 取得 | 100会場 × 1日2回 × 30日 = 約6,000回 | 無料枠内 |
| D1・R2・Queues | 数十MB、数万行 | ほぼ無料枠内 |
| Browser Run | JS必須の20会場 × 1日2回 × 10秒 ≈ 月3.3時間、0.09ドル／時 | 1ドル未満 |
| LLM抽出 | 変化ありのページのみ。大半はWorkers AI、一部だけSonnet | 数ドル（要計測） |

料金の出典：[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Browser Run pricing](https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/)。件数は仮定なので、Phase 0で実測して置き換える。

### 未決事項

- [ ] ジャンルを持つか（会場ページには書かれていないことが多く、推定になる）
- [ ] 海外ファン向けにWeb画面を作るか、MCPとAPIだけにするか
- [ ] 収益化の形（無料MCP＋有料API、アフィリエイト、データ販売）
- [ ] サービス名とドメイン
- [ ] 公開前の弁護士確認（クロール方針と利用規約）
