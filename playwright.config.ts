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
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/DressUpGame/',
    reuseExistingServer: true,
  },
});
