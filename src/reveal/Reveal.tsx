/**
 * 服が届いた演出: クローゼットのとびらが開いて、光の中から、ドールが着た服が出る。
 * 仕事 1 つにつき 1 回（セットは、全部を着た絵で 1 回）。1 点もできなかった仕事は、とびらは出さず、知らせだけ出す。
 */
import { useEffect } from 'react';
import { useItemLayers } from '../cloud/itemLayers';
import { Stage } from '../cloud/Stage';
import { playArriveSound } from '../services/sound';
import type { RevealView } from './revealView';

export interface RevealProps {
  view: RevealView;
  storeFailed: boolean; // 端末に保存できなかった服がある
  art?: { deliver?: string }; // 服を届ける店員の絵（無ければ、出さない）
  canTryOn: boolean;
  onTryOn: () => void;
  onOpenCloset: () => void;
  onClose: () => void;
}

const stageSize = () => Math.max(150, Math.min(300, Math.floor(Math.min(window.innerWidth * 0.56, window.innerHeight * 0.4))));

export function Reveal({ view, storeFailed, art, canTryOn, onTryOn, onOpenCloset, onClose }: RevealProps) {
  const layers = useItemLayers(view.items);
  const arrived = view.kind === 'arrived';
  useEffect(() => {
    if (arrived) playArriveSound();
  }, [arrived]);
  const size = stageSize();

  return (
    <div className="reveal" data-testid="reveal" data-kind={view.kind} role="dialog" aria-modal="true">
      <div className="reveal-card">
        {arrived ? (
          <>
            <h2 className="reveal-title">
              <span aria-hidden="true">✨</span> あたらしい ふくが とどいたよ！ <span aria-hidden="true">✨</span>
            </h2>
            <div className="reveal-closet" style={{ width: size + 32 }}>
              <div className="reveal-light" aria-hidden="true" />
              <div className="reveal-inside">
                <Stage doll={view.doll} layers={layers} size={size} testId="reveal-stage" />
              </div>
              <div className="reveal-door left" aria-hidden="true" />
              <div className="reveal-door right" aria-hidden="true" />
              {art?.deliver && <img className="reveal-clerk" src={art.deliver} alt="" draggable={false} />}
            </div>
            <p className="reveal-name" data-testid="reveal-name">
              {view.title}
            </p>
          </>
        ) : (
          <h2 className="reveal-title sorry">つくれませんでした</h2>
        )}

        {view.failed.map((label, i) => (
          <p key={i} className="reveal-failed" data-testid="reveal-failed">
            {arrived ? `${label}は つくれませんでした。` : `${label}: `}チケットは もどしました
          </p>
        ))}
        {storeFailed && arrived && (
          <p className="reveal-failed" data-testid="reveal-store-failed">
            この たんまつに ほぞんできませんでした（あきが たりないかもしれません）
          </p>
        )}

        <div className="reveal-buttons">
          {arrived && canTryOn && (
            <button type="button" className="primary" onClick={onTryOn} data-testid="reveal-try">
              きせてみる
            </button>
          )}
          {arrived && (
            <button type="button" onClick={onOpenCloset} data-testid="reveal-closet">
              クローゼットをみる
            </button>
          )}
          <button type="button" onClick={onClose} data-testid="reveal-close">
            とじる
          </button>
        </div>
      </div>
    </div>
  );
}
