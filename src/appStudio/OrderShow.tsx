/**
 * 注文の演出と、チケットを切る演出（画面いっぱい）
 *
 *   ordering = 「作る」を押してから、サーバーが仕事を作る（チケットを引く）まで。洋服屋さんに注文を伝えている。閉じないように促す
 *   ticket   = サーバーが「引いた」と返したあと。チケットが切れて、もう閉じてもよいことを伝える
 *   refused  = 注文を受けられなかった（チケットは使っていない）
 *
 * 子どもが横で見ていても分かるように、やさしい言葉で書く。絵（店員とお店）は、あれば重ねる（無ければ、図形と絵文字）。
 */
import './orderShow.css';

export type OrderPhase =
  | { kind: 'ordering' } // サーバーの返事を待っている
  | { kind: 'ticket'; cost: number; left: number; admin: boolean } // 引いた、と返ってきた
  | { kind: 'refused'; message: string }; // 受けられなかった

// 絵の URL（無ければ、図形と絵文字で出す）
export interface ShopArt {
  shop?: string; // お店の中（背景）
  order?: string; // 伝票に書いている店員
  ticket?: string; // はさみとチケットを持つ店員
}

interface Props {
  phase: OrderPhase;
  lines: string[]; // 伝票に書く、頼んだ内容
  art?: ShopArt;
  onDone: () => void;
}

// 切れたチケットの絵は、この枚数まで（それより多いときは、枚数を文で伝える）
const TICKETS_SHOWN = 6;

export function OrderShow({ phase, lines, art, onDone }: Props) {
  const clerk = phase.kind === 'ticket' ? (art?.ticket ?? art?.order) : art?.order;
  return (
    <div className="order-show" data-testid="order-show" data-phase={phase.kind} role="dialog" aria-modal="true" style={art?.shop ? { backgroundImage: `url(${art.shop})` } : undefined}>
      <div className="order-scene">
        <h2 className="order-shop-name">
          <span aria-hidden="true">🏪</span> ようふくやさん
        </h2>
        <div className="order-counter">
          {clerk ? <img className="order-clerk" src={clerk} alt="" draggable={false} /> : <div className="order-clerk order-clerk-plain" aria-hidden="true">🧵</div>}

          {phase.kind === 'ordering' && (
            <div className="order-slip" data-testid="order-slip">
              <div className="order-slip-head">ごちゅうもん</div>
              {lines.map((line, i) => (
                <div key={i} className="order-slip-line" style={{ animationDelay: `${0.25 + i * 0.35}s` }}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {phase.kind === 'ticket' && !phase.admin && (
            <div className="order-tickets" aria-hidden="true">
              {Array.from({ length: Math.min(phase.cost, TICKETS_SHOWN) }, (_, i) => (
                <div key={i} className="order-ticket" data-testid="order-ticket" style={{ animationDelay: `${i * 0.12}s` }}>
                  <span className="order-ticket-half left">🎫</span>
                  <span className="order-ticket-half right">🎫</span>
                </div>
              ))}
              <span className="order-scissors">✂</span>
            </div>
          )}
        </div>

        {phase.kind === 'ordering' && (
          <>
            <p className="order-text">
              ごちゅうもんを つたえています…<span className="order-dots" aria-hidden="true" />
            </p>
            <p className="order-warning">
              <span aria-hidden="true">⚠ </span>この がめんを とじないでね
            </p>
          </>
        )}

        {phase.kind === 'ticket' && (
          <>
            {!phase.admin && (
              <>
                <p className="order-snip">チョキン！</p>
                <p className="order-text" data-testid="order-ticket-count">
                  チケット {phase.cost} まい つかいました（のこり {phase.left} まい）
                </p>
              </>
            )}
            <p className="order-done">ごちゅうもん かんりょう！</p>
            <p className="order-text">もう とじても だいじょうぶ。</p>
            <p className="order-text">できたら クローゼットに とどきます。</p>
            <button type="button" className="order-button" onClick={onDone} data-testid="order-ok">
              OK
            </button>
          </>
        )}

        {phase.kind === 'refused' && (
          <>
            <p className="order-done">ごちゅうもんを うけられませんでした。</p>
            <p className="order-text">チケットは つかっていません。</p>
            <p className="order-reason" data-testid="order-reason">
              {phase.message}
            </p>
            <button type="button" className="order-button" onClick={onDone} data-testid="order-back">
              もどる
            </button>
          </>
        )}
      </div>
    </div>
  );
}
