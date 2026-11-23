/**
 * きろく（端末の上で起きたことの覚え書き）
 *
 * 作者の端末でしか起きない不具合を調べるためのもの。警告・エラー・描画の節目を、新しい順に少しだけ覚えておく。
 * 端末にも残すので、落ちて開き直ったあとでも、前の回の最後の行を読める。
 * 版数を 5 回押して、あいことば「log」で画面に出す（App.tsx）。外へは送らない。
 */
const KEY = 'dressup_diag';
const MAX_LINES = 120;
const MAX_LENGTH = 300;
const BURST = 10; // 1 秒に、すぐ残す回数
const SAVE_GAP_MS = 300;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
type ConsoleLike = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
type EventTargetLike = { addEventListener: (type: string, listener: (event: unknown) => void) => void };

export interface Diag {
  note: (kind: string, ...parts: unknown[]) => void;
  lines: () => string[]; // 今回（開いてから）の行
  previous: () => string[]; // 前の回の行
  install: (console: ConsoleLike, target: EventTargetLike) => void;
}

function textOf(part: unknown): string {
  if (part instanceof Error) return `${part.name}: ${part.message}`;
  if (typeof part === 'string') return part;
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}

export function createDiag(options: { storage?: Store | null; now?: () => number; max?: number } = {}): Diag {
  const now = options.now ?? (() => Date.now());
  const max = options.max ?? MAX_LINES;
  const storage = options.storage ?? null;
  const started = now();
  const current: string[] = [];
  let before: string[] = [];
  try {
    const saved: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    if (Array.isArray(saved)) before = saved.filter((line): line is string => typeof line === 'string');
  } catch {
    // 読めなければ、前の回は無し
  }

  // 端末に残す。ふだんは、1 行ごとにすぐ残す（落ちる直前の行が、いちばん大事）。
  // 1 秒に何行も続いたとき（警告が止まらない、など）だけ、まとめて残す（アプリを重くしない）
  let recent: number[] = [];
  let pending: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    pending = null;
    recent.push(now());
    try {
      storage?.setItem(KEY, JSON.stringify(current));
    } catch {
      // 残せなくても動く
    }
  };
  const save = () => {
    if (!storage || pending) return;
    const t = now();
    recent = recent.filter((at) => t - at < 1000);
    if (recent.length < BURST) write();
    else pending = setTimeout(write, SAVE_GAP_MS);
  };

  const note = (kind: string, ...parts: unknown[]) => {
    try {
      const seconds = ((now() - started) / 1000).toFixed(1);
      current.push([seconds, kind, ...parts.map(textOf)].join(' ').slice(0, MAX_LENGTH));
      if (current.length > max) current.splice(0, current.length - max);
      save();
    } catch {
      // きろくのせいで、アプリを止めない
    }
  };

  return {
    note,
    lines: () => [...current],
    previous: () => [...before],
    install: (console, target) => {
      const warn = console.warn;
      const error = console.error;
      console.warn = (...args: unknown[]) => {
        note('warn', ...args);
        warn.apply(console, args);
      };
      console.error = (...args: unknown[]) => {
        note('error', ...args);
        error.apply(console, args);
      };
      target.addEventListener('error', (event) => {
        const e = (event ?? {}) as { message?: string; filename?: string; lineno?: number };
        note('uncaught', e.message ?? '', `${e.filename ?? ''}:${e.lineno ?? ''}`);
      });
      target.addEventListener('unhandledrejection', (event) => {
        note('rejection', ((event ?? {}) as { reason?: unknown }).reason);
      });
    },
  };
}

export interface DiagEnv {
  version: string;
  userAgent: string;
  standalone: boolean;
  viewport: string;
  gl: unknown;
}

// 画面に出す・写して送る文
export function diagReport(diag: Diag, env: DiagEnv): string {
  return [
    `きせかえ v${env.version}`,
    env.userAgent,
    `standalone: ${env.standalone} / ${env.viewport}`,
    `gl: ${textOf(env.gl)}`,
    '--- 前の回 ---',
    ...diag.previous(),
    '--- 今回 ---',
    ...diag.lines(),
  ].join('\n');
}

function safeStorage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// アプリ全体で 1 つ
export const diag = createDiag({ storage: safeStorage() });

// ほうこく: きろくを、このリポジトリの「新しい Issue」に入れて開く URL。
// 作者が GitHub で「Submit new issue」を押すと、リポジトリに残り、開発の側から読める（写して送らなくてよい）。
// きろくに入るのは、端末の種類・画面の大きさ・描画の状態・警告・着せた服のカテゴリ。名前やアカウントは入らない
export const REPORT_REPO = 'Kake-git-hub/DressUpGame';
const REPORT_URL_MAX = 7000; // GitHub が受け取れる URL の長さ（約 8000）より短く
const REPORT_HEAD_LINES = 4; // 版・端末・画面・描画の状態
const TITLE_NOTE_MAX = 40;

export function reportIssueUrl(report: string, note: string, version: string, maxLength = REPORT_URL_MAX): string {
  const said = note.trim();
  const short = said.length > TITLE_NOTE_MAX ? `${said.slice(0, TITLE_NOTE_MAX)}…` : said;
  const title = `[きろく] v${version} ${short || 'ほうこく'}`;
  const lines = report.split('\n');
  const head = lines.slice(0, REPORT_HEAD_LINES);
  const rest = lines.slice(REPORT_HEAD_LINES);
  const build = (dropped: number) => {
    const kept = dropped > 0 ? [`（古い ${dropped} 行は省略）`, ...rest.slice(dropped)] : rest;
    const body = `${said ? `${said}\n\n` : ''}\`\`\`\n${[...head, ...kept].join('\n')}\n\`\`\`\n`;
    return `https://github.com/${REPORT_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  };
  // 長すぎたら、古い行から省く（最後の行は残す）
  let dropped = 0;
  let url = build(0);
  while (url.length > maxLength && dropped < rest.length - 1) {
    dropped += Math.max(1, Math.ceil((rest.length - dropped) / 8));
    url = build(Math.min(dropped, rest.length - 1));
  }
  return url;
}
