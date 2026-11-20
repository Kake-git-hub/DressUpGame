# 段階 E: アプリ内スタジオ（v0.26.0〜） Implementation Plan

> 進め方: このプロジェクトの決まり（HANDOFF 5 章）どおり、セッション内で順に実装し、小段階ごとに別の目の全体レビューを 1 回かける。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリの中から、保護者（大人）が「何を作るか・テーマ・絵柄」を選ぶだけで服が 1 点（またはセット）でき、その利用者のメニューにだけ出る。チケットの残りはサーバーだけが増減する。作者は、チケットを配り、特定の利用者に服を届けられる（PC のスタジオからも）。

**Architecture:** アプリは、スタジオの裏側を 1 つの形（`StudioBackend`）としてだけ知る。本物は Firebase（Auth の匿名ログイン、Callable Functions、Firestore、Storage）、テストと開発は端末の中だけで動く偽物。サーバーの関数は、いまの `tools/studio/` の「作る中身」（`planItems`・`planSet`・`generateCandidate`、品目ごとの処理）をそのまま使い、まわり（進み具合・上限・保存先）だけを Firestore と Storage に置き換える。自分の服は、端末の中（IndexedDB）に控えを持ち、ゲームは Firebase の部品を読まずに控えから出す。Firebase の部品は、「つくる」を開いたときにだけ読み込む。

**Tech Stack:** React 19、TypeScript、Vite（動的 import）、IndexedDB、`firebase`（ウェブ SDK）、`firebase-functions`（2 世代）、`firebase-admin`、`firebase-tools`（エミュレーター。この作業環境に Java 21 があり、取得先にも届くことを 2026-11-20 に確かめた）、esbuild（関数を 1 つにまとめる）、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-20-app-studio-portrait-sets-design.md` の 8 章。作者向けの手順書: `docs/firebase-setup.md`。

## Global Constraints

- テストを先に書き、失敗を見てから実装する。タスクごとにコミットする（作業ブランチ）。
- **スタジオを使わない人の、最初の読み込み・遊び方・オフラインでの動作は変えない。** ゲームの最初の読み込みに、Firebase の部品を入れない（ビルド後のファイルで確かめる）。一度もスタジオを使っていない端末では、Firebase に 1 回も通信しない。
- Gemini のキー・管理者の利用者コード・PC のスタジオ用のあいことばは、サーバーの秘密の値にだけ置く。端末から書けるのは関数だけ。Firestore と Storage は、端末からは「自分の分を読む」だけ（決まりのテストで確かめる）。
- **「つくる」の入口は保護者（大人）用**（設計書 8.3・8.6）。販売を始めるまでは、ボタンは、作者が教えた URL（`?studio=1`）を 1 回開いた端末にだけ出す。
- チケット: 1 点 = 1 枚。絵が 1 枚もできなかった品目の分は戻す。新しい利用者は 0 枚。管理者は制限なし（記録は残す）。サーバー全体にも 1 日の画像の上限を付ける。
- 利用者の書くテーマは 60 文字まで。キャラクター名などを書かせない決まり（`NO_NAMES`）は、いまのまま使う。
- 自分の服の ID は `my:` で始める（公開の服と重ならない）。端末の控えのデータベース名は `dressup-library`（旧方式の片付け `legacyCleanup.ts` が消す名前と別にする）。
- アプリでの手直し（位置の微調整・消しゴム）、背景・ドールの生成、販売、Google / Apple のログインは作らない。
- 本物の生成は、作者の Firebase ができてから、枚数を報告しながら少数だけ。開ける前に 10 点ほど作って「そのまま使える割合」を報告する。
- 画面の文言: 遊ぶ画面は今までどおり（ひらがな）。スタジオの中は大人向け（漢字かな交じり）。コードのコメントは日本語。

## 小段階

| 小段階 | 版 | 内容 | Firebase の設定値 |
|---|---|---|---|
| E1 | v0.26.0 | アプリの画面と、端末の中の「自分の服」。裏側は偽物（開発用）。`?studio=1` で開けた端末にだけ出る | 不要 |
| E2 | （公開しない） | サーバーの関数と決まり。エミュレーターで確かめる | 不要 |
| E3 | v0.27.0 | アプリを本物の裏側につなぐ。作者が載せて、本物で 10 点作る | **要る** |
| E4 | v0.28.0 | 作者の画面（チケットを配る・服を届ける）と、PC のスタジオからの「利用者に届ける」 | 要る |

E1 と E2 は、作者の用意を待たずに進められる。

## Review Focus（段階 E 全体）

1. **チケットが減ったまま**: 生成の途中でサーバーが止まる・アプリを閉じる・通信が切れる → 次に開いたとき、続きが見られるか、チケットが戻っている → E2 のテスト。
2. **同時に 2 回押す・2 つの端末**: チケットが 1 枚しか無いのに 2 点作れない（取り引きで引く）→ E2 のテスト。
3. **ほかの利用者の服・チケットが読める・書ける**: 決まりで断る → E2 の決まりのテスト。
4. **オフライン・Firebase に届かない**: ゲームは今までどおり遊べ、自分の服も控えから出る。スタジオは「つながっていません」と出る → E1・E3 のテスト。
5. **公開の素材からドールやカテゴリが消えた**: 自分の服はメニューに出ないだけで、落ちない・消さない → E1 のテスト。

---

## E1: アプリの画面と、端末の中の「自分の服」

### Task E1-1: 裏側の形と、偽物

**Files:** `src/cloud/backend.ts`（型）、`src/cloud/fakeBackend.ts`、`src/tests/fakeBackend.test.ts`

**Interfaces（Produces）:**

```ts
export interface StudioUser { userCode: string; tickets: number; admin: boolean }
export type StudioTarget = { kind: 'category'; categoryId: string } | { kind: 'set'; categoryIds: string[] };
export interface StudioCandidate {
  index: number; name: string; categoryId: string;
  status: 'waiting' | 'working' | 'done' | 'failed';
  notes: string[];             // 検品で気づいたこと・失敗の理由（日本語）
  previewUrl?: string;         // できた服の絵（ドールのキャンバスと同じ位置。透明の背景）
}
export interface StudioJob { id: string; dollId: string; set?: { id: string; name: string }; done: boolean; candidates: StudioCandidate[]; tickets: number /* 使った枚数（戻した分を引いたあと） */ }
// 自分の服 1 点。item は、公開の一覧（manifest）の服と同じ形で、file は `my:` の ID から引ける絵の名前
export interface MyItem { id: string; dollId: string; categoryId: string; set?: { id: string; name: string }; item: ManifestItem; files: Record<string, Blob>; createdAt: number }
export interface StudioBackend {
  signIn(): Promise<StudioUser>;
  onUser(listener: (user: StudioUser) => void): () => void;                       // チケットの残りが変わったら知らせる
  startJob(input: { dollId: string; theme: string; styleId: string; target: StudioTarget }): Promise<{ jobId: string; cost: number }>;
  watchJob(jobId: string, listener: (job: StudioJob) => void): () => void;
  pendingJobs(): Promise<StudioJob[]>;                                             // 閉じる前に作っていた分
  keep(jobId: string, index: number, name: string): Promise<MyItem>;              // 「使う」
  discard(jobId: string, index: number): Promise<void>;                           // 「捨てる」
  listMyItems(): Promise<MyItem[]>;
  deleteMyItem(id: string): Promise<void>;
}
export class BackendError extends Error { code: 'offline' | 'no-tickets' | 'limit' | 'refused' | 'unknown' }
```

- 偽物（`createFakeBackend(options)`）: メモリの中だけで動く。チケットの数・生成にかかる時間・失敗する品目を指定できる。絵は、色の付いた四角（品目ごとに違う色）。E2E と、`?studio=fake` で開いたときに使う。

### Task E1-2: 端末の中の「自分の服」

**Files:** `src/cloud/library.ts`（IndexedDB）、`src/content/loadContent.ts`（公開の一覧に重ねる）、`src/tests/library.test.ts`、`src/tests/loadContent.test.ts`

- `openLibrary(): { all(): Promise<MyItem[]>; put(item): Promise<void>; remove(id): Promise<void>; replaceAll(items): Promise<void> }`（データベース `dressup-library`、1 つの置き場 `items`）。IndexedDB が使えない端末では、空として動く（落ちない）。
- `mergeMyItems(content: LoadedContent, items: MyItem[]): { content: LoadedContent; revoke: () => void }`: 自分の服を、そのドール・カテゴリの服として足す（絵は `URL.createObjectURL`）。ドールやカテゴリが公開の一覧に無い服は、足さない（消しもしない）。`ClothingItemData.mine = true` を付ける（メニューで小さな印を出す）。
- `App.tsx`: 素材を読んだあと、控えを読んで重ねる。控えが変わったら（スタジオで「使う」「消す」）、重ね直す。

### Task E1-3: 入口（保護者の確認）と、スタジオの画面

**Files:** `src/appStudio/AdultGate.tsx`、`src/appStudio/AppStudio.tsx`、`src/appStudio/appStudio.css`、`src/appStudio/unlock.ts`、`src/App.tsx`、`e2e/appStudio.spec.ts`

- `unlock.ts`: `?studio=1`（本物）・`?studio=fake`（偽物）で開いたら、端末に覚える（`localStorage` の `dressup_studio`）。`?studio=0` で消す。覚えている端末にだけ、「✨つくる」ボタン（`data-testid="studio-button"`。横は右のボタンの並び、縦はボタンの行の 4 つ目）が出る。
- `AdultGate`: 「おとなの方へ」の説明、2 けた × 1 けたの掛け算を漢数字で出す問い（例: 「十二 かける 七 は？」。数字で答える）、「18 歳以上です」のチェック。両方そろうと開く。アプリを閉じるまで覚える（`sessionStorage`）。まちがえたら、問いを替える。
- `AppStudio`（動的 import。ゲームの最初の読み込みに入れない）: 設計書 8.3 の画面。残りのチケット、利用者コード、① 何を作るか（そのドールのカテゴリ + セット）② テーマ（60 文字まで）③ 絵柄（`STYLE_PRESETS`）、「作る（チケット n 枚）」、作っている間の表示、できた服をドールに着せた絵と「使う」「捨てる」、「自分の服」の一覧と「消す」。セットを選んだら、入れるカテゴリのチェック欄（2〜6 個）。チケットが足りないときは、押せない理由を出す。
- E2E（偽物の裏側）: ボタンが出る条件 / 入口（まちがい・チェック無しでは開かない）/ 1 点作って「使う」→ メニューのそのカテゴリに出る → ドラッグで着せられる → 読み込み直しても出る（オフラインでも）/「捨てる」/ セット / チケットが足りない / 作っている間に閉じて開き直す / 公開の一覧から消えたカテゴリの服は出ない / ビルド後の最初の読み込みに `firebase` が入っていない（`dist/assets` の入口のファイルを調べる）。

### Task E1-4: 版数・説明書・確認・レビュー・公開（v0.26.0）

## E2: サーバーの関数と決まり

### Task E2-1: 置き場の形と、チケットの台帳（純粋な部分）

**Files:** `functions/src/store.ts`（形）、`functions/src/memoryStore.ts`（テスト用）、`functions/src/tickets.ts`、`functions/src/tickets.test.ts`

- Firestore の形: `users/{uid}`（`userCode`・`tickets`・`createdAt`）、`userCodes/{code}`（`uid`）、`users/{uid}/jobs/{jobId}`（進み具合と候補）、`users/{uid}/items/{itemId}`（`MyItem` の絵以外）、`users/{uid}/ledger/{id}`（チケットの増減: 理由・枚数・時刻）、`system/usage-{日付}`（その日の画像の枚数）。Storage: `users/{uid}/jobs/{jobId}/{index}-{kind}.png`、`users/{uid}/items/{itemId}/{file}`。
- `tickets.ts`: `charge(store, uid, cost, reason)`（足りなければ `no-tickets`。取り引き）、`refund(store, uid, n, reason)`、`grant(store, uid, n)`。管理者は引かない（台帳には残す）。

### Task E2-2: 生成の関数

**Files:** `functions/src/index.ts`、`functions/src/jobs.ts`、`functions/src/content.ts`（公開の素材から、ドールの絵と型紙を読む）、`functions/package.json`、`functions/build.mjs`（esbuild）、`firebase.json`、`.firebaserc`（作者の `projectId` が届いてから）

- `signIn`（callable）: 利用者の文書が無ければ作る（利用者コードは 8 文字。まぎらわしい文字を除く）。返すのは `StudioUser`。
- `startJob`（callable）: 入力を確かめる → 企画（`planItems` / `planSet`。文章は `createGeminiText`）→ チケットを引く → 進み具合の文書を作る → `jobId` を返す。
- `runJob`（callable。時間は 540 秒、メモリは 1GiB、同時実行は 1）: 候補を 1 点ずつ `generateCandidate` で作り、絵を Storage に置き、文書を書き換える。失敗した品目の分は戻す。途中で止まっていた仕事（最後の書き換えから 10 分たっている）は、呼び直すと残りを続ける。
- `keep` / `discard` / `deleteMyItem`（callable）: `keep` は、絵を WebP にして（`tools/content/encode.ts`）、`items` に書く。
- 画像の 1 日の上限は、`system/usage-{日付}` を取り引きで数える（いまの `Budget` と同じ形の `spend()` を渡す）。

### Task E2-3: 決まりと、エミュレーターでのテスト

**Files:** `firestore.rules`、`storage.rules`、`functions/test/rules.test.ts`、`functions/test/flow.test.ts`

- 決まり: `users/{uid}` とその下・`users/{uid}/…` の絵は、本人だけが読める。書き込みは、だれもできない（関数だけ）。ほかは全部断る。
- エミュレーター（auth・firestore・storage・functions）で、Review Focus の 1〜3 を確かめる（偽の AI を差し込む）。

## E3: 本物につなぐ（作者の設定値が届いてから）

E1 のレビューで分かった、本物につなぐときに直すこと:

- **端末の控えの合わせ方**: いまは「丸ごと入れ替え」（`library.replaceAll`）。本物では、一覧が空で返った・途中で失敗した・匿名の利用者が替わった、で控えが全部消える。ID ごとに足す・消すにし、「使う」「消す」と順番に行う。サーバーの一覧が空で、端末に控えがあるときは、消さずに知らせる。
- **絵の持ち方**: いまは、どのドールの服も、起動のたびに全部 data: の URL に直す。本物の絵（1 点 100KB ほど）が増えると、起動が遅くなり、メモリも使う。いま遊んでいるドールの分だけ直す・直したものを覚えておく、に変える（Blob の URL は、描画の部品が絵と見分けられないので、そのままでは使えない）。
- **保護者の確認**と、**ホーム画面のアプリでの出し方**（版数を 5 回押して、あいことば）は、実機で確かめる。
- 公開の素材から消えたドールの服を、スタジオの「自分の服」で見て消せるようにする。

- `src/cloud/firebaseBackend.ts`（`StudioBackend` の本物。動的 import）、`src/cloud/firebaseConfig.ts`（作者の値）。自分の服の同期（足りない絵を取る・消した服を消す）。
- `npm run firebase:deploy`（関数をまとめて、関数・決まりを載せる）。作者に載せてもらい、本物で 10 点作って、割合と費用を報告する。

## E4: 作者の画面と、PC のスタジオからの「届ける」

- 関数 `grantTickets({ userCode, count })`・`deliverItem({ userCode, itemId })`（管理者だけ）、`deliverFromStudio`（`STUDIO_ADMIN_KEY` で確かめる HTTP の関数。PC のスタジオが、切り抜き済みの絵を送る）、`revokeItem`。
- アプリのスタジオに、管理者にだけ出る欄。PC のスタジオの候補のカードと「一覧」に「利用者に届ける」。
