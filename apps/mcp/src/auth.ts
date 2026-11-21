// Bearer 認証。要件: 知人限定公開で、認証なしの公開はしない。
// MCP_TOKENS が未設定・空のときは「全拒否」ではなく 503（設定漏れを 401 に紛れさせず、開けっ放しにもしない）。

export interface AuthEnv {
  MCP_TOKENS?: string | undefined
}

const encoder = new TextEncoder()

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

// 長さの違うトークン同士でも同じ長さで比較できるよう、先にハッシュ化してから全バイトを XOR する。
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= (ha[i] ?? 0) ^ (hb[i] ?? 0)
  return diff === 0
}

export function parseTokens(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

function bearerOf(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return m?.[1] ?? null
}

// 通す場合は null、止める場合はそのまま返す Response。
export async function authorize(request: Request, env: AuthEnv): Promise<Response | null> {
  const tokens = parseTokens(env.MCP_TOKENS)
  if (tokens.length === 0) {
    return Response.json({ error: 'server_misconfigured' }, { status: 503 })
  }
  const presented = bearerOf(request)
  if (presented === null) return unauthorized()
  // 一致しても途中で抜けず、全トークンと比較する（どれに一致したかを時間で漏らさない）。
  let ok = false
  for (const t of tokens) ok = (await constantTimeEqual(presented, t)) || ok
  return ok ? null : unauthorized()
}

function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'www-authenticate': 'Bearer' } })
}
