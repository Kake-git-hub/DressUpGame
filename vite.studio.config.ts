/**
 * スタジオ用の開発サーバー設定（npm run studio）
 * ゲーム本体の設定に、スタジオの API を足す
 */
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
import { studioPlugin } from './tools/studio/vitePlugin'

export default mergeConfig(base, defineConfig({
  plugins: [studioPlugin()],
  server: { host: '127.0.0.1', open: '/DressUpGame/studio.html' },
}))
