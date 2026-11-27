/**
 * 試し（捨てる前提）: テーマの細かさで、生成の幅を変える。文だけで比べる（画像 0 枚）。
 *   リポジトリの上で: NODE_USE_ENV_PROXY=1 npx tsx docs/superpowers/specs/2026-11-27-generation-width/spike.mts <出力.json> [回数]
 *   （GEMINI のキーは、この作業環境では中継が差し込む。ほかの環境では createGeminiText の 'dummy' を本物のキーに）
 * 方法:
 *   now   = いまの planItems そのまま
 *   avoid = いま + 「さっき作ったものとは違うものに」
 *   lot   = 細かさを測る（1 回呼ぶ）→ くじのヒント → planItems
 *   lot+  = lot + 「さっき作ったものとは違うものに」（きっちりのときは添えない）
 *   one   = 1 回の呼び出しで、くじを全部渡して AI に選ばせる + 「さっきとは違うものに」
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createGeminiText, GEMINI_TEXT_MODEL } from '../../../../tools/studio/ai.ts';
import type { TextAi } from '../../../../tools/studio/ai.ts';
import { planItems } from '../../../../tools/studio/generate.ts';
import type { PlannedItem } from '../../../../tools/studio/generate.ts';
import { findStyle } from '../../../../src/studio/stylePresets.ts';

const OUT = process.argv[2];
const RUNS = Number(process.argv[3] ?? 5);
const manifest = JSON.parse(readFileSync(process.env.CONTENT_MANIFEST ?? '../DressUpGame-content/manifest.json', 'utf8'));
const doll = manifest.dolls.find((d: { id: string }) => d.id === 'アニメ　その２');
const CATEGORY = 'ドレス';
const style = findStyle('anime').prompt;

const THEMES: { theme: string; kind: string }[] = [
  { theme: 'あかい リボンの ついた しろい ワンピース', kind: '細かい' },
  { theme: 'みずいろと しろの しましまで、すそに レースの ついた ながそでの ドレス', kind: '細かい' },
  { theme: 'ピンクの ドレス', kind: 'ふつう' },
  { theme: 'うみのおひめさま', kind: 'ふつう' },
  { theme: 'はる', kind: '大きい' },
  { theme: 'ゆめ', kind: '大きい' },
];

type Option = [en: string, ja: string];
const AXES: Record<string, { ja: string; options: Option[] }> = {
  colour: {
    ja: '色',
    options: [
      ['mainly pink', 'ピンク'], ['mainly sky blue', 'みずいろ'], ['mainly mint green', 'ミントグリーン'], ['mainly lavender', 'ラベンダー'],
      ['mainly lemon yellow', 'レモンいろ'], ['mainly red', 'あか'], ['mainly navy blue', 'こんいろ'], ['mainly white with one accent colour', 'しろ＋さしいろ'],
      ['mainly orange', 'オレンジ'], ['mainly green', 'みどり'], ['mainly purple', 'むらさき'], ['cream and brown', 'クリームとちゃいろ'],
      ['two contrasting bright colours', 'はんたいの 2 色'], ['soft pastel mix of several colours', 'パステルの まぜいろ'],
    ],
  },
  pattern: {
    ja: '柄',
    options: [
      ['polka dots', 'みずたま'], ['stripes', 'しましま'], ['gingham check', 'ギンガムチェック'], ['small flower print', 'こばな'], ['little stars', 'ほし'],
      ['little hearts', 'ハート'], ['plain fabric with no pattern', 'むじ'], ['tartan plaid', 'タータンチェック'], ['fruit print such as cherries or strawberries', 'くだもの'],
    ],
  },
  decoration: {
    ja: '飾り',
    options: [
      ['one big ribbon bow', 'おおきなリボン'], ['frills and ruffles', 'フリル'], ['lace trim', 'レース'], ['large round buttons', 'まるいボタン'], ['pom-poms', 'ポンポン'],
      ['embroidery', 'ししゅう'], ['pearls or beads', 'パール'], ['patch pockets', 'ポケット'], ['a sash belt', 'サッシュベルト'], ['scalloped edges', 'スカラップ'],
      ['a sailor collar', 'セーラーえり'], ['a round peter-pan collar', 'まるえり'],
    ],
  },
  material: {
    ja: '素材',
    options: [
      ['soft cotton', 'コットン'], ['layered tulle', 'チュール'], ['glossy satin', 'サテン'], ['knit', 'ニット'], ['denim', 'デニム'], ['velvet', 'ベルベット'],
      ['light chiffon', 'シフォン'], ['corduroy', 'コーデュロイ'],
    ],
  },
  shape: {
    ja: '形',
    options: [
      ['A-line flared skirt', 'Aライン'], ['puffy ball-gown skirt', 'ふんわり ドレス'], ['straight simple shift', 'まっすぐ'], ['tiered skirt', 'だんだん スカート'],
      ['high waist with a gathered skirt', 'ハイウエスト'], ['drop waist', 'ローウエスト'], ['pinafore style with shoulder straps', 'ジャンパースカート'], ['balloon hem', 'バルーン'],
    ],
  },
  length: {
    ja: '丈とそで',
    options: [
      ['sleeveless, knee-length', 'そでなし・ひざたけ'], ['puff sleeves, knee-length', 'パフスリーブ・ひざたけ'], ['long sleeves, mid-calf length', 'ながそで・ミモレたけ'],
      ['short sleeves, short skirt above the knee', 'はんそで・ミニ'], ['ankle-length long skirt', 'ロングたけ'], ['bell sleeves, knee-length', 'ベルスリーブ・ひざたけ'],
    ],
  },
  taste: {
    ja: 'ふんいき',
    options: [
      ['casual everyday wear', 'ふだんぎ'], ['elegant party wear', 'パーティー'], ['sporty', 'スポーティ'], ['retro classic', 'レトロ'], ['folk costume feeling', 'みんぞくふう'],
      ['fairy-tale', 'おとぎばなし'], ['cool and chic', 'クール'], ['natural, outdoorsy', 'ナチュラル'],
    ],
  },
};
const AXIS_IDS = Object.keys(AXES);

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const shuffle = <T,>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const base = createGeminiText('dummy', GEMINI_TEXT_MODEL);
let calls = 0;
const counted: TextAi = {
  async json(input) {
    calls++;
    for (let attempt = 0; ; attempt++) {
      try {
        return await base.json(input);
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  },
};
const withExtra = (extra: string[]): TextAi => ({ json: (input) => counted.json({ ...input, prompt: extra.length ? `${input.prompt}\n\n${extra.join('\n')}` : input.prompt }) });

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    topics: { type: 'array', items: { type: 'string' } },
    ...Object.fromEntries(AXIS_IDS.map((id) => [id, { type: 'boolean' }])),
  },
  required: ['topics', ...AXIS_IDS],
};

interface Analysis { topics: string[]; fixed: string[]; level: 'tight' | 'normal' | 'wide' }

async function analyse(theme: string): Promise<Analysis> {
  const r = await counted.json<Record<string, unknown>>({
    system: 'You analyse a short theme that a child typed to order one clothing item in a dress-up game. Reply with JSON only.',
    prompt: [
      `Theme: ${theme}`,
      `Item category: ${CATEGORY}`,
      'For each design aspect, answer true only if the words of the theme themselves state it (for example a colour word, a pattern word, a named decoration, a named fabric, a named silhouette, a sleeve or skirt length, a named style such as "sporty").',
      'A topic, a season, a place, a character type or a mood (spring, dream, sea, princess) does not state any aspect: answer false for all aspects it does not literally name.',
      'The category word itself (dress, one-piece) states nothing.',
      'Aspects: colour, pattern, decoration, material, shape (silhouette), length (sleeve or skirt length), taste (named style or occasion).',
      'topics: the separate topic words in the theme that are not one of the aspects above (for example ["sea", "princess"]); an empty list if there are none.',
    ].join('\n'),
    schema: ANALYSIS_SCHEMA,
  });
  const fixed = AXIS_IDS.filter((id) => r[id] === true);
  const topics = Array.isArray(r.topics) ? (r.topics as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const score = fixed.length + (topics.length >= 2 ? 1 : 0);
  return { topics, fixed, level: score >= 2 ? 'tight' : score === 1 ? 'normal' : 'wide' };
}

function drawHints(a: Analysis): { axis: string; en: string; ja: string }[] {
  const n = a.level === 'tight' ? 0 : a.level === 'normal' ? pick([1, 2]) : pick([2, 3]);
  return shuffle(AXIS_IDS.filter((id) => !a.fixed.includes(id)))
    .slice(0, n)
    .map((axis) => {
      const [en, ja] = pick(AXES[axis].options);
      return { axis, en, ja };
    });
}

const hintLines = (hints: { axis: string; en: string }[]): string[] =>
  hints.length
    ? [
        'Design hints (drawn at random so that the same theme gives a different design each time):',
        ...hints.map((h) => `- ${h.axis}: ${h.en}`),
        'Work these hints into the item where the theme leaves the design open. The theme always wins: if a hint contradicts the theme, drop that hint. The result must still clearly show the theme and be a normal, wearable, child-friendly garment.',
      ]
    : ['The theme is specific. Follow it exactly and keep everything it does not mention simple and consistent with it. Do not add extra patterns, decorations or colours that the theme does not ask for.'];

const avoidLines = (recent: string[]): string[] =>
  recent.length
    ? ['The same child recently received these items. Design something clearly different from all of them (different silhouette, main colour or decorations), while still following the theme:', ...recent.slice(-5).map((d) => `- ${d}`)]
    : [];

function oneCallLines(recent: string[]): { lines: string[]; offered: { axis: string; en: string; ja: string }[] } {
  const offered = shuffle(AXIS_IDS).map((axis) => {
    const [en, ja] = pick(AXES[axis].options);
    return { axis, en, ja };
  });
  return {
    offered,
    lines: [
      'Before designing, check how specific the theme is: count how many of these design aspects the words of the theme themselves state (a topic, season or mood such as spring, dream, sea or princess states none): colour, pattern, decoration, material, shape, length, taste.',
      'Random design suggestions, in priority order:',
      ...offered.map((h, i) => `${i + 1}. ${h.axis}: ${h.en}`),
      'If the theme states 2 or more aspects: ignore all suggestions, follow the theme exactly and add nothing it does not ask for.',
      'If the theme states exactly 1 aspect: use the first 1 or 2 suggestions whose aspect the theme does not state. Ignore the others.',
      'If the theme states no aspect: use the first 3 suggestions. Ignore the others.',
      'The theme always wins over a suggestion. The result must still clearly show the theme and be a normal, wearable, child-friendly garment.',
      ...avoidLines(recent),
    ],
  };
}

interface Row { method: string; run: number; item: PlannedItem | null; level?: string; fixed?: string[]; topics?: string[]; hints?: { axis: string; ja: string; en: string }[]; error?: string; ms: number }

async function planFor(theme: string, extra: string[]): Promise<PlannedItem> {
  const items = await planItems(withExtra(extra), doll, { theme, count: 1, categories: [CATEGORY], style });
  return items[0];
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number; error?: string }> {
  const t = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - t };
  } catch (error) {
    return { value: null, ms: Date.now() - t, error: (error as Error).message };
  }
}

async function runTheme(theme: string): Promise<Row[]> {
  const rows: Row[] = [];
  const parallel: Promise<void>[] = [];
  // now: 並べて走らせる
  for (let run = 0; run < RUNS; run++) {
    parallel.push(
      (async () => {
        const r = await timed(() => planFor(theme, []));
        rows.push({ method: 'now', run, item: r.value, ms: r.ms, error: r.error });
      })(),
    );
    parallel.push(
      (async () => {
        const t = Date.now();
        try {
          const a = await analyse(theme);
          const hints = drawHints(a);
          const item = await planFor(theme, hintLines(hints));
          rows.push({ method: 'lot', run, item, level: a.level, fixed: a.fixed, topics: a.topics, hints, ms: Date.now() - t });
        } catch (error) {
          rows.push({ method: 'lot', run, item: null, ms: Date.now() - t, error: (error as Error).message });
        }
      })(),
    );
  }
  // 「さっきとは違うものに」を使う方法は、順番に
  const chain = async (method: 'avoid' | 'lot+' | 'one') => {
    const recent: string[] = [];
    for (let run = 0; run < RUNS; run++) {
      const t = Date.now();
      try {
        if (method === 'avoid') {
          const item = await planFor(theme, avoidLines(recent));
          rows.push({ method, run, item, ms: Date.now() - t });
          recent.push(item.description);
        } else if (method === 'lot+') {
          const a = await analyse(theme);
          const hints = drawHints(a);
          const item = await planFor(theme, [...hintLines(hints), ...(a.level === 'tight' ? [] : avoidLines(recent))]);
          rows.push({ method, run, item, level: a.level, fixed: a.fixed, topics: a.topics, hints, ms: Date.now() - t });
          recent.push(item.description);
        } else {
          const { lines, offered } = oneCallLines(recent);
          const item = await planFor(theme, lines);
          rows.push({ method, run, item, hints: offered, ms: Date.now() - t });
          recent.push(item.description);
        }
      } catch (error) {
        rows.push({ method, run, item: null, ms: Date.now() - t, error: (error as Error).message });
      }
    }
  };
  await Promise.all([...parallel, chain('avoid'), chain('lot+'), chain('one')]);
  return rows.sort((x, y) => x.method.localeCompare(y.method) || x.run - y.run);
}

const out: { theme: string; kind: string; rows: Row[] }[] = [];
for (const t of THEMES) {
  const rows = await runTheme(t.theme);
  out.push({ ...t, rows });
  console.log(t.theme, rows.filter((r) => r.item).length, '/', rows.length, 'calls so far', calls);
  writeFileSync(OUT, JSON.stringify({ model: GEMINI_TEXT_MODEL, calls, themes: out }, null, 2));
}
