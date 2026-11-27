/**
 * 確かめの道具（捨てる前提。製品のコードではない）: 本物の作り（themeWidth + planItems・planSet）で、品目の説明を作って並べる。画像は作らない。
 *
 *   リポジトリの上で:
 *   NODE_USE_ENV_PROXY=1 npx tsx docs/superpowers/specs/2026-11-27-generation-width/compare.mts text <出力.md>
 *   NODE_USE_ENV_PROXY=1 npx tsx docs/superpowers/specs/2026-11-27-generation-width/compare.mts items <出力フォルダ> <回数>
 *
 *  text  = ドレス以外のカテゴリ・おとこのこ・セットで、新しい方法の説明を 3 回ずつ（おかしな説明が出ないかを読む）
 *  items = 画像で比べるための品目（テーマ 3 つ × いまの方法・新しい方法 × 回数）を、tools/studio/tryItems.ts に渡す JSON にして書く
 *
 * GEMINI のキーは、この作業環境では中継が差し込む（'dummy' のまま。NODE_USE_ENV_PROXY=1 が要る）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createGeminiText, GEMINI_TEXT_MODEL } from '../../../../tools/studio/ai.ts';
import type { TextAi } from '../../../../tools/studio/ai.ts';
import { planItems, planSet } from '../../../../tools/studio/generate.ts';
import type { PlannedItem } from '../../../../tools/studio/generate.ts';
import { axesFor, dollLines, drawHints, levelOf, measureTheme, widthKind, widthLines } from '../../../../tools/studio/themeWidth.ts';
import { findStyle } from '../../../../src/studio/stylePresets.ts';
import type { ManifestDoll } from '../../../../src/content/manifest.ts';

const [, , MODE, OUT, RUNS_ARG] = process.argv;
const manifest = JSON.parse(readFileSync(process.env.CONTENT_MANIFEST ?? '../DressUpGame-content/manifest.json', 'utf8')) as { dolls: ManifestDoll[] };
const dollNamed = (name: string) => manifest.dolls.find((d) => d.name === name)!;
const style = findStyle('anime').prompt;

const base = createGeminiText('dummy', GEMINI_TEXT_MODEL);
let calls = 0;
const text: TextAi = {
  async json(input) {
    calls++;
    for (let attempt = 0; ; attempt++) {
      try {
        return await base.json(input);
      } catch (error) {
        if (attempt >= 2) throw error;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  },
};

interface Made {
  level: string;
  fixed: string[];
  topics: string[];
  hints: string[];
  items: PlannedItem[];
  setName?: string;
  ms: number;
}

// 新しい方法（サーバーの startJob と同じ順番）: 測る → 細かさ → くじ → 最近の服 → 企画
async function makeNew(doll: ManifestDoll, categories: string[], theme: string, recent: string[]): Promise<Made> {
  const t = Date.now();
  const labels = categories.map((id) => doll.categories.find((c) => c.id === id)?.label ?? id);
  const isSet = categories.length > 1;
  const axes = axesFor(isSet ? 'set' : widthKind(labels[0]), doll.name);
  const measure = await measureTheme(text, { theme, categoryLabels: labels, axes }, 30_000);
  if (!measure) {
    const items = isSet ? (await planSet(text, doll, { theme, categories, style })).items : await planItems(text, doll, { theme, count: 1, categories, style });
    return { level: 'none', fixed: [], topics: [], hints: [], items, ms: Date.now() - t };
  }
  const level = levelOf(measure.fixed, measure.topics);
  const hints = drawHints(level, measure.fixed, axes, Math.random);
  const extra = [...widthLines(level, hints, level === 'tight' ? [] : recent.slice(0, 5)), ...dollLines(doll.name)];
  if (isSet) {
    const planned = await planSet(text, doll, { theme, categories, style, extra });
    return { level, fixed: measure.fixed, topics: measure.topics, hints: hints.map((h) => h.ja), items: planned.items, setName: planned.name, ms: Date.now() - t };
  }
  const items = await planItems(text, doll, { theme, count: 1, categories, style, extra });
  return { level, fixed: measure.fixed, topics: measure.topics, hints: hints.map((h) => h.ja), items, ms: Date.now() - t };
}

const LEVEL_JA: Record<string, string> = { tight: 'きっちり', normal: 'ふつう', wide: 'ひろく', none: '測れなかった' };

if (MODE === 'text') {
  const cases: { doll: string; categories: string[]; theme: string; runs: number }[] = [
    { doll: 'おんなのこ', categories: ['かお'], theme: 'げんき', runs: 3 },
    { doll: 'おんなのこ', categories: ['ヘアスタイル'], theme: 'はる', runs: 3 },
    { doll: 'おんなのこ', categories: ['くつ'], theme: 'ゆめ', runs: 3 },
    { doll: 'おんなのこ', categories: ['トップス'], theme: 'うみ', runs: 3 },
    { doll: 'おんなのこ', categories: ['ぼうし'], theme: 'おかし', runs: 3 },
    { doll: 'おんなのこ', categories: ['アクセサリー'], theme: 'ほし', runs: 3 },
    { doll: 'おんなのこ', categories: ['トップス', 'ボトムス', 'くつ'], theme: 'ゆき', runs: 3 },
    { doll: 'おとこのこ', categories: ['トップス'], theme: 'はる', runs: 3 },
    { doll: 'おとこのこ', categories: ['ボトムス'], theme: 'うみ', runs: 3 },
    { doll: 'おとこのこ', categories: ['ヘアスタイル'], theme: 'ゆめ', runs: 3 },
    { doll: 'おんなのこ', categories: ['ヘアスタイル'], theme: 'ピンクの ツインテール', runs: 2 },
    { doll: 'おんなのこ', categories: ['くつ'], theme: 'あかい ながぐつ', runs: 2 },
    { doll: 'おんなのこ', categories: ['トップス', 'ボトムス'], theme: 'しろい ブラウスと あかい チェックの プリーツスカート', runs: 2 },
  ];
  const md: string[] = [];
  // ONLY_DOLL=おとこのこ で、そのドールの分だけ
  const results = await Promise.all(
    cases.filter((c) => !process.env.ONLY_DOLL || c.doll === process.env.ONLY_DOLL).map(async (c) => {
      const doll = dollNamed(c.doll);
      const recent: string[] = [];
      const lines: string[] = [`## ${c.doll}・${c.categories.join('＋')}・「${c.theme}」`, ''];
      for (let run = 0; run < c.runs; run++) {
        try {
          const made = await makeNew(doll, c.categories, c.theme, recent);
          lines.push(`${run + 1}. 【${LEVEL_JA[made.level]}${made.fixed.length ? ` 決まっている: ${made.fixed.join(',')}` : ''}${made.topics.length ? ` 話題: ${made.topics.join(',')}` : ''}】 くじ: ${made.hints.join('、') || 'なし'}（${Math.round(made.ms / 100) / 10} 秒）`);
          for (const item of made.items) lines.push(`   - **${item.name}**（${item.category}）: ${item.description}`);
          recent.unshift(made.setName ? `${made.setName}: ${made.items[0].description}` : made.items[0].description);
        } catch (error) {
          lines.push(`${run + 1}. （失敗: ${(error as Error).message}）`);
        }
      }
      return [...lines, ''];
    }),
  );
  for (const lines of results) md.push(...lines);
  writeFileSync(OUT, [`# 新しい方法の説明を、ドレス以外で見る（文だけ。${GEMINI_TEXT_MODEL}、呼び出し ${calls} 回、画像 0 枚）`, '', ...md].join('\n'));
  console.log(`calls ${calls}`);
} else if (MODE === 'items') {
  const runs = Number(RUNS_ARG ?? 2);
  const doll = dollNamed('おんなのこ');
  const themes = [
    { key: 'fine', theme: 'あかい リボンの ついた しろい ワンピース' },
    { key: 'mid', theme: 'うみのおひめさま' },
    { key: 'wide', theme: 'はる' },
  ];
  mkdirSync(OUT, { recursive: true });
  const record: unknown[] = [];
  for (const { key, theme } of themes) {
    const nowItems: PlannedItem[] = [];
    const newItems: PlannedItem[] = [];
    const recent: string[] = [];
    for (let run = 0; run < runs; run++) {
      const [now] = await planItems(text, doll, { theme, count: 1, categories: ['ドレス'], style });
      nowItems.push({ ...now, name: `${key}いま${run + 1}` });
      const made = await makeNew(doll, ['ドレス'], theme, recent);
      newItems.push({ ...made.items[0], name: `${key}あたらしい${run + 1}` });
      recent.unshift(made.items[0].description);
      record.push({ theme, run, now: now.description, new: made.items[0].description, level: made.level, hints: made.hints });
    }
    writeFileSync(`${OUT}/${key}-now.json`, JSON.stringify(nowItems, null, 2));
    writeFileSync(`${OUT}/${key}-new.json`, JSON.stringify(newItems, null, 2));
  }
  writeFileSync(`${OUT}/plan.json`, JSON.stringify({ model: GEMINI_TEXT_MODEL, calls, record }, null, 2));
  console.log(`calls ${calls}`);
} else {
  console.error('text か items を指定してください');
  process.exit(1);
}
