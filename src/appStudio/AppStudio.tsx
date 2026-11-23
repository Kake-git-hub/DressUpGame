/**
 * アプリの中のスタジオ（つくる）: 「何を作るか・テーマ・絵柄」を選んで、服を注文する。
 * 大人（保護者）が使う画面なので、入力の欄は漢字かな交じり。注文の演出は、子どもが横で見ていても分かる言葉。
 *
 * チケット・生成・保存は、サーバーが行う。「作る」の返事が返ったあとは、この画面を閉じても、アプリを閉じても、
 * サーバーが最後まで作り、できた服は自動でクローゼットに入る（届いた知らせは、つなぎ役 = session が出す）。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BackendError, SET_MAX, SET_MIN, THEME_MAX, ticketCost } from '../cloud/backend';
import type { StudioTarget } from '../cloud/backend';
import type { CloudSession } from '../cloud/session';
import type { ManifestCategory } from '../content/manifest';
import { isBackHairCategory } from '../pipeline/hairSplit';
import { DEFAULT_STYLE_ID, STYLE_PRESETS } from '../studio/stylePresets';
import type { DollData } from '../types';
import { jobNotice } from './jobNotice';
import { OrderShow } from './OrderShow';
import type { OrderPhase, ShopArt } from './OrderShow';

interface Props {
  session: CloudSession;
  dolls: DollData[]; // ゲームに出ているドール
  categoriesByDoll: Record<string, ManifestCategory[]>;
  initialDollId: string; // 最初に選んでおくドール（最後に遊んだドール）
  onClose: () => void;
  onOpenCloset: () => void;
  demo?: boolean; // 確認用（偽物の裏側）。絵は色の四角で、チケットもにせもの
  art?: ShopArt;
}

const SET = '__set';
// 注文の演出を出しておく、いちばん短い時間（返事が早くても、何が起きたかが分かるように）
const ORDER_MIN_MS = 1500;
const NO_CATEGORIES: ManifestCategory[] = [];
const isFaceLabel = (label: string) => /かお|顔|face|メイク|makeup/i.test(label);
const messageOf = (e: unknown) => (e instanceof BackendError || e instanceof Error ? e.message : String(e));
const NOTICE = {
  waiting: '順番を待っています…',
  working: '作っています…（1 分くらい）',
  crowded: 'こみあっています。できたら、クローゼットに入ります。',
};

export function AppStudio({ session, dolls, categoriesByDoll, initialDollId, onClose, onOpenCloset, demo = false, art }: Props) {
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
  const [phase, setPhase] = useState<OrderPhase | null>(null);
  const [lines, setLines] = useState<string[]>([]);
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
  const chosen = targets.filter((c) => setCats.includes(c.id)).map((c) => c.id);
  const current: StudioTarget = isSet ? { kind: 'set', categoryIds: chosen } : { kind: 'category', categoryId: target };
  const cost = ticketCost(current);
  const text = theme.trim();
  const problem =
    state.status === 'problem' ? (state.problemCode === 'offline' ? `${state.problem ?? ''}（インターネットにつながっているか確かめて、開き直してください）` : (state.problem ?? 'うまくいきませんでした')) : null;
  // 「作る」を押せない理由（押せるなら null）
  const blocked = !user
    ? '準備しています…'
    : !doll || targets.length === 0
      ? 'このドールには、作れるものがありません。'
      : !text
        ? 'テーマを入れてください。'
        : isSet && (chosen.length < SET_MIN || chosen.length > SET_MAX)
          ? `セットに入れるものを ${SET_MIN}〜${SET_MAX} 個選んでください（いま ${chosen.length} 個）。`
          : !user.admin && user.tickets < cost
            ? `チケットが足りません（のこり ${user.tickets} 枚、必要 ${cost} 枚）。`
            : null;

  const labelOf = (forDoll: string, id: string) => categoriesByDoll[forDoll]?.find((c) => c.id === id)?.label ?? id;
  const make = async () => {
    if (blocked || phase || !doll) return;
    const style = STYLE_PRESETS.find((s) => s.id === styleId)?.label ?? '';
    setLines([`${isSet ? `セット（${chosen.length} てん）` : labelOf(doll.id, target)} ・ ${style}`, `「${text}」`]);
    setPhase({ kind: 'ordering' });
    const started = Date.now();
    const shown = () => new Promise((resolve) => setTimeout(resolve, Math.max(0, ORDER_MIN_MS - (Date.now() - started))));
    try {
      const { jobId, cost: used } = await session.backend.startJob({ dollId: doll.id, theme: text, styleId, target: current });
      // ここからは、閉じても、サーバーが最後まで作る
      session.track(jobId);
      await shown();
      const after = session.getState().user;
      setPhase({ kind: 'ticket', cost: used, left: after?.tickets ?? 0, admin: after?.admin ?? false });
    } catch (e) {
      await shown();
      setPhase({ kind: 'refused', message: messageOf(e) });
    }
  };

  // 作りかけの仕事（どのドールの分も）。終わった仕事は、ここには出さない（届いた知らせが出る）
  const making = state.jobs.filter((job) => !job.done);
  const dollName = (id: string) => dolls.find((d) => d.id === id)?.name ?? 'いまは選べないドール';

  return (
    <div className="studio-overlay" data-testid="app-studio">
      <div className="studio-panel" inert={phase !== null}>
        <header className="studio-header">
          <h2>✨ 服を作る</h2>
          {user && (
            <span className="studio-tickets" data-testid="studio-tickets">
              {user.admin ? '管理者（チケットの制限なし）' : `🎫 のこり ${user.tickets} 枚`}
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="とじる" data-testid="studio-close">
            ✕
          </button>
        </header>

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
            <p className="studio-note">
              テーマを書いて注文すると、AI が服を作ります。できた服は、クローゼットに入ります（1〜2 分。アプリを閉じていても届きます）。服 1 点につき、チケットを 1 枚使います。
            </p>

            <section className="studio-form">
              {dolls.length > 1 && (
                <label className="studio-group">
                  <span className="studio-label">ドール</span>
                  <select className="studio-select" value={doll?.id ?? ''} onChange={(e) => changeDoll(e.target.value)} data-testid="studio-doll">
                    {dolls.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="studio-group">
                <span className="studio-label">① 何を作る？</span>
                <select className="studio-select" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="studio-target">
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  {targets.length >= SET_MIN && <option value={SET}>セット</option>}
                </select>
              </label>
              {isSet && (
                <div className="studio-set" data-testid="studio-set-categories">
                  <span>
                    セットに入れるもの（{SET_MIN}〜{SET_MAX} 個。選んだものごとに 1 点、色と飾りをそろえて作ります）
                  </span>
                  <div className="studio-checks">
                    {targets.map((c) => (
                      <label key={c.id}>
                        <input type="checkbox" checked={setCats.includes(c.id)} onChange={(e) => setSetCats((list) => (e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id)))} /> {c.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <label className="studio-group">
                <span className="studio-label">② テーマ</span>
                <input value={theme} maxLength={THEME_MAX} onChange={(e) => setTheme(e.target.value)} placeholder="例: うみのおひめさま" aria-label="テーマ" data-testid="studio-theme" />
              </label>

              <label className="studio-group">
                <span className="studio-label">③ 絵柄</span>
                <select className="studio-select" value={styleId} onChange={(e) => setStyleId(e.target.value)} data-testid="studio-style">
                  {STYLE_PRESETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="studio-row">
                <button type="button" className="primary" onClick={() => void make()} disabled={phase !== null || blocked !== null} data-testid="studio-make">
                  {phase?.kind === 'ordering' ? '準備中…' : `作る（チケット ${cost} 枚）`}
                </button>
                {blocked && (
                  <span className="studio-hint" data-testid="studio-hint">
                    {blocked}
                  </span>
                )}
              </div>
            </section>

            {making.length > 0 && (
              <section data-testid="studio-making">
                <h3>作っている服</h3>
                <p className="studio-hint">この画面を閉じても、アプリを閉じても、続きます。できたら、クローゼットに入ります。</p>
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
                              {labelOf(job.dollId, c.categoryId)}「{c.name}」: {c.status === 'kept' ? 'できました' : c.status === 'failed' ? 'できませんでした（チケットは戻しました）' : c.status === 'working' ? '作っています' : '順番待ち'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="studio-row">
              <button type="button" onClick={onOpenCloset} data-testid="studio-open-closet">
                👗 クローゼットを見る
              </button>
            </div>

            {user && (
              <p className="studio-hint">
                利用者コード: <b data-testid="studio-user-code">{user.userCode}</b>（チケットを受け取るときに、作者に伝えるコードです）
              </p>
            )}
          </>
        )}
      </div>

      {phase && <OrderShow phase={phase} lines={lines} art={art} onDone={() => setPhase(null)} />}
    </div>
  );
}
