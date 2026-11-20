/**
 * Firebase のエミュレーターにつないで確かめるテスト（npm run firebase:test）。
 * ふだんのテスト（npm run test:run）には入れない（エミュレーターが動いていないと通らないので）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/test/**/*.emu.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
