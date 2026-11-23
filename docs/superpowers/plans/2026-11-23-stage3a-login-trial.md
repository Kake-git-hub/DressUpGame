# 段階 ③-a ログインの試し版（v0.37.0） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「つくる」のいちばん下に「アカウント」の欄を足し、Google のアカウントで、方法 1（小さい窓）・方法 2（画面を移る）のどちらでもログイン／ログアウトできるようにする（サーバーは変えない）。

**Architecture:** Firebase に触る所を、小さい口（`AuthPort`）に閉じ込める。口の本物は `firebaseTransport.ts`、偽物は `fakeAuth.ts`。その上の段取り（空の端末か・結果の分類・戻りの受け取り・きろく）は `account.ts` に 1 つだけ書き、本物と偽物の両方で同じものを使う（E2E が、本物と同じ段取りを通る）。方法 2 の純粋な部分（URL の組み立て・戻りの読み取りと確かめ）は `googleRedirect.ts`。

**Tech Stack:** TypeScript / React 19 / Vite / Firebase JS SDK（`firebase/auth`）/ Vitest / Playwright。

**Spec:** `docs/superpowers/specs/2026-11-23-login-design.md`（7 章が、この計画の範囲。実装の前に、7 章を全部読むこと）

**担当するモデル（作者の指示: 段階ごとに合ったモデルを使う）:** 設計・計画・最後のまとめ = この会話のモデル。Task 1〜6 の実装 = Sonnet。最後の全体レビュー = Opus。

## Global Constraints

- サーバー（`functions/`・`tools/cloud/`）は、1 行も変えない。
- 「つくる」を教えていない端末（`readStudioMode()` が null）では、Firebase も `src/cloud/boot.ts` も読み込まない（いまのまま）。`googleRedirect.ts` と `account.ts` は、`firebase/*` を import しない。
- きろく（`diag.note`）・`console.*` に、メールアドレス・`id_token`・`state`・`nonce` を渡さない。Firebase の失敗は、`code`（`auth/…`）の文字だけを取り出して使う（エラーのオブジェクトを、そのまま `console.error` しない）。
- 方法 1 の小さい窓は、ボタンの `onClick` の中で、**何も `await` しないうちに**開く。
- Google の証明（`id_token`）は、1 回しか Firebase に渡さない（「結び付けてだめなら入り直す」は、しない）。
- 画面の文は、設計書 7.1・7.2・7.4 の文を、そのまま使う（この計画の `LOGIN_MESSAGES` に写してある）。「つくる」は大人向け（漢字かな交じり）、ホームの知らせも同じ文。
- テストを先に書く。失敗を見てから実装する。コミットは、タスクごと。コミットの文は日本語（このリポジトリの書き方）。最後の行に、次の 2 行を付ける:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_017tg9jvY2baLxHy7Ufd7PFu`
- 確かめ: `npx vitest run <ファイル>`、`npx tsc -b`、`npx eslint .`（エラー 0）。E2E は `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test <ファイル> --trace off`。
- `git push` はしない（まとめ役がする）。`main` には触らない。

## Review Focus

1. Google から戻った直後に、自動の更新でページが読み込み直される → 戻りは無くならず、次の起動で受け取れる（Task 1・2）。
2. 開発用の設定（StrictMode）で、戻りの受け取りが 2 回同時に走る・ボタンを 2 回押す → 証明は 1 回しか使わない（Task 2）。
3. Firebase の失敗のオブジェクトに、メールアドレスが入っている（`customData.email`）→ きろくにも結果にも、出ない（Task 2）。
4. よそから開かれた URL に、にせの `#state=…&id_token=…` が付いている・古い戻りが残っている → Firebase を呼ばずに捨てる。ログインの戻りでない `#…` は、触らない（Task 1・2）。
5. ログアウトの途中で失敗する（通信が無い、など）→ 端末の控えは、何も消えない（Task 2・5）。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/cloud/googleRedirect.ts`（新） | 方法 2 の純粋な部分。Google へ移る URL、戻りの URL の取り込み（URL から消して `sessionStorage` へ）、`state`・期限・`nonce` の確かめ |
| `src/cloud/account.ts`（新） | 型（`AccountInfo`・`AuthPort`・`StudioAccount`・`LoginResult`）、段取り（`createAccount`）、結果の分類（`outcomeOf`）、文（`LOGIN_MESSAGES`）、空の端末か（`deviceEmpty`）、端末の控えから外す（`forgetAccount`）、戻りの仕上げ（`completeRedirect`） |
| `src/cloud/firebaseTransport.ts` | `AuthPort` の本物（`linkWithPopup` など）と、`client_id` の調べ |
| `src/cloud/firebaseConfig.ts` | `GOOGLE_CLIENT_ID`（いまは空） |
| `src/cloud/fakeAuth.ts`（新） | `AuthPort` の偽物（`?studio=fake`）。にせの「画面を移る」 |
| `src/cloud/fakeBackend.ts` | 利用者の入れ替え（ログアウトで空の利用者に、入り直すと元に戻る） |
| `src/cloud/backend.ts`・`remoteBackend.ts`・`createBackend.ts` | `StudioBackend.account` を足して、つなぐ |
| `src/appStudio/Account.tsx`（新）・`appStudio.css`・`AppStudio.tsx` | 「アカウント」の欄 |
| `src/home/LoginNotice.tsx`（新）・`home.css`・`src/App.tsx`・`src/main.tsx` | 起動時の戻りの取り込み、戻りの仕上げ、ホームの知らせ |
| `src/tests/googleRedirect.test.ts`・`account.test.ts`・`fakeAuth.test.ts`・`accountSection.test.tsx`・`firebaseAuthPort.test.ts`（新） | ユニット |
| `e2e/account.spec.ts`（新）・`e2e/appStudioReal.spec.ts` | E2E |

---

### Task 1: 方法 2 の純粋な部分（`googleRedirect.ts`）と、起動時の取り込み

**Files:**
- Create: `src/cloud/googleRedirect.ts`、`src/tests/googleRedirect.test.ts`
- Modify: `src/main.tsx`（いちばん最初に取り込む）

**Interfaces:**
- Produces:

```ts
export const PENDING_KEY = 'dressup_login_pending'; // localStorage: 行く前に覚えるもの
export const RETURN_KEY = 'dressup_login_return'; // sessionStorage: 戻って来た中身（使い終わるまで）
export const LOGIN_TTL_MS = 600_000; // 10 分
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export type LoginIntent = 'link' | 'signin'; // 結び付ける / 入る
export interface PendingLogin { state: string; rawNonce: string; intent: LoginIntent; at: number }
export interface LoginReturn { state: string; idToken?: string; error?: string }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function randomToken(bytes?: number): string; // 16 バイト → 16 進 32 文字（crypto.getRandomValues）
export async function sha256Hex(text: string): Promise<string>; // crypto.subtle
export function redirectUriOf(origin: string, baseUrl: string): string; // 例: ('https://kake-git-hub.github.io', '/DressUpGame/') → 'https://kake-git-hub.github.io/DressUpGame/'
export function buildAuthUrl(input: { clientId: string; redirectUri: string; state: string; nonce: string }): string;
export function parseReturn(hash: string): LoginReturn | null; // ログインの戻りでなければ null
// 起動のいちばん最初に呼ぶ。戻りなら、URL から # を消して（search は残す）、中身を session に置く。戻りだったら true
export function captureReturn(env: { location: Pick<Location, 'hash' | 'pathname' | 'search'>; history: Pick<History, 'replaceState'>; session: Store | null }): boolean;
export function hasReturn(session: Store | null): boolean;
export function savePending(local: Store | null, pending: PendingLogin): void;
export type ReturnCheck =
  | { ok: true; idToken: string; rawNonce: string; intent: LoginIntent }
  | { ok: false; reason: 'none' | 'mismatch' | 'expired' | 'error'; error?: string };
// 待っている戻りを、確かめて返す（消さない）。戻りが無ければ null
export async function readReturn(env: { session: Store | null; local: Store | null; now: () => number }): Promise<ReturnCheck | null>;
export function clearReturn(env: { session: Store | null; local: Store | null }): void; // 戻りと、覚え（pending）を消す
export function nonceOf(idToken: string): string | null; // JWT のまん中（base64url の JSON）の nonce
```

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/googleRedirect.test.ts`）。入れるもの:
  - `buildAuthUrl`: 返り値を `new URL()` で読むと、origin+pathname が `GOOGLE_AUTH_URL`、`client_id`・`redirect_uri`・`state`・`nonce` が渡した値、`response_type` が `id_token`、`scope` が `openid email`、`prompt` が `select_account`。
  - `parseReturn`: `'#state=s1&id_token=aaa.bbb.ccc'` → `{ state: 's1', idToken: 'aaa.bbb.ccc' }`。`'#error=access_denied&state=s1'` → `{ state: 's1', error: 'access_denied' }`。`''`・`'#foo'`・`'#id_token=x'`（state 無し）・`'#state=s1'`（中身無し）→ `null`。
  - `captureReturn`: 戻りの `#` のとき、`history.replaceState` が `pathname + search`（`#` 無し）で呼ばれ、`session` に `RETURN_KEY` が入り、`true`。`#foo` のときは、何も呼ばれず `false`。`session` が null・`setItem` が投げても、URL からは消す（`true`）。
  - `readReturn`: 戻りが無い → `null`。戻りはあるが `PENDING_KEY` が無い → `{ ok: false, reason: 'none' }`。`state` が違う → `mismatch`。`now - at > LOGIN_TTL_MS` → `expired`。`error` 付き → `{ ok: false, reason: 'error', error: 'access_denied' }`。`id_token` の `nonce` が `sha256Hex(rawNonce)` と違う → `mismatch`。全部合う → `{ ok: true, idToken, rawNonce, intent }`。**`readReturn` を 2 回呼んでも同じ結果**（消さない = 読み込み直しをはさんでも残る。Review Focus 1）。
  - `clearReturn` のあと、`hasReturn` が false、`readReturn` が `null`。
  - `nonceOf`: 正しい形の JWT から nonce を取る。壊れた文字（`'x'`・`'a.b.c'` でまん中が JSON でない）→ `null`。日本語を含む payload（base64url、UTF-8）でも読める。
  - `sha256Hex('abc')` が `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`。`randomToken()` は 32 文字の 16 進で、2 回呼ぶと違う。
- [ ] **Step 2: 走らせて、落ちるのを見る** — `npx vitest run src/tests/googleRedirect.test.ts`（モジュールが無い、で落ちる）
- [ ] **Step 3: `src/cloud/googleRedirect.ts` を書く**。`session`／`local` の読み書きは、投げても落ちないように包む。`RETURN_KEY` には `LoginReturn` の JSON。
- [ ] **Step 4: `src/main.tsx` のいちばん最初**（`diag.install` より前・`setupAutoUpdate` より前）で `captureReturn({ location: window.location, history: window.history, session: <sessionStorage を安全に取ったもの> })` を呼ぶ。戻りだったら `diag.note('login', 'back', 'captured')`（`diag.install` のあとに書く。中身は書かない）。
- [ ] **Step 5: 通るのを見る** — `npx vitest run src/tests/googleRedirect.test.ts`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 6: コミット** — `ログイン（方法 2）: Google へ移る URL と、戻りの取り込み・確かめ`

---

### Task 2: 段取り（`account.ts`）

**Files:**
- Create: `src/cloud/account.ts`、`src/tests/account.test.ts`
- Modify: `src/cloud/backend.ts`（`StudioBackend` に `readonly account: StudioAccount` を足す。`account.ts` の型を import type する）、`src/cloud/session.ts`（`NEW_KEY`・`ACKED_KEY` は、もう export されている。変えない）

**Interfaces:**
- Consumes: Task 1 の全部。`diag`（`src/services/diag.ts`）。`Library`（`src/cloud/library.ts`: `all()`・`put()`・`remove(id)`）。`MyItem.owner`（その服を持っていた利用者コード）。
- Produces:

```ts
export type AccountInfo = { kind: 'guest' } | { kind: 'google'; email: string };
export type LoginOutcome = 'linked' | 'switched' | 'taken' | 'cancelled' | 'not-ready' | 'no-popup' | 'failed';
export interface LoginResult { outcome: LoginOutcome; code?: string } // code は auth/… の語だけ（きろく用）
export const LOGIN_MESSAGES: Record<LoginOutcome, string>;

// Firebase を包んだ口。失敗は、{ code: 'auth/…' } を持つ例外（Firebase のエラーそのままでよい）
export interface AuthPort {
  current(): AccountInfo;
  popup(intent: LoginIntent): Promise<void>; // 呼ばれた、その場で窓を開く（中で、先に何も待たない）
  withToken(intent: LoginIntent, idToken: string, rawNonce: string): Promise<void>;
  signOut(): Promise<void>;
  clientId(): Promise<string | null>; // 方法 2 の client_id。分からなければ null
}

export interface StudioAccount {
  prepare(): Promise<AccountInfo>; // 口を用意する（Firebase の読み込み・いまの利用者）。失敗は BackendError のまま投げる
  canRedirect(): Promise<boolean>; // 方法 2 の client_id が分かった
  loginWithPopup(intent: LoginIntent): Promise<LoginResult>; // prepare が済んでいなければ { outcome: 'not-ready' }
  startRedirect(intent: LoginIntent): Promise<LoginResult>; // うまくいけば、画面が移る（返らない）
  // 待っている戻りがあれば、受け取る。無ければ null。intentNow: 覚えていた intent を見て、いま使う intent を返す
  finishRedirect(intentNow: (saved: LoginIntent) => Promise<LoginIntent>): Promise<LoginResult | null>;
  logout(): Promise<void>; // signOut だけ（端末の控えは、呼ぶ側が forgetAccount）
}

export interface AccountEnv {
  redirectUri: string;
  goTo(url: string): void; // 本物: location.assign。偽物: にせの戻り
  session: Store | null; // sessionStorage
  local: Store | null; // localStorage
  now(): number;
  note(...parts: string[]): void; // きろく（既定は diag.note('login', ...)）
}
export function createAccount(port: () => Promise<AuthPort>, env: AccountEnv): StudioAccount;
export function browserAccountEnv(goTo?: (url: string) => void): AccountEnv; // window から作る（redirectUri = origin + import.meta.env.BASE_URL）
export function outcomeOf(error: unknown): LoginResult;
// この端末が空か（設計書 7.2）。聞けなければ false
export async function deviceEmpty(backend: Pick<StudioBackend, 'signIn' | 'listMyItems' | 'openJobs'>): Promise<boolean>;
// 端末の控えから、その利用者コードの服だけを外し、NEW の印と「見た仕事」の覚えを消す
export async function forgetAccount(library: Library, userCode: string, local: Store | null): Promise<void>;
export const NOTICE_KEY = 'dressup_login_notice'; // sessionStorage: 読み込み直しのあとに出す知らせの文
// 起動のあと（つなぎ役ができたら）呼ぶ。戻りを受け取り、知らせの文を返す（無ければ null）。
// 'switched' のときは、forgetAccount → 文を NOTICE_KEY に置く → reload()（返り値は null）
export async function completeRedirect(deps: { backend: StudioBackend; library: Library; session: Store | null; local: Store | null; reload(): void }): Promise<string | null>;
export function takeNotice(session: Store | null): string | null; // NOTICE_KEY を読んで、消す
```

`LOGIN_MESSAGES`（設計書の文。そのまま使う）:

```ts
export const LOGIN_MESSAGES: Record<LoginOutcome, string> = {
  linked: 'Google のアカウントでログインしました',
  switched: 'Google のアカウントでログインしました',
  taken: 'この Google のアカウントは、ほかの端末で使われています。この端末のチケットと服を合わせるのは、次の版でできるようになります',
  cancelled: 'ログインを やめました',
  'not-ready': 'Google のログインの準備が、まだできていません（作者の設定待ちです）',
  'no-popup': '小さい窓を開けませんでした。方法 2 を試してください',
  failed: 'ログインできませんでした。少し待ってから、もう一度ためしてください',
};
```

`outcomeOf` の分け方（`code` は、`error.code` が `auth/` で始まる文字のときだけ取る）:

| `code` | outcome |
|---|---|
| `auth/credential-already-in-use`・`auth/email-already-in-use` | `taken` |
| `auth/popup-closed-by-user`・`auth/cancelled-popup-request`・`auth/user-cancelled` | `cancelled` |
| `auth/operation-not-allowed`・`auth/unauthorized-domain`・`auth/configuration-not-found`・`auth/admin-restricted-operation` | `not-ready` |
| `auth/popup-blocked`・`auth/operation-not-supported-in-this-environment`・`auth/web-storage-unsupported` | `no-popup` |
| そのほか（`code` が無いものも） | `failed` |

うまくいったときの outcome: `intent === 'link'` → `linked`、`'signin'` → `switched`。

きろくの行（`env.note` に渡す語。設計書 7.3）: `start popup` / `start redirect client=config|lookup`（どちらかは `AuthPort` からは分からないので、`start redirect` だけでよい）、`back ok` / `back none` / `back mismatch` / `back expired` / `back error=<語>`（語は英数字と `_` だけを通す。40 文字まで）、`result <outcome>`（`failed`・`not-ready`・`no-popup`・`taken` は ` code=<auth/…>` も）、`out`。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/account.test.ts`。`AuthPort` は、`vi.fn` で作った偽物。`env` は、メモリの `Store` と、行を集める `note`）。入れるもの:
  - `outcomeOf`: 上の表の全部の行。`{ code: 'auth/credential-already-in-use', customData: { email: 'a@example.com' }, message: '… a@example.com …' }` → `{ outcome: 'taken', code: 'auth/credential-already-in-use' }`（**結果のどこにも `@` が無い**。Review Focus 3）。`new Error('x')`・`null`・`{ code: 123 }` → `{ outcome: 'failed' }`（`code` 無し）。
  - `loginWithPopup`: `prepare()` の前 → `{ outcome: 'not-ready' }`、`port.popup` は呼ばれない。`prepare()` のあと → **`loginWithPopup('link')` を `await` せずに呼んだ直後に、`port.popup` が、もう 1 回呼ばれている**（何も待たずに開く）。成功 → `linked`（`'signin'` なら `switched`）。`popup` が `{ code: 'auth/popup-blocked' }` で落ちる → `no-popup`。1 回めが終わる前に、もう 1 回呼ぶ → `port.popup` は 1 回だけ（2 回めは、1 回めと同じ結果を返す）。
  - `startRedirect`: `clientId()` が null → `{ outcome: 'not-ready' }`、`goTo` は呼ばれない、`PENDING_KEY` も書かれない。分かる → `PENDING_KEY` に `{ state, rawNonce, intent, at }` が入り、`goTo` が 1 回、URL の `state` が覚えた `state`、`nonce` が `sha256Hex(rawNonce)`、`redirect_uri` が `env.redirectUri`。
  - `finishRedirect`: 戻りが無い → `null`、`port` は 1 回も作られない（`port` の関数が呼ばれない）。正しい戻り + `intentNow` が同じ intent を返す → `port.withToken(intent, idToken, rawNonce)` が 1 回、結果 `linked`、そのあと `hasReturn` が false で `PENDING_KEY` も無い。覚えが `signin`、`intentNow` が `'link'` を返す → `withToken('link', …)`。`state` 違い・期限切れ・覚え無し → `{ outcome: 'failed' }`、`withToken` は呼ばれない、戻りは消えている（Review Focus 4）。`error=access_denied` → `cancelled`。`withToken` が `auth/credential-already-in-use` → `taken`。**`finishRedirect` を、同時に 2 回呼ぶ → `withToken` は 1 回だけ**（2 回めは、同じ結果）（Review Focus 2）。
  - きろく: 上のどのテストでも、`note` に渡った文字をつなげたものに、`@`・`idToken` の文字・`state` の値・`rawNonce` の値が入っていない。
  - `deviceEmpty`: チケット 0・服 0・仕事 0・管理者でない → true。チケット 1 → false。服 1 → false。仕事 1 → false。**管理者（チケット 0）→ false**。`signIn` が投げる → false。
  - `forgetAccount`: 控えに `owner: 'AAAA'` 2 点・`owner: 'BBBB'` 1 点・`owner` 無し 1 点 → `forgetAccount(library, 'AAAA', local)` のあと、残るのは後ろの 2 点。`local` の `NEW_KEY`・`ACKED_KEY` が消えている（`session.ts` から import）。
  - `completeRedirect`: 戻りが無い → `null`、`backend.account.finishRedirect` が null を返すだけ。`linked` → 文（`LOGIN_MESSAGES.linked`）を返す、`reload` は呼ばれない。`switched` → `forgetAccount` が、**入る前の利用者コード**で呼ばれ、`NOTICE_KEY` に文が入り、`reload` が 1 回、返り値は `null`。`taken` → 文を返す、何も消えない。`intentNow` は、覚えが `signin` のとき `deviceEmpty` を聞き、空でなければ `'link'`。
  - `takeNotice`: 読むと消える。
- [ ] **Step 2: 走らせて、落ちるのを見る** — `npx vitest run src/tests/account.test.ts`
- [ ] **Step 3: `src/cloud/account.ts` を書く**。`loginWithPopup` は、`async` にしない（`prepare` で覚えた口を使い、同期で `port.popup(intent)` を呼んでから、その Promise をつなぐ）。進行中の Promise を覚えて、重ねて呼ばれたら同じものを返す（`loginWithPopup`・`finishRedirect`）。`finishRedirect` は、結果が出たら（成功でも失敗でも）`clearReturn`。`completeRedirect` の「入る前の利用者コード」は、`backend.signIn()` で聞いてから `finishRedirect` を呼ぶ（聞けなければ、`forgetAccount` はしない）。
- [ ] **Step 4: `src/cloud/backend.ts` の `StudioBackend` に `readonly account: StudioAccount;` を足す**。型のエラーが出る所（`remoteBackend.ts`・`fakeBackend.ts`・テストの偽物）は、Task 3・4 で本物を入れるまで、次の仮のものを使う: `account.ts` に `export const noAccount: StudioAccount`（`prepare` は `{ kind: 'guest' }`、`canRedirect` は false、ログインは `{ outcome: 'not-ready' }`、`finishRedirect` は null、`logout` は何もしない）。テストの中で `StudioBackend` を丸ごと作っている所には、`account: noAccount` を足す。
- [ ] **Step 5: 通るのを見る** — `npx vitest run src/tests/account.test.ts`、`npx vitest run src/tests`（ほかのテストが落ちていない）、`npx tsc -b`、`npx eslint .`
- [ ] **Step 6: コミット** — `ログイン: 段取り（結び付ける／入る・結果の分類・戻りの受け取り・端末の控えから外す）`

---

### Task 3: 口の本物（Firebase）と、つなぎ込み

**Files:**
- Modify: `src/cloud/firebaseTransport.ts`、`src/cloud/firebaseConfig.ts`、`src/cloud/remoteBackend.ts`、`src/cloud/createBackend.ts`
- Create: `src/tests/firebaseAuthPort.test.ts`
- Test: `src/tests/remoteBackend.test.ts`（`StudioTransport` の偽物に `auth` を足す）

**Interfaces:**
- Consumes: Task 2 の `AuthPort`・`createAccount`・`browserAccountEnv`・`StudioAccount`。
- Produces:
  - `src/cloud/firebaseConfig.ts`: `export const GOOGLE_CLIENT_ID = '';`（作者が Google を有効にしたら、まとめ役が書き込む。公開してよい値）
  - `StudioTransport`（`remoteBackend.ts`）に `auth(): Promise<AuthPort>` を足す。`createRemoteBackend(transport, options)` の `options` に `account?: StudioAccount` を足し、無ければ `createAccount(() => transport.auth(), browserAccountEnv())`。返す `StudioBackend` の `account` に入れる。
  - `createFirebaseTransport()` の返り値に `auth()`。中身:
    - `auth()` は、`ready()`（いまの「匿名でログイン」）を待ってから、口を返す。
    - `current()`: `auth.currentUser` の `providerData` に `providerId === 'google.com'` があれば `{ kind: 'google', email: その email ?? '' }`、無ければ `{ kind: 'guest' }`。
    - `popup(intent)`: **同期で**（`async` 関数にしない・先に何も待たない）`intent === 'link' ? linkWithPopup(auth.currentUser!, provider) : signInWithPopup(auth, provider)` を呼び、`.then(() => undefined)`。`provider` は `new GoogleAuthProvider()` に `setCustomParameters({ prompt: 'select_account' })`。`auth.currentUser` が無い（`link` なのに）ときは、`signInWithPopup`。
    - `withToken(intent, idToken, rawNonce)`: `const credential = new OAuthProvider('google.com').credential({ idToken, rawNonce })`。`link` で `auth.currentUser` があれば `linkWithCredential(auth.currentUser, credential)`、ほかは `signInWithCredential(auth, credential)`。
    - `signOut()`: `signOut(auth)` のあと、`signing = null`（次の `ready()` が、新しい匿名の利用者を作る）。
    - `clientId()`: `GOOGLE_CLIENT_ID` があれば、それ。無ければ、`lookupClientId(fetch, apiKey, continueUri)` を 1 回だけ呼んで覚える。
  - `export async function lookupClientId(fetchImpl: typeof fetch, apiKey: string, continueUri: string): Promise<string | null>` — `POST https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=<apiKey>`、本体 `{"providerId":"google.com","continueUri":"<continueUri>"}`。返事の `authUri`（URL）の `client_id` を返す。HTTP が 200 でない・`authUri` が無い・読めない・投げる → `null`。
  - `createBackend.ts` の `lazyFirebase()` に `auth: async () => (await load()).auth()`。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/firebaseAuthPort.test.ts`）。`lookupClientId`: `fetch` の偽物が `{ authUri: 'https://accounts.google.com/o/oauth2/auth?client_id=123-abc.apps.googleusercontent.com&x=1' }` を返す → `'123-abc.apps.googleusercontent.com'`。呼んだ URL が `…accounts:createAuthUri?key=KEY`、本体の JSON が `{ providerId: 'google.com', continueUri: … }`。400（`OPERATION_NOT_ALLOWED`）→ `null`。`fetch` が投げる → `null`。`authUri` が URL でない → `null`。
  口の本体（`current`・`popup`・`withToken`・`signOut`）: `vi.mock('firebase/auth', …)` と `vi.mock('firebase/app', …)`・`vi.mock('firebase/functions', …)` で部品を差し替えて、(a) `popup('link')` を呼んだ直後（`await` の前）に `linkWithPopup` が呼ばれている、(b) `popup('signin')` は `signInWithPopup`、(c) `withToken('link', 't', 'n')` は `OAuthProvider` の `credential({ idToken: 't', rawNonce: 'n' })` を `linkWithCredential` に渡す、(d) `signOut` のあとの `call()` は、もう一度 `signInAnonymously` を呼ぶ、(e) `current()` が `providerData` から Google を読む。差し替えが難しければ、口を作る所を `export function createAuthPort(deps: { auth: Auth; ready: () => Promise<void>; resetSignIn: () => void; fetchImpl: typeof fetch; apiKey: string; clientId: string; continueUri: string }): AuthPort` に切り出して、`firebase/auth` だけを差し替える。
- [ ] **Step 2: 落ちるのを見る** — `npx vitest run src/tests/firebaseAuthPort.test.ts`
- [ ] **Step 3: 実装する**（上の Produces のとおり）。`toBackendError` は、`auth()` が失敗したとき（Firebase を読み込めない・匿名のログインに失敗）に使う。
- [ ] **Step 4: `remoteBackend.ts`・`createBackend.ts` をつなぐ**。`src/tests/remoteBackend.test.ts` などの `StudioTransport` の偽物に `auth` を足す（呼ばれたら投げるものでよい）。
- [ ] **Step 5: 通るのを見る** — `npx vitest run src/tests`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 6: コミット** — `ログイン: Firebase の口（小さい窓・証明を渡す・ログアウト・client_id の調べ）`

---

### Task 4: 口の偽物（`?studio=fake`）

**Files:**
- Create: `src/cloud/fakeAuth.ts`、`src/tests/fakeAuth.test.ts`
- Modify: `src/cloud/fakeBackend.ts`、`src/cloud/createBackend.ts`（`fakeOptions()` に新しい項目を通す）
- Test: `src/tests/fakeBackend.test.ts`

**Interfaces:**
- Consumes: Task 2 の `AuthPort`・`createAccount`・`browserAccountEnv`、Task 1 の `nonceOf` など。
- Produces:
  - `FakeOptions` に `loginFail?: string`（ログインを、この `auth/…` の語で失敗させる。方法 2 では、`access_denied` を入れると Google の「キャンセル」のまね）と `googleTaken?: boolean`（「結び付ける」を、いつも `auth/credential-already-in-use` にする）。
  - `export const FAKE_EMAIL = 'tameshi@example.com';`
  - 偽物の利用者の入れ替え（`fakeBackend.ts`。いまの保存 `dressup_fake_backend` = いまの利用者の世界）:
    - `dressup_fake_account`（localStorage）= `{ google: boolean }`（いまの利用者が、Google に結び付いているか）
    - `dressup_fake_google`（localStorage）= ログアウトして置いてある、Google のアカウントの世界（`State`）
    - 結び付ける（`link`）: `dressup_fake_google` があれば `auth/credential-already-in-use`。無ければ、`google: true`（世界はそのまま）。
    - 入る（`signin`）: `dressup_fake_google` があれば、それを、いまの世界にする（置いてあった方は消す）。無ければ、いまの世界のまま `google: true`。
    - ログアウト: いまの世界を `dressup_fake_google` に置き、いまの世界を、新しい空の利用者（**チケット 0 枚**・服 0・仕事 0・新しい利用者コード・管理者でない）にする。`google: false`。
    - 入れ替えたあとは、メモリの `state` も読み直す（そのあと、呼ぶ側がページを読み込み直す）。
  - `export function createFakeAuthPort(world: { link(): void; signin(): void; signOut(): void; isGoogle(): boolean }, options: { loginFail?: string; googleTaken?: boolean }): AuthPort` — `popup`・`withToken` は、`loginFail` があれば `{ code: loginFail }` で落とす。`googleTaken` で `link` なら `auth/credential-already-in-use`。`clientId()` は `'fake-client'`。`current()` は、`isGoogle()` なら `{ kind: 'google', email: FAKE_EMAIL }`。
  - `export function fakeGoTo(url: string, win: Pick<Window, 'location'>, options: { loginFail?: string }): void` — にせの「Google の画面」。`url` から `state`・`nonce`・`redirect_uri` を読み、`win.location.hash` を `#state=<state>&id_token=<にせの JWT>` にして（`loginFail === 'access_denied'` なら `#error=access_denied&state=<state>`）、`win.location.reload()`。にせの JWT は `x.<base64url(JSON.stringify({ nonce, email: FAKE_EMAIL }))>.x`。**いまの URL の `search`（`?studio=fake&…`）は変えない**。
  - `createFakeBackend` の返す `account` = `createAccount(async () => 口, browserAccountEnv((url) => fakeGoTo(url, window, options)))`。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/fakeAuth.test.ts` と `src/tests/fakeBackend.test.ts` に足す）。入れるもの: 結び付ける → `current()` が Google、チケットと服はそのまま。ログアウト → `signIn()` がチケット 0 の別の利用者コード、`listMyItems()` が空。そのあと「入る」→ 元の利用者コード・チケット・服が戻る。Google の世界が置いてあるときに「結び付ける」→ `auth/credential-already-in-use`、いまの世界はそのまま。`googleTaken`・`loginFail` の動き。`fakeGoTo`: `hash` に入れた `id_token` の `nonceOf` が、URL の `nonce` と同じ、`reload` が 1 回、`access_denied` のときは `error`。
- [ ] **Step 2: 落ちるのを見る** — `npx vitest run src/tests/fakeAuth.test.ts src/tests/fakeBackend.test.ts`
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通るのを見る** — `npx vitest run src/tests`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `ログイン: 偽物の裏側（結び付ける・ログアウト・入り直す・にせの「画面を移る」）`

---

### Task 5: 画面（「アカウント」の欄・戻りの仕上げ・ホームの知らせ）

**Files:**
- Create: `src/appStudio/Account.tsx`、`src/home/LoginNotice.tsx`、`src/tests/accountSection.test.tsx`
- Modify: `src/appStudio/AppStudio.tsx`（利用者コードの行の上に `<Account>`）、`src/appStudio/index.tsx`（要れば、props を通す）、`src/appStudio/appStudio.css`、`src/home/home.css`、`src/App.tsx`

**Interfaces:**
- Consumes: Task 2 の `StudioAccount`（`session.backend.account`）・`deviceEmpty`・`forgetAccount`・`completeRedirect`・`takeNotice`・`LOGIN_MESSAGES`、`CloudSession`（`getState().user`）、`Library`。
- Produces:
  - `export function Account(props: { session: CloudSession; library: Library; reload?: () => void }): JSX.Element` — `reload` の既定は `() => window.location.reload()`。
  - `export function LoginNotice(props: { message: string; onClose: () => void }): JSX.Element`
  - `data-testid`: `account-section`、`account-login-popup`、`account-login-redirect`、`account-busy`、`account-message`、`account-email`、`account-logout`、`account-logout-confirm`、`account-logout-yes`、`account-logout-no`、`login-notice`、`login-notice-ok`。

欄の動き（設計書 7.1・7.2）:

- 出たとき: `account.prepare()`・`account.canRedirect()`・`deviceEmpty(session.backend)` を済ませる。済むまで、2 つのボタンは `disabled`（文は「準備しています…」）。`prepare` が失敗したら、欄に `LOGIN_MESSAGES['not-ready']` ではなく「いまは、ログインの準備ができません（インターネットを確かめてください）」を出し、ボタンは押せないまま。`canRedirect` が false なら、方法 2 のボタンは押せるままにして、押したら `not-ready` の文が出る（`startRedirect` が返す）。
- `intent` = 空なら `'signin'`、空でなければ `'link'`。
- 方法 1 のボタン: `onClick` の中で、**最初の文として** `const pending = account.loginWithPopup(intent)` を呼ぶ（その前に `setState` はしてよいが、`await` はしない）。結果: `linked` → `prepare()` をもう一度呼んで「ログイン中」に、文を出す。`switched` → `forgetAccount(library, 入る前の利用者コード, localStorage)` → 文を `NOTICE_KEY` に置く → `reload()`。ほか → `LOGIN_MESSAGES[outcome]` を `account-message` に。
- 方法 2 のボタン: `account.startRedirect(intent)`。返って来たら（= 移れなかった）、その文を出す。
- 文言（そのまま）: 見出し「アカウント」。説明「Google のアカウントでログインすると、ほかの端末でも、同じチケットと服を使えます。」。ボタン「Google でログイン（方法 1: 小さい窓）」「Google でログイン（方法 2: 画面を移る）」。注「ためしの版です。どちらの方法で、うまくいったか・いかなかったかを、きろく（log）から報告してください。」。待ち「ログインしています…」。ログイン中「ログイン中: {email}」（email が空なら「ログイン中」だけ）、ボタン「ログアウト」。
- ログアウト: 「ログアウト」→ 確かめ（`account-logout-confirm`）: 「ログアウトすると、この端末では、チケットと作った服が見えなくなります。アカウントには残っていて、同じ Google でログインすると戻ります。」［ログアウトする］［やめる］。「ログアウトする」→ `account.logout()` → **うまくいったときだけ** `forgetAccount(library, いまの利用者コード, localStorage)` → `reload()`。`logout()` が投げたら、何も消さずに「ログアウトできませんでした。少し待ってから、もう一度ためしてください」（Review Focus 5）。
- 偽物の裏側（`demo`）でも、同じ欄を出す。

`src/App.tsx`:

- つなぎ役を作る所（`boot.bootSession(...)` のあと）で、`hasReturn(sessionStorage)` なら `completeRedirect({ backend: session.backend, library, session: sessionStorage, local: localStorage, reload: () => window.location.reload() })` を呼ぶ（`hasReturn`・`completeRedirect` は、`boot` と同じく、動的に読み込んだ側から使う。「つくる」を教えていない端末の読み込みに、`account.ts` を入れない）。返って来た文を、state に入れる。
- 起動のとき、`NOTICE_KEY` に文があれば（`takeNotice`）、それを state に入れる（`sessionStorage` を 1 つ読むだけなので、`App.tsx` に小さく書いてよい。キーの名前は `account.ts` と同じ `'dressup_login_notice'`）。
- 文があれば、`<LoginNotice>` を、ホームでもゲームの画面でも、いちばん手前に出す（「OK」で閉じる）。
- 開発用の設定（StrictMode）で、この effect が 2 回走っても、`completeRedirect` → `finishRedirect` が 1 回しか証明を使わないこと（Task 2 の守り）に頼る。文が 2 回入っても、同じ文。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/accountSection.test.tsx`。`session`・`library`・`account` は偽物）。入れるもの:
  - 準備が済むまで、2 つのボタンが `disabled`。済むと押せる。
  - 空でない端末: 方法 1 を押す → `loginWithPopup('link')`。**`fireEvent.click` が返った時点で、もう呼ばれている**。`linked` → 「ログイン中: tameshi@example.com」と `LOGIN_MESSAGES.linked`。
  - 空の端末: 方法 1 → `loginWithPopup('signin')`。`switched` → `forgetAccount` 相当（控えから、前の利用者コードの服が消える）→ `reload` が 1 回。
  - `taken`・`cancelled`・`no-popup` → その文が `account-message` に。`reload` は呼ばれない。控えは変わらない。
  - 方法 2 → `startRedirect(intent)`。`not-ready` が返る → その文。
  - ログイン中: メールアドレスと「ログアウト」。押す → 確かめの文。「やめる」→ 何も起きない。「ログアウトする」→ `logout()` → 控えから、いまの利用者コードの服だけが消える（ほかの `owner` の服は残る）→ `reload` 1 回。`logout()` が投げる → 控えはそのまま、`reload` は呼ばれない、文が出る。
  - ゲスト（ログインしていない）のとき、「ログアウト」のボタンは無い。
  - `LoginNotice`: 文と「OK」。押すと `onClose`。
- [ ] **Step 2: 落ちるのを見る** — `npx vitest run src/tests/accountSection.test.tsx`
- [ ] **Step 3: `Account.tsx`・`LoginNotice.tsx`・CSS を書く**。見た目は、いまの「つくる」（`appStudio.css` の `studio-hint`・`studio-row`・ボタン）と、ホームの共有の窓（`home.css` の `home-share-overlay`）に合わせる。縦のスマホ（幅 390px）で、ボタンの文が折り返しても、はみ出さないこと。
- [ ] **Step 4: `AppStudio.tsx` と `App.tsx` をつなぐ**
- [ ] **Step 5: 通るのを見る** — `npx vitest run src/tests`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 6: コミット** — `ログイン: 「つくる」の中の「アカウント」の欄、戻りの仕上げ、ホームの知らせ`

---

### Task 6: E2E と、全体の確かめ

**Files:**
- Create: `e2e/account.spec.ts`
- Modify: `e2e/appStudioReal.spec.ts`（`fakeFirebase` の受け止めに、`identitytoolkit.googleapis.com/v1/accounts:createAuthUri` の偽の返事を足す）、`e2e/helpers.ts`（要れば）

**Interfaces:**
- Consumes: `?studio=fake`、`localStorage` の `dressup_fake_options`（`tickets`・`delayMs`・`loginFail`・`googleTaken`）、Task 5 の `data-testid`。いまの E2E の書き方は `e2e/appStudio.spec.ts`・`e2e/closet.spec.ts`・`e2e/helpers.ts` を見る。

- [ ] **Step 1: `e2e/account.spec.ts` を書く**（偽物の裏側）。テスト:
  1. **方法 1 で結び付ける**: チケット 5・服を 1 点作ってある端末で、「つくる」→ 欄の方法 1 → 「ログイン中: tameshi@example.com」。読み込み直しても「ログイン中」。チケットの数と、クローゼットの服は、そのまま。
  2. **ログアウト → 方法 2 で入り直す**: 1 の続き。「ログアウト」→ 確かめ →「ログアウトする」→（読み込み直される）→ クローゼットが空、「つくる」のチケットが 0 枚、欄はログイン前。方法 2 を押す →（にせの「画面を移る」で読み込み直される）→ **URL に `#` が残っていない**、`login-notice` に「Google のアカウントでログインしました」→「OK」→ クローゼットに、元の服が戻っている。チケットも元の数。
  3. **もう使われている**: Google の世界を置いたまま（2 の途中の状態を、`localStorage` に直接作ってよい）、空でない端末（チケット 3）で方法 1 → `account-message` に `LOGIN_MESSAGES.taken`。チケットは 3 のまま、欄はログイン前のまま。方法 2 でも同じ文が、`login-notice` に出る。
  4. **やめた・窓が開かない**: `loginFail: 'auth/popup-closed-by-user'` → 「ログインを やめました」。`loginFail: 'auth/popup-blocked'` → 「小さい窓を開けませんでした。方法 2 を試してください」。`loginFail: 'access_denied'` で方法 2 → 知らせに「ログインを やめました」。
  5. **きろく**: 1〜2 のあと、版数を 5 回押して `log` → きろくに `login start popup`・`login result linked`・`login out`・`login back ok`・`login result switched` があり、**`@` と `id_token` が無い**（`diag-panel` の文字で確かめる。書き方は `e2e/diag.spec.ts`）。
  6. **よその `#`**: `…/?studio=fake&home=0#state=zzz&id_token=x.y.z` を、覚え無しで開く → URL から `#` が消え、知らせは「ログインできませんでした。少し待ってから、もう一度ためしてください」、利用者は変わらない。`#foo` で開く → `#foo` のまま、知らせは出ない。
  7. **縦のスマホ（390×844）**: 欄の 2 つのボタンが、画面の幅に収まっている（`boundingBox` の右端 ≤ 390）。
- [ ] **Step 2: `e2e/appStudioReal.spec.ts`**: `fakeFirebase` に `createAuthUri` の偽の返事（`{ authUri: 'https://accounts.google.com/o/oauth2/auth?client_id=test-client.apps.googleusercontent.com' }`）を足し、テストを 1 つ足す: 本物の裏側（`?studio=1`）で「つくる」を開く → 欄が出て、準備が済むと 2 つのボタンが押せる、ログイン前の表示。**本物の Firebase・Google へは、1 つも通信が出ない**（いまの受け止めの決まり）。方法 2 を押す → `accounts.google.com` への移動を `page.route` で受け止めて、URL の `client_id` が `test-client.apps.googleusercontent.com`、`redirect_uri` が `http://localhost:4173/DressUpGame/`、`response_type=id_token`、`nonce` と `state` がある、を確かめる（受け止めたあとは、空のページを返してよい）。
- [ ] **Step 3: 走らせる** — `npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/account.spec.ts e2e/appStudioReal.spec.ts --trace off`。落ちたら、**アプリの側の不具合か、テストの書き方か**を見分けて直す（アプリの側なら、ユニットのテストを足してから直す）。
- [ ] **Step 4: 全体** — `npx vitest run`（`tools/studio/processSwap.test.ts` の 1 件は、この環境では時間切れで落ちることがある。それだけなら、そう報告する）、`npx tsc -b`、`npx eslint .`、`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`（10〜15 分）。件数と、落ちたものを報告する。
- [ ] **Step 5: コミット** — `ログイン: E2E（結び付ける・ログアウト・入り直す・もう使われている・きろく・よその #）`

---

### Task 7: まとめ（まとめ役が自分でする）

- [ ] 最後の全体レビュー（Opus。設計書 7 章・この計画の Review Focus と、`main` からの差分）。出た点を直す。
- [ ] 画面の写真（横・縦のスマホ。ログイン前・ログイン中・ログアウトの確かめ・ホームの知らせ）を `docs/superpowers/specs/2026-11-23-login/` に。
- [ ] `docs/firebase-setup.md` に 2-10（Google のログインを有効にする手順。設計書 9 章）。
- [ ] 版数 `0.37.0`（`src/version.ts`・`README.md`）、設計書 11 章（結果）、`docs/superpowers/specs/2026-11-23-stage3a-ledger.md`（決めたこと・残したこと）、`docs/superpowers/HANDOFF.md`。
- [ ] 作者に、写真と結果を見せて、公開してよいかをカードで聞く。
