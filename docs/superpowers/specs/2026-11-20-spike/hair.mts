// usage: hair.mts <slug> <bg r,g,b>
import { setup, sharp, fs, OUT } from './common.mts';
import { dilate, erode, components, pushPull } from './lib.mts';
import { matchToReference } from '/home/user/DressUpGame/src/pipeline/diffMatte.ts';
import { cutOutClothing } from '/home/user/DressUpGame/src/pipeline/cutout.ts';
import { tileTemplate } from '/home/user/DressUpGame/tools/studio/frame.ts';
const [slug, bgArg] = process.argv.slice(2);
const bg = bgArg.split(',').map(Number) as [number, number, number];
const W = 1024, N = W * W;
const T_LOW = 12, T_SAME = 16, T_FULL = 36;
const s = await setup();
const [tile] = s.tiles('upper');
const raw = async (f: string) => { const d = await sharp(f).removeAlpha().ensureAlpha().resize(W, W, { fit: 'fill' }).raw().toBuffer(); return new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength); };
const ref = await raw(`${OUT}${slug}-ref.png`);
const m = matchToReference(await raw(`${OUT}${slug}-gen.png`), ref, W, W);
const img = m.rgba;
const dollT = await tileTemplate(s.hi, 2, tile);
const doll = new Uint8Array(N); for (let p = 0; p < N; p++) doll[p] = dollT.rgba[p * 4 + 3] >= 128 ? 1 : 0;

// 1. foreground of the AI picture (doll + hair): background removed, soft despilled edges
const cut = new Uint8ClampedArray(img); cutOutClothing(cut, W, W, { background: bg, silhouette: null });
// 2. distance from the reference, tolerant of 1px jitter
const dist = new Float32Array(N);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4; let best = 1e9;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(W - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
    const j = (yy * W + xx) * 4; const d = Math.hypot(img[i] - ref[j], img[i + 1] - ref[j + 1], img[i + 2] - ref[j + 2]); if (d < best) best = d; }
  dist[y * W + x] = best;
}
// 3. hair on the doll = changed pixels inside the doll; hair around it = foreground outside the doll
const inHair = new Uint8Array(N), outHair = new Uint8Array(N);
for (let p = 0; p < N; p++) { inHair[p] = doll[p] && dist[p] > T_SAME ? 1 : 0; outHair[p] = !doll[p] && cut[p * 4 + 3] >= 128 ? 1 : 0; }
components(inHair, W, W, (px, n) => { if (n < 40) for (let k = 0; k < n; k++) inHair[px[k]] = 0; });
{ const hole = new Uint8Array(N); for (let p = 0; p < N; p++) hole[p] = doll[p] && !inHair[p] ? 1 : 0; let f = 0;
  components(hole, W, W, (px, n, border) => { if (border || n > 80) return; for (let k = 0; k < n; k++) { inHair[px[k]] = 1; f++; } }); console.log('holes filled px', f); }
// outside: drop the doll's own soft edge and other slivers (keep pieces with a core)
{ const core = erode(outHair, W, W, 2); components(outHair, W, W, (px, n) => { let has = false; for (let k = 0; k < n && !has; k++) has = !!core[px[k]]; if (!has) for (let k = 0; k < n; k++) outHair[px[k]] = 0; }); }

// FRONT: thick hair on the doll (thin slivers along the outline are the back hair touching the body: leave the doll's own line there)
const thick = dilate(erode(inHair, W, W, 3), W, W, 6);
const frontIn = new Uint8Array(N); for (let p = 0; p < N; p++) frontIn[p] = inHair[p] && thick[p] ? 1 : 0;
components(frontIn, W, W, (px, n) => { if (n < 150) for (let k = 0; k < n; k++) frontIn[px[k]] = 0; });
const nearFront = dilate(frontIn, W, W, 6);
const front = new Uint8ClampedArray(N * 4);
const bareNear = dilate((() => { const b = new Uint8Array(N); for (let p = 0; p < N; p++) b[p] = doll[p] && !inHair[p] ? 1 : 0; return b; })(), W, W, 1);
for (let p = 0; p < N; p++) {
  const i = p * 4;
  if (frontIn[p]) {
    let a = 255;
    if (bareNear[p]) a = Math.round(255 * Math.max(0.5, Math.min(1, (dist[p] - T_LOW) / (T_FULL - T_LOW)))); // feather where hair meets bare skin
    front[i] = img[i]; front[i + 1] = img[i + 1]; front[i + 2] = img[i + 2]; front[i + 3] = a;
  } else if (outHair[p] && nearFront[p]) { front[i] = cut[i]; front[i + 1] = cut[i + 1]; front[i + 2] = cut[i + 2]; front[i + 3] = cut[i + 3]; }
}

// BACK: all hair, plus a smooth fill under the doll (never outside it)
const back = new Uint8ClampedArray(N * 4); const hair = new Uint8Array(N);
for (let p = 0; p < N; p++) { const i = p * 4; if (outHair[p]) { back.set(cut.subarray(i, i + 4), i); hair[p] = 1; } else if (inHair[p]) { back[i] = img[i]; back[i + 1] = img[i + 1]; back[i + 2] = img[i + 2]; back[i + 3] = 255; hair[p] = 1; } }
const region = new Uint8Array(N);
for (let y = 0; y < W; y++) { let first = -1, last = -1; for (let x = 0; x < W; x++) if (hair[y * W + x]) { if (first < 0) first = x; last = x; }
  if (first < 0) continue; for (let x = first; x <= last; x++) { const p = y * W + x; if (doll[p] && !hair[p]) region[p] = 1; } }
{ const near = dilate(hair, W, W, 8); for (let p = 0; p < N; p++) if (doll[p] && !hair[p] && near[p]) region[p] = 1; } // tuck under the body edge
const lum = (i: number, a: Uint8ClampedArray) => a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11;
const ls: number[] = []; for (let p = 0; p < N; p += 7) if (outHair[p]) ls.push(lum(p * 4, back)); ls.sort((a, b) => a - b); const med = ls[ls.length >> 1] ?? 128;
const rgb = new Float32Array(N * 3), wt = new Float32Array(N); const core = erode(outHair, W, W, 3);
for (let p = 0; p < N; p++) if (core[p] && lum(p * 4, back) > med * 0.85) { wt[p] = 1; for (let c = 0; c < 3; c++) rgb[p * 3 + c] = back[p * 4 + c]; }
const field = pushPull(rgb, wt, W, W);
for (let p = 0; p < N; p++) if (region[p]) { back[p * 4] = field[p * 3]; back[p * 4 + 1] = field[p * 3 + 1]; back[p * 4 + 2] = field[p * 3 + 2]; back[p * 4 + 3] = 255; }

const png = (a: Uint8ClampedArray) => sharp(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
const [fp, bp, dp] = [await png(front), await png(back), await png(dollT.rgba)];
await fs.writeFile(`${OUT}${slug}-front.png`, fp); await fs.writeFile(`${OUT}${slug}-back.png`, bp); await fs.writeFile(`${OUT}${slug}-doll.png`, dp);
const on = (color: string | { r: number; g: number; b: number }, layers: Buffer[]) => sharp({ create: { width: W, height: W, channels: 3, background: color } }).composite(layers.map((input) => ({ input }))).png().toBuffer();
const worn = await on('#c8cdd7', [bp, dp, fp]);
await fs.writeFile(`${OUT}${slug}-worn.png`, worn);
const onKey = await sharp(await on({ r: bg[0], g: bg[1], b: bg[2] }, [bp, dp, fp])).removeAlpha().raw().toBuffer();
let bad = 0; for (let p = 0; p < N; p++) { const d = Math.hypot(onKey[p * 3] - img[p * 4], onKey[p * 3 + 1] - img[p * 4 + 1], onKey[p * 3 + 2] - img[p * 4 + 2]); if (d > 60) bad++; }
let outsideFill = 0; for (let p = 0; p < N; p++) if (region[p] && !doll[p]) outsideFill++;
console.log(slug, 'shift', m.scale, m.dx, m.dy, '| pixels unlike the AI picture:', (100 * bad / N).toFixed(2) + '%', '| fill outside the doll:', outsideFill, 'px');
const tiles = [await sharp(`${OUT}${slug}-gen.png`).resize(W, W).png().toBuffer(), worn, await on('#78c88c', [bp]), await on('#78c88c', [fp])];
await sharp({ create: { width: W * 4, height: W, channels: 3, background: '#fff' } }).composite(tiles.map((b, i) => ({ input: b, left: i * W, top: 0 }))).jpeg({ quality: 90 }).toFile(`${OUT}${slug}-result.jpg`);
await sharp(`${OUT}${slug}-result.jpg`).resize({ width: 2000 }).jpeg({ quality: 88 }).toFile(`${OUT}${slug}-result-s.jpg`);
