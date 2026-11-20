import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'app-icon-192.png', 'app-icon-512.png'],
      manifest: {
        name: 'Kids Dress-Up Game',
        short_name: 'DressUp',
        description: 'A fun dress-up game for kids',
        theme_color: '#ff69b4',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        scope: '/DressUpGame/',
        start_url: '/DressUpGame/',
        icons: [
          {
            src: 'app-icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'app-icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'app-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,gif,webp,woff,woff2}'],
        // 元のアイコン（大きすぎる）と、スタジオ（遊ぶ側には要らない）を除外
        globIgnores: ['**/app-icon.png', '**/studio*'],
        // スタジオのページを開いたとき、ゲームの画面を返さない
        navigateFallbackDenylist: [/\/studio\.html/],
        runtimeCaching: [
          {
            // 素材の一覧: オンラインなら最新、つながらなければ前回のもの
            urlPattern: /\/(DressUpGame-content|e2e-content)\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'content-manifest',
              networkTimeoutSeconds: 4,
            }
          },
          {
            // 素材の画像: ファイル名に内容のハッシュが入っているので、一度取れば変わらない
            urlPattern: /\/(DressUpGame-content|e2e-content)\/files\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'content-files',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 3000 }
            }
          }
        ]
      }
    })
  ],
  base: '/DressUpGame/',
  build: {
    // スタジオは別ページ。開いたときだけ読み込まれる
    rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } },
  },
})
