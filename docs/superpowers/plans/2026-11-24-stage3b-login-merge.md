# 段階 ③-b 2 台めの端末を合わせる（v0.38.0） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2 台めの端末（チケットか服がある）で、もう使われている Google のアカウントを選んだら、聞かずに、チケットと服をアカウントに合わせてログインできるようにする。ログインのボタンは 1 つ（画面を移る方法）にして、小さい窓は「うまくいかないとき」として残す。

**Architecture:** 匿名の利用者のうちに、サーバーから使い捨ての「引き継ぎの合い言葉」をもらって端末に覚え、アカウントに入ったあと、合い言葉を出してサーバーに移してもらう。サーバーの「移す」（`drain`）は、何度呼ばれても 2 重に足さない。アプリの段取りは、いまの `src/cloud/account.ts` に足す（Firebase に触る所は、`AuthPort` のまま）。

**Tech Stack:** TypeScript / React 19 / Vite / Firebase（Auth・Functions・Firestore）/ Vitest / Firebase エミュレーター / Playwright。

**Spec:** `docs/superpowers/specs/2026-11-23-login-design.md` の **8 章**（実装の前に、8 章を全部読む。3 章・7 章は、いまの作り）。

**担当するモデル:** Task 1（サーバー。チケットを移す所）= Opus。Task 2〜4（アプリ・E2E）= Sonnet。最後の全体レビュー = Opus。まとめ = この会話のモデル。

## Global Constraints

- チケットや服が、無くならない・2 重に足されない（設計書 8.2）。サーバーの書き換えは、取り引きの中で読み直す（確定の返事が届かず、やり直されても、2 回めは何も移さない）。
- 古いサーバー（`api` が 2）のままでも、「つくる」・クローゼット・1 台めのログイン・空の端末のログイン・ログアウトは、いままでどおり動く。アプリが断ってよいのは、合わせることだけ。`src/cloud/wire.ts` の `SERVER_API = 3`・`MIN_API = 2`・`ADOPT_API = 3` は、もう入っている（変えない）。
- きろく（`diag.note`）・`console.*` に、メールアドレス・証明（`id_token`）・`state`・`nonce`・合い言葉・Google の番号（`sub`）を渡さない。Firebase・サーバーの失敗は、理由の語だけを使う。
- 小さい窓は、ボタンの `onClick` の中で、何も `await` しないうちに開く（いまのまま）。
- 「つくる」を教えていない端末（`readStudioMode()` が null）では、Firebase も `src/cloud/boot.ts` も `account.ts` も読み込まない（いまのまま）。
- 画面の文は、この計画の文を、そのまま使う。
- テストを先に書く。失敗を見てから実装する。コミットは、タスクごと。文は日本語。最後に、次の 2 行:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_017tg9jvY2baLxHy7Ufd7PFu`
- `git add` は、自分が変えたファイルだけ（`git add -A` は、しない。ほかの担当が、同時に別のファイルを書いている）。`git push` はしない。`main` には触らない。`docs/` は、まとめ役が書く。
- 確かめ: `npx vitest run <ファイル>`、`npx tsc -b`、`npx eslint .`（エラー 0。前からある警告 1）。エミュレーター: `npm run firebase:test`。E2E: `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test <ファイル> --trace off`。

## Review Focus

1. `adopt` の返事が届かずに、アプリがもう一度呼ぶ／Firestore が取り引きをやり直す → チケットも服も、1 回ぶんだけ移る（Task 1）。
2. 合わせている最中に、古い匿名の利用者の仕事が、まだ進んでいる・やり直しで服を消す → 進んでいる仕事の服は、終わるまで移さない。終わったら、アカウントに入る（Task 1）。
3. アカウントに入ったあと、`adopt` の前に通信が切れる・アプリを閉じる → 次の起動で、もう一度 `adopt`。それまで、端末の服は消えない（Task 3）。
4. Google との 2 回めの行き来が、終わらなくなる（「もう使われている」→ 合い言葉 → 2 回め → また「もう使われている」…）→ 行き来は、最大 3 回（最初・画面なし・選ぶ画面）で、必ず止まる（Task 2・3）。
5. 合い言葉を、ほかの人が出す・使ったあとにもう一度出す・ログアウトしてから出す → 断る／待つ／捨てる、が決まっていて、覚えが残り続けない（Task 1・3）。

---

### Task 1: サーバー（合い言葉・移す・服を消す）— Opus

**Files:**
- Modify: `tools/cloud/store.ts`、`tools/cloud/memoryStore.ts`、`tools/cloud/studioCore.ts`、`tools/cloud/api.ts`、`functions/src/firestoreStore.ts`、`functions/src/index.ts`
- Test: `tools/cloud/memoryStore.test.ts`、`tools/cloud/studioCore.test.ts`、`tools/cloud/api.test.ts`、`functions/test/*.emu.ts`（いまあるファイルに足すか、`adopt.emu.ts` を作る）

**Interfaces:**
- Produces（`tools/cloud/store.ts`）:

```ts
export interface UserDoc {
  userCode: string; tickets: number; createdAt: number;
  movedTo?: string; // この利用者（匿名だった）のチケットと服は、この uid へ移す
  adopted?: string[]; // この利用者が、もらった元の uid（古い順。20 件まで）
  named?: boolean; // 匿名でない利用者として、1 回でも呼んだ（移す元には、できない）
  handoff?: string; // この利用者の、いまの合い言葉
}
export interface HandoffDoc { uid: string; createdAt: number; usedBy?: string }
// CloudStore に足す
  // 利用者の印を書く。もう同じ値なら、書かない
  markUser(uid: string, change: { movedTo?: string; named?: true }): Promise<void>;
  // adopted に足す（重ならない。20 件を超えたら、古いものから落とす）
  addAdopted(uid: string, from: string): Promise<void>;
  // その利用者の、まだ使っていない合い言葉があれば返す。無ければ、makeWord() で作って、handoffs と利用者に書く（1 つの取り引き）
  offerHandoff(uid: string, makeWord: () => string, now: number): Promise<string>;
  getHandoff(word: string): Promise<HandoffDoc | null>;
  useHandoff(word: string, by: string): Promise<void>; // usedBy を書く（もう同じなら、書かない）
  // from の残りのチケットを全部、to へ移す（1 つの取り引き。中で from を読み直す）。台帳に、from へ -n・to へ +n（理由 `adopt:out:{to}`・`adopt:in:{from}`）。返り値は、移した枚数。0 なら、何も書かない
  moveTickets(from: string, to: string, now: number): Promise<number>;
  // 服 1 点を、from から to へ移す（1 つの取り引き。中で読み直す）。from に無ければ false。to に同じ ID があれば、書かずに from から消す（true）
  moveItem(from: string, to: string, itemId: string): Promise<boolean>;
```

- Produces（`tools/cloud/studioCore.ts`）: `CoreDeps` に `newWord: () => string`（本物は `randomBytes(32).toString('hex')`）。

```ts
export async function offerHandoff(deps: CoreDeps, uid: string): Promise<string>;
export type AdoptStatus = 'done' | 'used' | 'unknown' | 'refused';
export async function adoptUser(deps: CoreDeps, toUid: string, word: string): Promise<{ status: AdoptStatus; tickets: number; items: number }>;
export async function drain(deps: CoreDeps, from: string, to: string): Promise<{ tickets: number; items: number }>;
export async function drainAdopted(deps: CoreDeps, uid: string): Promise<void>; // adopted の新しい順に 5 人まで
```

- Produces（`tools/cloud/api.ts`）: `handleCall(deps, uid, data, caller: { anonymous: boolean } = { anonymous: true })`。
  - `op: 'signIn'`: 匿名でなければ、`markUser(uid, { named: true })` と `drainAdopted`（失敗しても、`signIn` は通す）。返事は、いままでどおり `{ user, api: SERVER_API }`。
  - `op: 'offer'`: 匿名でなければ `CloudError('refused', …)`。返事 `{ word }`。
  - `op: 'adopt'`（`word`: 100 文字まで）: 匿名なら `{ status: 'wait', tickets: 0, items: 0 }`。ほかは `{ ...(await adoptUser(deps, uid, word)), user }`。
- Produces（`functions/src/index.ts`）: `handleCall(..., { anonymous: request.auth?.token?.firebase?.sign_in_provider === 'anonymous' })`。

**決まり**（設計書 8.5）:

- `adoptUser`: 合い言葉が無い → `unknown`。`usedBy` が、ほかの人 → `used`。元と先が同じ → `done`（0・0。何も書かない）。元の利用者が `named` → `refused`。ほかは、`markUser(from, { movedTo: to })` → 先の利用者を確かめる（`signIn(deps, to)`）→ `addAdopted(to, from)` → `drain` → `useHandoff(word, to)` → `done`（移した数）。同じ人が、同じ合い言葉をもう一度出したら、もう一度 `drain`（残りがあれば移る）。元が管理者でも、断らない。
- `drain`: `moveTickets`。服は `listItems(from)` を 1 点ずつ: 服の ID が `my:{仕事}-…` の形で、その仕事（`getJob(from, 仕事)`）があって `done` でなければ、**移さない**。ほかは `moveItem`。絵のファイルは、動かさない。
- `workJob` の終わり（`done`・`more`・`busy` のどれでも、投げたときも）: その利用者に `movedTo` があれば `drain`（`drain` の失敗で、仕事を失敗にしない）。
- `deleteItem`: 自分の置き場の服のフォルダに加えて、服が持っているパス（`item.paths`）のフォルダ（`users/{だれか}/items/{その服の ID を safe にしたもの}/` の形のものだけ）も、`removeAll`。

- [ ] **Step 1: 失敗するテストを書く**。入れるもの:
  - `memoryStore.test.ts`: `moveTickets`（3 枚 → 元 0・先 +3・台帳 2 行。もう一度呼ぶと 0 で、何も書かない）、`moveItem`（移る・元に無いと false・先に同じ ID があると元から消すだけ）、`offerHandoff`（同じ利用者が 2 回呼ぶと、同じ合い言葉。使われたあとは、新しい合い言葉）、`markUser`・`addAdopted`（重ならない）。
  - `studioCore.test.ts`: `adoptUser` の全部の答え（`unknown`・`used`・`done` 同じ人・`refused` = 元が `named`・ふつうの `done`）。移したあと: 先のチケット = 元 + 先、服は両方、ID・名前・色（`hue`）・並び順（`order`）・`createdAt`・`paths` は、そのまま。**同じ合い言葉で、もう一度 `adoptUser`** → 0・0（Review Focus 1）。**取り引きをやり直す**（いまある `replayTransactions` のやり方を、`moveTickets`・`moveItem` にも広げる。どの書き換えも、確定のあとにもう一度呼ばれる）→ チケットも服も、1 回ぶん。**元の利用者の仕事が、進んでいる途中**（`done: false` で、1 点はもう服になっている）→ その服は、移らない。仕事を `done` にして `workJob` の終わりを通す（または `drain` をもう一度）→ 移る。失敗して戻ったチケットも、移る（Review Focus 2）。`drainAdopted`: 元に、あとからチケットが入る（作者が、古い利用者コードに配った）→ 先の `signIn`（匿名でない）で、移る。`deleteItem`: 移した服を、先の利用者が消す → 元の置き場の絵も消える。ほかの服の絵は、消えない。
  - `api.test.ts`: `offer` は匿名だけ、`adopt` は匿名だと `wait`、匿名でない `signIn` で `named` が付く、`signIn` の返事の `api` が 3。
  - エミュレーター: 匿名の利用者 A（チケットと服を、置き場に直接入れてよい）で `offer` → 匿名でない利用者 B（エミュレーターで、メールとパスワードの利用者を作る、など）で `adopt` → B の `signIn`・`items` に、A の分が入っている。A の `items` は空。もう一度 `adopt` しても、数が変わらない。B が、移した服の絵を取れる（`itemFiles`）。
- [ ] **Step 2: 落ちるのを見る** — `npx vitest run tools/cloud`
- [ ] **Step 3: 実装する**（`store.ts` → `memoryStore.ts` → `studioCore.ts` → `api.ts` → `firestoreStore.ts` → `index.ts`）。Firestore では、`handoffs/{合い言葉}`（合い言葉は、`docId` を通す）。`moveItem`・`moveTickets` は `runTransaction`。
- [ ] **Step 4: 通るのを見る** — `npx vitest run tools/cloud`、`npx tsc -b`、`npx eslint .`、`npm run firebase:test`（22 件 + 足した分。1〜2 分）
- [ ] **Step 5: コミット** — `サーバー: 引き継ぎの合い言葉と、チケットと服を移す（offer・adopt）。移した服の絵も消す`

---

### Task 2: アプリの土台（裏側の形・偽物・口・方法 2 の URL）— Sonnet

**Files:**
- Modify: `src/cloud/backend.ts`、`src/cloud/remoteBackend.ts`、`src/cloud/fakeBackend.ts`、`src/cloud/fakeAuth.ts`、`src/cloud/createBackend.ts`、`src/cloud/firebaseTransport.ts`、`src/cloud/googleRedirect.ts`、`src/cloud/account.ts`（`AuthPort`・`noAccount` の形だけ）
- Test: `src/tests/remoteBackend.test.ts`、`src/tests/fakeBackend.test.ts`、`src/tests/fakeAuth.test.ts`、`src/tests/firebaseAuthPort.test.ts`、`src/tests/googleRedirect.test.ts`

**Interfaces:**
- Consumes: サーバーの受け口（Task 1。`op: 'offer'` → `{ word }`、`op: 'adopt', word` → `{ status, tickets, items, user? }`、`signIn` の返事の `api`）。`ADOPT_API`（`src/cloud/wire.ts`）。
- Produces:
  - `StudioBackend` に足す:

```ts
  // 引き継ぎの合い言葉をもらう（匿名の利用者のうちに）。サーバーが古ければ BackendError('old-server')
  offerHandoff(): Promise<string>;
  // 合い言葉を出して、この利用者へ移してもらう
  adopt(word: string): Promise<AdoptAnswer>;
export interface AdoptAnswer { status: 'done' | 'wait' | 'used' | 'unknown' | 'refused'; tickets: number; items: number }
```

  - `remoteBackend.ts`: `signIn` の返事の `api` を覚える。`offerHandoff` は、まだ `signIn` していなければしてから、`api < ADOPT_API` なら `BackendError('old-server', OLD_SERVER_MESSAGE)`、ほかは `op: 'offer'`。`adopt` は `op: 'adopt'`（返事に `user` があれば、いつもの `took`）。
  - `AuthPort` に足す: `signInWithStashed(): Promise<boolean>` — 「もう使われている」と断られたときに Firebase が返した証明で、そのアカウントに入る。証明が無ければ false。入れなければ、投げる。
    - 本物（`firebaseTransport.ts`）: `popup('link')`・`withToken('link', …)` が `auth/credential-already-in-use` で落ちたとき、`OAuthProvider.credentialFromError(error)` を覚える（落とし方は、いままでどおり）。`signInWithStashed` は、覚えがあれば `signInWithCredential(auth, 覚え)` して true（覚えは、使ったら捨てる）。
    - 偽物（`fakeAuth.ts`）: `FakeOptions.stashed`（既定 true）が false なら false。ほかは、世界の「入る」をして true。
  - `StudioAccount` に足す: `signInWithStashed(): Promise<boolean>`（口へ渡すだけ。`prepare` の前でも、口を用意して呼ぶ）。`startRedirect(intent, options?: { step?: 'silent' | 'chooser'; hint?: string })`。`noAccount` にも足す。
  - `googleRedirect.ts`:
    - `PendingLogin` に `step?: 'silent' | 'chooser'`（無ければ、最初の行き来）。
    - `buildAuthUrl` の入力に `prompt?: 'none' | 'select_account'`（既定 `select_account`）と `loginHint?: string`（あれば `login_hint`）。
    - `ReturnCheck` の `ok: true` に `step?`、`ok: false` の `reason: 'error'` に `step?` と `intent?`（覚えの `state` が合っていたときだけ）。
    - `export function subOf(idToken: string): string | null`（JWT のまん中の `sub`）。
  - `createAccount`（`account.ts`）の `startRedirect`: `options.step === 'silent'` なら `prompt: 'none'` と `loginHint: options.hint`、覚えに `step: 'silent'`、きろくは `start redirect silent`。`'chooser'` なら、覚えに `step: 'chooser'`、きろくは `start redirect chooser`。
  - `createAccount` の `finishRedirect` の結果（`LoginResult`）に足す: `step?: 'silent' | 'chooser'`（どの行き来の戻りか）、`hint?: string`（**結び付けが `taken` だったときだけ**、証明の `sub`。きろくには出さない）。Google が断った戻り（`reason: 'error'`）は、`step` を付けて返す（`access_denied` は `cancelled`、ほかは `failed`。いままでどおり）。
  - 偽物（`fakeBackend.ts`）: `offerHandoff`（`FakeOptions.noAdopt` なら `old-server`。合い言葉と、いまの世界の写しを `dressup_fake_handoff` に置く）、`adopt`（いまの利用者が Google でなければ `wait`。合い言葉が合えば、写しのチケットと服を、いまの世界に足して（同じ ID は足さない）、写しを消して `done`。合わなければ `unknown`。`FakeOptions.adoptFail`（数）が残っている間は、`BackendError('offline', …)` で落として、数を 1 つ減らす = 端末に覚える）。「入る」の世界の入れ替え: 置いてある Google の世界があれば、それに。無くて、合い言葉の写しがあれば、**空の新しい世界**（Google。チケット 0）に。どちらも無ければ、いまの世界のまま Google に。
  - 偽物の「画面を移る」（`fakeGoTo`）: URL の `prompt` が `none` で `FakeOptions.silentFail` なら、`#error=interaction_required&state=…`。にせの証明の中に `sub: 'fake-sub'` も入れる。
  - `createBackend.ts` の `fakeOptions()` に、`noAdopt`・`adoptFail`・`stashed`・`silentFail` を通す。

- [ ] **Step 1: 失敗するテストを書く**（上の Produces の 1 つずつ。とくに: `offerHandoff` は `api` が 2 のサーバーで `old-server`・3 で `op: 'offer'` を呼ぶ。本物の口は、`link` が `credential-already-in-use` で落ちたあとだけ `signInWithStashed` が true で、`signInWithCredential` に `credentialFromError` の結果を渡す。2 回めは false。`buildAuthUrl` の `prompt=none` と `login_hint`。`readReturn` が `step` と `intent` を返す。偽物: 合い言葉 → 入る → `adopt` で、チケットと服が足される。もう一度 `adopt` → `unknown`（もう無い）で、数は変わらない。`adoptFail: 1` → 1 回めは落ち、2 回めは `done`）
- [ ] **Step 2: 落ちるのを見る** — `npx vitest run src/tests`
- [ ] **Step 3: 実装する**。`StudioBackend` を丸ごと作っているテストの偽物には、`offerHandoff`・`adopt` を足す。
- [ ] **Step 4: 通るのを見る** — `npx vitest run src/tests`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `ログイン（合わせる）: 裏側の形（合い言葉・移す）、偽物、Firebase の口（断りと一緒に返る証明で入る）、画面なしの行き来`

---

### Task 3: アプリの段取りと画面（合わせる・ボタン 1 つ・きろく）— Sonnet

**Files:**
- Modify: `src/cloud/account.ts`、`src/cloud/boot.ts`、`src/appStudio/Account.tsx`、`src/appStudio/appStudio.css`、`src/App.tsx`、`src/services/diag.ts`、`src/cloud/firebaseConfig.ts`、きろくの画面（`diagReport` を出している所）
- Test: `src/tests/account.test.ts`、`src/tests/accountSection.test.tsx`、`src/tests/diag.test.ts`（いまあるきろくのテスト）

**Interfaces:**
- Consumes: Task 2 の全部。
- Produces（`account.ts`）:

```ts
export const ADOPT_KEY = 'dressup_adopt_pending'; // localStorage
export const OFFER_TTL_MS = 600_000; // offered の覚えが効く時間（10 分）
export interface AdoptPending { word: string; from: string /* 元の利用者コード */; stage: 'offered' | 'switched'; at: number; hint?: string; admin?: boolean }
export function readAdopt(local: Store | null, now: number): AdoptPending | null; // 10 分を過ぎた offered は、捨てて null
// 結び付けるか、入るか: 空なら入る。空でなくても、効いている offered があれば入る
export function intentFor(empty: boolean, local: Store | null, now: number): LoginIntent;
export type LoginOutcome = /* いままでの 7 つ + */ 'merged' | 'merge-later' | 'taken-old-server' | 'press-again';
export interface SettleDeps { backend: StudioBackend; library: Library; session: Store | null; local: Store | null; now(): number; reload(): void; note(...parts: string[]): void }
// ログインの結果の仕上げ（方法 1・2 で共通）。before: ログインの前の利用者（聞けなかったら null）。
// 返り値: 画面に出す結果。読み込み直した・次の行き来を始めたときは null
export async function settleLogin(deps: SettleDeps, result: LoginResult, method: 'popup' | 'redirect', before: StudioUser | null): Promise<LoginResult | null>;
// 起動のとき（つなぎ役を出す前）: 段階 switched の覚えがあれば、もう一度 adopt。合わさったら、知らせの文を返す
export async function resumeAdopt(deps: SettleDeps): Promise<string | null>;
export const ADMIN_NOTE: string;
```

`settleLogin` の中身（設計書 8.4）:

| 入って来た結果 | すること | 返す |
|---|---|---|
| `linked` | 効いている `offered` の覚えがあれば、捨てる | `linked` |
| `taken`（結び付けが断られた） | (1) `backend.offerHandoff()`。`old-server` → `taken-old-server`。ほかの失敗 → `taken`（きろく `offer old-server` / `offer failed`）。(2) 覚えを書く（`stage: 'offered'`、`from` = `before.userCode`、`admin` = `before.admin`、`hint` = `result.hint`）。きろく `offer ok`。(3) `backend.account.signInWithStashed()` が true → きろく `switch stashed` → 下の「入れた」へ。(4) false・投げた: 方法 2 なら `backend.account.startRedirect('signin', { step: 'silent', hint })`（きろく `switch silent`。画面が移る → `null`。移れずに返って来たら、その結果）。方法 1 なら `press-again` | 左 |
| 画面なしの行き来（`result.step === 'silent'`）が、`switched` でなかった | 方法 2 で、`backend.account.startRedirect('signin', { step: 'chooser' })`（きろく `switch chooser`） | `null` |
| `switched`（入れた） | 覚えが無い → いままでどおり（`forgetAccount(before.userCode)` → 知らせ `switched` → 読み込み直す）。覚えがある → `stage: 'switched'` に書き直す → `backend.adopt(word)`: `done` → 覚えを消す・`forgetAccount(覚えの from)`・知らせ `merged`（きろく `adopt ok tickets=N items=M`）。`used`・`unknown`・`refused` → 覚えを消す・知らせ `switched`（きろく `adopt <語>`）。投げた・`wait` → 覚えは残す・**控えは外さない**・知らせ `merge-later`（きろく `adopt later`）。どの道も、最後に読み込み直す。覚えの `admin` が true で、`merged`・`merge-later` なら、知らせの文に `ADMIN_NOTE` を足す | `null` |
| ほか（`cancelled`・`not-ready`・`no-popup`・`failed`・行き来の途中でない） | 何もしない | そのまま |

- `completeRedirect`: `finishRedirect` の `intentNow` は、**効いている `offered` があれば、いつも `signin`**（空でなくなっていたら結び付けに直す、を、しない）。結果は `settleLogin(..., 'redirect', before)` に通して、返って来た結果の文を返す。
- `resumeAdopt`: 覚えが `switched` のときだけ、`backend.adopt(word)`。`done` → 覚えを消す・`forgetAccount(from)`・文（`LOGIN_MESSAGES.merged` の後ろの文「この端末のチケットと服を、アカウントに合わせました」）。`used`・`unknown`・`refused` → 覚えを消す・null。投げた・`wait` → 何もしない。
- `LOGIN_MESSAGES` に足す文:

```ts
  merged: 'Google のアカウントでログインしました。この端末のチケットと服を、アカウントに合わせました',
  'merge-later': 'Google のアカウントでログインしました。この端末のチケットと服は、インターネットにつながったときに、合わせます',
  'taken-old-server': 'この Google のアカウントは、ほかの端末で使われています。サーバーが古い版のため、まだ合わせられません（作者が載せ直す必要があります）',
  'press-again': 'もう一度「小さい窓でログイン」を押すと、この端末のチケットと服を合わせて、ログインします',
  taken: 'この Google のアカウントは、ほかの端末で使われています。合わせる準備ができませんでした。少し待ってから、もう一度ログインしてください', // 書き換える
export const ADMIN_NOTE = '（この端末は管理者でしたが、合わせたので、管理者の印が外れました。Firebase の画面で、管理者の利用者コードを、いまの利用者コードに書き換えてください。手順書 2-11）';
```

- `src/cloud/boot.ts`: `resumeAdopt` を再輸出。`src/App.tsx` の、つなぎ役を作る所: `completeRedirect` のあと（戻りが無いときも）、`resumeAdopt` を呼んでから、つなぎ役を出す。返った文は、ホームの知らせに。
- `src/appStudio/Account.tsx`:
  - ボタン: 大きいボタン「Google でログイン」（`data-testid="account-login-redirect"`。方法 2）。その下に、小さい文字で「うまくいかないとき: 」と、小さいボタン「小さい窓でログイン」（`data-testid="account-login-popup"`）。「ためしの版です…」の注は、消す。
  - `intent` は `intentFor(empty, localStorage, Date.now())`。
  - 方法 1 の結果・方法 2 が移れずに返した結果は、`settleLogin` に通す（`before` は、押したときの `session.getState().user`）。`null` が返ったら、待ちのまま（読み込み直される・画面が移る）。いまの `handle` の中の `switched` の扱い（控えを外す・知らせ・読み込み直す）は、`settleLogin` に任せて、消す。
- `src/services/diag.ts`: `note('login', …)` の行は、ふだんの行に加えて、**別の保存**（`dressup_diag_login`。新しい 30 行。先頭に `MM-DD HH:mm`）にも残す。`Diag` に `loginLines(): string[]`。`diagReport` は、行があれば、最後に `--- ログイン ---` と、その行を出す。
- `src/cloud/firebaseConfig.ts`: `GOOGLE_CLIENT_ID = '389373249780-na1putbqacl36ste99du074tm5hojb8d.apps.googleusercontent.com'`（公開してよい値）。

- [ ] **Step 1: 失敗するテストを書く**。`account.test.ts`: 上の表の全部の行と、`readAdopt`（10 分）、`intentFor`、`resumeAdopt` の全部の答え、**行き来が 3 回で止まる**（最初 `taken` → 画面なし → 断られる → 選ぶ画面 → `cancelled` で、`startRedirect` は、もう呼ばれない。Review Focus 4）、**`adopt` が落ちたとき、控えの服が残る**（Review Focus 3）、きろくに、合い言葉・`sub`・`@` が入らない。`accountSection.test.tsx`: ボタンの文と testid、注が無い、`offered` の覚えがあると方法 1 が `signin`、`press-again` の文、`switched` で `settleLogin` を通って読み込み直す（いまあるテストは、新しい形に合わせて直す。弱めない）。`diag.test.ts`: `login` の行が、読み込み直し（`createDiag` を、同じ保存で作り直す）を 3 回はさんでも残る・30 行まで・報告に出る。
- [ ] **Step 2: 落ちるのを見る** — `npx vitest run src/tests`
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通るのを見る** — `npx vitest run src/tests`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `ログイン: 2 台めの端末を、聞かずにアカウントへ合わせる。ボタンを 1 つに。ログインのきろくを、読み込み直しをはさんでも残す`

---

### Task 4: E2E と、全体の確かめ — Sonnet

**Files:**
- Modify: `e2e/account.spec.ts`、`e2e/appStudioReal.spec.ts`、`e2e/helpers.ts`（`FakeOptions` に足す）

- [ ] **Step 1: `e2e/account.spec.ts`**。いまあるテストを、新しい画面（ボタン 1 つ + 小さいボタン、注が無い）に合わせて直す（弱めない。「もう使われている」のテストは、下の「合わさる」に変わる）。足すテスト（偽物の裏側）:
  1. **合わさる（主の方法・行き来なし）**: Google の世界（チケット 5・服 1 点）を置いた端末で、匿名の利用者（チケット 3・服 1 点）が「Google でログイン」→（読み込み直しのあと）ホームの知らせ「…合わせました」→ チケット 8 枚、クローゼットに服が 2 点。欄は「ログイン中」。
  2. **合わさる（画面なしの行き来）**: `stashed: false` で、同じこと（知らせ・8 枚・2 点）。URL に `#` が残らない。
  3. **選ぶ画面つきの行き来**: `stashed: false`・`silentFail: true` で、同じ結果。
  4. **`adopt` が 1 回落ちる**: `adoptFail: 1` → 知らせ「…つながったときに、合わせます」。チケットは 5 枚（まだ）、**クローゼットには、端末の服が残っている**。読み込み直す → 知らせ「この端末のチケットと服を、アカウントに合わせました」→ 8 枚・2 点。
  5. **古いサーバー**: `noAdopt: true` → 知らせ「…サーバーが古い版のため、まだ合わせられません…」。チケット 3 枚のまま、ログイン前のまま。
  6. **小さい窓で合わさる**: 「小さい窓でログイン」→（読み込み直しのあと）知らせ「…合わせました」→ 8 枚・2 点。`stashed: false` なら、欄に「もう一度「小さい窓でログイン」を押すと…」→ もう一度押す → 合わさる。
  7. **管理者**: `admin: true` の端末で 1 と同じ → 知らせに「この端末は管理者でしたが…」が入る。
  8. **きろく**: 1 のあと、きろくの画面の「--- ログイン ---」に `login offer ok`・`login switch stashed`・`login adopt ok tickets=3 items=1`・`login result merged` があり、`@`・合い言葉が無い。
- [ ] **Step 2: `e2e/appStudioReal.spec.ts`**: 方法 2 の移動先の `client_id` が、`GOOGLE_CLIENT_ID` の値になった（`createAuthUri` を呼ばなくなった）ことに合わせて直す。本物の Firebase・Google へは、1 つも通信が出ない、は、そのまま。
- [ ] **Step 3: 走らせる** — `npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/account.spec.ts e2e/appStudioReal.spec.ts --trace off`。アプリの側の不具合なら、ユニットのテストを足してから直す。
- [ ] **Step 4: 全体** — `npx vitest run`、`npx tsc -b`、`npx eslint .`、`npm run firebase:test`、全部の E2E（10〜15 分）。件数と、落ちたものを報告。
- [ ] **Step 5: コミット** — `ログイン: E2E（2 台めが合わさる・画面なしの行き来・adopt のやり直し・古いサーバー・小さい窓・管理者・きろく）`

---

### Task 5: まとめ（まとめ役が自分でする）

- [ ] 最後の全体レビュー（Opus）。出た点を直す。
- [ ] `docs/firebase-setup.md` の 2-11（載せ直し・管理者の利用者コードの書き換え・2 台での試し方）。
- [ ] 版数 `0.38.0`（`src/version.ts`・`README.md`）、設計書 12 章（結果）、`docs/superpowers/specs/2026-11-24-stage3b-ledger.md`、`docs/superpowers/HANDOFF.md`。
- [ ] 作者に、結果を見せて、公開してよいかをカードで聞く。
