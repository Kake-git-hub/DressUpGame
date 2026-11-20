// spike helpers (throwaway)
export type U8 = Uint8Array;
export function dilate(m: U8, w: number, h: number, r: number): U8 {
  const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= r) t[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; } }
  return o;
}
export const invert = (m: U8) => m.map((v) => (v ? 0 : 1)) as U8;
export const erode = (m: U8, w: number, h: number, r: number) => invert(dilate(invert(m), w, h, r));
// connected components of mask; cb(pixels, touchesBorder)
export function components(m: U8, w: number, h: number, cb: (px: Int32Array, n: number, border: boolean) => void) {
  const seen = new Uint8Array(m.length), stack = new Int32Array(m.length), piece = new Int32Array(m.length);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || seen[s]) continue;
    let top = 0, n = 0, border = false; stack[top++] = s; seen[s] = 1;
    while (top) { const p = stack[--top]; piece[n++] = p; const x = p % w, y = (p / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < m.length && m[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; } }
    cb(piece, n, border);
  }
}
// push-pull inpainting: fills every pixel from weighted known colours (weight 0..1), smooth
export function pushPull(rgb: Float32Array, wt: Float32Array, w: number, h: number): Float32Array {
  if (w <= 1 && h <= 1) return rgb.slice();
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const c2 = new Float32Array(w2 * h2 * 3), t2 = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x, q = (y >> 1) * w2 + (x >> 1); const a = wt[p]; t2[q] += a; for (let c = 0; c < 3; c++) c2[q * 3 + c] += rgb[p * 3 + c] * a; }
  for (let q = 0; q < w2 * h2; q++) { if (t2[q] > 0) { for (let c = 0; c < 3; c++) c2[q * 3 + c] /= t2[q]; t2[q] = Math.min(1, t2[q]); } }
  const up = pushPull(c2, t2, w2, h2);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; const a = wt[p];
    // bilinear sample of coarse level
    const fx = Math.max(0, Math.min(w2 - 1, (x - 0.5) / 2)), fy = Math.max(0, Math.min(h2 - 1, (y - 0.5) / 2));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w2 - 1, x0 + 1), y1 = Math.min(h2 - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 3; c++) {
      const v = (up[(y0 * w2 + x0) * 3 + c] * (1 - ax) + up[(y0 * w2 + x1) * 3 + c] * ax) * (1 - ay) + (up[(y1 * w2 + x0) * 3 + c] * (1 - ax) + up[(y1 * w2 + x1) * 3 + c] * ax) * ay;
      out[p * 3 + c] = rgb[p * 3 + c] * a + v * (1 - a);
    }
  }
  return out;
}
// remove the green that the cut-out left on the doll's outline (edge pixels only); shape unchanged
export function cleanOutline(rgba: Uint8ClampedArray, w: number, h: number, reach: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba); const n = w * h;
  const clear = new Uint8Array(n); for (let p = 0; p < n; p++) clear[p] = rgba[p * 4 + 3] < 128 ? 1 : 0;
  const edge = dilate(clear, w, h, reach);
  for (let p = 0; p < n; p++) { if (!edge[p] || !rgba[p * 4 + 3]) continue; const i = p * 4; out[i + 1] = Math.min(out[i + 1], Math.round((out[i] + out[i + 2]) / 2) + 8); }
  // soft pixels take the colour of the nearest solid outline pixel
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x, i = p * 4; if (out[i + 3] === 0 || out[i + 3] >= 250) continue; let best = -1, bd = 1e9;
    for (let yy = Math.max(0, y - 3); yy <= Math.min(h - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(w - 1, x + 3); xx++) { const q = yy * w + xx; if (rgba[q * 4 + 3] < 250) continue; const d = (xx - x) ** 2 + (yy - y) ** 2; if (d < bd) { bd = d; best = q; } }
    if (best >= 0) { out[i] = out[best * 4]; out[i + 1] = out[best * 4 + 1]; out[i + 2] = out[best * 4 + 2]; } }
  return out;
}
