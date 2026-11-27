import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { setupAutoUpdate } from './pwaUpdate'
import { diag } from './services/diag'
import { captureReturn } from './cloud/googleRedirect'
import { APP_VERSION } from './version'
import { arrivedByShare } from './home/installBoot'

// Google のログイン（方法 2）から戻った直後なら、URL の # を、いちばん最初に取り込んで消す。
// 自動の更新（下の setupAutoUpdate）で読み込み直されても、戻りが無くならないように、先に session へ移しておく
const loginReturned = captureReturn({
  location: window.location,
  history: window.history,
  session: (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })(),
});

// 端末の上で起きたことの覚え書き（警告・エラー）。版数を 5 回押して「log」で見る
diag.install(console, window)
diag.note('start', `v${APP_VERSION}`)
if (loginReturned) diag.note('login', 'back', 'captured')
// 「ともだちにおしえる」の URL から開いた（ホームに、ホーム画面への追加の案内を出す。home/installHint.ts）
if (arrivedByShare) diag.note('share', 'arrived')

// アプリを開いたとき・画面に戻ったときに更新を確認し、あれば自動で更新する
setupAutoUpdate(registerSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
