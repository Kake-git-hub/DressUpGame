/**
 * アプリの中のスタジオ（つくる）: 「何を作るか・テーマ・絵柄」を選んで、服を注文する。
 * 大人（保護者）が使う画面なので、入力の欄は漢字かな交じり。注文の演出は、子どもが横で見ていても分かる言葉。
 *
 * チケット・生成・保存は、サーバーが行う。「作る」の返事が返ったあとは、この画面を閉じても、アプリを閉じても、
 * サーバーが最後まで作り、できた服は自動でクローゼットに入る（届いた知らせは、つなぎ役 = session が出す）。
 *
 * 遊ぶ画面の上に重ねる幕ではなく、ひとつの画面（ホームから開き、閉じるとホームにもどる）。
 * 説明の文は置かない（絵とボタンだけで進める）。チケットの残りは、売っているときは、買う入口のリンクになる（v0.48.0）。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BACKGROUND_CATEGORY, BACKGROUND_LABEL, BackendError, SET_MAX, SET_MIN, THEME_MAX, ticketCost } from '../cloud/backend';
import type { StudioTarget } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';
import type { ManifestCategory } from '../content/manifest';
import { isBackHairCategory } from '../pipeline/hairSplit';
import { DEFAULT_STYLE_ID, STYLE_PRESETS } from '../studio/stylePresets';
import type { BackgroundData, ClothingItemData, DollData } from '../types';
import { formatJstDate } from '../cloud/expiry';
import { GiftTickets } from './GiftTickets';
import { Account } from './Account';
import { AdultGate } from './AdultGate';
import { jobNotice } from './jobNotice';
import { OrderShow } from './OrderShow';
import type { OrderPhase, ShopArt } from './OrderShow';
import type { PayReturn } from './payReturn';
import { Shop } from './Shop';
import { RETURN_TEXT, usePay } from './usePay';
import './shop.css';

interface Props {
  session: CloudSession;
  library: Library; // 端末の中の自分の服（ログアウトのとき、このアカウントの服を外す）
  dolls: DollData[]; // ゲームに出ているドール
  categoriesByDoll: Record<string, ManifestCategory[]>;
  clothing?: ClothingItemData[]; // 服の一覧（カテゴリの絵に、先頭の服のサムネイルを使う）
  backgrounds?: BackgroundData[]; // 背景の一覧（「はいけい」の絵に、そのドールの先頭の背景のサムネイルを使う）
  initialDollId: string; // 最初に選んでおくドール（最後に遊んだドール）
  onClose: () => void;
  demo?: boolean; // 確認用（偽物の裏側）。絵は色の四角で、チケットもにせもの
  art?: ShopArt;
  payReturn?: PayReturn | null; // 支払いのページから戻ってきたとき（?pay=done / cancel）
}

const SET = '__set';
const BG = BACKGROUND_CATEGORY;
// 注文の演出を出しておく、いちばん短い時間（返事が早くても、何が起きたかが分かるように）
const ORDER_MIN_MS = 1500;
const NO_CATEGORIES: ManifestCategory[] = [];
const NO_CLOTHING: ClothingItemData[] = [];
const NO_BACKGROUNDS: BackgroundData[] = [];
const clock = () => Date.now();
const isFaceLabel = (label: string) => /かお|顔|face|メイク|makeup/i.test(label);
const messageOf = (e: unknown) => (e instanceof BackendError || e instanceof Error ? e.message : String(e));
type Step = 'doll' | 'what' | 'theme' | 'style' | 'check';
const STEP_TITLE: Record<Step, string> = {
  doll: 'どの子に 作る？',
  what: 'なにを 作る？',
  theme: 'どんな テーマ？',
  style: 'どんな 絵に する？',
  check: 'これで 作る？',
};
// テーマの例（タップで入る）
const THEME_IDEAS = [
  { emoji: '🌊', word: 'うみ' },
  { emoji: '👑', word: 'おひめさま' },
  { emoji: '🍰', word: 'おかし' },
  { emoji: '🌸', word: 'さくら' },
  { emoji: '⭐', word: 'ほし' },
  { emoji: '❄️', word: 'ゆき' },
  { emoji: '🐰', word: 'うさぎ' },
  { emoji: '🎃', word: 'ハロウィン' },
  { emoji: '🎄', word: 'クリスマス' },
  { emoji: '🦄', word: 'ユニコーン' },
];
const STYLE_EMOJI: Record<string, string> = { anime: '✨', manga: '✒️', real: '📷', pastel: '🦄', picturebook: '🎨', pop: '🍭' };
// カテゴリの絵（そのカテゴリの先頭の服のサムネイル）。無ければ、名前の 1 文字め
function Thumb({ src, label }: { src: string | undefined; label: string }) {
  return src ? <img className="studio-thumb" src={src} alt="" draggable={false} /> : <span className="studio-thumb studio-thumb-none" aria-hidden="true">{label.slice(0, 1)}</span>;
}
const NOTICE = {
  waiting: '順番を待っています…',
  working: '作っています…（1 分くらい）',
  crowded: 'こみあっています。できたら、クローゼットに入ります。',
};

export function AppStudio({ session, library, dolls, categoriesByDoll, clothing = NO_CLOTHING, backgrounds = NO_BACKGROUNDS, initialDollId, onClose, demo = false, art, payReturn = null }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { user } = state;
  const [dollId, setDollId] = useState(() => (dolls.some((d) => d.id === initialDollId) ? initialDollId : (dolls[0]?.id ?? '')));
  const doll = dolls.find((d) => d.id === dollId) ?? dolls[0];
  // うしろがみは、髪と一緒にできるので、選べない
  const targets = useMemo(
    () => [...(categoriesByDoll[doll?.id ?? ''] ?? NO_CATEGORIES)].filter((c) => !isBackHairCategory(c.label)).sort((a, b) => a.menuOrder - b.menuOrder),
    [categoriesByDoll, doll],
  );
  // セットに入れるものの、最初の選び方: かお以外（多すぎるときは、先頭から上限まで）
  const defaultSet = (list: ManifestCategory[]) => list.filter((c) => !isFaceLabel(c.label)).slice(0, SET_MAX).map((c) => c.id);
  const [target, setTarget] = useState<string>(() => targets[0]?.id ?? SET);
  const [setCats, setSetCats] = useState<string[]>(() => defaultSet(targets));
  const [theme, setTheme] = useState('');
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const steps: Step[] = dolls.length > 1 ? ['doll', 'what', 'theme', 'style', 'check'] : ['what', 'theme', 'style', 'check'];
  const [step, setStep] = useState<Step>(steps[0]);
  const stepIndex = Math.max(0, steps.indexOf(step));
  // カテゴリの ID → 先頭の服のサムネイル（公開の服を先に。自分の服しか無いカテゴリは、自分の服）
  const thumbs = useMemo(() => {
    const map: Record<string, string> = {};
    const idOf = new Map(targets.map((c) => [c.label, c.id]));
    const mine = (item: ClothingItemData) => item.id.startsWith('my:');
    for (const item of [...clothing.filter((i) => !mine(i)), ...clothing.filter(mine)]) {
      if (item.dollId && item.dollId !== doll?.id) continue;
      const id = idOf.get(item.type);
      if (id && !map[id] && (item.thumbnailUrl || item.imageUrl)) map[id] = item.thumbnailUrl || item.imageUrl;
    }
    return map;
  }, [clothing, targets, doll]);
  // 背景を作れるか（サーバーが古い版なら、「はいけい」を出さない。つながったら聞く）
  const [canBg, setCanBg] = useState(false);
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    session.backend.canMakeBackground().then(
      (ok) => alive && setCanBg(ok),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [ready, session]);
  // 「はいけい」の絵: そのドールで使える先頭の背景（公開の背景を先に）。無ければ、絵文字
  const bgThumb = useMemo(() => {
    const usable = backgrounds.filter((b) => !b.dollId || b.dollId === doll?.id);
    const first = [...usable.filter((b) => !b.isCustom), ...usable.filter((b) => b.isCustom)][0];
    return first ? first.thumbnailUrl || first.imageUrl : undefined;
  }, [backgrounds, doll]);
  const bgArt = bgThumb ? <img className="studio-thumb" src={bgThumb} alt="" draggable={false} /> : <span className="studio-tile-emoji" aria-hidden="true">🖼️</span>;
  const [phase, setPhase] = useState<OrderPhase | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  // 支払い: 買うボタン・戻りの確かめ・お知らせ。保護者の確認は、買うたびに毎回（通った時刻を、最終確認のあと checkout に渡す）
  const pay = usePay(session, payReturn);
  const [buying, setBuying] = useState<'login' | 'gate' | 'shop' | null>(null);
  const [adultAt, setAdultAt] = useState(0);
  const [moreLots, setMoreLots] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  // 買う: ログインしていなければ、保護者の確認の前に、ログインの案内（口が用意できないときは、そのまま進む。断られたら Shop が案内する）
  const startBuying = async () => {
    const info = await session.backend.account.prepare().catch(() => null);
    setBuying(info?.kind === 'guest' ? 'login' : 'gate');
  };
  const goLogin = () => {
    setBuying(null);
    // アカウントの欄（「Google で ログイン」のボタン）を、見える所へ
    accountRef.current?.scrollIntoView?.({ block: 'center' });
  };
  // 「こみあっています」に切り替えるために、ときどき描き直す
  const [now, setNow] = useState(() => Date.now());

  // 開いている間は、進み具合をこまめに聞く。開いたときに、つなぐ（まだなら）
  useEffect(() => {
    session.setFast(true);
    void session.connect();
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      session.setFast(false);
      clearInterval(tick);
    };
  }, [session]);

  // ドールを替えたら、カテゴリは先頭に、セットの印は付け直す
  const changeDoll = (id: string) => {
    setDollId(id);
    const next = [...(categoriesByDoll[id] ?? NO_CATEGORIES)].filter((c) => !isBackHairCategory(c.label)).sort((a, b) => a.menuOrder - b.menuOrder);
    setTarget(next[0]?.id ?? SET);
    setSetCats(defaultSet(next));
  };

  const isSet = target === SET;
  const isBg = target === BG && canBg;
  const chosen = targets.filter((c) => setCats.includes(c.id)).map((c) => c.id);
  const current: StudioTarget = isBg ? { kind: 'background' } : isSet ? { kind: 'set', categoryIds: chosen } : { kind: 'category', categoryId: target };
  const cost = ticketCost(current);
  const text = theme.trim();
  const problem =
    state.status === 'problem' ? (state.problemCode === 'offline' ? `${state.problem ?? ''}（インターネットにつながっているか確かめて、開き直してください）` : (state.problem ?? 'うまくいきませんでした')) : null;
  // 「作る」を押せない理由（押せるなら null）
  const blocked = !user
    ? '準備しています…'
    : !doll || (targets.length === 0 && !isBg)
      ? 'このドールには、作れるものがありません。'
      : !text
        ? 'テーマを入れてください。'
        : isSet && (chosen.length < SET_MIN || chosen.length > SET_MAX)
          ? `セットに入れるものを ${SET_MIN}〜${SET_MAX} 個選んでください（いま ${chosen.length} 個）。`
          : !user.admin && user.tickets < cost
            ? `チケットが足りません（のこり ${user.tickets} 枚、必要 ${cost} 枚）。`
            : null;

  // この段から先へ進めない理由（進めるなら null）
  const stepBlocked =
    step === 'what'
      ? targets.length === 0 && !isBg
        ? 'このドールには、作れるものがありません。'
        : isSet && (chosen.length < SET_MIN || chosen.length > SET_MAX)
          ? `セットに入れるものを ${SET_MIN}〜${SET_MAX} 個選んでください（いま ${chosen.length} 個）。`
          : null
      : step === 'theme' && !text
        ? 'テーマを入れてください。'
        : null;
  const goNext = () => setStep((now) => steps[Math.min(steps.length - 1, steps.indexOf(now) + 1)] ?? now);
  const goBack = () => setStep((now) => steps[Math.max(0, steps.indexOf(now) - 1)] ?? now);

  const labelOf = (forDoll: string, id: string) => (id === BG ? BACKGROUND_LABEL : (categoriesByDoll[forDoll]?.find((c) => c.id === id)?.label ?? id));
  const make = async () => {
    if (blocked || phase || !doll) return;
    const style = STYLE_PRESETS.find((s) => s.id === styleId)?.label ?? '';
    setLines([`${isSet ? `セット（${chosen.length} てん）` : labelOf(doll.id, target)} ・ ${style}`, `「${text}」`]);
    setPhase({ kind: 'ordering' });
    const started = clock();
    const shown = () => new Promise((resolve) => setTimeout(resolve, Math.max(0, ORDER_MIN_MS - (clock() - started))));
    try {
      const { jobId, cost: used } = await session.backend.startJob({ dollId: doll.id, theme: text, styleId, target: current });
      // ここからは、閉じても、サーバーが最後まで作る
      session.track(jobId);
      await shown();
      const after = session.getState().user;
      setPhase({ kind: 'ticket', cost: used, left: after?.tickets ?? 0, admin: after?.admin ?? false });
    } catch (e) {
      // サーバーが理由つきで断ったときだけ、「チケットは使っていない」と言い切れる。
      // 返事が届かなかったときは、サーバーでは注文できているかもしれない: そう伝えて、仕事とチケットを聞き直す
      const unsure = !(e instanceof BackendError) || e.uncertain;
      if (unsure) void session.refresh();
      await shown();
      setPhase({ kind: unsure ? 'unsure' : 'refused', message: messageOf(e) });
    }
  };

  // 作りかけの仕事（どのドールの分も）。終わった仕事は、ここには出さない（届いた知らせが出る）
  const making = state.jobs.filter((job) => !job.done);
  const dollName = (id: string) => dolls.find((d) => d.id === id)?.name ?? 'いまは選べないドール';
  // チケットを売っているか（売っていれば、残りの枚数が、買う入口になる）
  const canBuy = Boolean(pay.shop?.open && pay.shop.packs.length > 0);
  const ticketText = user ? (user.admin ? `管理者（制限なし）・🎫 のこり ${user.tickets} 枚` : `🎫 のこり ${user.tickets} 枚`) : '';

  return (
    <div className="studio-screen" data-testid="app-studio">
      <div className="studio-panel" inert={phase !== null}>
        <header className="studio-header">
          <h2>✨ つくる</h2>
          {user &&
            (canBuy && !problem ? (
              <button type="button" className="studio-tickets studio-tickets-link" onClick={() => void startBuying()} data-testid="studio-tickets">
                {ticketText}
              </button>
            ) : (
              <span className="studio-tickets" data-testid="studio-tickets">
                {ticketText}
              </span>
            ))}
          <button type="button" onClick={onClose} aria-label="とじる" data-testid="studio-close">
            ✕
          </button>
        </header>
        {user && user.lots.length > 0 && (
          <div className="shop-lots" data-testid="studio-lots">
            <span data-testid="studio-lot">
              うち {user.lots[0].left} 枚は {formatJstDate(user.lots[0].expiresAt)}まで
            </span>
            {user.lots.length > 1 && (
              <>
                {' '}
                <button type="button" onClick={() => setMoreLots((v) => !v)} aria-expanded={moreLots} data-testid="studio-lots-more">
                  ほか
                </button>
                {moreLots && (
                  <ul data-testid="studio-lots-list">
                    {user.lots.slice(1).map((lot) => (
                      <li key={lot.expiresAt}>
                        うち {lot.left} 枚は {formatJstDate(lot.expiresAt)}まで
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {pay.returned && (
          <p className="shop-banner" data-testid="pay-return" data-status={pay.returned.status}>
            <span>{pay.returned.status === 'paid' ? `チケットが ${pay.returned.added} 枚 ふえました` : RETURN_TEXT[pay.returned.status]}</span>
          </p>
        )}
        {pay.notices.map((n) => (
          <p key={n.id} className="shop-banner" data-testid="pay-notice">
            <span>{n.text}</span>
            <button type="button" onClick={() => pay.dismiss(n.id)} data-testid="pay-notice-ok">
              OK
            </button>
          </p>
        ))}

        {problem ? (
          <p className="studio-error" data-testid="studio-problem">
            {problem}
          </p>
        ) : (
          <>
            {demo && (
              <p className="studio-demo" data-testid="studio-demo">
                確認用の画面です。絵は色の四角で、AI は使いません。チケットも、この端末の中だけのにせものです。
              </p>
            )}

            <section className="studio-wizard" data-testid="studio-step" data-step={step}>
              <ol className="studio-steps" aria-label="すすみぐあい">
                {steps.map((id, i) => (
                  <li key={id} data-on={id === step ? 'true' : undefined} data-done={i < stepIndex ? 'true' : undefined}>
                    <button type="button" onClick={() => i < stepIndex && setStep(id)} disabled={i >= stepIndex} aria-label={STEP_TITLE[id]}>
                      {i + 1}
                    </button>
                  </li>
                ))}
              </ol>
              <h3 className="studio-step-title">{STEP_TITLE[step]}</h3>

              {step === 'doll' && (
                <div className="studio-tiles" data-testid="studio-doll">
                  {dolls.map((d) => (
                    <button type="button" key={d.id} className="studio-tile studio-tile-doll" data-value={d.id} aria-pressed={d.id === doll?.id} aria-label={d.name} onClick={() => { changeDoll(d.id); goNext(); }}>
                      <img src={d.bodyImageUrl} alt="" draggable={false} />
                      <span>{d.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {step === 'what' && (
                <>
                  <div className="studio-tiles" data-testid="studio-target">
                    {targets.map((c) => (
                      <button type="button" key={c.id} className="studio-tile" data-value={c.id} aria-pressed={target === c.id} aria-label={c.label} onClick={() => { setTarget(c.id); goNext(); }}>
                        <Thumb src={thumbs[c.id]} label={c.label} />
                        <span>{c.label}</span>
                      </button>
                    ))}
                    {targets.length >= SET_MIN && (
                      <button type="button" className="studio-tile studio-tile-set" data-value={SET} aria-pressed={isSet} aria-label="セット" onClick={() => setTarget(SET)}>
                        <span className="studio-tile-collage" aria-hidden="true">
                          {targets.filter((c) => thumbs[c.id]).slice(0, 4).map((c) => (
                            <img key={c.id} src={thumbs[c.id]} alt="" draggable={false} />
                          ))}
                        </span>
                        <span>セット</span>
                      </button>
                    )}
                    {canBg && (
                      <button type="button" className="studio-tile studio-tile-bg" data-value={BG} aria-pressed={isBg} aria-label={BACKGROUND_LABEL} onClick={() => { setTarget(BG); goNext(); }} data-testid="studio-target-bg">
                        {bgArt}
                        <span>{BACKGROUND_LABEL}</span>
                      </button>
                    )}
                  </div>
                  {isSet && (
                    <div className="studio-set" data-testid="studio-set-categories">
                      <div className="studio-tiles studio-tiles-small">
                        {targets.map((c) => {
                          const on = setCats.includes(c.id);
                          return (
                            <button type="button" key={c.id} className="studio-tile" data-value={c.id} aria-pressed={on} aria-label={c.label} onClick={() => setSetCats((list) => (on ? list.filter((x) => x !== c.id) : [...list, c.id]))}>
                              <Thumb src={thumbs[c.id]} label={c.label} />
                              <span>{c.label}</span>
                              {on && <i className="studio-tile-check" aria-hidden="true">✓</i>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 'theme' && (
                <div className="studio-group">
                  <input className="studio-theme-input" value={theme} maxLength={THEME_MAX} onChange={(e) => setTheme(e.target.value)} placeholder="例: うみのおひめさま" aria-label="テーマ" data-testid="studio-theme" />
                  <div className="studio-ideas">
                    {THEME_IDEAS.map((idea) => (
                      <button type="button" key={idea.word} className="studio-idea" aria-pressed={text === idea.word} onClick={() => setTheme(idea.word)} data-testid="studio-theme-idea">
                        <span aria-hidden="true">{idea.emoji}</span>
                        {idea.word}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 'style' && (
                <div className="studio-tiles" data-testid="studio-style">
                  {STYLE_PRESETS.map((st) => (
                    <button type="button" key={st.id} className="studio-tile studio-tile-style" data-value={st.id} aria-pressed={styleId === st.id} aria-label={st.label} onClick={() => { setStyleId(st.id); goNext(); }}>
                      <span className="studio-tile-emoji" data-style={st.id} aria-hidden="true">
                        {STYLE_EMOJI[st.id] ?? '🎨'}
                      </span>
                      <span>{st.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {step === 'check' && (
                <div className="studio-check-list" data-testid="studio-summary">
                  {dolls.length > 1 && doll && (
                    <button type="button" className="studio-summary" onClick={() => setStep('doll')}>
                      <img src={doll.bodyImageUrl} alt="" className="studio-summary-doll" />
                      <span>{doll.name}</span>
                    </button>
                  )}
                  <button type="button" className="studio-summary" onClick={() => setStep('what')}>
                    <span className="studio-summary-thumbs">
                      {isBg
                        ? bgArt
                        : (isSet ? chosen : [target]).map((id) => <Thumb key={id} src={thumbs[id]} label={labelOf(doll?.id ?? '', id)} />)}
                    </span>
                    <span>{isSet ? `セット（${chosen.map((id) => labelOf(doll?.id ?? '', id)).join('・')}）` : labelOf(doll?.id ?? '', target)}</span>
                  </button>
                  <button type="button" className="studio-summary" onClick={() => setStep('theme')}>
                    <span className="studio-tile-emoji" aria-hidden="true">💭</span>
                    <span>「{text}」</span>
                  </button>
                  <button type="button" className="studio-summary" onClick={() => setStep('style')}>
                    <span className="studio-tile-emoji" aria-hidden="true">{STYLE_EMOJI[styleId] ?? '🎨'}</span>
                    <span>{STYLE_PRESETS.find((st) => st.id === styleId)?.label}</span>
                  </button>
                </div>
              )}

              <div className="studio-row studio-nav">
                {stepIndex > 0 && (
                  <button type="button" onClick={goBack} data-testid="studio-back">
                    ← もどる
                  </button>
                )}
                {step === 'check' ? (
                  <button type="button" className="primary studio-make" onClick={() => void make()} disabled={phase !== null || blocked !== null} data-testid="studio-make">
                    {phase?.kind === 'ordering' ? '準備中…' : `✨ 作る（チケット ${cost} 枚）`}
                  </button>
                ) : (
                  <button type="button" className="primary" onClick={goNext} disabled={stepBlocked !== null} data-testid="studio-next">
                    つぎへ →
                  </button>
                )}
              </div>
              {(step === 'check' ? blocked : stepBlocked) && (
                <span className="studio-hint" data-testid="studio-hint">
                  {step === 'check' ? blocked : stepBlocked}
                </span>
              )}
            </section>

            {making.length > 0 && (
              <section data-testid="studio-making">
                <h3>作っているもの</h3>
                <div className="studio-cards">
                  {making.map((job) => (
                    <div key={job.id} className="studio-candidate" data-testid="studio-job" data-notice={jobNotice(job, now)}>
                      <div className="studio-candidate-side">
                        <span className="studio-hint">
                          {dollName(job.dollId)}
                          {job.set ? ` ・ セット「${job.set.name}」` : ''}
                        </span>
                        <p data-testid="studio-job-notice">{NOTICE[jobNotice(job, now)]}</p>
                        <ul className="studio-parts">
                          {job.candidates.map((c) => (
                            <li key={c.index} data-status={c.status}>
                              {labelOf(job.dollId, c.categoryId)}「{c.name}」: {c.status === 'kept' ? 'できました' : c.status === 'failed' ? (c.notes.join(' ') || 'できませんでした（チケットは戻しました）') : c.status === 'working' ? '作っています' : '順番待ち'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div ref={accountRef}>
              <Account session={session} library={library} />
            </div>

            {user?.admin && <GiftTickets session={session} />}

            {user && (
              <p className="studio-hint">
                コード: <b data-testid="studio-user-code">{user.userCode}</b>
              </p>
            )}
          </>
        )}
      </div>

      {buying === 'login' && (
        <div className="shop-overlay" data-testid="shop-login-guide">
          <div className="studio-panel shop-panel">
            <h2>🎫 チケットを買う</h2>
            <p data-testid="shop-login-message">Google で ログインすると かえます</p>
            <div className="studio-row">
              <button type="button" onClick={() => setBuying(null)} data-testid="shop-login-cancel">
                やめる
              </button>
              <button type="button" className="primary" onClick={goLogin} data-testid="shop-login-go">
                ログインへ
              </button>
            </div>
          </div>
        </div>
      )}
      {buying === 'gate' && (
        <AdultGate
          onCancel={() => setBuying(null)}
          onPass={() => {
            setAdultAt(Date.now());
            setBuying('shop');
          }}
        />
      )}
      {buying === 'shop' && pay.shop && (
        <Shop
          backend={session.backend}
          packs={pay.shop.packs}
          adultAt={adultAt}
          onClose={() => setBuying(null)}
          onLogin={goLogin}
        />
      )}

      {phase && <OrderShow phase={phase} lines={lines} art={art} onDone={() => setPhase(null)} />}
    </div>
  );
}
