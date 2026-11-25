# 段階 ⑥ 支払い（v0.42.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** チケットを「配った分（期限なし）」と「買った分（6 か月）」に分けて数え、Stripe Checkout で買えるようにする。売る入口は、設定がオンか管理者のときだけ出す。

**Architecture:** チケットの数え方は、純粋な関数の束 `tools/cloud/wallet.ts` に集め、メモリ版と Firestore 版の置き場が、取り引きの中でそれを呼ぶ。支払いは `PaymentGateway`（作る・聞く・知らせを確かめる）の口の向こうに Stripe を置き、`studioCore` の支払いの関数（`shop`・`checkout`・`purchase`・`handlePayEvent`）が、置き場の `purchases` を、何度呼ばれても 1 回だけ足すように書き換える。アプリは、新しい op を `StudioBackend` に足し、「つくる」の中に買う流れ（保護者の確認 → パック → 最終確認 → 移る → 戻る）を足す。

**Tech Stack:** TypeScript、React、Vitest、Playwright、Firebase Functions v2（`onCall`・`onRequest`）、Firestore、`stripe` 23.2.0（functions だけ）。

**Spec:** `docs/superpowers/specs/2026-11-25-stage6-payment-design.md`（前提: `docs/superpowers/plans/2026-11-23-payment-plan.md`）。

## Global Constraints

- 期限: `expiresAt` = 支払いページを作った時刻 + 暦の 6 か月（**日本時間**で数える。その日が無い月は月末。時刻はそのまま）。延長・繰り越しなし。
- 使う順: 期限内の買った分を `expiresAt` の早い順 → 配った分（`free`）。管理者はチケットを引かない（いままでどおり `note`）。
- 配った分（いまの残り・手で配った分・ようこそ・2 台めから合わせた分）には期限を付けない。いまあるチケットを減らさない。
- 買えるのは匿名でない（Google でログインした）呼び出しだけ。`checkout` は 1 人 1 日 10 回まで。Checkout Session の命は 30 分。
- 1 回の支払いで足すのは 1 回だけ（知らせとアプリの聞き直しのどちらが先でも、何度でも）。
- 設定（`system/config`）: `salesOpen`（既定 false）・`packs`（`10:300,30:800` の形、既定 空）・`welcomeTickets`（既定 0）・`payReturnUrl`（既定 `https://kake-git-hub.github.io/DressUpGame/`）。秘密の値: `STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`。鍵が無いあいだ `checkout` は `pay:closed`。
- 断りの理由（`CloudError('refused')` の message の先頭 `pay:{理由}`）: `login`・`closed`・`pack`・`limit`・`other`。
- サーバーの版: `SERVER_API = 5`、`PAY_API = 5`（`src/cloud/wire.ts`）。版 4 以下のサーバーなら、アプリは「チケットを買う」を出さない。
- カードの番号・秘密の鍵・支払いの番号・金額・メールを、アプリの保存・きろく（`diag`）・リポジトリに入れない。
- 画面の文は、子どもにも読めるやさしい日本語（いまの「つくる」と同じ調子）。最終確認の項目は設計書 5-1 のとおり（文言は仮でよい）。
- 「つくる」をだれにでも出すことは、しない（別の版）。
- 画像生成（Gemini）は使わない。
- 版は v0.42.0。README の更新履歴に足す。

## Review Focus

1. **古い形の利用者**（`free`・`lots`・`ticketsWritten` が無く `tickets` だけ）が、最初の書き込みで 1 枚も増減しない → Task 1・2 のテスト「古い形はそのまま free」。
2. **作者が Firestore で `tickets` を手で書き換えた**（増やした・減らした）あとに使う・戻す・買う → 差が配った分に入る／減らした分が free → 期限の近い買った分の順に減る。切れた買った分が配った分に化けない → Task 1 のテスト。
3. **知らせが 2 回・順が逆・アプリの聞き直しと同時**（`completed` を 2 回、`refunded` が `completed` より先、`purchase` と `completed` の取り引きのやり直し）→ 足すのは 1 回、取り戻すのは目標の数まで → Task 3 のテスト（`replayTransactions` を使う）。
4. **期限をまたぐ失敗の払い戻し**（引いた買った分が、戻す時には切れている）→ 配った分へ戻る → Task 1・2 のテスト。
5. **Safari で戻った・別の端末**（覚えた支払いの番号が無い／別の利用者）→ `pay:other` で「ホーム画面のアプリを開くと増えています」、開いたときに `announce` で「ふえました」が 1 回だけ → Task 3・6 のテスト。

---

### Task 1: チケットの財布（純粋な関数）

**Files:**
- Create: `tools/cloud/wallet.ts`
- Test: `tools/cloud/wallet.test.ts`
- Modify: `tools/cloud/store.ts`（`UserDoc` に `free?`・`lots?`・`ticketsWritten?`・`welcomed?`、`JobDoc` に `draws?`、型 `Lot`・`Draw` を足す）

**Interfaces:**
- Produces（`tools/cloud/store.ts`）:
  - `interface Lot { id: string; count: number; left: number; boughtAt: number; expiresAt: number }`（`id` = 支払いの番号）
  - `interface Draw { lot?: string; n: number }`（`lot` 無し = 配った分）
  - `UserDoc` に `free?: number; lots?: Lot[]; ticketsWritten?: number; welcomed?: true`。`JobDoc` に `draws?: Draw[]`。
- Produces（`tools/cloud/wallet.ts`）:
  - `interface Wallet { free: number; lots: Lot[] }`（`lots` は期限切れを含む、`left > 0` のもの）
  - `readWallet(user: UserDoc): Wallet` — 古い形・手で書いた `tickets` の解釈（下）。
  - `usable(w: Wallet, now: number): number` — `free` + 期限内の `left` の和。
  - `draw(w: Wallet, cost: number, now: number): { wallet: Wallet; draws: Draw[] } | null` — 足りなければ null。
  - `refundTicket(w: Wallet, draws: Draw[] | undefined, index: number, now: number): Wallet` — 品目 `index` の 1 枚を戻す。
  - `expire(w: Wallet, now: number): { wallet: Wallet; expired: { lot: string; n: number }[] }` — 切れた `lots` を落とす。
  - `addFree(w: Wallet, n: number): Wallet`、`addLot(w: Wallet, lot: Lot): Wallet`、`merge(a: Wallet, b: Wallet): Wallet`（2 台めを合わせる。同じ `id` の lot は足さない）
  - `reclaim(w: Wallet, lotId: string, n: number): { wallet: Wallet; taken: number }` — その lot の `left` から最大 n 枚。
  - `walletFields(w: Wallet, now: number): Pick<UserDoc, 'free' | 'lots' | 'tickets' | 'ticketsWritten'>` — 書くときの形（`tickets` = `ticketsWritten` = `usable`。期限切れ・`left` 0 の lot は残さない）。
  - `addMonthsJst(at: number, months: number): number`、`LOT_MONTHS = 6`。

**解釈の規則（`readWallet`）:**
- `free`・`lots`・`ticketsWritten` がどれも無い → `{ free: tickets, lots: [] }`。
- ある → `base = { free, lots }`。`tickets !== ticketsWritten` なら手で書いた差 `d = tickets - ticketsWritten`: `d > 0` なら `free += d`、`d < 0` なら `free` から、足りなければ期限の近い順の lot の `left` から減らす（期限切れの lot からは減らさない。0 未満にしない）。
- `tickets` が数でない・有限でない → 0 とみなす（いまの `have` と同じ）。

**戻す規則（`refundTicket`）:** 設計書 4-2 の「最後に引いた所へ」を、こう具体にする（品目ごとに行き先が決まり、`draws` を書き換えずに、何度呼んでも同じ所へ戻せる）: `draws` を 1 枚ずつ並べた列の `index` 番めの行き先（その lot か free）へ 1 枚。その lot が `w.lots` に無い・期限切れ → `free` へ。`draws` が無い・`index` が範囲外 → `free` へ。

- [ ] **Step 1: 失敗するテストを書く**（`wallet.test.ts`。時刻は日本時間の文字列から作る）
  - `addMonthsJst`: `2026-11-25T10:00+09:00` → `2027-05-25T10:00+09:00`、`2026-08-31T23:30+09:00` → `2027-02-28T23:30+09:00`、`2026-11-30T23:30+09:00`（UTC では 14:30）→ `2027-05-30T23:30+09:00`。
  - 古い形 `{ tickets: 7 }` → `usable` 7、`free` 7。`walletFields` が `{ free: 7, lots: [], tickets: 7, ticketsWritten: 7 }`。
  - 手で増やした: `{ free: 2, lots: [L(5, 期限内)], tickets: 10, ticketsWritten: 7 }` → `free` 5、`usable` 10。
  - 手で減らした: `{ free: 2, lots: [L(5)], tickets: 4, ticketsWritten: 7 }` → `free` 0、lot の `left` 4。
  - 切れた lot が配った分に化けない: `{ free: 2, lots: [L(5, 期限切れ)], tickets: 7, ticketsWritten: 7 }` → `usable` 2、`free` 2。
  - `draw` の順: lots `A(3, 6/1)`・`B(2, 5/1)`・free 4、cost 6 → draws `[{lot:'B',n:2},{lot:'A',n:3},{n:1}]`。切れた lot からは引かない。足りなければ null。
  - `refundTicket`: 上の draws で index 1 → B へ、index 5 → free へ、B が切れていたら index 1 → free へ。draws 無し → free へ。
  - `expire`: 切れた lot の `left` を返し、wallet から落とす。
  - `merge`: free を足し、lot は期限を保つ、同じ id は 1 回。
  - `reclaim`: `left` 7 から 5 → taken 5、`left` 2。`left` 2 から 5 → taken 2。

- [ ] **Step 2: 走らせて落ちるのを見る** — `npx vitest run tools/cloud/wallet.test.ts` → FAIL（モジュールが無い）。
- [ ] **Step 3: `tools/cloud/wallet.ts` を書き、`store.ts` に型を足す。**
- [ ] **Step 4: 通る** — `npx vitest run tools/cloud/wallet.test.ts` → PASS。`npx tsc -p tsconfig.app.json --noEmit` も通る。
- [ ] **Step 5: コミット**（`支払い: チケットの財布（配った分と買った分）`）

---

### Task 2: 置き場を財布で数える（メモリ版・Firestore 版）

**Files:**
- Modify: `tools/cloud/store.ts`（`CloudStore` の `refundOnce` に `index` と `draws` を足す。返り値の型）、`tools/cloud/memoryStore.ts`、`functions/src/firestoreStore.ts`、`tools/cloud/studioCore.ts`（`signIn` の `UserView`、`startJob` が `draws` を受ける、`settleRefunds` の呼び方）、`src/cloud/backend.ts`（`StudioUser` に `free`・`lots`）、`src/cloud/wire.ts`
- Test: `tools/cloud/memoryStore.test.ts`、`tools/cloud/studioCore.test.ts`、`functions/test/adapters.emu.ts`

**Interfaces:**
- Consumes: Task 1 の `wallet.ts` 全部。
- Produces:
  - `CloudStore.charge(uid, cost, reason, now): Promise<number>` — 形は同じ。中で `readWallet` → `expire` → `draw` → `walletFields`。台帳: 引いた行 `{ count: -cost, reason, at, draws }` と、切れた lot ごとに `{ count: -n, reason: 'expire:{lot}', at }`。
  - `CloudStore.chargeAndCreateJob(uid, job, cost, reason, now): Promise<number>` — 形は同じ。`job.draws` を中で決めて、仕事と一緒に書く（やり直しで、もう仕事があれば、いまの残りを返す = いまと同じ）。
  - `CloudStore.refundOnce(uid: string, key: string, index: number, draws: Draw[] | undefined, reason: string, now: number): Promise<boolean>` — `refundTicket` で戻す。台帳の行に `to: lot | 'free'`。
  - `CloudStore.addTickets(...)` — 配った分（`addFree`）。`moveTickets(from, to, now)` — `merge`。返り値は移した `usable`。
  - `CloudStore.getWallet(uid: string, now: number): Promise<{ free: number; lots: Lot[] }>` — 読むだけ（期限切れを除いた lots）。
  - `UserView` と `StudioUser` に `free: number; lots: { count: number; left: number; expiresAt: number }[]`（期限内だけ、`expiresAt` の早い順）。`tickets` は `usable`。
  - `JobDoc.draws` は `chargeAndCreateJob` が書く。`settleRefunds` は `refundOnce(uid, key, c.index, job.draws, reason, now)`。

- [ ] **Step 1: 失敗するテストを書く**
  - `memoryStore.test.ts`: 古い形の利用者（`tickets: 3` だけを直接入れる）に `charge(1)` → 残り 2、`free` 2、`ticketsWritten` 2。lot を持つ利用者に `chargeAndCreateJob(2)` → `job.draws` が lot から。`refundOnce(index 0)` を 2 回 → 1 回だけ戻る。切れた lot の分の `refundOnce` → free へ。`moveTickets` で lot の期限が保たれる。
  - `studioCore.test.ts`: `signIn` の返事に `free`・`lots`。lot を持つ利用者が作って、品目 1 つが失敗 → その lot に戻る。**`replayTransactions` で同じことを通す**（取り引きの中で `draw` を二重にしない）。
  - `functions/test/adapters.emu.ts`: Firestore 版で、同じ 4 件（古い形・手で書いた差・切れた lot・refund の行き先）。
- [ ] **Step 2: 落ちる** — `npx vitest run tools/cloud` → FAIL。
- [ ] **Step 3: メモリ版・Firestore 版・`studioCore` を書き換える**（Firestore は、利用者の文書を取り引きの中で読み、`walletFields` で `update`）。
- [ ] **Step 4: 通る** — `npx vitest run tools/cloud` → PASS（`processSwap.test.ts` の時間切れ 1 件は前からある）。`npm run firebase:test` → PASS。
- [ ] **Step 5: コミット**（`支払い: 置き場のチケットを、財布で数える`）

---

### Task 3: 支払いの中身（サーバーの core・op・ようこそ）

**Files:**
- Create: `tools/cloud/payment.ts`（`PaymentGateway` の型・パックの読み方・`shop`・`checkout`・`purchase`・`shopAck`・`handlePayEvent`・`fulfill`）、`tools/cloud/fakeGateway.ts`（テスト用）
- Modify: `tools/cloud/store.ts`（`PurchaseDoc` と置き場の口）、`tools/cloud/memoryStore.ts`、`functions/src/firestoreStore.ts`、`tools/cloud/studioCore.ts`（`CoreDeps.pay`、`signIn` のようこそ）、`tools/cloud/api.ts`（op）、`src/cloud/wire.ts`（`SERVER_API = 5`・`PAY_API = 5`・`WireShop`・`WirePurchase`・`PayRefusal`）
- Test: `tools/cloud/payment.test.ts`、`tools/cloud/api.test.ts`、`functions/test/adapters.emu.ts`

**Interfaces:**
- Produces（`store.ts`）:
  - `interface PurchaseDoc { id: string; uid: string; pack: string; tickets: number; price: number; status: 'open' | 'paid' | 'expired'; createdAt: number; expiresAt: number; adultAt: number; agreedAt: number; paidAt?: number; reclaimed?: number; announced?: true }`（`id` = Checkout Session の ID、`expiresAt` = チケットの期限）
  - `CloudStore.putPurchase(p: PurchaseDoc): Promise<void>`、`getPurchase(id): Promise<PurchaseDoc | null>`
  - `CloudStore.fulfillPurchase(id: string, paidAt: number, now: number): Promise<{ added: number; purchase: PurchaseDoc } | null>` — 1 つの取り引き: `open` なら `addLot({ id, count: tickets, left: tickets, boughtAt: paidAt, expiresAt })`・`paid`・台帳 `buy:{id}`（+tickets）。もう `paid` なら `added: 0`。無ければ null。`expired` でも、支払い済みと言われたら足す（30 分を過ぎて払えたとき）。
  - `CloudStore.expirePurchase(id): Promise<void>`（`open` のときだけ）
  - `CloudStore.reclaimPurchase(id: string, target: number, now: number): Promise<number>` — 1 つの取り引き: `target - (reclaimed ?? 0)` を `reclaim`、`reclaimed = target`（大きくなるときだけ）、台帳 `refund-paid:{id}`。取った枚数を返す。
  - `CloudStore.listUnannounced(uid: string): Promise<PurchaseDoc[]>`（`paid` で `announced` 無し）、`markAnnounced(id)`
  - `CloudStore.countCheckout(uid: string, day: string, perDay: number): Promise<void>`（`countTrade` と同じ形。上限なら `CloudError('limit')`）
  - `CloudStore.markWelcome(uid: string, n: number, now: number): Promise<number>` — 1 つの取り引き: `welcomed` が無ければ `addFree(n)`・`welcomed: true`・台帳 `welcome`。足した枚数（もう配っていれば 0）。
- Produces（`payment.ts`）:
  - `interface PaymentGateway { createCheckout(input: { uid: string; pack: Pack; purchaseExpiresAt: number; successUrl: string; cancelUrl: string; sessionExpiresAt: number }): Promise<{ id: string; url: string }>; getSession(id: string): Promise<{ id: string; paid: boolean; paidAt: number | null; expired: boolean; uid: string | null }>; parseEvent(body: Buffer, signature: string): PayEvent }`（`parseEvent` は、署名が違えば投げる）
  - `type PayEvent = { kind: 'completed'; session: string; paid: boolean; paidAt: number } | { kind: 'expired'; session: string } | { kind: 'refunded'; session: string; amount: number; refunded: number } | { kind: 'disputed'; session: string } | { kind: 'other' }`（`refunded` / `disputed` の `session` は、本物では PaymentIntent から Checkout Session を引いて埋める = Task 4）
  - `interface Pack { id: string; tickets: number; price: number }`、`parsePacks(text: string): Pack[]`（`10:300,30:800` → `[{ id: '10-300', tickets: 10, price: 300 }, …]`。正の整数、price ≥ 50、壊れた項目は捨てる）
  - `interface PayDeps { gateway: PaymentGateway | null; salesOpen: boolean; packs: Pack[]; welcomeTickets: number; returnUrl: string; checkoutsPerDay: number }`。`CoreDeps.pay?: PayDeps`（無ければ、売らない・ようこそ 0）
  - `shop(deps, uid): Promise<WireShop>`、`checkout(deps, uid, caller, input: { pack: string; adultAt: number; agreedAt: number }): Promise<{ session: string; url: string; expiresAt: number }>`、`purchase(deps, uid, session): Promise<WirePurchase>`、`shopAck(deps, uid, session): Promise<void>`、`handlePayEvent(deps, event: PayEvent): Promise<void>`
- Produces（`wire.ts`）: `WireShop = { open: boolean; packs: Pack[]; announce: { session: string; tickets: number }[] }`、`WirePurchase = { status: 'open' | 'paid' | 'expired'; added: number; tickets: number }`、`PayRefusal = 'login' | 'closed' | 'pack' | 'limit' | 'other'`。
- op（`api.ts`）: `shop`・`checkout`（`pack`・`adultAt`・`agreedAt`）・`purchase`（`session`）・`shopAck`（`session`）。どれも返事に `user`。

**決まり:**
- `shop.open` = `(salesOpen || admin) && gateway !== null && packs.length > 0`。
- `checkout`: 匿名 → `pay:login`。`!open` → `pay:closed`。パックが無い → `pay:pack`。`countCheckout(uid, day, 10)` → `pay:limit`。`expiresAt = addMonthsJst(now, 6)`、`sessionExpiresAt = now + 30 分`、`successUrl = returnUrl + '?pay=done&session={CHECKOUT_SESSION_ID}'`、`cancelUrl = returnUrl + '?pay=cancel'`。`putPurchase` は Checkout を作ったあと。
- `purchase`: 無い・別の uid → `pay:other`。`open` なら `getSession` → `paid` なら `fulfill`、`expired` なら `expirePurchase`。
- `handlePayEvent`: `completed && paid` → `fulfill`（`purchases` が無ければ何もしない）。`expired` → `expirePurchase`。`refunded` → まだ `open` なら先に `fulfill`、`reclaimPurchase(id, ceil(tickets × refunded / amount))`。`disputed` → 先に `fulfill`、`reclaimPurchase(id, tickets)`。
- ようこそ: `api.ts` の `signIn` の、匿名でない枝の `markUser` のあとで、`welcomeTickets > 0` のときだけ `markWelcome`。返事に `welcome: n`（0 なら無し）。

- [ ] **Step 1: 失敗するテストを書く**（`payment.test.ts`。`fakeGateway` は、作った session を覚え、`pay(id)`・`expire(id)` で状態を変えられる）
  - 匿名の `checkout` → `pay:login`。`salesOpen: false` で管理者でない → `pay:closed`、管理者なら作れる。gateway が null → `pay:closed`。無いパック → `pay:pack`。11 回め → `pay:limit`。
  - `checkout` の返事の `expiresAt` が `addMonthsJst(now, 6)`、`purchases` に `adultAt`・`agreedAt`。
  - `completed` を 2 回 + `purchase` 1 回 → lot は 1 つ、台帳 `buy:` は 1 行。**`replayTransactions` でも同じ**。
  - `refunded`（10 枚・3 枚使用・半額）→ 残り 2 枚。同じ知らせをもう 1 回 → 変わらない。`refunded` が `completed` より先 → 足してから引く（残り 5）。
  - `disputed` → その lot の残り 0。
  - 別の uid の `purchase` → `pay:other`。
  - `shop.announce` に出て、`shopAck` のあとは出ない。
  - `parsePacks('10:300, 30:800,x:1,5:10')` → 2 つ（`5:10` は 50 円未満で捨てる）。
  - ようこそ: `welcomeTickets: 3` で名前のある `signIn` を 2 回 → free +3 は 1 回。`welcomeTickets: 0` なら `welcomed` を書かない。匿名には配らない。
  - `api.test.ts`: 4 つの op が `handleCall` から通る、`api` が 5。
  - `adapters.emu.ts`: Firestore 版の `fulfillPurchase` を 2 回 → 1 回、`reclaimPurchase`、`markWelcome`、`countCheckout`。
- [ ] **Step 2: 落ちる** — `npx vitest run tools/cloud` → FAIL。
- [ ] **Step 3: 書く**（Firestore: `purchases/{id}` は最上位の集まり、`checkouts/{uid}_{day}` で数える）。
- [ ] **Step 4: 通る** — `npx vitest run tools/cloud` と `npm run firebase:test` → PASS。
- [ ] **Step 5: コミット**（`支払い: サーバーの段取り（買う・足す・取り戻す・ようこそ）`）

---

### Task 4: 本物の Stripe と、知らせの関数

**Files:**
- Create: `functions/src/stripeGateway.ts`
- Modify: `functions/package.json`（`"stripe": "23.2.0"`、`(cd functions && npm install)` で lock を更新）、`functions/src/index.ts`（設定の読み方・秘密の値・`stripeHook`・`studio` に `pay` を渡す）、`firestore.rules`（`purchases`・`checkouts` はアプリから読めない = いまの決まりのまま、確かめる）
- Test: `functions/test/callable.emu.ts`（または新しい `functions/test/pay.emu.ts`）

**Interfaces:**
- Consumes: Task 3 の `PaymentGateway`・`PayEvent`・`handlePayEvent`・`parsePacks`。
- Produces:
  - `createStripeGateway(secretKey: string, webhookSecret: string): PaymentGateway` — `checkout.sessions.create({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: price, product_data: { name: 'チケット {n} 枚（服 {n} 点ぶん）' } } }], client_reference_id: uid, metadata: { uid, pack, tickets, expiresAt }, success_url, cancel_url, expires_at: 秒, locale: 'ja' })`。支払いの方法は Stripe の既定（管理画面で選ぶ）に任せる。`parseEvent` は `webhooks.constructEvent`。`charge.refunded` / `charge.dispute.created` は `payment_intent` から `checkout.sessions.list({ payment_intent })` で session を引く（見つからなければ `other`）。
  - `stripeHook`（`onRequest`、東京、`secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]`）: POST だけ。`req.rawBody` と `stripe-signature` で `parseEvent`。署名が違う → 400。`handlePayEvent` が投げた → 500。ほかは 200。記録（`logger`）に支払いの番号を出してよい（サーバーの記録は公開されない）。
  - 設定: `salesOpen`（true / `"true"`）、`packs`（文字列）、`welcomeTickets`（数）、`payReturnUrl`（`https://` で始まるときだけ）。秘密の値が空なら `gateway: null`。
  - エミュレーターのときだけ、`STUDIO_TEST_FAKE_PAY=1` で `fakeGateway` を使う（署名は、にせの鍵 `whsec_test` で HMAC。Task 3 の `fakeGateway` に `sign(body)` を足す）。

- [ ] **Step 1: 失敗するテストを書く**（エミュレーター）: `stripeHook` に、正しい署名の `completed` → チケットが増える。署名が違う → 400 で増えない。同じ本文を 2 回 → 1 回。
- [ ] **Step 2: 落ちる** — `npm run firebase:test` → FAIL。
- [ ] **Step 3: 書く。**
- [ ] **Step 4: 通る** — `npm run firebase:test` → PASS。`(cd functions && npx tsc --noEmit)` も通る。
- [ ] **Step 5: コミット**（`支払い: Stripe の口と、支払いの知らせの関数`）

---

### Task 5: アプリの裏側の口（本物と、にせ）

**Files:**
- Modify: `src/cloud/backend.ts`（`StudioBackend` に口）、`src/cloud/remoteBackend.ts`、`src/cloud/fakeBackend.ts`、`src/cloud/createBackend.ts`（`fakeOptions()` に項目）、`src/cloud/session.ts`（`user` の `free`・`lots`）
- Test: `src/tests/remoteBackend.test.ts`、`src/tests/fakeBackend.test.ts`

**Interfaces:**
- Consumes: Task 3 の `WireShop`・`WirePurchase`・`PayRefusal`・`PAY_API`。
- Produces（`StudioBackend`）:
  - `canPay(): Promise<boolean>`（サーバーが `PAY_API` 以上）
  - `shop(): Promise<WireShop>`、`checkout(pack: string, adultAt: number, agreedAt: number): Promise<{ session: string; url: string; expiresAt: number }>`、`purchase(session: string): Promise<WirePurchase>`、`shopAck(session: string): Promise<void>`
  - 断りは `BackendError('refused', …, { payRefusal })`（`tradeRefusal` と同じ形で `payRefusal?: PayRefusal` を足す）。古いサーバー → `BackendError('old-server')`。
  - `signIn()` の返事の `welcome?: number` を、`StudioUser` ではなく `onWelcome(listener)` か `signIn` の戻り値の別の欄で渡す（作る人が選ぶ。Task 6 が 1 回だけ出せればよい）。
- にせ（`dressup_fake_options`）: `shop: { open?: boolean; packs?: string }`（既定 `open: true`、`packs: '10:300,30:800'`）、`payResult: 'paid' | 'cancel' | 'slow'`（既定 `paid`。`slow` = 足すのが 40 秒あと）、`welcome?: number`、`anonymous?: boolean`（ログインしていない扱い）。にせの `checkout` の `url` は、同じアプリの `?pay=fake&session={id}`（Task 6 の、にせの支払いページ）。にせの lot は `localStorage` に、期限つきで持つ。

- [ ] **Step 1: 失敗するテストを書く**: remote は op の名前と引数、`pay:*` の断りの写し方、版 4 なら `canPay` false。fake は `payResult` ごとの `purchase` の答え、`slow` は 40 秒前は `open`、`anonymous` で `pay:login`、使う順（lot → free）。
- [ ] **Step 2: 落ちる** — `npx vitest run src/tests/remoteBackend.test.ts src/tests/fakeBackend.test.ts` → FAIL。
- [ ] **Step 3: 書く。**
- [ ] **Step 4: 通る** — 同じコマンド → PASS。
- [ ] **Step 5: コミット**（`支払い: アプリの裏側の口（本物と、にせ）`）

---

### Task 6: 買う画面・戻り・チケットの表示

**Files:**
- Create: `src/appStudio/Shop.tsx`（パック → 最終確認）、`src/appStudio/payReturn.ts`（`?pay=` を読む・消す・覚えた番号）、`src/appStudio/FakePayPage.tsx`（にせの支払いページ。`?studio=fake` のときだけ）、`src/appStudio/shop.css`
- Modify: `src/appStudio/AppStudio.tsx`（「チケットを買う」・残りの下の期限・お知らせ）、`src/App.tsx`（起動時に `?pay=` を見て「つくる」を開く）、`src/services/diag.ts` の使い方（`pay …`・`welcome …` の行）
- Test: `src/tests/shop.test.tsx`、`src/tests/payReturn.test.ts`、`e2e/pay.spec.ts`

**Interfaces:**
- Consumes: Task 5 の口、`AdultGate`（`src/appStudio/AdultGate.tsx`）、`addMonthsJst`（`tools/cloud/wallet.ts` から読めないなら `src/cloud/` に同じ関数を置き、テストで同じ答えを確かめる）。
- Produces:
  - `readPayReturn(search: string): { kind: 'done'; session: string } | { kind: 'cancel' } | { kind: 'fake'; session: string } | null`、`clearPayReturn(): void`（`history.replaceState`）、`rememberSession(id)` / `pendingSession(): string | null` / `forgetSession()`（`localStorage` `dressup_pay_pending`。try/catch）。
  - `Shop` の props: `{ backend: StudioBackend; packs: Pack[]; onClose(): void }`。

**画面の決まり（設計書 5-1）:**
- 「チケットを買う」: `canPay && shop.open` のときだけ。匿名なら押すと「Google で ログインすると かえます」（ログインのボタンへ）。
- 押す → `AdultGate`（毎回）→ パック → 最終確認（設計書 5-1 の 7 項目、表記・規約・ポリシーへのリンクは `legal/*.html` を別のタブ、同意の印を付けるまで「支払いへ進む」は押せない）→ `checkout` → `rememberSession` → `location.assign(url)`。
- 戻り `done`: 「お支払いを たしかめています…」→ 3 秒おきに `purchase`、`paid` で「チケットが N 枚 ふえました」・`shopAck`・`forgetSession`。30 秒で「お支払いの確認に じかんが かかっています。あとで チケットの のこりを 見てね」。`pay:other` → 「お支払いは うけつけました。ホーム画面の アプリを ひらくと、チケットが ふえています」。
- 戻り `cancel`: 「お支払いを やめました」。
- 「つくる」を開いたとき: `shop.announce` があれば 1 つずつ「チケットが N 枚 ふえました」→ `shopAck`。`welcome` があれば「ようこそ！ チケットを N 枚 プレゼント」。期限 14 日以内の lot があれば「N 枚の チケットが Y年M月D日で つかえなくなります」（その端末で lot ごとに 1 回。`localStorage`）。
- 残りの表示: `🎫 のこり 12 枚` の下に、lots があるときだけ `うち 10 枚は 2027年5月25日まで`（2 つ以上なら `ほか` で一覧を開く）。
- きろく: `pay shop open=… packs=N`、`pay checkout ok|refused reason=…`、`pay return done|cancel`、`pay result paid added=N|slow|other|expired`、`welcome added=N`。

- [ ] **Step 1: 失敗するテストを書く**
  - `payReturn.test.ts`: 3 つの形と、それ以外は null。`clearPayReturn` がほかの引数を残す。
  - `shop.test.tsx`: 同意の印が無いと「支払いへ進む」が押せない。最終確認に `税込 300 円`・期限の日付・`返品・返金はできません`・3 つのリンク。
  - `e2e/pay.spec.ts`（にせの裏側）: (1) `shop.open: false` で管理者でない → ボタンが無い、(2) 管理者なら出る、(3) `anonymous` → ログインの案内、(4) 保護者の確認 → パック → 同意 → にせの支払いページ →「払う」→ 戻って「ふえました」・残りが +10・期限の表示、(5) にせの支払いページで「やめる」→ 増えない、(6) `slow` →「じかんが かかっています」→ 開き直すと「ふえました」、(7) 期限まで 14 日以内の lot →お知らせが 1 回、(8) 戻りの URL が消えている。
- [ ] **Step 2: 落ちる** — `npx vitest run src/tests/shop.test.tsx src/tests/payReturn.test.ts` → FAIL。
- [ ] **Step 3: 書く。**
- [ ] **Step 4: 通る** — 上のコマンド → PASS。`npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/pay.spec.ts --trace off` → PASS。ほかの E2E（`appStudio`・`closet`・`trade`・`account`）も通る。
- [ ] **Step 5: 写真**: 最終確認の画面とパックの画面を、iPad（縦 820×1180）とスマホ（縦 390×844）で `docs/superpowers/specs/2026-11-25-stage6-payment/` に（`deviceScaleFactor: 2`）。
- [ ] **Step 6: コミット**（`支払い: 買う画面・戻り・チケットの期限の表示`）

---

### Task 7: ページ・手順・版

**Files:**
- Create: `public/legal/tokushoho.html`、`public/legal/terms.html`、`public/legal/privacy.html`
- Modify: `docs/firebase-setup.md`（新しい章: Stripe の試し用の環境で、アカウント → 鍵を秘密の値に → 載せ直し → 知らせの登録（URL は `stripeHook` の、イベントは 4 つ）→ `system/config` に `packs` → 管理者の端末で試しのカード `4242 4242 4242 4242` → チケットが増える → iPad のホーム画面アプリでも。本番への切り替えと `salesOpen` は、表記を埋めてから）、`README.md`（使い方と更新履歴 v0.42.0）、`src/version.ts`（`0.42.0`）、`docs/superpowers/HANDOFF.md`（0 章の表と 0-1、⑥ の作り 0-1f）、`docs/superpowers/plans/2026-11-23-payment-plan.md`（決まったことに印）
- Create: `docs/superpowers/specs/2026-11-25-stage6-ledger.md`（決めたこと・残したこと）

- [ ] **Step 1: ページを書く**: 設計書 8 章の中身。名前・住所・電話・メールは `【作者が記入】`。「法律の専門家の確認ではない下書き」であることは、ページには書かず、`stage6-ledger.md` と作者への報告に書く。見た目は、いまのアプリの色に合わせた素の HTML（外の読み込み無し）。
- [ ] **Step 2: 確かめる**: `npm run build` のあと、`dist/legal/*.html` があり、最終確認のリンクから開ける（`e2e/pay.spec.ts` に 1 件足す: リンクの先が 200）。
- [ ] **Step 3: 全部のテスト**: `npx vitest run`、`npm run firebase:test`、`npm run lint`、`npm run build`、E2E 全部 → PASS（落ちたものは、出力を残す）。
- [ ] **Step 4: コミット**（`v0.42.0: 支払い（Stripe でチケットを売る。売る入口は隠しておく）`）
