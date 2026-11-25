/**
 * E2Eテスト: アプリの中のスタジオを、本物の裏側（Firebase）につないだときの動き（?studio=1）。
 *
 * 本物の Firebase には、つながない。ブラウザから出ていく通信（匿名のログイン・サーバーの関数）を、ここで受けて、決めた返事を返す。
 * 確かめること: ブラウザの中で Firebase の部品が動く・ログインが 1 回で済む・関数の呼び方・画面の出方・つながらないときの知らせ。
 * サーバーの関数そのものは、エミュレーターのテスト（npm run firebase:test）で確かめる。
 */
import sharp from 'sharp';
import { test, expect, type Page, type Route } from '@playwright/test';
import { GOOGLE_CLIENT_ID } from '../src/cloud/firebaseConfig';
import { chooseTarget, themeAndCheck } from './helpers';

const REAL = '/DressUpGame/?content=e2e-content/&studio=1';
const FUNCTIONS = 'https://asia-northeast1-dressup-game-89f6e.cloudfunctions.net';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const COLOR = { r: 224, g: 64, b: 160 };

async function openStudio(page: Page) {
  await page.goto(REAL);
  await expect(page.getByTestId('home-create')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('app-studio')).toBeVisible({ timeout: 60_000 });
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
// 匿名の利用者の ID トークン（形だけ。中身を確かめるのはサーバーで、ここには無い）
function idToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: 'https://securetoken.google.com/dressup-game-89f6e', aud: 'dressup-game-89f6e', auth_time: now, user_id: uid, sub: uid, iat: now, exp: now + 3600, firebase: { identities: {}, sign_in_provider: 'anonymous' } })}.sig`;
}

interface Fake {
  calls: { op: string; auth: string | undefined }[];
  signUps: number;
  authUriCalls: number; // client_id を Firebase に聞く受け口（createAuthUri）への通信。定数があるので、0 のまま
  finish(): void;
}
/**
 * Firebase の偽の返事を用意する。functions: 'ok' = 関数が動く、'old' = 前の版のサーバー（列で進めない）、
 * 'missing' = 関数が無いと読める返事（404）、'down' = 届かない。
 * 本物では、関数がまだ載っていないときの返事は、ブラウザからは読めない見込み（ほかのサイトから読んでよいという印が付かない）。
 * そのときアプリからは 'down' と同じに見える（この道具では、読めない返事をまねできないので、'down' で確かめる）。
 */
async function fakeFirebase(page: Page, functions: 'ok' | 'old' | 'missing' | 'down' = 'ok'): Promise<Fake> {
  const webp = (await sharp({ create: { width: 240, height: 200, channels: 4, background: { ...COLOR, alpha: 1 } } }).webp().toBuffer()).toString('base64');
  const user = { userCode: 'ABCD2345', tickets: 2, admin: false };
  let started = false;
  let done = false;
  let acked = false;
  let dollId = '';
  const fake: Fake = { calls: [], signUps: 0, authUriCalls: 0, finish: () => (done = true) };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  const job = () => ({
    id: 'j1',
    dollId,
    done,
    tickets: 1,
    createdAt: Date.now(),
    candidates: [{ index: 0, name: 'うみのトップス', categoryId: 'トップス', status: done ? 'kept' : 'working', notes: [], ...(done ? { itemId: 'my:j1-0-1' } : {}) }],
  });
  const item = () => ({
    id: 'my:j1-0-1',
    dollId,
    item: { id: 'my:j1-0-1', name: 'うみのトップス', category: 'トップス', image: { file: 'files/a.webp', canvasW: 1024, canvasH: 1024, box: { x: 392, y: 300, w: 240, h: 200 } }, thumb: 'files/t.webp' },
    createdAt: 5,
    hue: 0,
    order: 5,
    updatedAt: 5,
    notes: [],
  });
  const files = { 'files/a.webp': webp, 'files/t.webp': webp };

  // ここで受けていない Google 宛ての通信は、外に出さない（本物の Firebase に、テストの利用者を作らない）
  await page.route(/googleapis\.com|cloudfunctions\.net|firebaseio\.com|firebaseapp\.com/, (route) => route.abort());
  await page.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:signUp/, (route) => {
    fake.signUps++;
    return json(route, { kind: 'identitytoolkit#SignupNewUserResponse', idToken: idToken('uid1'), refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid1' });
  });
  // 方法 2 の client_id は、アプリの中の定数（GOOGLE_CLIENT_ID）。Firebase には聞かないので、ここに来たら数える（偽の返事は、前の値のまま。使われたら、すぐ分かる）
  await page.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:createAuthUri/, (route) => {
    fake.authUriCalls++;
    return json(route, { authUri: 'https://accounts.google.com/o/oauth2/auth?client_id=test-client.apps.googleusercontent.com' });
  });
  await page.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, (route) => json(route, { kind: 'identitytoolkit#GetAccountInfoResponse', users: [{ localId: 'uid1', lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] }));
  await page.route(/securetoken\.googleapis\.com\/v1\/token/, (route) => json(route, { access_token: idToken('uid1'), id_token: idToken('uid1'), expires_in: '3600', token_type: 'Bearer', refresh_token: 'refresh-1', user_id: 'uid1', project_id: '389373249780' }));
  if (functions === 'down') return fake;
  await page.route(`${FUNCTIONS}/studio`, (route) => {
    if (functions === 'missing') return json(route, { error: { status: 'NOT_FOUND', message: 'Not Found' } }, 404);
    const data = (route.request().postDataJSON() as { data: Record<string, unknown> }).data;
    fake.calls.push({ op: String(data.op), auth: route.request().headers()['authorization'] });
    switch (data.op) {
      case 'signIn':
        // 前の版のサーバーは、版（api）を返さない
        return json(route, { result: functions === 'old' ? { user } : { user, api: 2 } });
      case 'jobs':
        return json(route, { result: { jobs: started && !acked ? [job()] : [], user } });
      case 'ack':
        acked = true;
        return json(route, { result: { ok: true } });
      case 'items':
        return json(route, { result: { items: done ? [item()] : [] } });
      case 'startJob':
        if (data.theme === 'だめ') return json(route, { error: { status: 'FAILED_PRECONDITION', message: 'チケットが足りません（のこり 0 枚、必要 1 枚）', details: { code: 'no-tickets' } } }, 400);
        dollId = String(data.dollId);
        started = true;
        user.tickets -= 1;
        return json(route, { result: { jobId: 'j1', cost: 1, user } });
      case 'job':
        return json(route, { result: { job: job(), user } });
      case 'itemFiles':
        return json(route, { result: { item: item(), files } });
      default:
        return json(route, { error: { status: 'FAILED_PRECONDITION', message: '呼び出しの形が正しくありません', details: { code: 'refused' } } }, 400);
    }
  });
  return fake;
}

test.describe('アプリの中のスタジオ（本物の裏側。Firebase は偽の返事）', () => {
  test('匿名のログインをして、関数を呼ぶ: チケットの残りと利用者コードが出る。作る → チケットの演出 → できたら、自分の服に入る。開き直しても、同じ利用者', async ({ page }) => {
    const fake = await fakeFirebase(page);
    await openStudio(page);
    await expect(page.getByTestId('studio-tickets')).toContainText('のこり 2 枚');
    await expect(page.getByTestId('studio-user-code')).toHaveText('ABCD2345');
    await expect(page.getByTestId('studio-demo')).toHaveCount(0); // 確認用（偽物）の知らせは、出ない
    expect(fake.signUps).toBe(1);
    // 関数は、ログインした利用者の印（ID トークン）を付けて呼ばれる
    expect(fake.calls[0]).toMatchObject({ op: 'signIn' });
    expect(fake.calls[0].auth).toMatch(/^Bearer ey/);

    // サーバーが理由つきで断ったら、注文を受けられなかったと出て、その文章を出す
    await chooseTarget(page, 'トップス');
    await themeAndCheck(page, 'だめ');
    await page.getByTestId('studio-make').click();
    await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'refused', { timeout: 10_000 });
    await expect(page.getByTestId('order-show')).toContainText('チケットは つかっていません。');
    await expect(page.getByTestId('order-reason')).toHaveText('チケットが足りません（のこり 0 枚、必要 1 枚）');
    await page.getByTestId('order-back').click();
    await expect(page.getByTestId('studio-tickets')).toContainText('のこり 2 枚');

    // さいごの段のまま: テーマの段へもどって、入れ直す
    await page.getByTestId('studio-summary').getByText('「だめ」').click();
    await themeAndCheck(page, 'うみ');
    await page.getByTestId('studio-make').click();
    await expect(page.getByTestId('order-ticket-count')).toHaveText('チケット 1 まい つかいました（のこり 1 まい）', { timeout: 10_000 });
    await page.getByTestId('order-ok').click();
    await expect(page.getByTestId('studio-tickets')).toContainText('のこり 1 枚');
    await expect(page.getByTestId('studio-job')).toHaveCount(1);
    // アプリは、「進める」を呼ばない（サーバーの列が進める）。進み具合を聞くだけ
    await expect.poll(() => fake.calls.some((c) => c.op === 'jobs')).toBe(true);
    fake.finish();
    await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
    // できた服は、絵ごと端末に取り込まれる
    await expect.poll(() => fake.calls.filter((c) => c.op === 'itemFiles').length).toBe(1);
    // 届いた演出が出る。閉じると、サーバーに「見た」の印を付ける
    await expect(page.getByTestId('reveal')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('reveal-name')).toHaveText('うみのトップス');
    await page.getByTestId('reveal-close').click();
    await expect.poll(() => fake.calls.some((c) => c.op === 'ack')).toBe(true);

    // 開き直す: ログインはやり直さない（同じ利用者）。服は、端末の控えから出る（絵を取り直さない）
    const before = fake.calls.length;
    await openStudio(page);
    await expect(page.getByTestId('studio-user-code')).toHaveText('ABCD2345');
    expect(fake.signUps).toBe(1);
    await expect.poll(() => fake.calls.slice(before).map((c) => c.op)).toEqual(expect.arrayContaining(['signIn', 'jobs', 'items']));
    expect(fake.calls.slice(before).map((c) => c.op)).not.toContain('itemFiles');
    // ゲームのメニューにも入っている
    await page.getByTestId('studio-close').click();
    await page.getByTestId('home-play').click();
    await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
    await expect(page.locator('img[alt="うみのトップス"]').first()).toBeVisible();
  });

  test('前の版のサーバー（列で進めない）につないだときは、「サーバーが古い版です」と出て、作る欄は出ない', async ({ page }) => {
    await fakeFirebase(page, 'old');
    await openStudio(page);
    await expect(page.getByTestId('studio-problem')).toContainText('サーバーが古い版です');
    await expect(page.getByTestId('studio-problem')).toContainText('作者が載せ直す必要があります');
    await expect(page.getByTestId('studio-make')).toHaveCount(0);
  });

  test('サーバーの関数がまだ載っていないときは、「準備ができていません」と出る（作る欄は出ない）', async ({ page }) => {
    await fakeFirebase(page, 'missing');
    await openStudio(page);
    await expect(page.getByTestId('studio-problem')).toContainText('準備ができていません');
    await expect(page.getByTestId('studio-make')).toHaveCount(0);
  });

  test('サーバーから返事が無いとき（届かない。関数がまだ載っていないときも、こう見える）は、「返事がありません」と出る（通信のせいにしない）。ゲームは、そのまま遊べる', async ({ page }) => {
    await fakeFirebase(page, 'down');
    await openStudio(page);
    await expect(page.getByTestId('studio-problem')).toContainText('サーバーから返事がありません');
    await expect(page.getByTestId('studio-problem')).toContainText('準備ができていないかもしれません');
    await expect(page.getByTestId('studio-problem')).not.toContainText('インターネット');
    await expect(page.getByTestId('studio-make')).toHaveCount(0);
    await page.getByTestId('studio-close').click();
    await page.getByTestId('home-play').click();
    await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  });

  test('「アカウント」の欄: 準備が済むと 2 つのボタンが押せる（ログイン前）。方法 2 は、定数の client_id（GOOGLE_CLIENT_ID）を付けて accounts.google.com へ移る（Google へは、通信を出さない）', async ({ page }) => {
    const fake = await fakeFirebase(page);
    // Google の画面への移動は、ここで受け止めて、空のページを返す
    const moved: string[] = [];
    await page.route(/^https:\/\/accounts\.google\.com\//, (route) => {
      moved.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>google</title>' });
    });
    await openStudio(page);
    await expect(page.getByTestId('account-section')).toBeVisible();
    await page.getByTestId('account-summary').click(); // たたんであるのを開く
    await expect(page.getByTestId('account-login-popup')).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('account-login-redirect')).toBeEnabled();
    await expect(page.getByTestId('account-email')).toHaveCount(0);
    await expect(page.getByTestId('account-message')).toHaveCount(0);

    await page.getByTestId('account-login-redirect').click();
    await expect.poll(() => moved.length, { timeout: 15_000 }).toBe(1);
    const url = new URL(moved[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4173/DressUpGame/');
    expect(url.searchParams.get('response_type')).toBe('id_token');
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    // client_id を聞きに、Firebase へは行かない。Google へ出た通信も、この移動の 1 回だけ
    expect(fake.authUriCalls).toBe(0);
    expect(moved).toHaveLength(1);
  });
});
