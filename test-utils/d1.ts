/// <reference types="node" />
// テスト専用: node:sqlite を D1Database 互換に見せる最小の shim。
// 実装済みは prepare().bind().all()/first()/run()/raw() と batch()/exec() のみ。
// 他の D1 API（dump・withSession など）は呼ばれたら型で気づけるよう、意図的に載せていない。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

// URL 型は workers-types と node の定義が衝突するため、文字列パスで扱う。
const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: readonly SQLInputValue[] = []
  ) {}

  // D1 の bind は新しい statement を返す（呼び出し側の再利用を壊さない）。
  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, values as SQLInputValue[])
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[]
    return { success: true, results, meta: {} } as unknown as D1Result<T>
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const info = this.db.prepare(this.sql).run(...this.params)
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
    } as unknown as D1Result<T>
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this.sql)
    stmt.setReturnArrays(true)
    return stmt.all(...this.params) as T[]
  }
}

class ShimDatabase {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): Statement {
    return new Statement(this.db, sql)
  }

  // D1 の batch はトランザクション。途中で失敗したら全部巻き戻す。
  async batch<T = unknown>(statements: Statement[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = []
    this.db.exec('BEGIN')
    try {
      for (const s of statements) out.push(await s.run<T>())
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return out
  }

  async exec(sql: string): Promise<D1ExecResult> {
    this.db.exec(sql)
    return { count: 0, duration: 0 }
  }
}

export function createD1Shim(db: DatabaseSync = new DatabaseSync(':memory:')): D1Database {
  return new ShimDatabase(db) as unknown as D1Database
}

// migrations/*.sql をファイル名順に流した空の DB を返す。ファイル名が連番なので辞書順で足りる。
export function createMigratedDb(): D1Database {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) raw.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  return createD1Shim(raw)
}
