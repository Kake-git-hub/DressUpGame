/**
 * 口の偽物（?studio=fake）のテスト: 入れ替えの本体は fakeBackend 側。ここは、口の動きと、にせの「画面を移る」。
 */
import { describe, expect, it, vi } from 'vitest';
import { createFakeAuthPort, FAKE_EMAIL, fakeGoTo } from '../cloud/fakeAuth';
import { buildAuthUrl, nonceOf, parseReturn, subOf } from '../cloud/googleRedirect';

const world = (google = false) => ({ link: vi.fn(), signin: vi.fn(), signOut: vi.fn(), isGoogle: vi.fn(() => google) });

describe('createFakeAuthPort', () => {
  it('current: Google に結び付いていれば、にせのメールアドレス', () => {
    expect(createFakeAuthPort(world(false), {}).current()).toEqual({ kind: 'guest' });
    expect(createFakeAuthPort(world(true), {}).current()).toEqual({ kind: 'google', email: FAKE_EMAIL });
  });
  it('popup・withToken: link は world.link、signin は world.signin', async () => {
    const w = world();
    const port = createFakeAuthPort(w, {});
    await port.popup('link');
    await port.withToken('link', 't', 'n');
    expect(w.link).toHaveBeenCalledTimes(2);
    await port.popup('signin');
    await port.withToken('signin', 't', 'n');
    expect(w.signin).toHaveBeenCalledTimes(2);
  });
  it('popup は、呼ばれたその場で world を動かす（await の前）', () => {
    const w = world();
    void createFakeAuthPort(w, {}).popup('link');
    expect(w.link).toHaveBeenCalledTimes(1);
  });
  it('loginFail: どちらも、その code で落ちる。world は動かない', async () => {
    const w = world();
    const port = createFakeAuthPort(w, { loginFail: 'auth/popup-blocked' });
    await expect(port.popup('link')).rejects.toMatchObject({ code: 'auth/popup-blocked' });
    await expect(port.withToken('signin', 't', 'n')).rejects.toMatchObject({ code: 'auth/popup-blocked' });
    expect(w.link).not.toHaveBeenCalled();
    expect(w.signin).not.toHaveBeenCalled();
  });
  it('googleTaken: link だけ、いつも「もう使われている」', async () => {
    const w = world();
    const port = createFakeAuthPort(w, { googleTaken: true });
    await expect(port.popup('link')).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
    await expect(port.withToken('link', 't', 'n')).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
    expect(w.link).not.toHaveBeenCalled();
    await port.popup('signin');
    expect(w.signin).toHaveBeenCalledTimes(1);
  });
  it('signOut は world.signOut。clientId は fake-client', async () => {
    const w = world();
    const port = createFakeAuthPort(w, {});
    await port.signOut();
    expect(w.signOut).toHaveBeenCalledTimes(1);
    expect(await port.clientId()).toBe('fake-client');
  });
});

describe('signInWithStashed（断りと一緒に返る証明で入る、のまね）', () => {
  it('既定: 世界の「入る」をして true', async () => {
    const w = world();
    expect(await createFakeAuthPort(w, {}).signInWithStashed()).toBe(true);
    expect(w.signin).toHaveBeenCalledTimes(1);
  });
  it('stashed が false: 何もせず false（証明が返らなかったまね）', async () => {
    const w = world();
    expect(await createFakeAuthPort(w, { stashed: false }).signInWithStashed()).toBe(false);
    expect(w.signin).not.toHaveBeenCalled();
    expect(w.link).not.toHaveBeenCalled();
  });
});

describe('fakeGoTo（にせの「画面を移る」）', () => {
  const url = buildAuthUrl({ clientId: 'fake-client', redirectUri: 'http://localhost/app/', state: 'st1', nonce: 'nn1' });
  const win = () => {
    const location = { hash: '', search: '?studio=fake&home=0', reload: vi.fn() };
    return { location } as unknown as Pick<Window, 'location'> & { location: typeof location };
  };

  it('state と nonce を引き継いだ戻りの # を付けて、読み込み直す。search は変えない', () => {
    const w = win();
    fakeGoTo(url, w, {});
    const back = parseReturn(w.location.hash);
    expect(back).toMatchObject({ state: 'st1' });
    expect(nonceOf(back!.idToken!)).toBe('nn1');
    expect(w.location.reload).toHaveBeenCalledTimes(1);
    expect(w.location.search).toBe('?studio=fake&home=0');
  });
  it('にせの証明には、sub（fake-sub）も入る', () => {
    const w = win();
    fakeGoTo(url, w, {});
    const token = parseReturn(w.location.hash)!.idToken!;
    expect(subOf(token)).toBe('fake-sub');
    expect(nonceOf(token)).toBe('nn1');
  });
  it('prompt=none で silentFail: interaction_required の戻り。silentFail でも、選ぶ画面つきなら、ふつうに戻る', () => {
    const silentUrl = buildAuthUrl({ clientId: 'fake-client', redirectUri: 'http://localhost/app/', state: 'st2', nonce: 'nn2', prompt: 'none', loginHint: 'fake-sub' });
    const failing = win();
    fakeGoTo(silentUrl, failing, { silentFail: true });
    expect(parseReturn(failing.location.hash)).toEqual({ state: 'st2', error: 'interaction_required' });
    expect(failing.location.reload).toHaveBeenCalledTimes(1);
    const working = win();
    fakeGoTo(silentUrl, working, {});
    expect(parseReturn(working.location.hash)).toMatchObject({ state: 'st2' });
    expect(parseReturn(working.location.hash)!.idToken).toBeDefined();
    const chooser = win();
    fakeGoTo(url, chooser, { silentFail: true });
    expect(parseReturn(chooser.location.hash)!.idToken).toBeDefined();
  });
  it('access_denied: 戻りは error になる', () => {
    const w = win();
    fakeGoTo(url, w, { loginFail: 'access_denied' });
    expect(parseReturn(w.location.hash)).toEqual({ state: 'st1', error: 'access_denied' });
    expect(w.location.reload).toHaveBeenCalledTimes(1);
  });
});
