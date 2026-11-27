/**
 * 試しの結果（out.json）を、読める形にする。
 *   npx tsx report.mts out.json report.md [--translate]
 * 似ている度合い: 説明の文どうし（5 回 = 10 組）で、同じ単語がどのくらい重なるか（0 = 全部ちがう、100 = 同じ）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , IN, OUT, flag] = process.argv;
const data = JSON.parse(readFileSync(IN, 'utf8'));
const METHODS: [string, string][] = [
  ['now', 'いまの方法'],
  ['avoid', '「さっきと違うものに」だけ'],
  ['lot', 'くじのヒント'],
  ['lot+', 'くじのヒント + さっきと違うものに'],
  ['one', '1 回で頼む（くじを全部わたす）'],
];
const STOP = new Set('a an the and or of with in on at to for from by is are it its this that as into over under around each every small large little big very featuring features has have made style styled design designed dress one-piece onepiece'.split(' '));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((w) => b.has(w)).length;
  return inter / (a.size + b.size - inter || 1);
};
const hueName = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15) return l > 0.8 ? '白' : l < 0.25 ? '黒' : '灰';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return '赤';
  if (h < 45) return 'だいだい';
  if (h < 70) return '黄';
  if (h < 165) return '緑';
  if (h < 200) return '水色';
  if (h < 260) return '青';
  if (h < 300) return '紫';
  return 'ピンク';
};

async function translate(lines: string[]): Promise<string[]> {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': 'dummy', 'api-revision': '2026-05-20' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash',
      system_instruction: 'Translate each English clothing description into one short, plain Japanese sentence (at most 60 characters). Keep colours, shapes, patterns and decorations. Reply with JSON only.',
      input: [{ type: 'text', text: lines.map((l, i) => `${i + 1}. ${l}`).join('\n') }],
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { ja: { type: 'array', items: { type: 'string' } } }, required: ['ja'] } },
    }),
  });
  const json = await r.json();
  let text = '';
  for (const step of json.steps ?? []) if (step.type === 'model_output') for (const b of step.content ?? []) if (b.type === 'text') text = b.text;
  const ja = JSON.parse(text).ja as string[];
  return lines.map((_, i) => ja[i] ?? '');
}

const md: string[] = [];
const summary: string[] = ['| テーマ | ' + METHODS.map(([, ja]) => ja).join(' | ') + ' |', '|---|' + METHODS.map(() => '---').join('|') + '|'];
for (const t of data.themes) {
  md.push(`## 「${t.theme}」（${t.kind}）`, '');
  const cells: string[] = [];
  for (const [method, label] of METHODS) {
    const rows = t.rows.filter((r: { method: string }) => r.method === method);
    const ok = rows.filter((r: { item: unknown }) => r.item);
    const sets = ok.map((r: { item: { description: string } }) => words(r.item.description));
    const pairs: number[] = [];
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) pairs.push(jaccard(sets[i], sets[j]));
    const sim = pairs.length ? Math.round((pairs.reduce((a, b) => a + b, 0) / pairs.length) * 100) : NaN;
    const mains = ok.map((r: { item: { colors: string[] } }) => (r.item.colors[0] ? hueName(r.item.colors[0]) : '?'));
    const distinct = new Set(mains).size;
    const ms = Math.round(rows.reduce((a: number, r: { ms: number }) => a + r.ms, 0) / (rows.length || 1) / 100) / 10;
    cells.push(`${sim}／${distinct} 色`);
    md.push(`### ${label} — 似ている度合い ${sim}、いちばん多い色の種類 ${distinct}（${mains.join('・')}）、1 回 ${ms} 秒`, '');
    const ja = flag === '--translate' && ok.length ? await translate(ok.map((r: { item: { description: string } }) => r.item.description)) : [];
    let k = 0;
    for (const r of rows) {
      if (!r.item) {
        md.push(`${r.run + 1}. （失敗: ${r.error}）`);
        continue;
      }
      const level = r.level ? `【${{ tight: 'きっちり', normal: 'ふつう', wide: 'ひろく' }[r.level as string]}${r.fixed?.length ? ` 決まっている: ${r.fixed.join(',')}` : ''}${r.topics?.length ? ` 話題: ${r.topics.join(',')}` : ''}】` : '';
      const hints = r.hints?.length ? `くじ: ${(method === 'one' ? r.hints.slice(0, 3) : r.hints).map((h: { ja: string }) => h.ja).join('、')}${method === 'one' ? '（先頭 3 つ）' : ''}` : r.hints ? 'くじ: なし' : '';
      md.push(`${r.run + 1}. **${r.item.name}** ${level} ${hints}`.trimEnd());
      if (ja[k]) md.push(`   - ${ja[k]}`);
      md.push(`   - ${r.item.description}`);
      k++;
    }
    md.push('');
  }
  summary.push(`| ${t.theme}（${t.kind}） | ${cells.join(' | ')} |`);
}
writeFileSync(OUT, [`# 文だけの比べ（${data.model}、呼び出し ${data.calls} 回、画像 0 枚）`, '', '数字は「似ている度合い（0〜100。小さいほど、ばらばら）／5 回のうち、いちばん多い色が何種類か」。', '', ...summary, '', ...md].join('\n'));
console.log(summary.join('\n'));
