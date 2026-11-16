import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { setupAutoUpdate } from './pwaUpdate'

// アプリを開いたとき・画面に戻ったときに更新を確認し、あれば自動で更新する
setupAutoUpdate(registerSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
