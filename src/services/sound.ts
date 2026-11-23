/**
 * 効果音（音のファイルは使わず、Web Audio でその場で鳴らす）
 */

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor: AudioContextClass | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

// 1 音: 立ち上がりが速く、余韻が残るベルのような音
function bell(ctx: AudioContext, out: AudioNode, freq: number, at: number, length: number, volume: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  gain.connect(out);
  // 基音と、少し高い倍音を重ねて、きらっとした音色にする
  for (const [ratio, type, level] of [
    [1, 'sine', 1],
    [2, 'triangle', 0.35],
    [3.01, 'sine', 0.15],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * ratio, at);
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

// 服を着せたときの音: 魔法の変身のような、上がっていくきらきらの和音
export function playDressUpSound(): void {
  const ctx = audio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    // ド・ミ・ソ・ド（高い音）を素早く上がる
    const notes = [1046.5, 1318.5, 1568.0, 2093.0];
    notes.forEach((f, i) => bell(ctx, master, f, now + i * 0.055, 0.6, 0.6));
    // 最後に、高い音をちらちらと散らす
    const sparkle = [2637.0, 3136.0, 2793.8, 3520.0];
    sparkle.forEach((f, i) => bell(ctx, master, f, now + 0.24 + i * 0.045, 0.35, 0.25));
  } catch {
    // 音が出せない環境では何もしない
  }
}

// 服が届いたときの音: とびらが開いて、明るい和音が広がる
export function playArriveSound(): void {
  const ctx = audio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime + 0.3; // とびらが開きはじめてから
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    // ソ・ド・ミ・ソ（上がっていく）のあと、高いドを長く
    [784.0, 1046.5, 1318.5, 1568.0].forEach((f, i) => bell(ctx, master, f, now + i * 0.11, 0.7, 0.55));
    bell(ctx, master, 2093.0, now + 0.5, 1.2, 0.5);
    [2637.0, 3136.0, 3520.0].forEach((f, i) => bell(ctx, master, f, now + 0.62 + i * 0.07, 0.5, 0.2));
  } catch {
    // 音が出せない環境では何もしない
  }
}
