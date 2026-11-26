/**
 * Playwright E2Eテスト設定
 * 本番ビルドを vite preview で配信して、Chromium（ソフトウェアWebGL）で確認する
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    viewport: { width: 1180, height: 820 },
    // 操作ガイドは「見た」ことにしておく（ガイドのテスト = e2e/guide.spec.ts だけ、空の状態で開く）
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'dressup_guide_seen', value: '["play","worn","adjust","studio"]' }] }],
    },
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
      // 別バージョンのブラウザを使う環境向け（未設定ならPlaywright同梱のものを使う）
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } },
    },
  ],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/DressUpGame/',
      reuseExistingServer: true,
    },
    {
      // スタジオ: 空の素材フォルダから始める（毎回作り直す）
      command: 'rm -rf node_modules/.tmp/studio-e2e && npx vite --config vite.studio.config.ts --port 4174 --strictPort --open false',
      url: 'http://127.0.0.1:4174/api/status',
      reuseExistingServer: false,
      env: { CONTENT_DIR: 'node_modules/.tmp/studio-e2e', STUDIO_CREATE: '1', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
    },
  ],
});
