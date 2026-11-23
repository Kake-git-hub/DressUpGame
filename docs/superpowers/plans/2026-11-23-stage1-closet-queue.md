# 段階 ①: クローゼット・止まらない生成・演出・ホームの公開（v0.35.0） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引いたチケットが必ず「クローゼットの服」か「払い戻し」で終わるように、生成をサーバーの列（Cloud Tasks）で進め、できた服を自動で保存し、クローゼット・3 つの演出・ホームの全員公開を足す。

**Architecture:** サーバーの本体（`tools/cloud/`）に「列に入れる」役（`deps.enqueue`）を外から渡し、`runJob` が 1 点できるごとに服として保存する。Firebase の層（`functions/`）は、列の関数 `studioWork` と見回り `studioSweep` を足し、`studioRun` を消す。アプリは、起動時に裏で動く「つなぎ役」（`src/cloud/session.ts`）が、服の合わせ・進み具合・届いた知らせを 1 か所で持ち、つくる・クローゼット・演出がそれを見る。

**Tech Stack:** React 19 + TypeScript (strict)、Vite 7、Vitest、Playwright、Firebase（firebase-functions 7.4.0 の `onTaskDispatched`・`onSchedule`、firebase-admin 14.5.1 の `getFunctions().taskQueue`）、sharp。

**Spec:** `docs/superpowers/specs/2026-11-23-closet-and-unstoppable-generation-design.md`（必ず読む。この計画は、そこに無い「名前・形・値」だけを決める）

## Global Constraints

- 画面の言葉は日本語。クローゼットと演出は、ひらがな中心（子どもも見る）。「つくる」の入力の欄は、漢字かな交じり（大人向け）。
- テストを先に書き、失敗を見てから実装する（`docs/superpowers/HANDOFF.md` 5 章）。
- 「つくる」を教えていない端末（`readStudioMode()` が null）は、Firebase の部品を読み込まない。「つくる」「クローゼット」も出さない。
- 端末の控えを合わせるとき、丸ごと入れ替えない（`src/cloud/sync.ts` の決まり: 消すのは「いまの利用者の服で、サーバーから無くなったもの」だけ）。
- 払い戻しの鍵は、今までと同じ `${jobId}:${index}`（`refundOnce`）。前の版で戻した分を、二重に戻さない。
- 版数: `src/version.ts` の `APP_VERSION` と `README.md` を `0.35.0` に。
- サーバーの部品の版は変えない（`functions/package.json` はそのまま。足す部品は無い）。
- コミットメッセージ・コード・文書に、AI のモデル名を書かない。コミットの末尾は、セッションの決まりの 2 行。
- 画像生成（Task 12）は作者の費用。枚数を数えて報告する。上限 10 枚。
- 確かめるコマンド: `npx vitest run`、`npx tsc -b`、`npx eslint .`、`npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`、`npm run firebase:test`。

## Review Focus

設計書が言っていないが、使う人が当たりそうな所。それぞれ、持ち主のタスクにテストを足してある。

1. **つながっていないときに、覚えている利用者で起動する**: ゲームはいつもどおり開き、知らせも出さない。つながったら、裏で合わせる（Task 7）。
2. **同じ利用者の 2 つ目の端末・タブ**: 片方で見た演出は、もう片方で出ない。開いている服が、ほかの端末で消されていたら、直す操作は「この服は見つかりません」で閉じ、一覧から消える（Task 5・10）。
3. **端末に保存できない（空きが無い・IndexedDB が使えない）のに服が届いた**: 演出は 1 回出して「このたんまつに ほぞんできませんでした」と添え、見たことにする（何度も出さない）（Task 11）。
4. **服のドールが、公開の素材から消えた**: クローゼットでは「いまは つかえない ドール」として出て、消せる。届いた演出は、ドールの絵なしで、服の絵だけを出す（Task 10・11）。
5. **「作る」の連打・演出の途中の操作**: 注文の演出の間は入力もボタンも押せず、仕事は 1 つだけできる。「きせてみる」は、素材の読み込みが終わってから着せる（Task 9・11）。

---

## ファイルの地図

| ファイル | 役割 | 変更 |
|---|---|---|
| `tools/cloud/store.ts`・`memoryStore.ts`、`functions/src/firestoreStore.ts` | 置き場の形と本物 | 項目と操作を足す（Task 1） |
| `tools/cloud/studioCore.ts` | 生成の進行・保存・払い戻し・服の直し | Task 2・3 |
| `tools/cloud/api.ts`、`src/cloud/wire.ts` | アプリからの受け口と、やり取りの形 | Task 4 |
| `functions/src/index.ts`、`firebase.json`、`firestore.indexes.json`（新）、`package.json` | 列の関数・見回り・載せる設定 | Task 4 |
| `src/cloud/backend.ts`・`fakeBackend.ts`・`remoteBackend.ts`・`sync.ts`・`library.ts` | アプリの裏側 | Task 5・6 |
| `src/cloud/session.ts`（新） | 起動時の合わせ・進み具合・届いた知らせ | Task 7 |
| `src/home/`、`src/App.tsx` | ホーム・画面の切り替え | Task 8 |
| `src/appStudio/AppStudio.tsx`、`src/appStudio/OrderShow.tsx`（新） | つくる・注文とチケットの演出 | Task 9 |
| `src/closet/Closet.tsx`・`ClosetItem.tsx`・`closet.css`（新） | クローゼット | Task 10 |
| `src/reveal/Reveal.tsx`・`reveal.css`（新） | クローゼットが開く演出 | Task 11 |
| `tools/art/shopArt.ts`（新）、`src/assets/shop/*.webp`（新） | 店員とお店の絵 | Task 12 |

---

### Task 1: 置き場に、項目と 3 つの操作を足す

**Files:**
- Modify: `tools/cloud/store.ts`、`tools/cloud/memoryStore.ts`、`functions/src/firestoreStore.ts`
- Create: `tools/cloud/memoryStore.test.ts`
- Modify (test): `functions/test/adapters.emu.ts`

**Interfaces:**
- Produces（`tools/cloud/store.ts`）:

```ts
export type CandidateStatus = 'waiting' | 'working' | 'done' | 'failed' | 'kept' | 'discarded'; // done・discarded は前の版の名残
export interface CandidateDoc { /* 今までの項目 */ tries?: number; itemId?: string; refunded?: boolean }
export interface JobDoc { /* 今までの項目 */ v?: 2; seen?: boolean; queuedAt?: number }
export interface ItemDoc { /* 今までの項目 */ hue?: number; order?: number; updatedAt?: number; notes?: string[] }
export interface CloudStore {
  // チケットを引くことと、仕事を作ることを、1 つの取り引きで行う。足りなければ CloudError('no-tickets')（どちらも起きない）。返り値は残り
  chargeAndCreateJob(uid: string, job: JobDoc, cost: number, reason: string, now: number): Promise<number>;
  // 服を、読んで書き換える（割り込まれない）。無ければ CloudError('refused', 'この服は見つかりません')。change が null なら書かない
  updateItem(uid: string, itemId: string, change: (item: ItemDoc) => ItemDoc | null): Promise<ItemDoc>;
  // 終わっていない仕事（全部の利用者。古い順、limit 件まで）
  listOpenJobs(limit: number): Promise<{ uid: string; job: JobDoc }[]>;
}
```

- [ ] **Step 1: 失敗するテストを書く**（`tools/cloud/memoryStore.test.ts`）。テスト名と確かめること:
  - `chargeAndCreateJob: 足りないと、引かず、仕事も作らない` — 2 枚の利用者に cost 3 → `CloudError` の `code === 'no-tickets'`、`getUser().tickets === 2`、`getJob()` は `null`。
  - `chargeAndCreateJob: 引いて、仕事ができ、台帳に残る` — cost 2 → 残り 0、`ledger` に `{ count: -2, reason }`。
  - `updateItem: 無い服は refused`、`updateItem: change が 2 回呼ばれても結果は 1 つ`（`updateJob` と同じやり直しの作り）。
  - `listOpenJobs: done の仕事は入らない・古い順・limit で切る`。
- [ ] **Step 2: 失敗を見る** — `npx vitest run tools/cloud/memoryStore.test.ts` → 「chargeAndCreateJob is not a function」。
- [ ] **Step 3: `MemoryStore` に 3 つを実装する**（`updateItem` は `updateJob` と同じ「読んで → 待って → 変わっていたらやり直す」）。
- [ ] **Step 4: `FirestoreStore` に実装する。**
  - `chargeAndCreateJob`: `runTransaction` の中で、利用者を読み、`tx.update`（tickets）・`tx.create`（ledger の行）・`tx.create`（仕事）。
  - `updateItem`: `runTransaction`（`updateJob` と同じ形）。
  - `listOpenJobs`: `db.collectionGroup('jobs').where('done', '==', false).orderBy('createdAt', 'asc').limit(limit)`。uid は `decodeURIComponent(doc.ref.parent.parent!.id)`。
- [ ] **Step 5: エミュレーターのテストを足す**（`functions/test/adapters.emu.ts`）: 上の 4 つと同じ内容を `FirestoreStore` で。加えて `chargeAndCreateJob: 3 枚しか無いのに同時に 8 回 → 通るのは 3 回、仕事も 3 つ`。索引は Task 4 で足すので、`listOpenJobs` のテストは Task 4 の Step で走らせる（ここでは `it.todo`）。
- [ ] **Step 6: 通るのを見る** — `npx vitest run tools/cloud`、`npx tsc -b`。
- [ ] **Step 7: コミット** — `置き場: 引くのと仕事を作るのを 1 つの取り引きに、服の書き換え、終わっていない仕事の一覧`

---

### Task 2: 生成を「列」で進め、できたら服にする（サーバーの本体）

**Files:**
- Modify: `tools/cloud/studioCore.ts`、`tools/cloud/studioCore.test.ts`

**Interfaces:**
- Consumes: Task 1 の `chargeAndCreateJob`・`updateItem`。
- Produces（`tools/cloud/studioCore.ts`）:

```ts
export interface CoreDeps {
  /* 今までの項目 */
  // 仕事を、列に入れる。delaySeconds: 何秒あとに呼ばれるか（既定 0）
  enqueue: (uid: string, jobId: string, delaySeconds?: number) => Promise<void>;
  maxTries?: number; // 1 つの品目に取りかかれる回数（既定 3）
}
export const MAX_TRIES = 3;
export const BUSY_RETRY_SECONDS = 60;
// 生成を進める。'busy' = ほかの呼び出しが進めている、'more' = 持ち時間切れで残りがある、'done' = 終わった
export function runJob(deps: CoreDeps, uid: string, jobId: string): Promise<'done' | 'busy' | 'more'>;
// 列の関数の中身: runJob を呼び、'busy' なら 60 秒あと・'more' ならすぐ、列に入れ直す
export function workJob(deps: CoreDeps, uid: string, jobId: string): Promise<void>;
// できなかった（failed）のに、まだ戻していない（refunded !== true）品目を、払い戻して印を付ける
export function settleRefunds(deps: CoreDeps, uid: string, jobId: string): Promise<void>;
```

**決めたこと（設計書 6.1 の実現）**

- `startJob`: 企画のあと、管理者でなければ `chargeAndCreateJob`（管理者は `note` → `createJob`）。仕事には `v: 2`、`queuedAt: now`。そのあと `deps.enqueue(uid, jobId)`。**列に入れるのに失敗しても、例外にしない**（仕事はできている。Task 3 の入れ直しが拾う）。写真の受け口はそのまま。
- `take()`: 受け持つとき `tries = (tries ?? 0) + 1`。順番待ちに戻した品目・順番待ちの品目のうち `tries >= maxTries` のものは、受け持たずに `failed`（`notes: ['作れませんでした（何度か試しましたが、途中で止まりました）。チケットは戻しました']`、`refunded: false`、`job.tickets -= 1`）にして、次の品目を探す。ほかの呼び出しが進めている最中（`working` があり、合図が 150 秒以内）なら `'busy'` を返す。
- **失敗の順番**: 必ず「`failed`・`refunded: false` と書く（`finish`）→ 払い戻す → `refunded: true` と書く」。払い戻しは `settleRefunds` が行う（管理者の仕事 `free` は `note` だけ）。`runJob` は、最初と、品目が失敗するたびに `settleRefunds` を呼ぶ。今までの「先に払い戻す」は、やめる（払い戻したあとに止まると、作り直してできた服と、払い戻しの両方が起きうる）。
- **できたら服にする**: `generateCandidate` が通ったら、`mine(job, index)` を確かめてから、服を保存し（今の `keep` の中身を `saveItem` に切り出す）、`finish(index, { status: 'kept', itemId, notes })`。服の ID は `my:${jobId}-${index}-${tries}`（受け持ちごとに別の名前）。`finish` が通らなかった（追い越された）ら、自分が保存した服を消す（`deleteItem`）。服には `order: now`、`updatedAt: now`、`notes`（検品の注意。あれば）を付ける。候補の絵（`jobPrefix` の下）は、もう置き場に入れない。
- **前の版の `done`**: `take()` の前に、`done` の候補を 1 つずつ、置き場の絵（`candidate.layers`）から服にして `kept` にする（服の ID は、前の版と同じ `my:${jobId}-${index}`）。絵が無ければ `failed`（払い戻しなし。前の版でチケットは使われた扱い）。済んだら `v: 2` を書く。
- 持ち時間（`runBudgetMs`）の既定は、そのまま（呼ぶ側が渡す）。残りがあって時間切れなら `'more'`。
- `keep`・`discard`・`listJobs` は消す（Task 3 で `openJobs` に替える）。

- [ ] **Step 1: 失敗するテストを書く**（`studioCore.test.ts`。`deps.enqueue` は、呼ばれた引数を配列に残す偽物）。今ある `keep`・`discard` のテストは、下の新しい決まりに書き直す。
  - `startJob: チケットを引き、仕事を作り、列に入れる` — `enqueued` が `[[uid, jobId, undefined]]`、仕事に `v === 2`。
  - `startJob: 列に入れられなくても、仕事はできている` — `enqueue` が投げる → `startJob` は通り、`getJob()` がある。
  - `runJob: できた品目は、その場で自分の服になる` — 返り値 `'done'`、候補が `status: 'kept'`・`itemId` あり、`listItems()` が 1 点、`files` に `users/u1/jobs/` で始まるパスが無い。
  - `runJob: セットは、パーツの数だけ服になり、同じ set が付く`。
  - `runJob: できなかった品目は、failed → 払い戻し → refunded: true` — `failImages = true` → 残りが元に戻り、`refunded === true`、服は 0 点。
  - `runJob: failed と書いたあと、払い戻しの前に止まっても、次の runJob が戻す（1 回だけ）` — `store.refundOnce` を 1 回だけ投げるようにして確かめ、もう 1 回 `runJob` → 残りが戻り、3 回目でも増えない。
  - `runJob: 3 回取りかかって止まった品目は、打ち切って払い戻す` — `working`・`tries: 3`・合図が 200 秒前の仕事を置く → `'done'`、`failed`、払い戻し 1 回、`imageCalls === 0`。
  - `runJob: ほかの呼び出しが進めていたら 'busy'`、`runJob: 持ち時間切れで残りがあれば 'more'`（`runBudgetMs: 0`、2 パーツ）。
  - `runJob: 同時に 3 回呼んでも、絵は 1 回、服は 1 点`（今あるテストを、服の数で確かめる形に）。
  - `runJob: 追い越された呼び出しは、服を残さない` — `imageGate` で止めている間に、合図を古くして 2 つ目を走らせる → 服は 1 点だけ、候補の `itemId` はその服。
  - `runJob: 前の版の done は、服になる`（`layers` の絵を置き場に入れておく）。
  - `workJob: busy なら 60 秒あと、more ならすぐ、列に入れ直す。done なら入れない`。
- [ ] **Step 2: 失敗を見る** — `npx vitest run tools/cloud/studioCore.test.ts`。
- [ ] **Step 3: 実装する**（上の「決めたこと」のとおり）。
- [ ] **Step 4: 通るのを見る** — `npx vitest run tools/cloud`（`api.test.ts` は Task 4 で直すので、ここでは `keep`・`discard` を呼ぶ行を消すだけ）、`npx tsc -b`。
- [ ] **Step 5: コミット** — `サーバー: 生成を列で進め、できた服をその場で保存。失敗は「印 → 払い戻し」の順に`

---

### Task 3: 入れ直し・打ち切り・見回り・見た印・服の直し（サーバーの本体）

**Files:**
- Modify: `tools/cloud/studioCore.ts`、`tools/cloud/studioCore.test.ts`

**Interfaces:**
- Consumes: Task 2 の `settleRefunds`・`deps.enqueue`、Task 1 の `listOpenJobs`・`updateItem`。
- Produces:

```ts
export const REQUEUE_MS = 30_000;          // 入れ直しは、仕事ごとに 30 秒に 1 回まで
export const EXPIRE_MS = 24 * 3_600_000;   // 作ってから 24 時間で打ち切る
export const HUE_MIN = -180; export const HUE_MAX = 180;
// 仕事 1 つの手当て: 打ち切り（24 時間）→ 払い戻しの残り → 止まっていれば列に入れ直す。返り値は、手当てのあとの仕事
export function tendJob(deps: CoreDeps, uid: string, job: JobDoc): Promise<JobDoc>;
// 見回り: 終わっていない仕事（200 件まで）を tendJob する。返り値は、見た数
export function sweep(deps: CoreDeps): Promise<number>;
// まだ見ていない仕事（v === 2 で seen でないもの + 前の版の、決まっていない候補のある仕事）。新しい順。それぞれ tendJob 済み
export function openJobs(deps: CoreDeps, uid: string): Promise<JobDoc[]>;
// 見た印を付ける。終わっていない仕事には付けない（何もしない）
export function ackJob(deps: CoreDeps, uid: string, jobId: string): Promise<void>;
export function updateItem(deps: CoreDeps, uid: string, itemId: string, change: { name?: string; hue?: number }): Promise<ItemDoc>;
// ids の順に、order を now, now-1, now-2 … にする。自分の服でない ID・同じ ID の重なりは CloudError('refused')
export function orderItems(deps: CoreDeps, uid: string, ids: string[]): Promise<ItemDoc[]>;
```

**決めたこと**

- 「止まっている」= 終わっていなくて、`working` が無いか、合図が 150 秒（`STALE_MS`）より古い。入れ直すときは、`updateJob` で `queuedAt = now` を書いてから `deps.enqueue`（`now - queuedAt < REQUEUE_MS` なら入れない）。
- 打ち切り: `now - createdAt > EXPIRE_MS` で終わっていない仕事は、`waiting`・`working`・`done` の候補を全部 `failed`（`notes: ['時間内に作れませんでした。チケットは戻しました']`、`refunded: false`、`tickets` を減らす）にし、`done: true`、`runner` を消す。そのあと `settleRefunds`。
- `updateItem`: 名前は今の `plainName`（20 文字まで。空なら変えない）。`hue` は整数に丸めて -180〜180 に収める。どちらも `updatedAt = now`。
- `orderItems`: 上限 500 件。`updatedAt = now`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tendJob: 止まっていれば列に入れ直す。30 秒以内には、もう入れない`（`clock` を進めて 2 回）。
  - `tendJob: 進んでいる最中の仕事は、入れ直さない`。
  - `tendJob: 24 時間たった仕事は、残りを failed にして払い戻し、終わりにする` — 2 パーツ中 1 つ `kept`・1 つ `waiting` → `waiting` だけ戻る、`done === true`。
  - `tendJob: 打ち切ったあとに、古い呼び出しができあがっても、服は残らない`（Task 2 の「追い越された」と同じ守りが効くこと）。
  - `sweep: 終わっていない仕事だけを手当てする`。
  - `openJobs: 見た仕事は出ない。終わっていない仕事は ack しても出る`。
  - `openJobs: 前の版の、全部決まった仕事（v なし）は出ない`。
  - `updateItem: 名前は 20 文字まで・hue は -180〜180 に収まる・ほかの利用者の服は refused`。
  - `orderItems: 先頭ほど order が大きい。あとから作った服は、その前に来る`（`clock` を進めて作る）。
- [ ] **Step 2: 失敗を見る。**
- [ ] **Step 3: 実装する。**
- [ ] **Step 4: 通るのを見る** — `npx vitest run tools/cloud`、`npx tsc -b`。
- [ ] **Step 5: コミット** — `サーバー: 止まった仕事の入れ直し、24 時間の打ち切り、見回り、見た印、服の名前・色・順番`

---

### Task 4: 受け口・列の関数・見回りの関数・載せる設定

**Files:**
- Modify: `src/cloud/wire.ts`、`tools/cloud/api.ts`、`tools/cloud/api.test.ts`、`functions/src/index.ts`、`firebase.json`、`package.json`（`firebase:test`・`firebase:deploy`）、`functions/test/callable.emu.ts`、`functions/test/adapters.emu.ts`
- Create: `firestore.indexes.json`

**Interfaces:**
- Consumes: Task 2・3 の関数。
- Produces（`src/cloud/wire.ts`）:

```ts
export const API_VERSION = 2; // 列で生成を進めるサーバー
export interface WireCandidate { index: number; name: string; categoryId: string; status: 'waiting' | 'working' | 'kept' | 'failed'; notes: string[]; itemId?: string }
export interface WireJob { id: string; dollId: string; set?: SetRef; done: boolean; tickets: number; createdAt: number; candidates: WireCandidate[] }
export interface WireItem { id: string; dollId: string; item: ManifestItem; set?: SetRef; createdAt: number; hue: number; order: number; updatedAt: number; notes: string[] }
```

- 受け口（`handleCall` の `op`）:

| op | 入力 | 返り値 |
|---|---|---|
| `signIn` | — | `{ user, api: 2 }` |
| `startJob` | `dollId, theme, styleId, target`（`photo` は受けるが、アプリは送らない） | `{ jobId, cost, user }` |
| `job` | `jobId` | `{ job, user }`（返す前に `tendJob`） |
| `jobs` | — | `{ jobs, user }`（`openJobs`） |
| `ack` | `jobId` | `{ ok: true }` |
| `items` | — | `{ items }` |
| `itemFiles` | `id` | `{ item, files }` |
| `updateItem` | `id, name?, hue?` | `{ item }` |
| `orderItems` | `ids`（文字列の並び、500 まで） | `{ items }` |
| `deleteItem` | `id` | `{ ok: true }` |

  `preview`・`keep`・`discard` は消す。`jobView` は、前の版の `done` を `working` として、`discarded` の候補は除いて返す。`WireItem` の `hue`・`order`・`updatedAt`・`notes` は、無ければ `0`・`createdAt`・`createdAt`・`[]`。

- 関数（`functions/src/index.ts`）:

```ts
const WORKERS = 3; // 同時に進める仕事の数（利用者が増えたら、ここを変えて載せ直す）
export const studio = onCall(/* 今までの設定 */);
export const studioWork = onTaskDispatched(
  { region: REGION, secrets: [GEMINI_API_KEY], memory: '2GiB', timeoutSeconds: 1800, concurrency: 1, maxInstances: WORKERS,
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 30, maxBackoffSeconds: 300 }, rateLimits: { maxConcurrentDispatches: WORKERS } },
  async (request) => { /* request.data = { uid, jobId } を確かめて workJob(deps, uid, jobId)。deps.runBudgetMs は 1_500_000（25 分） */ },
);
export const studioSweep = onSchedule({ schedule: 'every 60 minutes', region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async () => { /* sweep(deps) */ });
```

  `deps.enqueue` の本物: `getFunctions().taskQueue('locations/asia-northeast1/functions/studioWork').enqueue({ uid, jobId }, { scheduleDelaySeconds: delaySeconds ?? 0, dispatchDeadlineSeconds: 1800 })`（`firebase-admin/functions`。東京の関数は、場所まで含めた名前で指定する。持ち時間の既定は 10 分なので、30 分を指定する）。`studioRun` は消す。

- [ ] **Step 1: 受け口のテストを書き直す**（`tools/cloud/api.test.ts`）: 表の op ごとに 1 つ。加えて `signIn は api: 2 を返す`、`job は、止まっている仕事を列に入れ直す`、`keep・discard・preview は refused`、`updateItem の hue が数でなければ refused`、`orderItems の ids が並びでなければ refused`。
- [ ] **Step 2: 失敗を見て、`wire.ts` と `api.ts` を実装し、通るのを見る** — `npx vitest run tools/cloud`。
- [ ] **Step 3: `functions/src/index.ts` を書き換える**（上の形）。`firestore.indexes.json` を作る:

```json
{ "indexes": [{ "collectionGroup": "jobs", "queryScope": "COLLECTION_GROUP", "fields": [{ "fieldPath": "done", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "ASCENDING" }] }], "fieldOverrides": [] }
```

  `firebase.json` の `firestore` に `"indexes": "firestore.indexes.json"`、`emulators` に `"tasks": { "port": 9499 }` を足す。`package.json`: `firebase:deploy` の `--only` を `functions,firestore,storage` に、`firebase:test` の `--only` に `tasks` を足す。
- [ ] **Step 4: エミュレーターのテストを直す**（`functions/test/callable.emu.ts`）: `run()`（`studioRun`）を使う所を、「`startJob` のあと、`job` を 2 秒おきに聞いて、`done` になるまで待つ（上限 90 秒）」に替える。足すテスト: `作る → 何も呼ばなくても、服になる`、`セット 2 点`、`できなかったら払い戻し`、`ack した仕事は jobs に出ない`、`updateItem・orderItems`。Task 1 の `listOpenJobs` の `it.todo` を本物に。
- [ ] **Step 5: 走らせる** — `npm run firebase:test`。**列のエミュレーターが使えない・列の関数が呼ばれないとき**（firebase-tools 15.37.0 で未確認）: `tasks` を設定から外し、エミュレーターのときだけ、`deps.enqueue` が `setTimeout` で `workJob` を直接呼ぶ（`process.env.FUNCTIONS_EMULATOR === 'true'` の分かれ道。`index.ts` の `emulated` と同じ流儀）ようにして、その旨をテストの頭に書く。どちらになったかを、Task 13 の文書に書く。
- [ ] **Step 6: まとめて確かめる** — `npm run functions:build`（まとまること）、`npx tsc -b`、`npx eslint .`。
- [ ] **Step 7: コミット** — `サーバー: 列の関数 studioWork と見回り studioSweep。studioRun をやめる`

---

### Task 5: アプリの裏側の形を、新しいサーバーに合わせる

**Files:**
- Modify: `src/cloud/backend.ts`、`src/cloud/fakeBackend.ts`、`src/cloud/remoteBackend.ts`、`src/cloud/firebaseTransport.ts`（`run` を消す）、`src/cloud/createBackend.ts`、`src/cloud/sync.ts`
- Test: `src/tests/fakeBackend.test.ts`、`src/tests/remoteBackend.test.ts`、`src/tests/sync.test.ts`、`functions/test/client.emu.ts`

**Interfaces:**
- Consumes: Task 4 の `wire.ts`。
- Produces（`src/cloud/backend.ts`）:

```ts
export interface StudioCandidate { index: number; name: string; categoryId: string; status: 'waiting' | 'working' | 'kept' | 'failed'; notes: string[]; itemId?: string }
export interface StudioJob { id: string; dollId: string; set?: SetRef; done: boolean; candidates: StudioCandidate[]; tickets: number; createdAt: number }
export interface MyItem { id: string; dollId: string; item: ManifestItem; files: Record<string, Blob>; set?: SetRef; createdAt: number; owner?: string;
  hue: number; order: number; updatedAt: number; notes: string[] }
export type MyItemInfo = Omit<MyItem, 'files' | 'owner'>;
export type BackendErrorCode = 'offline' | 'no-tickets' | 'limit' | 'refused' | 'unknown' | 'old-server';
export interface StudioBackend {
  signIn(): Promise<StudioUser>; // サーバーが古い（api < 2）なら BackendError('old-server', 'サーバーが古い版です（作者が載せ直す必要があります）')
  onUser(listener: (user: StudioUser) => void): () => void;
  startJob(input: { dollId: string; theme: string; styleId: string; target: StudioTarget }): Promise<{ jobId: string; cost: number }>;
  watchJob(jobId: string, listener: (job: StudioJob) => void): () => void;
  openJobs(): Promise<StudioJob[]>;      // まだ見ていない仕事（作りかけ + 終わって見ていないもの）。新しい順
  ackJob(jobId: string): Promise<void>;
  listMyItems(): Promise<MyItemInfo[]>;
  fetchMyItem(id: string): Promise<MyItem>;
  updateMyItem(id: string, change: { name?: string; hue?: number }): Promise<MyItemInfo>;
  orderMyItems(ids: string[]): Promise<MyItemInfo[]>;
  deleteMyItem(id: string): Promise<void>;
}
// 並び順: order の大きい順（同じなら createdAt の新しい順、ID）
export function byClosetOrder(a: { order: number; createdAt: number; id: string }, b: { order: number; createdAt: number; id: string }): number;
```

- `SyncResult` に `updated: number` を足す。`syncLibrary` は、端末にある服のうち `updatedAt` がサーバーと違うものを、`{ ...端末の服, item: { ...端末の item, name: サーバーの名前 }, hue, order, updatedAt, notes }` に書き直す（絵は取り直さない）。端末の控えに `hue` などが無い服（前の版）は、読むときに `hue: 0, order: createdAt, updatedAt: createdAt, notes: []` として扱う（`library.all()` で補う）。

**決めたこと**

- `remoteBackend`: `kick`・`transport.run`・`preview` を消す。`watchJob` は今までどおり聞きに行く（`pollMs` 既定 2500）。`StudioTransport` は `call` だけ。
- `fakeBackend`: 候補に「できあがる時刻」を持ち、**読み込み直したとき、時刻を過ぎていた分は、その場でできあがりにする**（閉じている間もサーバーが進めた、のまね）。できた品目は、その場で服（`state.items`）になり、候補は `kept`・`itemId`。`FakeOptions` に `planMs?: number`（`startJob` が返るまでの待ち。既定 800）と `oldServer?: boolean` を足す。`seen` を覚える。`updateMyItem`・`orderMyItems` は本物と同じ決まり（20 文字、-180〜180）。偽物の服の ID は `my:${jobId}-${index}-1`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `fakeBackend.test.ts`: `できた品目は、自分の服になる（keep は要らない）`、`読み込み直すと、過ぎていた分はできあがっている`（`Date.now` を進めて作り直す）、`ackJob した仕事は openJobs に出ない`、`updateMyItem・orderMyItems`、`oldServer なら signIn が old-server`、`planMs の間は startJob が返らない`。
  - `remoteBackend.test.ts`: `api が 1・無いサーバーでは signIn が old-server`、`startJob のあと run を呼ばない`（偽の運び役に `run` が無くても動く）、`kept の候補は itemId を持つ`、`updateMyItem は op: updateItem を呼ぶ`。
  - `sync.test.ts`: `updatedAt が違う服は、名前・色・順番だけ直す（fetchMyItem を呼ばない）`、`前の版の控え（hue なし）は、0 として読める`。
- [ ] **Step 2: 失敗を見る** — `npx vitest run src/tests/fakeBackend.test.ts src/tests/remoteBackend.test.ts src/tests/sync.test.ts`。
- [ ] **Step 3: 実装する。** `AppStudio.tsx` は Task 9 で書き直すので、ここでは型が通る最小の直し（`keep`・`discard`・写真の送信を消す）だけ。
- [ ] **Step 4: 通るのを見る** — `npx vitest run`、`npx tsc -b`。`functions/test/client.emu.ts` を新しい形に直し、`npm run firebase:test`。
- [ ] **Step 5: コミット** — `アプリの裏側: 自動で服になる形に。見た印、服の名前・色・順番、古いサーバーの見分け`

---

### Task 6: メニューで自分の服を先に・既定の色

**Files:**
- Modify: `src/cloud/library.ts`、`src/types/index.ts`、`src/components/menuSets.ts`、`src/components/ItemAdjustPanel.tsx`、`src/content/startState.ts`（必要なら）
- Test: `src/tests/library.test.ts`、`src/tests/menuSets.test.ts`、`src/tests/startState.test.ts`、`e2e/appStudio.spec.ts`

**Interfaces:**
- Consumes: Task 5 の `MyItem`（`hue`・`order`）、`byClosetOrder`。
- Produces:

```ts
// src/types/index.ts（ClothingItemData）
defaultHue?: number; // 既定の色（クローゼットで決めた角度）。調整画面の「色をもどす」は、ここへ戻す
// src/cloud/library.ts
// recolorThumb: 絵（data: の URL）に、色を付けた絵（data: の URL）を返す。既定は、ブラウザのキャンバスと pipeline/recolor.ts。テストでは差し替える
export function mergeMyItems(content: LoadedContent, items: MyItem[], recolorThumb?: (url: string, hue: number, dark: boolean) => Promise<string>): Promise<LoadedContent>;
```

**決めたこと**

- `mergeMyItems`: 自分の服を `byClosetOrder` で並べ、**公開の服の前**に置く（`[...mine, ...content.clothing]`）。`hue !== 0` の服は、`colorHue: hue`・`defaultHue: hue` を付け（うしろがみの分にも）、`thumbnailUrl` を色を付けた絵にする。黒っぽいかどうかは、服の絵（と、あれば後ろ髪の絵）のどちらかが `isDarkImage` なら両方とも黒っぽい扱い（ゲームと同じ）。色を付けた絵は、今ある `dataUrls` の覚えに、鍵へ `hue` を足して覚える。
- 自分のセット: `sets` の印に `order` を付ける（`-(そのセットの服のうち、いちばん古い createdAt)`。新しいセットほど小さい = 先）。公開のセットの `order` は 0 以上なので、自分のセットが先になる。`menuSets.ts` は変えなくてよい見込み（テストで確かめる）。
- 調整画面: `hue-reset` は `item.defaultHue ?? 0` に戻す。押せないのは、いまの色がその値のとき。
- 保存した服装に色が無ければ（色を変えずに着ていた）、既定の色で出る。色があれば、保存の色。

- [ ] **Step 1: 失敗するテストを書く。**
  - `library.test.ts`: `自分の服は、公開の服より前。自分の服どうしは order の大きい順`、`hue のある服は colorHue・defaultHue が付き、サムネイルは色を付けた絵`（`recolorThumb` の偽物が `tinted:${hue}` を返す）、`hue が 0 なら recolorThumb を呼ばない`、`髪は、うしろがみにも同じ色`。
  - `menuSets.test.ts`: `自分のセット（order が負）は、公開のセットより前。新しいセットほど前`。
  - `startState.test.ts`: `保存に色が無い服は、既定の色で復元する。色があれば、保存の色`。
- [ ] **Step 2: 失敗を見る → 実装 → 通るのを見る** — `npx vitest run src/tests`。
- [ ] **Step 3: E2E を 1 つ足す**（Task 9 のあとで走らせる。ここでは書くだけ）: `自分の服は、カテゴリの先頭に出る`（`data-mine` の付いた絵が、そのカテゴリの 1 番目）。
- [ ] **Step 4: コミット** — `メニュー: 自分の服を先に。既定の色（サムネイル・着せたときの色・色をもどす）`

---

### Task 7: つなぎ役（起動時の合わせ・進み具合・届いた知らせ）

**Files:**
- Create: `src/cloud/session.ts`、`src/tests/session.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 5 の `StudioBackend`、`syncLibrary`、`Library`。
- Produces:

```ts
export interface SessionState {
  status: 'idle' | 'connecting' | 'ready' | 'problem'; // idle = まだつないでいない
  user: StudioUser | null;
  problem: string | null;      // つなげなかった理由（「つくる」「クローゼット」の中に出す。ゲームには出さない）
  jobs: StudioJob[];           // まだ見ていない仕事。新しい順
  arrivals: StudioJob[];       // jobs のうち、終わっていて、できた服を端末に取り込み終えたもの。古い順（演出を出す順）
  newItemIds: string[];        // NEW の印の服
  storeFailed: boolean;        // 端末に保存できなかった服がある
}
export interface CloudSession {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  connect(): Promise<void>;                 // つなぐ（2 回呼んでも 1 回）。失敗しても投げない（state.problem）
  refresh(): Promise<void>;                 // いますぐ、服を合わせ、仕事を聞く
  setFast(on: boolean): void;               // つくる・クローゼットを開いている間は true（聞く間隔 3 秒。ほかは 30 秒）
  track(jobId: string): void;               // 「作る」で始めた仕事を、すぐ見はじめる
  ack(jobId: string): Promise<void>;        // 演出・知らせを見た
  markSeen(itemId: string): void;           // NEW の印を消す
  readonly backend: StudioBackend;
}
export function createSession(deps: { backend: StudioBackend; library: Library; onLibraryChanged: () => void | Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>; now?: () => number; visible?: () => boolean }): CloudSession;
export const USED_KEY = 'dressup_cloud_used';   // 1 回でもつないだ端末の印
export const NEW_KEY = 'dressup_new_items';     // NEW の印の服の ID（JSON の並び）
```

**決めたこと**

- 聞き直すのは、終わっていない仕事がある間だけ。画面が見えていない間（`document.visibilityState !== 'visible'`）は聞かず、見えたらすぐ `refresh()`。
- 仕事が終わったら: `syncLibrary` → 取り込めた服を `newItemIds` に足す → `onLibraryChanged()` → その仕事を `arrivals` に入れる。服を取り込めなかった（`failed > 0`）ときも `arrivals` に入れ、`storeFailed = true`（Review Focus 3）。
- `App.tsx`: `STUDIO_MODE` があり、`localStorage[USED_KEY] === '1'` なら、素材の読み込みが終わったあと（`loadState === 'ready'` になった次の間）に `session.connect()`。`USED_KEY` は、初めて `signIn` が通ったときに書く。`STUDIO_MODE` が無ければ、`createSession` も `createBackend` も呼ばない（部品の読み込みは今までどおり `import('./firebaseTransport')` の中）。
- `session.ts` は軽い（Firebase を読まない）ので、`App.tsx` から直接読んでよい。

- [ ] **Step 1: 失敗するテストを書く**（`session.test.ts`。裏側は `createFakeBackend`、控えは `fake-indexeddb`、時計は `vi.useFakeTimers`）:
  - `connect: つながらなくても投げず、problem に理由が入る。あとの refresh でつながれば ready`（Review Focus 1）。
  - `仕事が終わると、服を取り込み、NEW に入り、arrivals に出る`。
  - `ack すると arrivals から消え、作り直した session でも出ない`（Review Focus 2）。
  - `端末に保存できないとき、arrivals には出て、storeFailed が true`（`library.put` が投げる偽物）。
  - `終わっていない仕事が無ければ、聞き直さない`（`openJobs` の呼ばれた数）。
  - `見えていない間は聞かず、見えたらすぐ聞く`。
  - `setFast(true) の間は 3 秒おき、ふだんは 30 秒おき`。
- [ ] **Step 2: 失敗を見る → `session.ts` を実装 → 通るのを見る。**
- [ ] **Step 3: `App.tsx` につなぐ**（上の決まり）。E2E を 1 つ足す（`e2e/appStudio.spec.ts`）: `?studio の無い端末は、firebase の部品を読み込まない`（`page.on('request')` で、`firebase` を含む JS が無いこと。今ある同じ趣旨のテストがあれば、それを直す）。
- [ ] **Step 4: コミット** — `つなぎ役: 起動時に裏で服を合わせ、作りかけの仕事を見る`

---

### Task 8: ホームを全員に。入口を 1 つに

**Files:**
- Modify: `src/home/homeMode.ts`、`src/home/HomeScreen.tsx`、`src/home/home.css`、`src/App.tsx`、`src/App.css`（✨ の分を消す）、`src/tests/home.test.ts`、`e2e/home.spec.ts`、`e2e/dressup.spec.ts`・`e2e/appStudio.spec.ts`・`e2e/appStudioReal.spec.ts`（開く URL）

**Interfaces:**
- Produces:

```ts
// src/home/homeMode.ts — ホームから始めるか。?home=0 のときだけ、その読み込みに限って、すぐゲーム（テストと確認用。覚えない）
export function startsOnHome(search: string): boolean;
// src/home/HomeScreen.tsx
export interface HomeScreenProps { onPlay: () => void; onCreate?: () => void; onCloset?: () => void; closetDot?: boolean }
// onCreate・onCloset が無ければ、そのボタンを出さない
```

**決めたこと**

- `readHomeEnabled`・`unlockHomeByWord`・覚え（`dressup_home`）は消す。あいことば `home`・`nohome` は効かなくなる。
- アカウントのボタンとその画面は消す。
- `App.tsx`: `onCreate`・`onCloset` は `STUDIO_MODE` があるときだけ渡す。ゲームの ✨（`studio-button`）と、ゲームからスタジオを開く道を消す。🏠 は、いつも出す。スタジオのモードは `STUDIO_MODE` だけ（`HOME_STUDIO_MODE` の「教えていなければ偽物」は消す）。`AdultGate` は、`const ASK_ADULT = false;`（`App.tsx` の 1 か所）で `skipGate={!ASK_ADULT}`。
- `closetDot` は Task 10 でつなぐ（ここでは受け口だけ）。
- 今ある E2E の、ゲームを直接開く URL には `&home=0` を足す（`dressup.spec.ts` の `APP_URL` など、定数の 1 か所ずつ）。

- [ ] **Step 1: 失敗するテストを書く。**
  - `home.test.ts`: `startsOnHome: ふつうは true、?home=0 は false、覚えない`。
  - `e2e/home.spec.ts`（書き直す）: `だれでも、開くとホーム。あそぶでゲーム、🏠 でもどる`、`教えていない端末には、つくる・クローゼット・アカウントが無い`、`?studio=fake の端末には、つくる・クローゼットがある`、`ゲームの画面に ✨ が無い`、`?home=0 は、すぐゲーム`、`ともだちにおしえる`（今のまま）。
- [ ] **Step 2: 失敗を見る → 実装 → `npx vitest run`、`npm run build`、E2E 全部を走らせる**（`appStudio.spec.ts` の、✨ と保護者の確認から入るテストは、Task 9 で書き直すので、ここでは `test.fixme` ではなく、入口だけホームの「つくる」に替える）。
- [ ] **Step 3: コミット** — `ホームを全員に。つくる・クローゼットは教えた端末だけ。ゲームの ✨ とアカウントのボタンを外す`

---

### Task 9: つくる（テーマだけ・ドールを選ぶ・注文とチケットの演出）

**Files:**
- Modify: `src/appStudio/AppStudio.tsx`、`src/appStudio/index.tsx`、`src/appStudio/appStudio.css`、`src/App.tsx`
- Create: `src/appStudio/OrderShow.tsx`、`src/appStudio/orderShow.css`
- Delete: `src/tests/appStudioPhoto.test.tsx`
- Test: `src/tests/orderShow.test.tsx`（新）、`e2e/appStudio.spec.ts`、`e2e/appStudioReal.spec.ts`

**Interfaces:**
- Consumes: Task 7 の `CloudSession`、Task 5 の `StudioBackend`。
- Produces:

```ts
// src/appStudio/index.tsx
export interface StudioRootProps { session: CloudSession; dolls: DollData[]; categoriesByDoll: Record<string, ManifestCategory[]>; initialDollId: string;
  onClose: () => void; onOpenCloset: () => void; skipGate?: boolean; demo?: boolean }
// src/appStudio/OrderShow.tsx — 注文の演出と、チケットを切る演出（画面いっぱい）
export type OrderPhase =
  | { kind: 'ordering' }                                           // サーバーの返事を待っている
  | { kind: 'ticket'; cost: number; left: number; admin: boolean } // 引いた、と返ってきた
  | { kind: 'refused'; message: string };                          // 受けられなかった
export function OrderShow(props: { phase: OrderPhase; lines: string[]; art?: ShopArt; onDone: () => void }): JSX.Element;
export interface ShopArt { shop?: string; order?: string; ticket?: string } // 絵の URL（Task 12。無ければ、図形と絵文字）
```

**決めたこと**

- 入力の欄: ドール（`select`、`data-testid="studio-doll"`。`dolls` が 1 体なら出さない）→ ① 何を作る？ → ② テーマ → ③ 絵柄 → 「作る（チケット n 枚）」。写真（📷）と色のテーマは消す。ドールを替えると、カテゴリの選び直し（先頭）とセットの印の付け直し。
- 「作る」: `phase = ordering` で `OrderShow` を出し、`backend.startJob` を待つ。**演出は、返事が早くても 1.5 秒は出す。** 通ったら `ticket`（`left` は返ってきた利用者の残り）、`session.track(jobId)`。「OK」で閉じる。失敗したら `refused`（`message` は裏側の文）。`OrderShow` が出ている間、後ろは押せない（Review Focus 5）。
- `lines`（伝票）: `[カテゴリの名前（セットなら「セット（n てん）」） + ' ・ ' + 絵柄の名前, '「' + テーマ + '」']`。
- 演出の言葉（そのまま使う）:
  - 注文: 見出し `ようふくやさん`、伝票の頭 `ごちゅうもん`、下 `ごちゅうもんを つたえています…`、注意 `この がめんを とじないでね`。
  - チケット: `チョキン！`、`チケット ${cost} まい つかいました（のこり ${left} まい）`、`ごちゅうもん かんりょう！`、`もう とじても だいじょうぶ。`、`できたら クローゼットに とどきます。`、ボタン `OK`。管理者は 1 行目と 2 行目を出さない。
  - 受けられない: `ごちゅうもんを うけられませんでした。`、`チケットは つかっていません。`、理由、ボタン `もどる`。
- 入力の欄の「作る」のボタン: 待っている間は `準備中…`（演出の後ろで見えないが、テストと読み上げのため）。
- 作りかけのカード（`session.getState().jobs`。どのドールの分も。カードにドールの名前）: `順番を待っています…`／`作っています…（1 分くらい）`。全部が `waiting` のまま、作ってから 60 秒たったら `こみあっています。できたら、クローゼットに入ります。`。カードの頭に、いつも `この画面を閉じても、アプリを閉じても、続きます。`。終わった仕事は、ここには出さない（演出が出る。Task 11）。
- 「自分の服」「ほかのドールの服」の欄は消す。代わりに、ボタン `クローゼットを見る`（`onOpenCloset`）。利用者コードは残す。
- `state.problem`（つながらない・`old-server`）は、今の `studio-problem` の場所に出し、「作る」は押せない。
- 開いている間は `session.setFast(true)`。開いたとき `session.connect()`。
- 動きを減らす設定（`prefers-reduced-motion: reduce`）では、動きを止める（CSS の `@media`）。

- [ ] **Step 1: 失敗するテストを書く。**
  - `orderShow.test.tsx`: `ordering: とじないでね、が出て、ボタンが無い`、`ticket: 枚数と残りが出て、OK で onDone`、`ticket（管理者）: チョキンと枚数の行が無い`、`refused: 理由と「チケットは つかっていません」`。
  - `e2e/appStudio.spec.ts`（書き直す。入口はホームの「つくる」）: `作る → 注文の演出 → チケットの演出（のこりが 1 減る）→ OK → 作りかけのカード`、`注文の演出の間は、後ろのボタンを押せない。仕事は 1 つだけ`（Review Focus 5。`planMs: 1500` にして、演出の上から「作る」の場所を 3 回押す）、`チケットが足りないと、作るを押せない`、`ドールを替えると、カテゴリが替わる`、`写真のボタンと色の欄が無い`、`古いサーバー（oldServer）では、知らせが出て、作るを押せない`、`60 秒たっても始まらないと、こみあっています`（偽物の `delayMs` を長くし、`page.clock` で進める）。
  - `e2e/appStudioReal.spec.ts`: 偽の Firebase の返事を、新しい op（`signIn` に `api: 2`、`studioRun` を呼ばない）に直す。
- [ ] **Step 2: 失敗を見る → 実装 → 通るのを見る**（Task 6 の E2E もここで通す）。
- [ ] **Step 3: コミット** — `つくる: テーマだけに。ドールを選ぶ。注文とチケットの演出`

---

### Task 10: クローゼット

**Files:**
- Create: `src/closet/index.tsx`、`src/closet/Closet.tsx`、`src/closet/ClosetItem.tsx`、`src/closet/closet.css`、`src/closet/closetView.ts`、`src/tests/closetView.test.ts`、`e2e/closet.spec.ts`
- Modify: `src/App.tsx`（開く・ホームの ●）、`src/appStudio/AppStudio.tsx`（`Stage`・`BlobImage` を `src/closet/` から使えるよう `src/cloud/Stage.tsx` に移す）

**Interfaces:**
- Consumes: Task 7 の `CloudSession`、Task 5 の `MyItem`・`byClosetOrder`、`HueCanvas`（`src/components/HueCanvas.tsx`）。
- Produces:

```ts
// src/closet/closetView.ts（純粋関数。画面の並びを決める）
export interface ClosetDoll { id: string; name: string; usable: boolean } // usable = いまゲームに出ている
export interface ClosetGroup { categoryId: string; label: string; items: MyItem[] }
export function closetDolls(items: MyItem[], dolls: DollData[], currentDollId: string): ClosetDoll[];
export function closetGroups(items: MyItem[], dollId: string, categories: ManifestCategory[]): ClosetGroup[];
// まえへ・うしろへ: 同じドール・同じカテゴリの中で 1 つ動かしたあとの、その組の ID の並び（動かせなければ null）
export function movedOrder(group: MyItem[], itemId: string, direction: -1 | 1): string[] | null;
// src/closet/index.tsx（押したときに読み込む）
export default function ClosetRoot(props: { session: CloudSession; library: Library; dolls: DollData[]; categoriesByDoll: Record<string, ManifestCategory[]>;
  currentDollId: string; onClose: () => void; onLibraryChanged: () => void | Promise<void> }): JSX.Element;
```

**決めたこと**

- `closetDolls`: 自分の服のあるドール。並びは、いまのドール → ほかのゲームに出ているドール（素材の順）→ ゲームに出ていないドール（名前は `いまは つかえない ドール`。いくつあっても 1 つずつ、ID の順）。服が 1 点も無ければ、空（画面は `まだ ふくが ありません。「つくる」で つくれるよ`）。
- `closetGroups`: カテゴリは `menuOrder` の順。素材に無いカテゴリの服は、最後に `そのほか`。組の中は `byClosetOrder`。
- 一覧: 絵は 96px 以上（`grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))`）、下に名前。色のある服は `HueCanvas` で既定の色。`NEW` の印（`session.getState().newItemIds`）。
- 作りかけ（`jobs` のうち終わっていないもの）: 上に `つくっています…` と、品目ごとの小さな札（カテゴリの名前）。
- 服の画面（`ClosetItem`。押すと開く。開いたとき `session.markSeen(id)`）:
  - ドールが着た絵（`Stage`。色は `HueCanvas` で、その場で変わる）。ドールが使えないときは、服の絵だけ。
  - `なまえ`（20 文字。欄を離れたとき・Enter で保存）。
  - `いろ`（`input type="range"` -180〜180。高さ 44px 以上の、にじ色の帯。指を離したときに保存。`もとのいろ` で 0）。
  - `ならび`（`◀ まえへ`・`うしろへ ▶`。端では押せない）。
  - セットの服には `セット「名前」`。注意（`notes`）があれば、小さく出す。
  - `けす`: 絵と名前を出し、`けしますか？（もとに もどせません）`、`けす`・`やめる`。
  - `できた` で閉じる。
- 直す・消すは、サーバーを先に（`backend.updateMyItem`・`orderMyItems`・`deleteMyItem`）。通ったら `library.put`／`remove` と `onLibraryChanged()`。通らなければ、何も変えずに、裏側の文を出す。**`refused`（服がもう無い）のときは、文を出して服の画面を閉じ、`session.refresh()`**（Review Focus 2）。
- つながっていない（`state.status !== 'ready'`）ときは、一覧は出し、服の画面の直す・消すを押せなくして `インターネットに つながっていないので、いまは なおせません` と出す。
- `App.tsx`: ホームの `closetDot` は `newItemIds.length > 0 || jobs.some((j) => !j.done)`。開いている間は `session.setFast(true)`。開いたとき `session.connect()`。

- [ ] **Step 1: 失敗するテストを書く**（`closetView.test.ts`）: `closetDolls: いまのドールが先頭。ゲームに出ていないドールは usable: false`（Review Focus 4）、`closetDolls: 服が無ければ空`、`closetGroups: menuOrder の順、組の中は order の大きい順、素材に無いカテゴリは「そのほか」`、`movedOrder: 先頭を前へは null、2 番目を前へで入れ替わる`。
- [ ] **Step 2: 失敗を見る → `closetView.ts` を実装 → 通るのを見る。**
- [ ] **Step 3: E2E を書く**（`e2e/closet.spec.ts`。`?studio=fake`、偽物の `delayMs: 300`）:
  - `作る → OK → 読み込み直す（閉じたつもり）→ クローゼットに入っている`（演出は Task 11 なので、ここでは一覧の数で確かめる）。
  - `NEW の印は、押すと消える。読み込み直しても消えたまま`。
  - `名前を変えると、メニューの服の名前（title）も変わる`。
  - `色を変えると、一覧の絵とメニューの絵の色が変わり、着せた服の色も変わる`（`pixel()`。偽物の四角の色）。
  - `うしろへ、で順番が入れ替わり、メニューの順番も同じ`。
  - `けす、で一覧とメニューから消える。やめる、では消えない`。
  - `ほかのタブで消された服を直そうとすると、知らせが出て、一覧から消える`（Review Focus 2。`localStorage` の偽物の服を、ページの外から消す）。
  - `ゲームに出ていないドールの服は「いまは つかえない ドール」に出て、消せる`（Review Focus 4。偽物の服の `dollId` を、無い ID に書き換える）。
  - `つながっていないと、一覧は見えるが、直せない`（偽物の `offline`）。
- [ ] **Step 4: 画面を実装 → E2E を通す → `npx vitest run`、`npx tsc -b`、`npx eslint .`。**
- [ ] **Step 5: 画面の写真を撮って見る**（Playwright、1180×820 と 390×844。`deviceScaleFactor: 1`）。重なり・はみ出しを直す。
- [ ] **Step 6: コミット** — `クローゼット: 自分の服の一覧と、名前・既定の色・並び・消す`

---

### Task 11: クローゼットが開く演出

**Files:**
- Create: `src/reveal/Reveal.tsx`、`src/reveal/reveal.css`、`src/reveal/revealView.ts`、`src/tests/revealView.test.ts`、`e2e/reveal.spec.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 7 の `SessionState.arrivals`・`ack`・`storeFailed`、Task 10 で移した `Stage`。
- Produces:

```ts
// src/reveal/revealView.ts（純粋関数）
export interface RevealView {
  kind: 'arrived' | 'failed-only';   // failed-only = 1 点もできなかった（とびらは出さない）
  items: MyItem[];                   // 届いた服（セットは全部）
  failed: string[];                  // できなかった品目のカテゴリの名前
  doll: DollData | null;             // 着せて見せるドール。素材に無ければ null（服の絵だけを出す）
  title: string;                     // 1 点なら服の名前、セットなら「セットの名前」
}
export function revealView(job: StudioJob, library: MyItem[], dolls: DollData[], categoriesByDoll: Record<string, ManifestCategory[]>): RevealView;
// src/reveal/Reveal.tsx（arrivals があるときに読み込む）
export default function Reveal(props: { view: RevealView; storeFailed: boolean; art?: { deliver?: string }; canTryOn: boolean;
  onTryOn: () => void; onOpenCloset: () => void; onClose: () => void }): JSX.Element;
```

**決めたこと**

- `App.tsx`: `arrivals[0]` があれば、どの画面の上にも `Reveal` を出す（ホーム・ゲーム・つくる・クローゼット）。**画面に指が触れている間（`pointerdown` から `pointerup`／`pointercancel` まで。`window` で数える）は出さず、離れた直後に出す。** 閉じる・「クローゼットをみる」・「きせてみる」のどれでも `session.ack(job.id)`。次の `arrivals` があれば、続けて出す。
- 言葉: `あたらしい ふくが とどいたよ！`、服の名前、できなかった品目ごとに `${カテゴリ}は つくれませんでした。チケットは もどしました`、`storeFailed` のとき `この たんまつに ほぞんできませんでした（あきが たりないかもしれません）`。ボタン `きせてみる`・`クローゼットをみる`・`とじる`。`failed-only`: `つくれませんでした。チケットは もどしました`（品目ごと）と `とじる` だけ。
- とびら: 左右 2 枚が開き（0.9 秒）、光の中から、ドールが着た絵（セットは全部を重ねる）。音は `src/services/sound.ts` に `playArriveSound()` を足す（今の音と同じ作り方）。動きを減らす設定では、開いた状態から出す。
- `きせてみる`（`canTryOn` = ドールがあり、`items.length > 0`）: そのドールに切り替え（`handleDollChange`）、届いた服を全部着せ（セットは `handleSetDrop` と同じ決まり、1 点は `handleItemDrop`）、ホーム・つくる・クローゼットを閉じて、ゲームの画面にする。**素材の読み込みが終わっていなければ（`loadState !== 'ready'`）、終わるのを待ってから着せる**（Review Focus 5）。ドールを替えるので、着ていた服は脱げる（ドールが同じなら、1 点は重ねて着せるだけ・セットは今の決まりどおり全部脱がせる）。

- [ ] **Step 1: 失敗するテストを書く**（`revealView.test.ts`）: `1 点: arrived、title は服の名前`、`セット: 全部の服、title はセットの名前`、`一部できなかった: failed にカテゴリの名前`、`全部できなかった: failed-only`、`ドールが素材に無い: doll は null`（Review Focus 4）、`服が控えに無い（保存できなかった）: items は空でも arrived`（Review Focus 3）。
- [ ] **Step 2: 失敗を見る → `revealView.ts` を実装 → 通るのを見る。**
- [ ] **Step 3: E2E を書く**（`e2e/reveal.spec.ts`）:
  - `ホームで待っていると、できたときに演出が出る。とじると、もう出ない（読み込み直しても）`。
  - `閉じている間にできた分は、次に開いたときに出る`（作る → `page.goto('about:blank')` → 待つ → 開く）。
  - `ゲームで遊んでいる最中でも出る。服をドラッグしている間は出ず、離すと出る。とじると、着ていた服はそのまま`。
  - `きせてみる: ゲームの画面になり、届いた服を着ている`（`pixel()`）。
  - `セット: 1 回だけ出て、全部を着た絵。きせてみるで全部着る`。
  - `できなかった品目は、同じ画面に知らせが出る`、`全部できなかったら、とびらは出ず、知らせだけ。1 回だけ`。
  - `2 つ続けて終わると、1 つずつ順に出る`。
- [ ] **Step 4: 実装 → E2E を通す → 全部のテスト。**
- [ ] **Step 5: 画面の写真（1180×820 と 390×844）を見て直す。**
- [ ] **Step 6: コミット** — `演出: できあがったら、クローゼットが開く。きせてみる`

---

### Task 12: 店員（おねえさん）とお店の絵

**Files:**
- Create: `tools/art/shopArt.ts`、`src/assets/shop/shop.webp`・`order.webp`・`ticket.webp`・`deliver.webp`、`docs/superpowers/specs/2026-11-23-shop-art/`（候補の絵と、指示文）
- Modify: `src/appStudio/OrderShow.tsx`、`src/reveal/Reveal.tsx`（絵を渡す）、CSS

**Interfaces:**
- Consumes: Task 9 の `ShopArt`、Task 11 の `art.deliver`。`tools/studio/ai.ts` の `createGemini`（画像の AI の呼び方は、このファイルを読んで合わせる）、`src/pipeline/` の背景の透過（緑の背景を抜く。ドールづくり `tools/studio/makeDoll.ts` と同じやり方）。
- Produces: 4 枚の絵（長い辺 768px、WebP、1 枚 150KB 以下が目安）。`shop` = お店の中（背景。人なし）、`order` = 伝票に書いている店員、`ticket` = はさみとチケットを持つ店員、`deliver` = 服の箱（または、たたんだ服）を差し出す店員。店員の 3 枚は、背景が透明。

**決めたこと**

- 店員: ドール「おんなのこ」と同じアニメの絵柄。洋服屋のおねえさん（エプロン、メジャーを首にかける）。上半身〜ひざ上。正面。**キャラクター名・作品名・ブランド名を書かない**（今の指示文の決まりと同じ）。
- 作る順: (1) `order` の候補を 2 枚 →（作者に見せて 1 枚えらぶ）→ (2) えらんだ絵を見本に渡して `ticket`・`deliver` を 1 枚ずつ（同じ人に見えるように）→ (3) `shop` を 1 枚。うまくいかなければ作り直すが、**合わせて 10 枚まで**。枚数を数える。
- 呼び方: `NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy npx tsx tools/art/shopArt.ts <order|ticket|deliver|shop> <出力フォルダ> [見本の絵]`（`HANDOFF.md` 7 章の、画像生成の呼び方と同じ）。
- 絵は、演出の画面の読み込み（`OrderShow`・`Reveal` と同じまとまり）に入れる（`import url from '../assets/shop/order.webp'`）。ゲームの最初の読み込みには入れない。
- 絵が無くても、演出は動く（Task 9・11 の、図形と絵文字の見た目が出る）。

- [ ] **Step 1: `tools/art/shopArt.ts` を書く**（指示文 4 つ、見本の絵を渡す、緑の背景で作って透過、768px の WebP に書き出す）。指示文は `docs/superpowers/specs/2026-11-23-shop-art/prompts.md` にも残す。
- [ ] **Step 2: `order` の候補を 2 枚作り、作者に送って、カードの質問でえらんでもらう**（`SendUserFile`、`AskUserQuestion`。「どちらも違う」のときは、直す所を聞いて作り直す）。
- [ ] **Step 3: `ticket`・`deliver`・`shop` を作る。4 枚を並べた絵を作者に送り、使ってよいかを聞く。**
- [ ] **Step 4: 絵を `src/assets/shop/` に入れ、演出に重ねる。画面の写真（1180×820、390×844）を撮って、伝票・チケット・とびらと、絵の重なりを直す。**
- [ ] **Step 5: 確かめる** — `npm run build` のあと、`dist/assets` の最初に読むまとまり（`index-*.js`・`index-*.css`）に `shop` の絵が入っていないこと、E2E 全部。
- [ ] **Step 6: コミット** — `演出の絵: 洋服屋の店員とお店（画像生成 n 枚）`

---

### Task 13: 文書・版数・全体の確かめ

**Files:**
- Modify: `src/version.ts`、`README.md`、`docs/firebase-setup.md`、`docs/superpowers/HANDOFF.md`、`docs/superpowers/specs/2026-11-23-closet-and-unstoppable-generation-design.md`（末尾に「結果」）、`.github/copilot-instructions.md`（古い説明があれば）

- [ ] **Step 1: 版数を 0.35.0 に。`README.md` の更新履歴と「遊び方」（ホーム・クローゼット）を書く。**
- [ ] **Step 2: `docs/firebase-setup.md`** に「v0.35.0 の載せ直し」を足す: `git pull` → `npm ci` → `npm run firebase:deploy`。聞かれること（API を有効にする → はい。`studioRun` を消す → はい）。載せたあとの確かめ（1 点作って、1〜2 分でクローゼットに入るか。入らなければ `npm run firebase:logs`）。同時に進める数の変え方（`functions/src/index.ts` の `WORKERS`）。
- [ ] **Step 3: `HANDOFF.md` を、いまの状態に書き直す**（v0.28.0 で止まっている。1 章の表、進行中の計画 = この段階と ②〜⑥、コードの地図に `session.ts`・`closet/`・`reveal/`、エミュレーターで列がどう動いたか、作者に確かめてもらうこと）。
- [ ] **Step 4: 全部を走らせる** — `npx vitest run`、`npx tsc -b`、`npx eslint .`、`npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`、`npm run firebase:test`。件数を控える。
- [ ] **Step 5: 別の目の全体レビューを 1 回**（`superpowers:requesting-code-review`。見てもらう所: チケットの増減が「服か払い戻し」で必ず終わるか、Review Focus の 5 つ、教えていない端末が Firebase を読まないか）。指摘を直す。
- [ ] **Step 6: 設計書の末尾に「結果」を書く**（作ったもの、設計から変えた点、確かめたこと、確かめられていないこと = 本物の Firebase・本物の Gemini・実機の手ざわり、画像生成の枚数）。
- [ ] **Step 7: コミットして push。作者に報告する**（日本語。数値と、確かめられていないこと、作者にお願いすること = 載せ直しと実機の確認）。`main` へのマージは、作者に確かめてから。
