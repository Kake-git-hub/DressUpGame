/**
 * シルエットの形を使って、AI が作った画像をドールに位置合わせする純粋関数
 *
 * 「シルエットはドールの内側にあり、背景はドールに重ならない」という条件で、
 * いちばん合う倍率とずれを探す。
 */

export interface Alignment {
  // 元画像の点 p を、ドールのキャンバス上の p × (dollWidth / width) × scale + (dx, dy) に写す
  scale: number;
  dx: number;
  dy: number;
  score: number; // 0〜1。1 = シルエットが全部ドールの内側にあり、背景がドールに重ならない
}

export interface AlignInput {
  silhouette: Uint8Array; // 元画像の大きさ。1 = シルエット
  background: Uint8Array; // 元画像の大きさ。1 = 背景
  width: number;
  height: number;
  doll: Uint8Array; // ドールのキャンバスの大きさ。1 = ドール
  dollWidth: number;
  dollHeight: number;
}

const SCALE_MIN = 0.85;
const SCALE_MAX = 1.15;
const SHIFT_LIMIT = 0.12; // ドールのキャンバスに対する割合
const MIN_SILHOUETTE_SHARE = 0.03; // シルエットがドールのこの割合より少なければ探さない
const MIN_IMPROVEMENT = 0.01; // 等倍・ずれなしからの改善がこれ未満なら動かさない

interface Level {
  n: number; // ドールのキャンバスの幅（縮小後）
  h: number;
  doll: Float32Array;
  srcW: number;
  srcH: number;
  sil: Float32Array; // 元画像を「ドールのキャンバスと同じ縮尺」に縮めたもの
  bg: Float32Array;
}

// 面積平均で縮小する（0〜1 の被覆率）
function shrink(mask: Uint8Array, width: number, height: number, outW: number, outH: number): Float32Array {
  const out = new Float32Array(outW * outH);
  const count = new Float32Array(outW * outH);
  const fx = outW / width;
  const fy = outH / height;
  for (let y = 0; y < height; y++) {
    const oy = Math.min(outH - 1, Math.floor(y * fy));
    for (let x = 0; x < width; x++) {
      const o = oy * outW + Math.min(outW - 1, Math.floor(x * fx));
      out[o] += mask[y * width + x];
      count[o]++;
    }
  }
  for (let i = 0; i < out.length; i++) if (count[i] > 0) out[i] /= count[i];
  return out;
}

function makeLevel(input: AlignInput, n: number): Level {
  const k = n / input.dollWidth;
  const h = Math.max(1, Math.round(input.dollHeight * k));
  // 元画像は、幅がドールのキャンバスの幅に合うように縮める
  const srcW = n;
  const srcH = Math.max(1, Math.round((input.height * n) / input.width));
  return {
    n,
    h,
    doll: shrink(input.doll, input.dollWidth, input.dollHeight, n, h),
    srcW,
    srcH,
    sil: shrink(input.silhouette, input.width, input.height, srcW, srcH),
    bg: shrink(input.background, input.width, input.height, srcW, srcH),
  };
}

interface Sums {
  inside: number; // ドールの内側にあるシルエット
  outside: number; // ドールの外側にあるシルエット
  bgOnDoll: number; // ドールに重なる背景
}

// 倍率 scale（キャンバスの中心が基準）と、ずれ (ox, oy)（この段の画素単位）で重ねたときの量
function measure(level: Level, scale: number, ox: number, oy: number): Sums {
  const { n, h, doll, srcW, srcH, sil, bg } = level;
  const cx = n / 2;
  const cy = h / 2;
  const scx = srcW / 2;
  const scy = srcH / 2;
  const inv = 1 / scale;
  let inside = 0;
  let outside = 0;
  let bgOnDoll = 0;
  for (let y = 0; y < h; y++) {
    const sy = Math.floor((y + 0.5 - cy - oy) * inv + scy);
    const rowOk = sy >= 0 && sy < srcH;
    for (let x = 0; x < n; x++) {
      const d = doll[y * n + x];
      const sx = Math.floor((x + 0.5 - cx - ox) * inv + scx);
      if (!rowOk || sx < 0 || sx >= srcW) continue; // 元画像の外は、背景でもシルエットでもない
      const s = sil[sy * srcW + sx];
      if (s > 0) {
        inside += s * d;
        outside += s * (1 - d);
      }
      if (d > 0) bgOnDoll += bg[sy * srcW + sx] * d;
    }
  }
  return { inside, outside, bgOnDoll };
}

const objective = (s: Sums) => s.inside - s.outside - s.bgOnDoll;

/**
 * 探す範囲: 倍率 0.85〜1.15、ずれはドールのキャンバスの ±12%。
 * 長辺 128px に縮めて全体を探し、256 → 512 → 等倍と細かくしていく。
 */
export function alignToDoll(input: AlignInput): Alignment {
  const identity: Alignment = { scale: 1, dx: 0, dy: 0, score: 0 };
  let dollCount = 0;
  for (let i = 0; i < input.doll.length; i++) dollCount += input.doll[i];
  let silCount = 0;
  for (let i = 0; i < input.silhouette.length; i++) silCount += input.silhouette[i];
  const toDoll = input.dollWidth / input.width;
  if (dollCount === 0 || silCount * toDoll * toDoll < dollCount * MIN_SILHOUETTE_SHARE) return identity;

  const sizes = [128, 256, 512, input.dollWidth].filter((n, i, all) => n <= input.dollWidth && all.indexOf(n) === i);
  // 最良の候補（倍率と、ドールのキャンバス px 単位の中心基準のずれ）
  let best = { scale: 1, ox: 0, oy: 0 };
  let bestValue = -Infinity;

  sizes.forEach((n, index) => {
    const level = makeLevel(input, n);
    const px = input.dollWidth / n; // この段の 1 画素 = ドールのキャンバスの何 px か
    const limit = SHIFT_LIMIT * input.dollWidth;
    let scales: number[];
    let reach: number; // ずれを探す範囲（この段の画素）
    if (index === 0) {
      scales = [];
      for (let s = SCALE_MIN; s <= SCALE_MAX + 1e-9; s += 0.02) scales.push(s);
      reach = Math.ceil(limit / px);
    } else {
      const step = [0, 0.008, 0.004, 0.002][Math.min(index, 3)];
      scales = [-2, -1, 0, 1, 2].map((k) => best.scale + k * step);
      reach = index === 1 ? 4 : 2;
    }
    const center = { ...best };
    bestValue = -Infinity;
    const stride = index === 0 ? 2 : 1; // 最初の段は 1 つおき。次の段が ±4 画素で埋める
    for (const scale of scales) {
      if (scale < SCALE_MIN - 1e-9 || scale > SCALE_MAX + 1e-9) continue;
      for (let j = -reach; j <= reach; j += stride) {
        for (let i = -reach; i <= reach; i += stride) {
          const ox = (index === 0 ? 0 : center.ox) + i * px;
          const oy = (index === 0 ? 0 : center.oy) + j * px;
          if (Math.abs(ox) > limit || Math.abs(oy) > limit) continue;
          const value = objective(measure(level, scale, ox / px, oy / px));
          if (value > bestValue) {
            bestValue = value;
            best = { scale, ox, oy };
          }
        }
      }
    }
  });

  const full = makeLevel(input, input.dollWidth);
  const quality = (s: Sums) => {
    const total = s.inside + s.outside;
    return total === 0 ? 0 : Math.max(0, (s.inside - s.outside - s.bgOnDoll) / total);
  };
  const found = measure(full, best.scale, best.ox, best.oy);
  const still = measure(full, 1, 0, 0);
  if ((objective(found) - objective(still)) / dollCount < MIN_IMPROVEMENT) {
    return { scale: 1, dx: 0, dy: 0, score: quality(still) };
  }
  // 中心基準のずれを、左上基準（p × toDoll × scale + (dx, dy)）に直す
  const scale = Math.round(best.scale * 1000) / 1000;
  const srcHeightOnDoll = input.height * toDoll;
  return {
    scale,
    dx: Math.round(input.dollWidth / 2 + best.ox - (input.dollWidth / 2) * scale),
    dy: Math.round(input.dollHeight / 2 + best.oy - (srcHeightOnDoll / 2) * scale),
    score: quality(found),
  };
}
