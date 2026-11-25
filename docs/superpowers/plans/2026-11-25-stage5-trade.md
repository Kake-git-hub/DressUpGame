# 段階 ⑤ 交換（v0.41.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2 台の端末をそろえたときだけ、自分の服 1 点と相手の服 1 点を、QR コードで入れ替える。

**Architecture:** サーバー（`tools/cloud/`）に交換の文書 `trades/{id}` と 7 つの呼び出しを足し、入れ替えは置き場の 1 つの取り引きで行う。アプリは `StudioBackend` に交換の口を足し（本物 = `remoteBackend.ts`、偽物 = `fakeBackend.ts` の「にせの あいて」）、クローゼットから開く遅延読み込みの画面 `src/trade/` を作る。QR は `qrcode-generator`（既存）で描き、`jsqr` で読む。

**Tech Stack:** TypeScript, React, Vitest, Playwright, Firebase Functions / Firestore（`functions/src/firestoreStore.ts`）, `jsqr@1.4.0`（新規）

**Spec:** `docs/superpowers/specs/2026-11-25-stage5-trade-design.md`（必ず先に読む。とくに 3・5・6 章）

## Global Constraints

- 画面の文は、ひらがな中心（クローゼットと同じ）。カメラが使えないときの設定の案内だけ、おとな向けの短い文。
- 交換できるのは自分の服（`my:`）だけ。1 対 1。取り消しは無い。カメラ以外の道（合い言葉を打つ・リンク）は作らない。
- 読み取りの印の命は **90 秒**。アプリは QR を出している間 **60 秒おき**に印を新しくする。
- 時間切れ: `open` のまま **10 分**、`claimed` から **5 分**、`joined` から **3 分**。
- 上限: 1 人 1 日 **30 回**（`tradeOpen` + `tradeClaim`）。
- 入れ替えは 1 つの取り引きで。片方だけ動く・同じ服が 2 人にある・どちらにも無い、は起こさない。
- 動かした服: 名前・`hue`・`paths`・`notes` はそのまま、`set` は外す、`order` = 入れ替えた時刻、`updatedAt` = 入れ替えた時刻、ID はそのまま。受け取る側に同じ ID があれば `cancelled`（`reason: 'conflict'`）。
- 出せる服 = `movable()`（`tools/cloud/studioCore.ts:728`）が true の服。
- 新しいアプリ ↔ 古いサーバー: `TRADE_API = 4` 未満なら交換の画面に「こうかんは まだ つかえません（サーバーが ふるい はんです）」。カメラを開かない。
- カメラと `jsqr` は、交換の画面を開いたときだけ読み込む（ゲームの起動に入れない）。
- きろく（`diag.note('trade', …)`）に、服の名前・利用者コード・読み取りの印を入れない。
- 版数 v0.41.0。サーバーを変えるので、作者の載せ直しが要る（`docs/firebase-setup.md` に書く）。

## Review Focus

1. **2 人がほぼ同時に「こうかんする」を押す** → 入れ替えは 1 回だけ（両方の呼び出しが `done` を見る）。Task 2 のテスト `accept twice concurrently swaps once`。
2. **入れ替えの直前に、片方の服が消えていた・別の端末で消された** → 何も動かない、`cancelled`（`reason: 'gone'`）。Task 2 `swap aborts when an item vanished`。
3. **交換の途中で A がもう一度「こうかん」を開く（新しい `tradeOpen`）** → 前の交換は `cancelled`、相手の画面にも「やめに なったよ」。Task 2 `new open cancels previous`、Task 5 E2E `partner sees cancel`。
4. **QR を出したまま画面を閉じる・アプリを切り替える** → 閉じたら `tradeCancel` を送る（送れなくても 10 分で切れる）。戻ってきたら、すぐ様子を聞き直す。Task 4 の `TradeShow` のテスト。
5. **交換のあと、つながりが切れてクローゼットに反映されない** → 次の合わせ（`session.refresh`）で直る。渡した服は、端末の控えから「いまの利用者の服」として消える。Task 4 で `refresh` を呼ぶこと、Task 5 E2E で両方のクローゼットを見る。

---

### Task 1: 置き場に交換の文書と、入れ替えの取り引き

**Files:**
- Modify: `tools/cloud/store.ts`（型と `CloudStore` の口）
- Modify: `tools/cloud/memoryStore.ts`
- Modify: `functions/src/firestoreStore.ts`（`trades/{id}`。冒頭の文書の一覧のコメントにも足す）
- Test: `tools/cloud/memoryStore.test.ts`、エミュレーターのテスト（`functions/test/` の既存の置き場のテストに足す）

**Interfaces:**
- Produces（`store.ts`）:
  ```ts
  export type TradeStatus = 'open' | 'claimed' | 'joined' | 'done' | 'cancelled';
  export type TradeEndReason = 'cancel' | 'expired' | 'gone' | 'conflict' | 'replaced';
  export interface TradeSide { uid: string; itemId?: string; accepted?: boolean }
  export interface TradeDoc {
    id: string; status: TradeStatus;
    a: TradeSide; b?: TradeSide;
    code: string; codeAt: number;      // 読み取りの印と、出した時刻
    createdAt: number; claimedAt?: number; joinedAt?: number; endedAt?: number;
    reason?: TradeEndReason;
  }
  // CloudStore に足す
  putTrade(trade: TradeDoc): Promise<void>;
  getTrade(id: string): Promise<TradeDoc | null>;
  findTradeByCode(code: string): Promise<TradeDoc | null>;
  updateTrade(id: string, change: (t: TradeDoc) => TradeDoc | null): Promise<TradeDoc>; // 取り引きの中で読み直す。null = 変えない
  // a.itemId を b.uid へ、b.itemId を a.uid へ。1 つの取り引きで両方の服と交換を読み直し、
  // まだ status=joined・両方 accepted・両方の服がそれぞれの持ち主にある・受け取る側に同じ ID が無い、ときだけ動かして done。
  // 合わなければ何も動かさず cancelled（reason gone/conflict）。もう done なら、何もせずそのまま返す
  swapTrade(id: string, now: number): Promise<TradeDoc>;
  // 利用者のいまの交換（ひとつだけ）の ID。UserDoc に trade?: string を足す
  setUserTrade(uid: string, tradeId: string | null): Promise<void>;
  ```
- `swapTrade` で動いた服: `set` を消し、`order`・`updatedAt` を `now` にする（Global Constraints）。

- [ ] **Step 1: memoryStore のテストを書く** — `swapTrade moves both items and drops set`（`set` が消え、`hue`・`item.name`・`paths` が残り、`order === now`）、`swapTrade aborts when an item vanished`（片方を消してから → 両方とも元のまま、`reason: 'gone'`）、`swapTrade conflict`（B に同じ ID の服 → `reason: 'conflict'`、何も動かない）、`swapTrade twice is a no-op`、`findTradeByCode`。
- [ ] **Step 2: `npx vitest run tools/cloud/memoryStore.test.ts` で落ちるのを見る**
- [ ] **Step 3: `store.ts` の型、`memoryStore.ts` を実装する**
- [ ] **Step 4: テストが通るのを見る**
- [ ] **Step 5: `firestoreStore.ts` を実装する** — `trades` コレクション。`findTradeByCode` は `where('code','==',code).limit(1)`（単一の欄なので索引は要らない）。`swapTrade` は `runTransaction` の中で、交換・2 点の服・受け取る側の同じ ID を `tx.get` してから書く。
- [ ] **Step 6: エミュレーターのテスト** — 同じ 3 つ（入れ替わる／消えていたら動かない／2 回めは何もしない）を足し、`npm run firebase:test` が通るのを見る（この作業環境で動かなければ、そう報告して先へ）。
- [ ] **Step 7: Commit** `git commit -m "交換: 置き場に交換の文書と、入れ替えの取り引き"`

### Task 2: サーバーの交換の段取りと呼び出し

**Files:**
- Modify: `tools/cloud/studioCore.ts`（交換の関数。`deleteItem` に「交換に出している服は断る」）
- Modify: `tools/cloud/api.ts`（`op` を 7 つ足す）
- Modify: `src/cloud/wire.ts`（`SERVER_API = 4`、`TRADE_API = 4`、`WireTrade`）
- Test: `tools/cloud/studioCore.test.ts`、`tools/cloud/api.test.ts`

**Interfaces:**
- Consumes: Task 1 の `CloudStore` の口。`movable(deps, uid, item)`（同じファイル。そのまま使う）。`deps.newWord`（印に使う。短くしたければ `deps.newTradeCode` を足してよい。推し量れない乱数であること）。
- Produces（`studioCore.ts`）:
  ```ts
  export const TRADE_CODE_MS = 90_000, TRADE_OPEN_MS = 600_000, TRADE_CLAIMED_MS = 300_000, TRADE_JOINED_MS = 180_000, TRADE_PER_DAY = 30;
  export async function tradeOpen(deps, uid, itemId): Promise<{ tradeId: string; code: string }>;
  export async function tradeCode(deps, uid, tradeId): Promise<{ code: string }>;
  export async function tradeClaim(deps, uid, code): Promise<{ tradeId: string }>;   // 断るときは CloudError('refused', 理由) と下の語
  export async function tradeJoin(deps, uid, tradeId, itemId): Promise<void>;
  export async function tradeView(deps, uid, tradeId): Promise<WireTrade>;          // 時間切れなら、ここで cancelled にしてから返す
  export async function tradeAccept(deps, uid, tradeId): Promise<WireTrade>;        // 2 人めなら swapTrade
  export async function tradeCancel(deps, uid, tradeId): Promise<void>;
  ```
- Produces（`wire.ts`）:
  ```ts
  export const TRADE_API = 4;
  export type TradeRefusal = 'unknown' | 'expired' | 'self' | 'busy' | 'not-movable' | 'limit';
  export interface WireTradeItem { id: string; dollId: string; name: string; categoryId: string; hue: number; thumb: string /* base64 */; thumbType: string }
  export interface WireTrade {
    id: string; status: 'open' | 'claimed' | 'joined' | 'done' | 'cancelled';
    me: 'a' | 'b'; mine?: WireTradeItem; theirs?: WireTradeItem;
    myAccepted: boolean; theirAccepted: boolean;
    reason?: 'cancel' | 'expired' | 'gone' | 'conflict' | 'replaced';
    receivedId?: string; // done のとき、もらった服の ID
  }
  ```
- 断りの語は、`CloudError('refused', …)` の message の先頭に `trade:<TradeRefusal>` を付けて渡す（アプリが見分けられるように。形は任せるが、Task 3 の `BackendError` に `tradeRefusal` として出ること）。
- `api.ts` の op: `tradeOpen{itemId}`・`tradeCode{tradeId}`・`tradeClaim{code}`・`tradeJoin{tradeId,itemId}`・`trade{tradeId}`・`tradeAccept{tradeId}`・`tradeCancel{tradeId}`。

決まり（テストで押さえる）:
- `tradeOpen`: 服が自分の・`movable`・ほかの生きている交換に出ていない。前の自分の交換が終わっていなければ `cancelled`（`replaced`）。1 日の回数を数える（`TRADE_PER_DAY`、超えたら `limit`）。
- `tradeClaim`: 印が一致・`codeAt` から 90 秒以内（過ぎたら `expired`）・`open`（ほかなら `busy`）・`a.uid !== uid`（`self`）。B の前の交換もやめにする。回数を数える。
- `tradeJoin`: `claimed` で `b.uid === uid`、服が B の・`movable`・ほかの交換に出ていない。
- 時間切れ（`tradeView`・`tradeAccept`・`tradeJoin` の入口で見る）: Global Constraints の 3 つ。
- `tradeAccept`: `joined` のときだけ。自分の `accepted` を立て、両方立ったら `swapTrade`。
- `deleteItem`（利用者から）: その服が、生きている交換（`open`・`claimed`・`joined`）に出ていれば断る。`force` の片付けは、そのまま。
- `tradeView` の `thumb`: その服の `item.thumb` の絵（`paths` から読む）。相手の服は `claimed` 以降、自分の服はいつも。

- [ ] **Step 1: `studioCore.test.ts` に交換のテストを書く** — `trade swaps when both accept`（A の服が B に、B の服が A に、`receivedId`）、`one accept does not move`、`accept twice concurrently swaps once`（`Promise.all` で 2 人同時）、`claim refuses expired code`（時計を 91 秒進める → `expired`）、`code refresh invalidates old code`、`claim refuses self`、`third person is busy`、`claim survives code refresh while choosing`（claim → 印を新しく → join・accept が通る）、`cannot offer item of unfinished job`（`not-movable`）、`cannot delete item in live trade`、`new open cancels previous`（`replaced`）、`timeouts`（10 分・5 分・3 分）、`daily limit`（31 回めで `limit`）、`received item delete removes original files`（③-b の `deleteItem` の決まりが効く）。
- [ ] **Step 2: `npx vitest run tools/cloud/studioCore.test.ts` で落ちるのを見る**
- [ ] **Step 3: `studioCore.ts` を実装する**
- [ ] **Step 4: テストが通るのを見る**
- [ ] **Step 5: `api.test.ts` に op の形のテスト**（引数の型が違えば `refused`、`signIn` の `api` が 4）、`api.ts`・`wire.ts` を実装して通す
- [ ] **Step 6: `npm run functions:build` が通ることを見る**
- [ ] **Step 7: Commit** `git commit -m "交換: サーバーの段取りと呼び出し（サーバーの版 4）"`

### Task 3: アプリの裏側の口（本物と偽物）

**Files:**
- Modify: `src/cloud/backend.ts`（`StudioBackend` に交換の口、`BackendError` に `tradeRefusal`）
- Modify: `src/cloud/remoteBackend.ts`
- Modify: `src/cloud/fakeBackend.ts`（`FakeOptions` に `noTrade`・`partner`）
- Modify: `src/cloud/session.ts`（`markNew(itemId)`）
- Test: `src/cloud/remoteBackend.test.ts`（あれば。無ければ近くの既存テストの形で新規）、`src/cloud/fakeBackend.test.ts`、`src/cloud/session.test.ts`

**Interfaces:**
- Consumes: Task 2 の `WireTrade`・`TRADE_API`・`TradeRefusal`。
- Produces（`backend.ts`）:
  ```ts
  export interface TradeItem { id: string; dollId: string; name: string; categoryId: string; hue: number; thumb: Blob }
  export interface TradeState extends Omit<WireTrade, 'mine' | 'theirs'> { mine?: TradeItem; theirs?: TradeItem }
  // StudioBackend に足す。サーバーが TRADE_API 未満なら、どれも BackendError('old-server')
  tradeOpen(itemId: string): Promise<{ tradeId: string; code: string }>;
  tradeCode(tradeId: string): Promise<string>;
  tradeClaim(code: string): Promise<{ tradeId: string }>;
  tradeJoin(tradeId: string, itemId: string): Promise<void>;
  trade(tradeId: string): Promise<TradeState>;
  tradeAccept(tradeId: string): Promise<TradeState>;
  tradeCancel(tradeId: string): Promise<void>;
  canTrade(): Promise<boolean>; // signIn 済みのサーバーの版が TRADE_API 以上か
  // BackendError に readonly tradeRefusal?: TradeRefusal
  ```
- Produces（`session.ts`）: `markNew(itemId: string): void`（`newItemIds` に足し、`NEW_KEY` に保存して知らせる）。
- 偽物の「にせの あいて」（`FakeOptions.partner?: { claimAfterMs?: number; acceptAfterMs?: number; refuse?: TradeRefusal; cancelAfterMs?: number }`）:
  - こちらが `tradeOpen` したら、`claimAfterMs`（既定 1500）後に、にせの あいてが読み、にせの服（色の四角、名前「にせの ふく」、ドールはこちらと同じ）で `joined` にし、`acceptAfterMs`（既定 1000）後に「はい」。
  - こちらが `tradeClaim('FAKE')` したら、にせの あいての `open` の交換に入ったことにする（相手の服は、にせの服）。`refuse` があれば、その語で断る。
  - 2 人とも「はい」で、こちらの服を `items` から外し、にせの服を自分の服として足す（`receivedId`）。
  - `cancelAfterMs` があれば、その時間であいてが「やめる」。
  - `noTrade: true` は古いサーバーのまね（`old-server`）。

- [ ] **Step 1: テストを書く** — `remoteBackend`: op の名前と引数、`thumb` の base64 → Blob、古いサーバーで `old-server`、断りの語が `tradeRefusal` に出る。`fakeBackend`: にせの あいてと 2 人「はい」で服が入れ替わる・`FAKE` を読んで入れる・`noTrade`。`session`: `markNew` が保存され、`newItemIds` に出る。
- [ ] **Step 2: 落ちるのを見る**（`npx vitest run src/cloud`）
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通るのを見る。`npx tsc -b` も通す**
- [ ] **Step 5: Commit** `git commit -m "交換: アプリの裏側の口（本物と、にせの あいて）"`

### Task 4: 交換の画面（`src/trade/`）とクローゼットのボタン

**Files:**
- Create: `src/trade/index.tsx`（遅延読み込みの入口。`trade.css` を読む）
- Create: `src/trade/Trade.tsx`（段取り: えらぶ → だす／よむ → えらぶ → こうかんする？ → できた／やめ）
- Create: `src/trade/tradeFlow.ts`（画面の段階を決める純粋な関数。テストしやすくする）
- Create: `src/trade/QrScan.tsx`（カメラ + `jsqr`。`?studio=fake` のときは、テスト用の入力 `data-testid="trade-scan-test"` で印を直接渡せる）
- Create: `src/trade/QrShow.tsx`（`qrcode-generator`。`src/home/share.ts` の描き方を借りる）
- Create: `src/trade/trade.css`
- Modify: `src/closet/Closet.tsx`（ヘッダーに「こうかん」ボタン `data-testid="closet-trade"`。押すと `lazy(() => import('../trade'))`）
- Modify: `package.json`（`jsqr` を `1.4.0` で足す。`npm install jsqr@1.4.0`）
- Test: `src/trade/tradeFlow.test.ts`

**Interfaces:**
- Consumes: Task 3 の `StudioBackend` の交換の口、`session.markNew`・`session.refresh`、クローゼットの `closetGroups`（`src/closet/closetView.ts`。服を選ぶ並び）、`BlobImage`（`src/cloud/Stage`）。
- Produces: `export default function TradeRoot(props: { session: CloudSession; library: Library; categoriesByDoll: Record<string, ManifestCategory[]>; dolls: DollData[]; onClose: () => void; onLibraryChanged: () => void | Promise<void> })`。

画面の決まり（設計書 5 章の絵のとおり）:
- 最初に `canTrade()`。false なら古いサーバーの文だけ。自分の服が 0 点なら「こうかんできる ふくが ないよ」。
- 選ぶ画面: 作っている途中の仕事の服（`session.getState().jobs` の終わっていない仕事の `itemId`、または断りの `not-movable`）は出さず、「つくっている とちゅうの ふくは、できあがってから」と小さく出す。
- だす: `tradeOpen` → QR（印だけ）。60 秒おきに `tradeCode`。1.5 秒おきに `trade` を聞く（`claimed` で「あいてが ふくを えらんでいるよ」、`joined` で「こうかんする？」）。
- よむ: カメラ（`facingMode: 'environment'`）。読めたら `tradeClaim` → 服を選ぶ → `tradeJoin`。断りの語ごとの文: `expired`「もういちど よんでね」、`busy`「ほかの ひとが こうかんちゅう」、`self`「じぶんの QR コードだよ」、`unknown`「よめない QR コードだよ」、`limit`「きょうは もう こうかんできないよ」。
- カメラの失敗（`NotAllowedError` / `NotFoundError` / ほか）: ひらがなの理由 + 「おとなの ひとに きいてね」+ おとな向け「端末の設定で、このアプリ（ブラウザ）のカメラを許可してください」。
- こうかんする？: 両方の服の絵と名前、相手が OK なら「あいては OK」。[やめる] は `tradeCancel`。
- `done`: 「こうかん できたよ！」+ もらった服の絵（NEW）→ `session.markNew(receivedId)`、`session.refresh()`、`onLibraryChanged()`。`cancelled`: 「こうかんは やめに なったよ」。
- 画面を閉じた・`pagehide` で、終わっていない交換に `tradeCancel`（失敗は無視）。`visibilitychange` で戻ったら、すぐ `trade` を聞く。カメラは閉じたら止める（`track.stop()`）。
- きろく: 設計書 7 章の行（`trade open` など）。名前・コード・印は入れない。

- [ ] **Step 1: `tradeFlow.test.ts` を書く** — `WireTrade` の状態と自分の側から画面の段階を返す `stageOf(state: TradeState | null, local: LocalStep): TradeStage` の表（`open`/a → `show-qr`、`claimed`/a → `partner-choosing`、`claimed`/b → `choose`、`joined` → `confirm`、`done` → `done`、`cancelled` → `ended`）と、断りの語 → 文 `refusalText(r: TradeRefusal): string`。
- [ ] **Step 2: 落ちるのを見る**（`npx vitest run src/trade`）
- [ ] **Step 3: `tradeFlow.ts` を実装して通す**
- [ ] **Step 4: 画面の部品を作る。`npm install jsqr@1.4.0`。クローゼットにボタン**
- [ ] **Step 5: `npm run build` で、`jsqr` が交換の画面のかたまりにだけ入っていることを見る**（`dist/assets` の主なかたまりに `jsQR` の文字が無い）
- [ ] **Step 6: Commit** `git commit -m "交換: 画面（QR を出す・読む・こうかんする？）とクローゼットのボタン"`

### Task 5: E2E と写真、版数と文書

**Files:**
- Create: `e2e/trade.spec.ts`
- Modify: `src/version.ts`（`0.41.0`）、`README.md`（更新履歴）、`docs/firebase-setup.md`（載せ直し: サーバーの版 4）、`docs/superpowers/HANDOFF.md`（0 章・0-1 の表の ⑤）
- Create: `docs/superpowers/specs/2026-11-25-stage5-trade/`（写真）、`docs/superpowers/specs/2026-11-25-stage5-ledger.md`（決めたこと・残したこと）

**Interfaces:**
- Consumes: Task 3 の `FakeOptions.partner`・`noTrade`（E2E では、`e2e/closet.spec.ts` が偽物の設定を渡すやり方に合わせる）、Task 4 の `data-testid`。

- [ ] **Step 1: `e2e/trade.spec.ts` を書く** — `show QR and swap with fake partner`（クローゼット → こうかん → だす → 服を選ぶ → QR が出る → 「あいてが えらんでいるよ」→ こうかんする → できた → クローゼットに「にせの ふく」が NEW で出て、渡した服が無い → ゲームのメニューにも出る）／`scan side`（よむ → テスト用の入力に `FAKE` → 服を選ぶ → こうかんする → できた）／`partner sees cancel`（`cancelAfterMs` → 「やめに なったよ」）／`refusals`（`refuse: 'expired'` → 「もういちど よんでね」）／`old server`（`noTrade` → 古い版の文、カメラを開かない）／`no items`（「こうかんできる ふくが ないよ」）／`camera denied`（`?studio=fake` でも `QrScan` は本物と同じく `getUserMedia` を呼び、テスト用の入力は、それに足して出すだけ。Playwright でカメラの許可を与えずに「よむ」→ 断ったときの理由の文が出る）。
- [ ] **Step 2: `npm run test:e2e -- --trace off e2e/trade.spec.ts` で通す**（ほかの E2E も `npm run test:e2e -- --trace off` で全部通す）
- [ ] **Step 3: 写真** — iPad の縦（820×1180）とスマホの縦（390×844）で、選ぶ・QR・こうかんする？・できた・カメラ不可（deviceScaleFactor 2）。`docs/superpowers/specs/2026-11-25-stage5-trade/` へ。
- [ ] **Step 4: 版数と文書を直す。`npm run lint`・`npx vitest run`・`npm run build` が通るのを見る**
- [ ] **Step 5: Commit** `git commit -m "v0.41.0: 交換（会ったときだけ、服を 1 点ずつ入れ替える）"`
