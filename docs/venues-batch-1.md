# 会場追加 batch 1（渋谷近郊）

調査日は 2026-11-27（JST）。方針は「まず渋谷近郊から。club も入れる」。渋谷・宇田川町・道玄坂・円山町・代官山・恵比寿・中目黒あたりのライブハウスとクラブを 20 件ほど当たり、条件を満たす 10 件（ライブハウス 6、クラブ 4）を採用した。

取得の礼儀は Phase 0（`docs/phase0-venues.md`）と同じ。robots.txt を先に取り、同一ホストへは 5 秒以上あけ、会場あたり数リクエストにとどめた。User-Agent は `live-info-mcp-crawler/0.1 (+https://github.com/yk0817/live-info-mcp/issues)`。実ページの HTML はリポジトリに置かず（`apps/crawler/fixtures-local/` は .gitignore 済み）、テストには DOM 構造だけを模した合成 HTML（`apps/crawler/fixtures/<venue_id>/schedule.html`）を使う。

## 採否の条件

- 一覧がサーバー描画の HTML にあり、1 公演ごとに日付（月と日）が item の中から取れる
- robots.txt でスケジュールページが許可されている（404 は制限なしとみなす。403・5xx で読めなければ見送る）
- 収容 1000 人以下。収容人数は公式サイトに書いてあるものだけ入れ、無ければ NULL（推定しない）

## 採用した 10 会場

| id | 会場 | 種別 | 収容 | スケジュールページ | robots | 描画・構造 | 実ページの抽出件数 |
|---|---|---|---|---|---|---|---|
| `venue-shibuya-o-nest` | 渋谷O-nest | livehouse | NULL | `https://shibuya-o.com/nest/schedule/?y=YYYY&m=M` | OK（`/wp-admin/` のみ Disallow） | WordPress。カード `.p-scheduled-card` | 45 / 45 |
| `venue-shibuya-o-crest` | 渋谷O-Crest | livehouse | NULL | `https://shibuya-o.com/crest/schedule/?y=YYYY&m=M` | 同上 | 同上（同じテーマ） | 42 / 42 |
| `venue-shibuya-o-west` | 渋谷O-WEST | livehouse | NULL | `https://shibuya-o.com/west/schedule/?y=YYYY&m=M` | 同上 | 同上（同じテーマ） | 35 / 35 |
| `venue-shibuya-quattro` | 渋谷CLUB QUATTRO | livehouse | NULL | `https://www.club-quattro.com/shibuya/schedule/?ym=YYYYMM` | OK（robots.txt は無く、`/notfound/` の HTML に転送される＝規則なし） | 独自 CMS。`li.list-item[data-event-date]` | 30 / 30 |
| `venue-shibuya-lamama` | 渋谷La.mama | livehouse | 230（公式 ABOUT「スタンディング 230」） | `https://www.lamama.net/schedule/?month=YYYY-MM` | OK（`/wp-admin/` のみ Disallow） | WordPress。`a.pickup_btn.schedule[data-schedule]` | 45 / 45 |
| `venue-daikanyama-spaceodd` | 代官山SPACE ODD | livehouse | NULL | `https://spaceodd.jp/schedule/?event_year=YYYY&event_month=M` | OK（`/wp-admin/` のみ Disallow） | WordPress・Tailwind。独自タグ `<d id="post-N">` | 27 枠 → 10 公演（Coming soon 17 件を skip） |
| `venue-shibuya-circus` | 渋谷Circus Tokyo | club | NULL | `https://circus-tokyo.jp/schedule/` | OK（`/wp-admin/` のみ Disallow） | WP Event Manager。`.wpem-event-layout-wrapper` | 24 / 24 |
| `venue-ebisu-batica` | 恵比寿BATICA | club | NULL | `https://batica.jp/events/` | OK（`/wp/wp-admin/` のみ Disallow） | The Events Calendar の月表示 | 44 枠 → 42 公演（TBA 2 件を skip） |
| `venue-nakameguro-solfa` | 中目黒solfa | club | NULL | `https://nakameguro-solfa.com/events/` | OK（`/wp/wp-admin/` のみ Disallow） | The Events Calendar の月表示（BATICA と同じ） | 36 枠 → 34 公演（TBA 2 件を skip） |
| `venue-shibuya-theroom` | 渋谷THE ROOM | club | NULL | `https://theroom.jp/schedule/?ym=YYYY-MM` | OK（`/wp-admin/` のみ Disallow） | WordPress・Elementor。`.schedule-card` | 19 / 19 |

抽出件数は 2026-11 のページ（Circus は直近一覧、BATICA・solfa は当月の月表示）に設定を当てた結果。どの会場も `extractedEventSchema` に全件通り、時刻の拒否（issues）は 0 件だった。

### 実ページでの代表確認（各 3 件）

ページ上の表記と抽出結果（日付・open/start・出演者）を突き合わせた。

| 会場 | 確認した公演（日付 open/start・出演者） |
|---|---|
| O-nest | 11/01 10:45/11:15・1 組 ／ 11/01 18:00/18:30・3 組・SOLD OUT → sold_out ／ 11/03 10:30/11:00・5 組 |
| O-Crest | 11/01 11:15/12:00・1 組 ／ 11/02 18:30/19:00・出演者欄が全角空白 → 出演者なし ／ 11/03 11:00/11:30・3 組 |
| O-WEST | 11/01 16:00/16:30・1 組 ／ 11/04 18:20/19:00・4 組 ／ 11/05 18:00/19:00・出演者欄なし・SOLD OUT |
| CLUB QUATTRO | 11/01 17:15/18:00・1 組 ／ 11/03 16:00/17:00・3 組（「（※順不同)」を除去） ／ 11/23 17:15/18:00・`<br>` 区切りの 2 組 |
| La.mama | 11/27 時刻なし・「MC：」「他」を除いた 2 組 ／ 11/28 DAY と NIGHT の 2 公演 ／ 12/03（翌月 PICK UP）3 組 |
| SPACE ODD | 11/05 19:00/19:30 ／ 11/06 二重ラベル「OPEN/START： OPEN/START:19:00/19:30」→ 19:00/19:30 ／ 11/03 時刻なし |
| Circus Tokyo | 11/27 start 23:00 ／ 11/28 start 14:00 と 23:00 の 2 公演 ／ 11/28【SOLD OUT】→ sold_out |
| BATICA | 10/27 open 19:00 ／ 11/03 open 16:00 と 23:00 の 2 公演 ／ 11/27 open 23:30（説明文は OPEN 24:00。カレンダーの開始時刻を採る） |
| solfa | 11/07 open 15:00 と 23:00 の 2 公演 ／ 11/14 open 12:00 ／ 11/29「TBA」は skip |
| THE ROOM | 11/03 時刻なし・DJ 3 組 ／ 11/04 [GUEST DJ] と [DJ] の見出しを除いた 4 組 ／ 11/28 LIVE と DJ の 2 公演 |

## 会場ごとのメモ

### 渋谷 O-nest / O-Crest / O-WEST（shibuya-o.com 共通テーマ）

3 会場とも同じテーマで、設定は URL 以外同じ。O-EAST は収容が大きいので対象外。

| 項目 | セレクタ |
|---|---|
| 公演 | `.p-schedule__list > .p-scheduled-card` |
| 日付 | `.p-scheduled-card__date-item`（`11 / 01`。年は URL の `y`、無ければ now から推定） |
| タイトル | `.p-scheduled-card__title-top` / `-main` / `-bottom` を連結 |
| 出演者 | `.p-scheduled-card__artist-item`（全角空白だけの `li` があり、空として捨てる） |
| open / start | `.p-scheduled-card__date-open`（`OPEN 18:00 / START 18:30`） |
| 完売 | `.p-scheduled-card__soldout`（`SOLD OUT`）→ `sold_out` |

### 渋谷CLUB QUATTRO

渋谷・名古屋・梅田・広島で同じ CMS。月別は `?ym=202611`。

- 日付は `li` の `data-event-date`。公演名は `.txt-02`、出演者は `.txt-01`（`/` と `<br>` 区切り）。
- 時刻は `dt` が「開場/開演」の次の `dd`。「1回目 15:30 / 16:00. 2回目 18:00 / 19:00」は先頭の回だけ取る。
- 出演者欄の `[Vo,G 名前 / G, 名前]` のようなメンバー表記も `/` で分かれてしまう（未対応）。
- 収容は公式サイトの会場ページに見当たらず NULL。

### 渋谷La.mama

- ページは「今後の公演 → NEXT MONTH PICK UP（翌月の一部）→ FINISHED（当月の終了分）」の順で、DOM 順は日付順ではない。
- 一覧に時刻はなく、`.time_zone` の DAY / NIGHT だけ。同じ日の昼夜は別公演として取る（時刻は null）。
- 出演者 `.member` は `/` 区切り。「MC：」「ゲスト：」「(O.A.)」「他」「ほか」を外し、「※」で始まる注記と and more… を捨てる。番号付きの出演順（`1 ROCK ON`）はそのまま残る。

### 代官山SPACE ODD

- カードは独自タグ `<d>` で、クラスは Tailwind のユーティリティだけ。日付（`2026. 11.01`）と時刻（`OPEN/START： 19:00/19:30`）はカード全体の text に正規表現を当てる。
- 「Coming soon…」の仮カードが半分以上あり、skip する。一覧に出演者はない。

### 渋谷Circus Tokyo

- WP Event Manager の一覧。月別 URL はなく、SSR されるのは直近の約 24 件。それより先は Ajax の「もっと見る」で、取れない。
- `.wpem-event-date-time-text` の `2026-11-27 - 23:00 - 2026-11-28 - 05:00` から開始日と開始時刻（start）を取る。完売はタイトル先頭の【SOLD OUT】だけ。

### 恵比寿BATICA / 中目黒solfa（The Events Calendar）

- 既定で当月の月表示。前後月の週の端の日の公演も入る。月の切り替え URL はロケール付きの `/events/月/2026-12/` なので使わず、`/events/` を毎日取る。
- 公演は `article.tribe-events-calendar-month__calendar-event`。モバイル用の複製（`mobile-event`）と、solfa の休業日「CLOSED」（終日の `multiday-event`）は数えない。
- 日付はツールチップの `time[datetime]`（YYYY-MM-DD）。最初の `time[datetime]`（HH:MM）は説明文の OPEN と一致するので open に写す。「TBA」の仮枠は skip。
- `/wp-json/tribe/events/v1/` の REST API もあるが、DOM ルールの範囲で足りるので使わない。

### 渋谷THE ROOM

- 月別は `?ym=2026-11`。日付は `.date`（`2026-11-03 TUE`）。一覧に時刻はない。
- 出演者 `.dj` は `<br>` 区切りで、`[DJ]` `[GUEST DJ]` `[LIVE]` の見出し行が混ざる。行頭の見出しを外し、見出しだけの行は捨てる。バンドの編成行（`(Gt)名前`）も 1 組として入る（区別できない）。

## 見送った会場

| 会場 | 理由 |
|---|---|
| 渋谷WWW / WWW X（WWWβ） | robots.txt は 404（制限なし）でサーバー描画だが、カードの日付が日だけ（`01`）で月が item の中にない。月はページ見出しにしかなく、今のエンジン（月は item 内のパターン必須）では取れない。エンジンに「見出しから月を取る」を足せば 1 ページで 3 会場取れる |
| 渋谷eggman | スケジュール（`/schedule-cat/daytime/`）も日だけで月が item にない。ページ送り（1 ページ 17 件）もある |
| 恵比寿LIQUIDROOM | robots は OK、サーバー描画で取りやすい（日付は詳細 URL の `_20261101`）。ただし公式サイトで収容人数を確認できず、1000 超かどうか判断できないので今回は見送り |
| 渋谷clubasia | robots は `Allow: /`。Framer 製で、同じ一覧がブレークポイントごとに 3 重に SSR され、区別できるのはハッシュ化クラス（`hidden-xxxx`）だけ。公開し直すたびに変わりうるので壊れやすい |
| 渋谷Harlem | robots.txt は 404。スケジュールは iframe（`/schedule/calender.html`）で、中身は画像の表。テキストの一覧がない |
| 渋谷SOUND MUSEUM VISION | `vision-tokyo.com` は robots.txt もトップも 404（LiteSpeed）。サイトの所在を確認できない |
| 表参道VENT | `vent-tokyo.net` に接続できなかった（名前解決または TLS で失敗） |
| 渋谷Contact | Phase 0 で robots.txt が 403 のため見送り済み |
| 渋谷bar bridge | `bar-bridge.com` は別業態の店舗のサイトで、会場のサイトを特定できなかった |
| 渋谷Star lounge / 渋谷CYCLONE | 推測したドメインに接続できず、公式サイトを特定できなかった |
| 渋谷O-EAST | 収容が大きく対象外（指示どおり除外） |

## 既知の制限

- 収容人数は La.mama 以外 NULL。公式サイトに明記がない会場は人が確認して埋める（`seeds/venues.sql` の TODO(T13) と同じ扱い）。
- La.mama と THE ROOM は一覧に時刻がない。詳細ページには書いてあるが、今は詳細ページを取らない。
- Circus Tokyo は直近の約 24 件のみ。BATICA・solfa は当月の月表示のみ（翌月分は月末近くまで出ない）。
- BATICA・solfa の open はカレンダーの開始時刻で、説明文の表記（`OPEN 24:00` など）とずれることがある。
