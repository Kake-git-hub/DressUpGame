/**
 * 支払いのページから戻ってきたときの、URL の読み取りと、支払いの番号の覚え
 *
 * 戻りは `?pay=done&session=…`（払った）・`?pay=cancel`（やめた）・`?pay=fake&session=…`（にせの支払いページ。偽物の裏側のときだけ）。
 * 読んだら URL から消す（Google の戻りと同じやり方）。支払いの番号は、ページを移る前に端末に覚え、足されたことが分かったら忘れる。
 */
export type PayReturn = { kind: 'done'; session: string } | { kind: 'cancel' } | { kind: 'fake'; session: string };

const PENDING_KEY = 'dressup_pay_pending';
// 支払いの番号として通す形（Stripe の cs_… と、偽物の fake-pay-…）
const SESSION_RE = /^[A-Za-z0-9_-]{1,200}$/;

export function readPayReturn(search: string): PayReturn | null {
  try {
    const params = new URLSearchParams(search);
    const kind = params.get('pay');
    const session = params.get('session') ?? '';
    if (kind === 'cancel') return { kind: 'cancel' };
    if ((kind === 'done' || kind === 'fake') && SESSION_RE.test(session)) return { kind, session };
  } catch {
    // 読めなければ、戻りではない
  }
  return null;
}

// 戻りの引数（pay・session）だけを URL から消す。ほかの引数は残す
export function clearPayReturn(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('pay') && !url.searchParams.has('session')) return;
    url.searchParams.delete('pay');
    url.searchParams.delete('session');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // URL を直せなくても、動く
  }
}

export function rememberSession(id: string): void {
  try {
    localStorage.setItem(PENDING_KEY, id);
  } catch {
    // 覚えられなくても、戻りの URL に番号がある
  }
}

export function pendingSession(): string | null {
  try {
    const id = localStorage.getItem(PENDING_KEY);
    return id && SESSION_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function forgetSession(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // 消せなくても動く
  }
}
