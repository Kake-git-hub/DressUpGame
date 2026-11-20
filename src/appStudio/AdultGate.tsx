/**
 * 「つくる」の入口: 保護者（大人）の確認
 *
 * 画像を作る AI（Gemini）は、18 歳未満が使うことを認めていない。そのため、「つくる」は大人が使う画面として、
 * 子どもの遊ぶ画面から分ける。子どもには読みにくい問い（漢数字の掛け算）と、「18 歳以上です」の印の両方で開く。
 */
import { useState } from 'react';
import { gateQuestion } from './unlock';

export function AdultGate({ onPass, onCancel }: { onPass: () => void; onCancel: () => void }) {
  const [question, setQuestion] = useState(gateQuestion);
  const [answer, setAnswer] = useState('');
  const [adult, setAdult] = useState(false);
  const [wrong, setWrong] = useState(false);
  const submit = () => {
    if (Number(answer.trim()) === question.answer && adult) {
      onPass();
      return;
    }
    // まちがえたら、問いを替える
    setWrong(true);
    setAnswer('');
    setQuestion(gateQuestion());
  };
  return (
    <div className="studio-overlay" data-testid="adult-gate">
      <form
        className="studio-panel studio-gate"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>おとなの方へ</h2>
        <p>ここから先は、保護者（大人）の方が使う画面です。AI で、このドールの服を作ります。</p>
        <p>お子さまだけで使わないよう、次の問いに答えてください。</p>
        <label className="studio-gate-question">
          <span data-testid="adult-question">{question.text}</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value.replace(/[^0-9]/g, ''));
              setWrong(false);
            }}
            placeholder="数字で答える"
            data-testid="adult-answer"
          />
        </label>
        <label className="studio-check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} data-testid="adult-18" /> 私は 18 歳以上です
        </label>
        {wrong && (
          <p className="studio-error" data-testid="adult-error">
            答えが違います。もう一度どうぞ。
          </p>
        )}
        <div className="studio-row">
          <button type="button" onClick={onCancel} data-testid="adult-cancel">
            やめる
          </button>
          <button type="submit" className="primary" disabled={!answer.trim() || !adult} data-testid="adult-open">
            ひらく
          </button>
        </div>
      </form>
    </div>
  );
}
