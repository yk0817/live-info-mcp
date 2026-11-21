import { describe, expect, it } from 'vitest'
import { detectChange } from './detect'
import { normalizeBody } from './normalize'
import { saveRawHtml, type RawBucket } from './raw-store'

const PAGE = `<!doctype html><html><head><title>t</title>
<script nonce="abc123">window.__t = 1</script><style>.a{}</style></head>
<body>
<header>menu A</header>
<nav>nav</nav>
<main>
  <form><input type="hidden" name="csrf" value="tok1"><input name="q"></form>
  <ul class="ev-x9f"><li data-ts="111"><a href="/e/1">2026-12-01 Band A</a></li><li><a href="/e/2">2026-12-02 Band B</a></li></ul>
  <div class="ad">AD one</div>
</main>
<footer>visitors 100</footer>
<!-- built at 111 -->
</body></html>`

describe('normalizeBody / detectChange', () => {
  // Contract: noise that changes per request (whitespace, nonce, csrf, data-*, classes, comments, chrome) never changes the hash.
  it('gives the same hash for the same content despite per-request noise', async () => {
    const noisy = PAGE.replace('abc123', 'zzz999')
      .replace('tok1', 'tok2')
      .replace('data-ts="111"', 'data-ts="999"')
      .replace('ev-x9f', 'ev-q1w')
      .replace('built at 111', 'built at 222')
      .replace('menu A', 'menu B (new banner)')
      .replace('visitors 100', 'visitors 101')
      .replace(/\n\s*/g, '\n\n   ')
    const a = await detectChange({ previousHash: null, html: PAGE })
    const b = await detectChange({ previousHash: a.hash, html: noisy })
    expect(b.hash).toBe(a.hash)
    expect(b.changed).toBe(false)
  })

  // Contract: a real content change is detected.
  it('detects a real content change', async () => {
    const a = await detectChange({ previousHash: null, html: PAGE })
    const b = await detectChange({ previousHash: a.hash, html: PAGE.replace('Band B', 'Band C') })
    expect(b.changed).toBe(true)
    expect(b.hash).not.toBe(a.hash)
  })

  it('treats a link target change as a content change (ticket URL)', async () => {
    const a = await detectChange({ previousHash: null, html: PAGE })
    const b = await detectChange({ previousHash: a.hash, html: PAGE.replace('/e/2', '/e/3') })
    expect(b.changed).toBe(true)
  })

  it('first run (no previous hash) is changed', async () => {
    expect((await detectChange({ previousHash: null, html: PAGE })).changed).toBe(true)
  })

  // Contract: per-source ignoreSelectors drop volatile blocks.
  it('ignoreSelectors removes matching elements from the hash', async () => {
    const ignoring = ['.ad']
    const a = await detectChange({ previousHash: null, html: PAGE, ignoreSelectors: ignoring })
    const b = await detectChange({
      previousHash: a.hash,
      html: PAGE.replace('AD one', 'AD two'),
      ignoreSelectors: ignoring
    })
    expect(b.changed).toBe(false)
    const without = await detectChange({ previousHash: a.hash, html: PAGE.replace('AD one', 'AD two') })
    const base = await detectChange({ previousHash: null, html: PAGE })
    expect(without.hash).not.toBe(base.hash)
  })

  it('normalized output has no script, style, comments, hidden inputs or chrome', () => {
    const out = normalizeBody(PAGE)
    for (const unwanted of ['window.__t', '.a{}', 'built at', 'tok1', 'menu A', 'visitors', 'nonce', 'data-ts', 'class=']) {
      expect(out).not.toContain(unwanted)
    }
    expect(out).toContain('Band A')
    expect(out).toContain('href="/e/1"')
  })

  it('is deterministic and does not depend on attribute order', () => {
    expect(normalizeBody('<body><a title="t" href="/x">y</a></body>')).toBe(
      normalizeBody('<body><a href="/x"   title="t">y</a></body>')
    )
  })
})

class FakeR2 implements RawBucket {
  readonly objects = new Map<string, { value: string; contentType: string | undefined }>()
  puts = 0
  async head(key: string): Promise<unknown | null> {
    return this.objects.get(key) ?? null
  }
  async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown> {
    this.puts += 1
    this.objects.set(key, { value, contentType: options?.httpMetadata?.contentType })
    return {}
  }
}

describe('saveRawHtml', () => {
  // Contract: key is raw/<sourceId>/<JST date>/<hash>.html with text/html, and a repeat save is a no-op.
  it('stores under the JST date key with text/html, idempotently', async () => {
    const r2 = new FakeR2()
    // 2026-11-20T16:00:00Z は JST では 11-21 01:00
    const input = { sourceId: 'shibuya-xxx', fetchedAt: new Date('2026-11-20T16:00:00Z'), hash: 'abc', html: '<p>x</p>' }
    const key = await saveRawHtml(r2, input)
    expect(key).toBe('raw/shibuya-xxx/2026-11-21/abc.html')
    expect(r2.objects.get(key)).toEqual({ value: '<p>x</p>', contentType: 'text/html' })
    expect(await saveRawHtml(r2, input)).toBe(key)
    expect(r2.puts).toBe(1)
  })

  it('a different hash or day gets a different key', async () => {
    const r2 = new FakeR2()
    const base = { sourceId: 's', fetchedAt: new Date('2026-11-21T00:00:00Z'), html: 'x' }
    const k1 = await saveRawHtml(r2, { ...base, hash: 'a' })
    const k2 = await saveRawHtml(r2, { ...base, hash: 'b' })
    const k3 = await saveRawHtml(r2, { ...base, hash: 'a', fetchedAt: new Date('2026-11-23T00:00:00Z') })
    expect(new Set([k1, k2, k3]).size).toBe(3)
    expect(r2.puts).toBe(3)
  })
})
