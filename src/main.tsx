import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { setupAutoUpdate } from './pwaUpdate'
import { diag } from './services/diag'
import { APP_VERSION } from './version'

// 端末の上で起きたことの覚え書き（警告・エラー）。版数を 5 回押して「log」で見る
diag.install(console, window)
diag.note('start', `v${APP_VERSION}`)

// アプリを開いたとき・画面に戻ったときに更新を確認し、あれば自動で更新する
setupAutoUpdate(registerSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
