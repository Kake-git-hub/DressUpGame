/**
 * E2Eテスト: アプリの中のスタジオを、本物の裏側（Firebase）につないだときの動き（?studio=1）。
 *
 * 本物の Firebase には、つながない。ブラウザから出ていく通信（匿名のログイン・サーバーの関数）を、ここで受けて、決めた返事を返す。
 * 確かめること: ブラウザの中で Firebase の部品が動く・ログインが 1 回で済む・関数の呼び方・画面の出方・つながらないときの知らせ。
 * サーバーの関数そのものは、エミュレーターのテスト（npm run firebase:test）で確かめる。
 */
import sharp from 'sharp';
import { test, expect, type Page, type Route } from '@playwright/test';

const REAL = '/DressUpGame/?content=e2e-content/&studio=1';
const FUNCTIONS = 'https://asia-northeast1-dressup-game-89f6e.cloudfunctions.net';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const COLOR = { r: 224, g: 64, b: 160 };

const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function answerOf(question: string): number {
  const m = /^(十)?([一二三四五六七八九])?\s*かける\s*([二三四五六七八九])/.exec(question.trim());
  if (!m) throw new Error(`問いを読めません: ${question}`);
  return ((m[1] ? 10 : 0) + (m[2] ? KANJI[m[2]] : 0)) * KANJI[m[3]];
}
async function openStudio(page: Page) {
  await page.goto(REAL);
  await expect(page.getByTestId('studio-button')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('studio-button').click();
  await page.getByTestId('adult-answer').fill(String(answerOf((await page.getByTestId('adult-question').textContent()) ?? '')));
  await page.getByTestId('adult-18').check();
  await page.getByTestId('adult-open').click();
  await expect(page.getByTestId('app-studio')).toBeVisible();
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
  runs: string[];
  finish(): void;
}
/**
 * Firebase の偽の返事を用意する。functions: 'ok' = 関数が動く、'missing' = 関数が無いと読める返事（404）、'down' = 届かない。
 * 本物では、関数がまだ載っていないときの返事は、ブラウザからは読めない見込み（ほかのサイトから読んでよいという印が付かない）。
 * そのときアプリからは 'down' と同じに見える（この道具では、読めない返事をまねできないので、'down' で確かめる）。
 */
async function fakeFirebase(page: Page, functions: 'ok' | 'missing' | 'down' = 'ok'): Promise<Fake> {
  const png = (await sharp({ create: { width: 240, height: 200, channels: 4, background: { ...COLOR, alpha: 1 } } }).png().toBuffer()).toString('base64');
  const webp = (await sharp({ create: { width: 240, height: 200, channels: 4, background: { ...COLOR, alpha: 1 } } }).webp().toBuffer()).toString('base64');
  const user = { userCode: 'ABCD2345', tickets: 2, admin: false };
  let done = false;
  let dollId = '';
  let kept = false;
  const fake: Fake = { calls: [], signUps: 0, runs: [], finish: () => (done = true) };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  const job = () => ({
    id: 'j1',
    dollId,
    done,
    tickets: 1,
    createdAt: 1,
    stalled: false,
    candidates: [{ index: 0, name: 'うみのトップス', categoryId: 'トップス', status: kept ? 'kept' : done ? 'done' : 'working', notes: [], ...(done ? { preview: { canvasW: 1024, canvasH: 1024, box: { x: 392, y: 300, w: 240, h: 200 } } } : {}) }],
  });
  const item = () => ({ id: 'my:j1-0', dollId, item: { id: 'my:j1-0', name: 'うみのふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 1024, canvasH: 1024, box: { x: 392, y: 300, w: 240, h: 200 } }, thumb: 'files/t.webp' }, createdAt: 5 });
  const files = { 'files/a.webp': webp, 'files/t.webp': webp };

  // ここで受けていない Google 宛ての通信は、外に出さない（本物の Firebase に、テストの利用者を作らない）
  await page.route(/googleapis\.com|cloudfunctions\.net|firebaseio\.com|firebaseapp\.com/, (route) => route.abort());
  await page.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:signUp/, (route) => {
    fake.signUps++;
    return json(route, { kind: 'identitytoolkit#SignupNewUserResponse', idToken: idToken('uid1'), refreshToken: 'refresh-1', expiresIn: '3600', localId: 'uid1' });
  });
  await page.route(/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, (route) => json(route, { kind: 'identitytoolkit#GetAccountInfoResponse', users: [{ localId: 'uid1', lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] }));
  await page.route(/securetoken\.googleapis\.com\/v1\/token/, (route) => json(route, { access_token: idToken('uid1'), id_token: idToken('uid1'), expires_in: '3600', token_type: 'Bearer', refresh_token: 'refresh-1', user_id: 'uid1', project_id: '389373249780' }));
  if (functions === 'down') return fake;
  await page.route(`${FUNCTIONS}/studioRun`, (route) => {
    if (functions === 'missing') return json(route, { error: { status: 'NOT_FOUND', message: 'Not Found' } }, 404);
    fake.runs.push(String((route.request().postDataJSON() as { data: { jobId: string } }).data.jobId));
    return json(route, { result: { ok: true } });
  });
  await page.route(`${FUNCTIONS}/studio`, (route) => {
    if (functions === 'missing') return json(route, { error: { status: 'NOT_FOUND', message: 'Not Found' } }, 404);
    const data = (route.request().postDataJSON() as { data: Record<string, unknown> }).data;
    fake.calls.push({ op: String(data.op), auth: route.request().headers()['authorization'] });
    switch (data.op) {
      case 'signIn':
        return json(route, { result: { user } });
      case 'jobs':
        return json(route, { result: { jobs: [], user } });
      case 'items':
        return json(route, { result: { items: kept ? [item()] : [] } });
      case 'startJob':
        if (data.theme === 'だめ') return json(route, { error: { status: 'FAILED_PRECONDITION', message: 'チケットが足りません（のこり 0 枚、必要 1 枚）', details: { code: 'no-tickets' } } }, 400);
        dollId = String(data.dollId);
        user.tickets -= 1;
        return json(route, { result: { jobId: 'j1', cost: 1, user } });
      case 'job':
        return json(route, { result: { job: job(), user } });
      case 'preview':
        return json(route, { result: { data: png, contentType: 'image/png' } });
      case 'keep':
        kept = true;
        return json(route, { result: { item: { ...item(), item: { ...item().item, name: String(data.name) } }, files, user } });
      case 'itemFiles':
        return json(route, { result: { item: item(), files } });
      default:
        return json(route, { error: { status: 'FAILED_PRECONDITION', message: '呼び出しの形が正しくありません', details: { code: 'refused' } } }, 400);
    }
  });
  return fake;
}

test.describe('アプリの中のスタジオ（本物の裏側。Firebase は偽の返事）', () => {
  test('匿名のログインをして、関数を呼ぶ: チケットの残りと利用者コードが出る。作る → できた絵 → 使う → 自分の服に入る。開き直しても、同じ利用者', async ({ page }) => {
    const fake = await fakeFirebase(page);
    await openStudio(page);
    await expect(page.getByTestId('studio-tickets')).toContainText('のこり 2 枚');
    await expect(page.getByTestId('studio-user-code')).toHaveText('ABCD2345');
    await expect(page.getByTestId('studio-demo')).toHaveCount(0); // 確認用（偽物）の知らせは、出ない
    expect(fake.signUps).toBe(1);
    // 関数は、ログインした利用者の印（ID トークン）を付けて呼ばれる
    expect(fake.calls[0]).toMatchObject({ op: 'signIn' });
    expect(fake.calls[0].auth).toMatch(/^Bearer ey/);

    // サーバーが理由つきで断ったら、その文章を出す
    await page.getByTestId('studio-target').selectOption({ label: 'トップス' });
    await page.getByTestId('studio-theme').fill('だめ');
    await page.getByTestId('studio-make').click();
    await expect(page.getByTestId('studio-error')).toContainText('チケットが足りません（のこり 0 枚、必要 1 枚）');

    await page.getByTestId('studio-theme').fill('うみ');
    await page.getByTestId('studio-make').click();
    await expect(page.getByTestId('studio-tickets')).toContainText('のこり 1 枚');
    await expect(page.getByTestId('studio-candidate')).toHaveCount(1);
    await expect.poll(() => fake.runs).toEqual(['j1']); // 「進める」を頼んだ
    await expect(page.getByTestId('studio-keep')).toHaveCount(0); // まだ作成中
    fake.finish();
    await expect(page.getByTestId('studio-keep')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-preview]')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await page.getByTestId('studio-keep').click();
    await expect(page.getByTestId('studio-my-item')).toHaveCount(1);
    await expect(page.getByTestId('studio-my-item')).toContainText('うみのトップス');
    await expect(page.getByTestId('studio-candidate')).toHaveCount(0);

    // 開き直す: ログインはやり直さない（同じ利用者）。服は、端末の控えから出る（絵を取り直さない）
    const before = fake.calls.length;
    await openStudio(page);
    await expect(page.getByTestId('studio-user-code')).toHaveText('ABCD2345');
    await expect(page.getByTestId('studio-my-item')).toHaveCount(1);
    expect(fake.signUps).toBe(1);
    await expect.poll(() => fake.calls.slice(before).map((c) => c.op)).toEqual(expect.arrayContaining(['signIn', 'jobs', 'items']));
    expect(fake.calls.slice(before).map((c) => c.op)).not.toContain('itemFiles');
    // ゲームのメニューにも入っている
    await page.getByTestId('studio-close').click();
    await page.locator('.palette-section button', { hasText: 'トップス' }).click();
    await expect(page.locator('img[alt="うみのトップス"]').first()).toBeVisible();
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
    await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible();
  });
});
