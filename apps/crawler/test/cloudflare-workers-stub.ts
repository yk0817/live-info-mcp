// Node の vitest では `cloudflare:workers` を解決できないので、DurableObject の最小スタブで差し替える。
export class DurableObject {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: unknown
  ) {}
}
