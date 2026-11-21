# アーキテクチャ

## 概要

東京の中小ライブ会場の公式スケジュールを毎日クロールして D1 に貯め、MCP で日英検索できるようにする。実行は Cloudflare のみで、実行時の LLM は Workers AI だけ。Sonnet は開発時にコードと設定 JSON を書く役で、実行時には呼ばない。

要件の合意事項は [requirements.md](requirements.md)、元の設計は [design-v0.1.md](design-v0.1.md)。食い違う箇所は要件メモが優先する。

## 1. 全体構成

収集 Worker と提供 Worker は D1 だけでつなぐ。収集側が止まっても、MCP は最後に取れたデータで答え続けられる。

```mermaid
flowchart TB
    Venue[会場の公式サイト]
    Client[Claude など MCP クライアント]

    subgraph Dev["開発時（Claude Code 上の Sonnet）"]
        Sonnet[Sonnet]
    end

    subgraph Cf[Cloudflare]
        subgraph Crawl["収集 Worker（apps/crawler）"]
            Cron[Cron 毎時]
            Queue[Queues]
            Fetch[取得<br>robots 確認・条件付き GET]
            Gate[Durable Objects<br>ドメインごとの間隔]
            Browser[Browser Run<br>JS 描画]
            Diff[変化検知]
            Extract[抽出チェーン]
            AI[Workers AI]
            Valid[検証 Zod]
            Merge[マージ・名寄せ]
        end

        R2[(R2<br>生 HTML 30 日)]
        D1[(D1<br>本体 DB)]

        subgraph Serve["提供 Worker（apps/mcp）"]
            Mcp["/mcp"]
            Rest["/api/v1"]
        end
    end

    D1 -->|sources 台帳| Cron
    Cron --> Queue
    Queue --> Fetch
    Fetch --> Gate
    Fetch -->|GET| Venue
    Fetch -.->|JS が必須のページ| Browser
    Browser -.-> Venue
    Fetch --> Diff
    Diff -->|変化あり| R2
    Diff -->|変化あり| Extract
    Extract -.->|ルールが壊れたとき| AI
    Extract --> Valid
    Valid --> Merge
    Merge --> D1

    Sonnet -->|設定 JSON| D1
    Sonnet -.->|会場別コードの PR| Crawl

    Client --> Mcp
    Client -.-> Rest
    Mcp --> D1
    Rest --> D1
```

| 部品 | 役割 |
| --- | --- |
| Cron / Queues | 毎時に台帳から対象を選び、取得ジョブを配って失敗時に再試行する |
| Durable Objects | 同一ドメインの同時接続 1・間隔 5 秒以上を 1 か所で守る |
| Browser Run | JS 描画が必要なページだけ HTML を取る。普通のページでは使わない |
| R2 | 変化があった生 HTML を解析用に 30 日だけ置く |
| Workers AI | ルールが壊れたときの予備の抽出、英語表記の生成 |
| D1 | 公演・会場・出演者の本体と、台帳、証跡、実行ログ |

## 2. 収集の流れ

大半のアクセスは「変化なし」で終わるので、抽出（LLM）まで進むのは変化があったページだけ。

```mermaid
sequenceDiagram
    participant Cr as Cron
    participant Q as Queues
    participant F as 取得
    participant G as Durable Objects
    participant S as 会場サイト
    participant R as R2
    participant E as 抽出チェーン
    participant D as D1

    Cr->>D: 今回回す sources を選ぶ
    Cr->>Q: 取得ジョブを積む
    Q->>F: ジョブ
    F->>S: robots.txt を確認（24 時間キャッシュ）
    F->>G: アクセス間隔を予約
    F->>S: 条件付き GET（ETag・Last-Modified）
    alt 304 または本文のハッシュが同じ
        F->>D: crawl_runs に changed=false を記録
    else 変化あり
        F->>R: 生 HTML を保存
        F->>E: 本文を渡す
        E->>E: 構造化データ → 設定 JSON → 予備の Workers AI
        E->>E: Zod で検証
        E->>D: events を upsert、observations に証跡
        E->>D: 検証に落ちたものは needs_review
    end
```

抽出の分岐（構造化データ → 設定 JSON → 会場別コード → 予備の LLM）の詳細は、[requirements.md の設計判断 3](requirements.md) の図を正とする。

## 3. データモデル

「公演（events）」と「その情報をどこで見たか（observations）」を分ける。同じ公演を複数のページで見つけても 1 件にまとまる。

```mermaid
erDiagram
    venues ||--o{ events : "開催"
    events ||--o{ event_artists : "出演"
    artists ||--o{ event_artists : "出演"
    sources ||--o{ observations : "抽出元"
    events ||--o{ observations : "証跡"
    sources ||--o{ crawl_runs : "実行"

    venues {
        string id PK
        string name_ja
        string name_en
        int capacity "不明は NULL。推定しない"
        string venue_kind "livehouse か club"
    }
    artists {
        string id PK
        string name_ja
        string name_en
        string mbid "MusicBrainz ID。任意"
    }
    events {
        string id PK
        string venue_id FK
        string date "興行日。JST"
        string start_at "UTC。並べ替え用"
        string start_text "元の表記。例 24:30"
        string status
        int needs_review
        string fingerprint
    }
    event_artists {
        string event_id FK
        string artist_id FK
        string role "headliner support guest"
    }
    sources {
        string id PK
        string kind
        string url
        string parser "rule か llm"
        string config_json "会場ごとの設定 JSON"
        int robots_ok
    }
    observations {
        int id PK
        string source_id FK
        string event_id FK
        string raw_r2_key
        string extracted_json
    }
    crawl_runs {
        int id PK
        string source_id FK
        int http_status
        int changed
        string error
    }
```

## 4. 役割分担

```mermaid
flowchart TD
    Dev["開発時：Claude Code 上の Sonnet<br>スクレイピングの実装・設定 JSON・テスト"]
    Human["人（Ken）<br>最初の 10 会場の目視・PR のマージ・抜き打ち"]
    Run["実行時：Cloudflare<br>Cron・Queues・Workers・Workers AI"]

    Dev -->|PR とデータ| Human
    Human -->|マージ・登録| Run
    Run -.->|ルール破損の通知| Human
    Human -.->|再生成を依頼| Dev
```

ルールが壊れたときは、予備の Workers AI 抽出に自動で戻り、再生成は人が Sonnet を起動して行う。
