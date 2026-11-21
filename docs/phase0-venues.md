# Phase 0 会場調査（T13-lite）

調査日は 2026-11-21（JST）。会場の公式スケジュールページを礼儀正しく（robots.txt を先に確認、同一ホスト 5 秒間隔、会場あたり数リクエスト）取得し、抽出のしやすさを判定した。HTML の実物は `apps/crawler/fixtures/<venue_id>/schedule.html` に保存してある。

## 概要

| 会場 | 種別 | スケジュールページ | robots | レンダリング | 構造化データ | 難度 |
|---|---|---|---|---|---|---|
| 下北沢SHELTER | livehouse | `https://www.loft-prj.co.jp/schedule/shelter/schedule` | OK（robots.txt なし） | サーバー描画 | なし（JSON-LD は WebPage のみ） | 易 |
| 新宿LOFT | livehouse | `https://www.loft-prj.co.jp/schedule/loft/schedule` | OK（同上） | サーバー描画 | なし | 易 |
| 渋谷duo MUSIC EXCHANGE | livehouse | `https://www.duomusicexchange.com/schedule/2026/index_2026-11.html` | OK（robots.txt は 404） | 静的 HTML（手書き） | なし | 中 |
| 渋谷WOMB | club | `https://www.womb.co.jp/ja/events`（トップ `https://www.womb.co.jp/ja` にも直近分） | OK（`Allow: /`） | サーバー描画（Next.js、カードは SSR） | NightClub のみ。イベントは RSC ペイロードの JSON | 中 |
| 代官山UNIT（渋谷Contact の代替） | club | `https://www.unit-tokyo.com/schedule/` | OK（`/wp/wp-admin/` のみ Disallow） | サーバー描画（WordPress） | JSON-LD の `Event` 30 件、RSS あり | 易 |

iCal はどの会場にもなかった。RSS は UNIT のみ（`/schedule/feed/`）。

## 差し替え

渋谷Contact（`www.contacttokyo.com`）は `robots.txt` もトップページも `UA: live-info-mcp-research/0.1` に対して 403（XSERVER の Forbidden）を返し、robots.txt を読めなかった。許可を確認できない会場は取得しない方針なので、同じ club の代官山UNIT（`venue-daikanyama-unit`）に差し替えた。403 は WAF の UA 判定の可能性があり、人が通常のブラウザで robots.txt を確認すれば戻せる。UNIT は収容人数を推定しないため `capacity` などは NULL のまま。

## 下北沢SHELTER / 新宿LOFT（同一 CMS）

LOFT PROJECT 共通の WordPress テーマ。URL は `.../schedule/<shelter|loft>/schedule`。月の切り替えは `?scheduleyear=2026&schedulemonth=11`（ページ上部の `.navi_month` の PREV と ARCHIVE セレクトに全月の URL がある）。1 ページに 1 か月分（SHELTER 38 件、LOFT 35 件）。

| 項目 | セレクタ候補 |
|---|---|
| イベント | `.block_schedule_list .list > .column` |
| 日付 | `.column time` 内の `.year` `.month` `.day`（数値分割。曜日は英語 `.week`） |
| タイトル | `.c_title span` |
| 出演者 | `.artist_tag li`（多いと末尾が `<li>...</li>` で省略される） |
| open / start | `.open` のテキスト `OPEN 18:00 - START 19:00` |
| 詳細 URL | `.column > a[href]`（イベント詳細へ。チケットはここにある） |
| 完売・受付終了 | `.column > p.soldout`（文言は「このイベントの予約は締めきりました。」） |

注意点。
- 同じ日に複数の `.column` がある（昼夜 2 部は別カード）。
- `.open` が空のカードがあり、開演時刻なしを許容する必要がある（SHELTER の記念イベントなど）。
- `メンテナンス` のような非公演カードが混ざる（LOFT）。
- 深夜の `OPEN 23:30 - START 24:00` のように 24 時超え表記がある。
- SHELTER の `.soldout` は予約締切であり、必ずしも完売ではない。status の対応表は T 側で決める。
- `.column` 内に出演者が空のカードがあるので、出演者は任意項目。
- 日付は JST の暦日。JSON-LD にはイベントがなく、DOM のみが頼り。

## 渋谷duo MUSIC EXCHANGE

月別の静的ページ `https://www.duomusicexchange.com/schedule/YYYY/index_YYYY-MM.html`（トップから全月へのリンクあり）。手書きの Bootstrap 風 HTML で、日付ブロックが 1 イベント。ページあたり 31 ブロック。

| 項目 | セレクタ候補 |
|---|---|
| イベント | `section#daybox`（id が重複するので属性でなく要素で拾う） |
| 日付 | 直前の `<a name="261121">`（YYMMDD）。見た目は `.date .day`（日のみ）と `.saturday` `.weekday` `.holiday` |
| タイトル | `.details-title` |
| 出演者 | `.artist`（`<br>` 区切り。`<font>【ALLNIGHT】</font>` のような装飾が混じる） |
| open / start | `dl` の `dt` が `OPEN/START` の次の `dd`（`15:00 / 16:00`、または `24:00` の単独値） |
| チケット | `dt` が `Ticket.` の次の `dd a[href]`（e+ や Google フォームなど外部） |
| 料金 | `dt` が `ADV./DOOR` の次の `dd` |
| 完売 | ページ内に完売表記なし（今月分では確認できず） |

注意点。
- 同じ日付に複数ブロックがある（昼公演と `24:00` 開始の ALLNIGHT 公演）。
- `24:00` の単独値は open/start の区別がない。深夜表記は翌日扱いの正規化が必要。
- クラス名より `dt` のラベル文字で値を引く方が壊れにくい。
- 月ページの切り替えは URL の月番号のみで簡単。画像パスの `11-img/` は月ごとに変わる。

## 渋谷WOMB

Next.js（microCMS）。`/ja/events` は 2.8MB の巨大ページで、一覧は DOM ではなく RSC ペイロード（`self.__next_f` の JSON、`allEvents` 配列）に入っている。サイズが重いのでフィクスチャはトップページ `https://www.womb.co.jp/ja` の HTML（SSR されたカード約 20 件）にした。

| 項目 | セレクタ候補（トップの SSR カード） |
|---|---|
| イベント | `.events-grid > article.event-card` |
| 日付 | `.event-date`（`11/21 SAT`。年なし） |
| 時刻 | `.event-time`（`23:00-4:30`。open-終了で、終了は翌朝） |
| タイトル | `.event-title` |
| 出演者 | `.event-artists`（カンマ区切り） |
| 詳細 URL | `article.event-card > a[href]`（`/ja/events/112126` など。末尾 6 桁は MMDDYY 風の id） |
| チケット | 一覧にはなく、詳細ページか RSC の `tickets[].ticket_link`（ZAIKO） |

RSC 側のフィールドは `title` `date`（`2026-11-20T15:00:00.000Z`、これは JST 11/21 0 時の UTC 表現）`time`（`23:00-4:30`）`fee` `genre` `tickets` `url`。注意点。
- 日付は UTC 表現で 1 日前にずれて見える。JST に直してから使う。
- 時刻は 「開始-終了」の形で、終了が翌日 4:30 のように日付をまたぐ。
- DOM の日付は年がなく、年は文脈（月の並び）から補う。
- 一覧は直近約 20 件のみ。月単位でなく先の日付まで取るには RSC か詳細ページが必要。
- `/_next/image` のような画像の変換 URL は無視する。
- `WOMBLIVE` は別サイト（`womblive.jp`）で対象外。

## 代官山UNIT（渋谷Contact の代替）

WordPress。月別ページ `https://www.unit-tokyo.com/schedule/YYYY-MM/`（`/schedule/` は当月）。ページ上部の `.p-schedule__nav` に前後月のリンク。`<link rel="alternate" type="application/rss+xml" href=".../schedule/feed/">` の RSS がある。

JSON-LD の `Event`（schema.org、30 件）が最も楽で、`name` `url` `startDate`（日付のみ）`endDate` `image` `performer`（中身は `"Organization"` という文字列でアーティスト名は入らない）を持つ。時刻は入らない。DOM を併用する。

| 項目 | セレクタ候補 |
|---|---|
| イベント | `.p-schedule__body > .p-schedule__item`（曜日クラス `SUN` など付き） |
| 日付 | `.p-schedule__item-date`（`11/01`。年はページ見出し `.p-schedule__header-title` の `2026.11`） |
| 時刻 | `.p-schedule__item-open span`（`OPEN 18:00`。start は一覧にない） |
| タイトル | `.p-schedule__item-title`（上下に `-title-top` `-title-bottom` の補助行） |
| 出演者 | `.p-schedule__item-lineup`（`/` 区切り） |
| 詳細 URL | `.p-schedule__item > a[href]`（`/schedule/14979/`） |
| カテゴリ | `.p-schedule__item-category`（`RECOMMEND` `FEATURE`。status ではない） |

注意点。
- start 時刻は詳細ページを見ないと取れない可能性がある（未確認）。
- 完売表記は今月分に見当たらなかった。
- 年は DOM の日付に含まれない。JSON-LD の `startDate` が年を持つのでそちらで補完できる。
- `UNIT` は club だがライブ公演も多い。種別 `club` が妥当かは人が確認する。

## 次にやること

- 各会場の `official_url` `capacity` `lat` `lng` `nearest_station` を人が確認して埋める（T13）。
- SHELTER・LOFT・UNIT は DOM ルールで抽出できる。duo はラベル引き、WOMB は RSC か SSR カード。
- 24 時超え・終了時刻が翌日・日付が UTC 表現の 3 ケースは時刻変換のテストに入れる。
