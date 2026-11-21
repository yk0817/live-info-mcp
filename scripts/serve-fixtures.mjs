// ローカル実行用: 保存済みフィクスチャを http://127.0.0.1:8899/<venue_id>/schedule.html で配る（外部アクセスなし）。
// robots.txt は 404（= 全許可）。使い方: node scripts/serve-fixtures.mjs [port]
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const port = Number(process.argv[2] ?? 8899)
const root = resolve(import.meta.dirname, '../apps/crawler/fixtures')

const server = createServer((req, res) => {
  const m = /^\/(venue-[a-z0-9-]+)\/schedule\.html$/.exec(req.url?.split('?')[0] ?? '')
  const file = m ? resolve(root, m[1], 'schedule.html') : null
  if (file === null || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    return
  }
  process.stdout.write(`served ${req.url}\n`)
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(file))
})

server.listen(port, '127.0.0.1', () => process.stdout.write(`fixtures on http://127.0.0.1:${port}\n`))
