/**
 * スタジオ用の開発サーバー設定（npm run studio）
 * ゲーム本体の設定に、スタジオの API を足す
 */
import { defineConfig, loadEnv, mergeConfig } from 'vite'
import base from './vite.config'
import { studioPlugin } from './tools/studio/vitePlugin'

// API キーなどは、.env.local（git 管理外）か、PC の環境変数から読む。環境変数が優先。
// ここで読んだ値はサーバー側だけで使い、画面（ブラウザ）には渡さない
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env }

export default mergeConfig(base, defineConfig({
  plugins: [studioPlugin(env)],
  server: { host: '127.0.0.1', open: '/DressUpGame/studio.html' },
}))
