// サーバーの関数を、1 つのファイル（functions/lib/index.cjs）にまとめる。
// 中身（tools/cloud・tools/studio・src の一部）は functions/ の外にあるので、載せる前にまとめておく必要がある。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (file) => fileURLToPath(new URL(file, import.meta.url));

await build({
  entryPoints: [here('src/index.ts')],
  outfile: here('lib/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // サーバーに入れてもらうもの（functions/package.json の dependencies）
  external: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*', 'sharp', 'stripe'],
  // 文章の AI は Gemini を使う。Claude の部品は載せない
  alias: { '@anthropic-ai/sdk': here('src/stubs/anthropic.ts') },
  logLevel: 'warning',
});
