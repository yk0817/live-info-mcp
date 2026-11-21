// apps/crawler/venue-configs/*.json から seeds/source-configs.sql を生成する。
// 使い方: npm run seed:configs
// config_json は 1 行の JSON に詰めて入れる。シングルクォートは '' にエスケープする。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configDir = join(root, 'apps/crawler/venue-configs')
const outFile = join(root, 'seeds/source-configs.sql')

const files = readdirSync(configDir)
  .filter((f) => f.endsWith('.json'))
  .sort()

const statements = files.map((file) => {
  const venueId = file.replace(/\.json$/, '')
  const json = JSON.stringify(JSON.parse(readFileSync(join(configDir, file), 'utf8')))
  return `UPDATE sources SET config_json = '${json.replaceAll("'", "''")}' , needs_review = 0 WHERE id = 'src_${venueId}';`
})

const header = [
  '-- 生成物。編集せず `npm run seed:configs` で作り直す（元は apps/crawler/venue-configs/*.json）。',
  '-- seeds/sources.sql の後に流す。何度流しても同じ結果になる。',
  ''
].join('\n')

writeFileSync(outFile, `${header}${statements.join('\n')}\n`)
stdout.write(`wrote ${outFile} (${statements.length} sources)\n`)
