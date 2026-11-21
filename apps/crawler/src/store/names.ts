// 名寄せ・同一判定に使う正規化。NFKC で全角半角を揃え、小文字化し、空白を 1 つに畳む。
export function normalizeName(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}

// ひらがな・カタカナ・漢字・長音を含めば日本語表記とみなす（それ以外は name_en に入れる）
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/u

export const isJapaneseName = (name: string): boolean => JAPANESE.test(name)
