/**
 * 操作ガイド: 画面に半透明の幕をかけ、操作する部品のまわりだけを明るく抜いて、ひとことの吹き出しを出す。
 * 1 つずつ「つぎへ」で進む。「とばす」で終わる。終わったら、その場面は二度と出さない（guideStore）。
 * 部品の位置は、その場で測る（画面の向き・大きさが変わっても合う）。見つからない部品の段は、とばす。
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import type { GuideName } from './guideStore';
import { markGuideSeen } from './guideStore';
import './guide.css';

export interface GuideStep {
  // 明るくする部品（CSS セレクタ）。いくつか書けば、最初に見つかったもの。text も同じ順に書ける（1 つなら共通）
  target: string | string[];
  text: string | string[];
}

const list = <T,>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
// 部品を探す: 画面に出ていて大きさのあるもの
function find(step: GuideStep): { element: Element; text: string } | null {
  const targets = list(step.target);
  const texts = list(step.text);
  for (let i = 0; i < targets.length; i++) {
    const element = document.querySelector(targets[i]);
    if (!element) continue;
    const r = element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { element, text: texts[Math.min(i, texts.length - 1)] };
  }
  return null;
}

const PAD = 6; // 明るく抜く所の、部品のまわりのあき
const WAIT_MS = 500; // 出す前に待つ（画面が出そろうのを待つ）

export function Guide({ name, steps, onDone }: { name: GuideName; steps: GuideStep[]; onDone: () => void }) {
  const [index, setIndex] = useState<number | null>(null); // null = まだ出していない
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [text, setText] = useState('');

  // 少し待ってから、最初に見つかる段から始める。1 つも見つからなければ、出さない（覚えもしない）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const first = steps.findIndex((s) => find(s));
      if (first < 0) onDone();
      else setIndex(first);
    }, WAIT_MS);
    return () => window.clearTimeout(timer);
    // 場面ごとに 1 回だけ（steps は毎回作り直されるので、見ない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // いまの段の部品の位置を、こまめに測る
  useLayoutEffect(() => {
    if (index === null) return undefined;
    let frame = 0;
    const measure = () => {
      const found = find(steps[index]);
      setRect((prev) => {
        const r = found?.element.getBoundingClientRect() ?? null;
        if (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height) return prev;
        return r;
      });
      setText(found?.text ?? '');
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [index, steps]);

  if (index === null) return null;
  const finish = () => {
    markGuideSeen(name);
    onDone();
  };
  const next = () => {
    for (let k = index + 1; k < steps.length; k++) {
      if (find(steps[k])) return setIndex(k);
    }
    finish();
  };
  const last = !steps.slice(index + 1).some((s) => find(s));

  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const hole = rect && { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  // 吹き出しは、抜いた所の下（入らなければ上、どちらも入らなければ画面のまん中）
  const bubbleW = Math.min(300, vw - 32);
  const below = hole ? hole.top + hole.height + 12 : vh / 2;
  const roomBelow = vh - below;
  const bubbleStyle: React.CSSProperties = { width: `${bubbleW}px`, left: `${Math.max(16, Math.min(vw - bubbleW - 16, hole ? hole.left + hole.width / 2 - bubbleW / 2 : (vw - bubbleW) / 2))}px` };
  if (!hole) bubbleStyle.top = `${vh / 2 - 60}px`;
  else if (roomBelow >= 150) bubbleStyle.top = `${below}px`;
  else if (hole.top - 12 >= 150) bubbleStyle.bottom = `${vh - hole.top + 12}px`;
  else bubbleStyle.top = `${Math.max(16, vh / 2 - 60)}px`;

  return (
    <div className="guide-layer" data-testid="guide" data-guide={name} data-step={index} onClick={(e) => e.stopPropagation()}>
      {hole ? (
        <div className="guide-hole" style={{ left: `${hole.left}px`, top: `${hole.top}px`, width: `${hole.width}px`, height: `${hole.height}px` }} />
      ) : (
        <div className="guide-dim" />
      )}
      <div className="guide-bubble" style={bubbleStyle} role="dialog" aria-live="polite">
        <p className="guide-text" data-testid="guide-text">
          {text}
        </p>
        <div className="guide-buttons">
          {!last && (
            <button type="button" className="guide-skip" onClick={finish} data-testid="guide-skip">
              とばす
            </button>
          )}
          <button type="button" className="guide-next" onClick={last ? finish : next} data-testid="guide-next">
            {last ? 'わかった' : 'つぎへ'}
          </button>
        </div>
      </div>
    </div>
  );
}
