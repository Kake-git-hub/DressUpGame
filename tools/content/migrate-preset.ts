/**
 * プリセットのフォルダを配信用の形に変換するコマンド
 *
 *   npm run content:migrate -- <プリセットのフォルダ> <出力先フォルダ>
 */
import { buildContent } from './buildContent.ts';

const [presetDir, outDir] = process.argv.slice(2);
if (!presetDir || !outDir) {
  console.error('使い方: npm run content:migrate -- <プリセットのフォルダ> <出力先フォルダ>');
  process.exit(1);
}

const report = await buildContent(presetDir, outDir);
console.log(`ドール ${report.dolls} 体、服 ${report.items} 点、背景 ${report.backgrounds} 枚を書き出しました → ${outDir}`);
if (report.warnings.length > 0) {
  console.log(`\n注意 ${report.warnings.length} 件:`);
  for (const w of report.warnings) console.log(`  - ${w}`);
}
