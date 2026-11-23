/**
 * ログインの口（AuthPort）の偽物（`?studio=fake`。開発・テスト・E2E 用）
 *
 * 段取り（account.ts）は本物と同じものを通る。ここは、Firebase の代わりに、利用者の入れ替え（world。fakeBackend.ts が持つ）を動かすだけ。
 */
import type { AccountInfo, AuthPort } from './account';
import type { LoginIntent } from './googleRedirect';

export const FAKE_EMAIL = 'tameshi@example.com';

// 利用者の入れ替え（fakeBackend.ts が実装する）。link は「もう使われている」ときに、{ code: 'auth/credential-already-in-use' } を投げる
export interface FakeWorld {
  link(): void;
  signin(): void;
  signOut(): void;
  isGoogle(): boolean;
}

export function createFakeAuthPort(world: FakeWorld, options: { loginFail?: string; googleTaken?: boolean }): AuthPort {
  // 呼ばれた、その場で動かす（本物の popup と同じく、何も待たない）
  const run = (intent: LoginIntent): Promise<void> => {
    try {
      if (options.loginFail) throw { code: options.loginFail };
      if (intent === 'link' && options.googleTaken) throw { code: 'auth/credential-already-in-use' };
      if (intent === 'link') world.link();
      else world.signin();
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return {
    current: (): AccountInfo => (world.isGoogle() ? { kind: 'google', email: FAKE_EMAIL } : { kind: 'guest' }),
    popup: (intent) => run(intent),
    withToken: (intent) => run(intent),
    signOut: async () => world.signOut(),
    clientId: async () => 'fake-client',
  };
}

const b64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// にせの「Google の画面」: Google へ移る URL から state と nonce を読み、戻りの # を付けて、読み込み直す（いまの search は変えない）
export function fakeGoTo(url: string, win: Pick<Window, 'location'>, options: { loginFail?: string }): void {
  const params = new URL(url).searchParams;
  const state = params.get('state') ?? '';
  const nonce = params.get('nonce') ?? '';
  win.location.hash = options.loginFail === 'access_denied' ? `#error=access_denied&state=${state}` : `#state=${state}&id_token=x.${b64url(JSON.stringify({ nonce, email: FAKE_EMAIL }))}.x`;
  win.location.reload();
}
