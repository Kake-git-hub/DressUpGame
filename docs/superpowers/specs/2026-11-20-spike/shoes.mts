// usage: shoes.mts <slug> <bg r,g,b>
import { setup, sharp, fs, OUT, C } from './common.mts';
import { dilate, erode, components, cleanOutline } from './lib.mts';
import { matchToReference } from '/home/user/DressUpGame/src/pipeline/diffMatte.ts';
import { cutOutClothing } from '/home/user/DressUpGame/src/pipeline/cutout.ts';
import { tileTemplate, toTile } from '/home/user/DressUpGame/tools/studio/frame.ts';
import { processSwap } from '/home/user/DressUpGame/tools/studio/processSwap.ts';
import { swapZones } from '/home/user/DressUpGame/src/pipeline/frames.ts';
const [slug, bgArg] = process.argv.slice(2);
const bg = bgArg.split(',').map(Number) as [number, number, number];
const W = 1024, N = W * W, T_SAME = 16;
const s = await setup();
const tiles = s.tiles('feet'); const tile = tiles[0];
const raw = async (f: string | Buffer) => { const d = await sharp(f).removeAlpha().ensureAlpha().resize(W, W, { fit: 'fill' }).raw().toBuffer(); return new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength); };
const refPng = await fs.readFile(`${OUT}${slug}-ref.png`), genPng = await fs.readFile(`${OUT}${slug}-gen.png`);
const ref = await raw(refPng);
const m = matchToReference(await raw(genPng), ref, W, W); const img = m.rgba;
const dollT = await tileTemplate(s.hi, 2, tile);
const doll = new Uint8Array(N); for (let p = 0; p < N; p++) doll[p] = dollT.rgba[p * 4 + 3] >= 128 ? 1 : 0;
const cut = new Uint8ClampedArray(img); cutOutClothing(cut, W, W, { background: bg, silhouette: null });
const G = new Uint8Array(N); for (let p = 0; p < N; p++) G[p] = cut[p * 4 + 3] >= 128 ? 1 : 0;
const changed = new Uint8Array(N);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; let best = 1e9;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(W - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) { const j = (yy * W + xx) * 4; const d = Math.hypot(img[i] - ref[j], img[i + 1] - ref[j + 1], img[i + 2] - ref[j + 2]); if (d < best) best = d; }
  changed[y * W + x] = best > T_SAME ? 1 : 0; }
const zone = toTile(s.parts.feet, tile); // from the ankle line down
const inZone = (p: number) => { const y = (p / W) | 0; return y >= zone.y; };
// skin tone of the doll (median of the reference doll) and "skin-like" test (base tone … its shade)
const rs: number[] = [], gs: number[] = [], bs: number[] = [];
for (let p = 0; p < N; p += 11) if (doll[p] && dollT.rgba[p * 4 + 3] === 255) { rs.push(ref[p * 4]); gs.push(ref[p * 4 + 1]); bs.push(ref[p * 4 + 2]); }
const med = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1]; const skin = [med(rs), med(gs), med(bs)];
const skinLike = (i: number) => { let best = 1e9; for (let k = 0.78; k <= 1.03; k += 0.05) best = Math.min(best, Math.hypot(img[i] - skin[0] * k, img[i + 1] - skin[1] * k, img[i + 2] - skin[2] * k)); return best < 22; };
// skin layer: the foot the AI drew (skin-like, in the zone), with the thin lines enclosed by it (toes)
const skinM = new Uint8Array(N); for (let p = 0; p < N; p++) skinM[p] = G[p] && inZone(p) && skinLike(p * 4) ? 1 : 0;
components(skinM, W, W, (px, n) => { if (n < 60) for (let k = 0; k < n; k++) skinM[px[k]] = 0; });
const closed = erode(dilate(skinM, W, W, 3), W, W, 3);
for (let p = 0; p < N; p++) if (closed[p] && G[p] && inZone(p)) skinM[p] = 1;
// shoe layer: everything else the AI drew in the zone, and what it changed above it (boot shaft, straps)
const shoeM = new Uint8Array(N); for (let p = 0; p < N; p++) shoeM[p] = G[p] && !skinM[p] && (inZone(p) ? true : changed[p] === 1) ? 1 : 0;
{ const core = erode(shoeM, W, W, 2); components(shoeM, W, W, (px, n) => { let has = false; for (let k = 0; k < n && !has; k++) has = !!core[px[k]]; if (!has) for (let k = 0; k < n; k++) shoeM[px[k]] = 0; }); }
const layer = (mask: Uint8Array, soft: boolean) => { const o = new Uint8ClampedArray(N * 4); const near = soft ? dilate(mask, W, W, 2) : mask;
  for (let p = 0; p < N; p++) { const i = p * 4; if (mask[p]) { o.set(cut.subarray(i, i + 3), i); o[i + 3] = Math.max(cut[i + 3], 0); } else if (soft && near[p] && cut[i + 3] > 0 && cut[i + 3] < 128 && !doll[p]) { o.set(cut.subarray(i, i + 4), i); } } return o; };
const shoe = layer(shoeM, true), skinL = layer(skinM, false);
{ const d: number[][] = [[], [], []]; for (let p = 0; p < N; p += 5) if (doll[p] && !changed[p] && dollT.rgba[p * 4 + 3] === 255) for (let c = 0; c < 3; c++) d[c].push(img[p * 4 + c] - ref[p * 4 + c]);
  const drift = d.map((v) => (v.length ? med(v) : 0)); console.log('skin drift', drift.join(','));
  const FEATHER = 10;
  for (let p = 0; p < N; p++) { const i = p * 4; if (!skinL[i + 3]) continue; for (let c = 0; c < 3; c++) skinL[i + c] = Math.max(0, Math.min(255, skinL[i + c] - drift[c])); const y = (p / W) | 0; if (y < zone.y + FEATHER) skinL[i + 3] = Math.round(skinL[i + 3] * Math.max(0, (y - zone.y) / FEATHER)); } }
// hide: the part of the bare foot that sticks out of the new picture (applies to the doll and to socks)
const Gin = erode(G, W, W, 2); const hide = new Uint8ClampedArray(N * 4);
for (let p = 0; p < N; p++) if (inZone(p) && !Gin[p]) { hide[p * 4] = hide[p * 4 + 1] = hide[p * 4 + 2] = 255; hide[p * 4 + 3] = 255; }

const png = (a: Uint8ClampedArray, w = W) => sharp(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { raw: { width: w, height: w, channels: 4 } }).png().toBuffer();
const BGC = '#c8cdd7';
const flat = (w = W) => sharp({ create: { width: w, height: w, channels: 3, background: BGC } });
// the published sock, in tile space
const sockItem = s.doll.items.find((i: any) => i.name === 'しろいハイソックス').image;
const sockFull = await sharp({ create: { width: 1228, height: 1228, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp(C + sockItem.file).resize(sockItem.box.w, sockItem.box.h, { fit: 'fill' }).png().toBuffer(), left: sockItem.box.x, top: sockItem.box.y }]).png().toBuffer();
const sockCanvas = await sharp(sockFull).extract({ left: tile.from.x, top: tile.from.y, width: tile.from.w, height: tile.from.h }).png().toBuffer();
const sockTile = await sharp(sockCanvas).resize(W, W, { kernel: 'lanczos3' }).png().toBuffer();
const minus = async (a: Buffer, mask: Buffer) => sharp(a).composite([{ input: mask, blend: 'dest-out' }]).png().toBuffer();

// NEW: clean outline doll, stored at 2x (tile 1024 → 726 → shown at 1024)
const dollClean = await png(cleanOutline(dollT.rgba, W, W, 6));
const hideP = await png(hide), shoeP = await png(shoe), skinP = await png(skinL);
const twoX = async (b: Buffer) => sharp(await sharp(b).resize(tile.from.w * 2, tile.from.h * 2, { kernel: 'lanczos3' }).png().toBuffer()).resize(W, W, { kernel: 'lanczos3' }).png().toBuffer();
const newBare = await flat().composite([{ input: await minus(dollClean, hideP) }, { input: await twoX(skinP) }, { input: await twoX(shoeP) }]).png().toBuffer();
const newSock = await flat().composite([{ input: await minus(dollClean, hideP) }, { input: await twoX(skinP) }, { input: await minus(sockTile, hideP) }, { input: await twoX(shoeP) }]).png().toBuffer();

// OLD: the current pipeline on the same AI picture, at the current resolution (1x)
const old = await processSwap(genPng, refPng, s.work, tiles, swapZones('feet', s.parts), bg);
const cw = s.work.canvasW; const crop = (b: Buffer) => sharp(b).extract({ left: tile.from.x, top: tile.from.y, width: tile.from.w, height: tile.from.h }).png().toBuffer();
const oldItem = await crop(await png(old.rgba, cw));
const hideOld = new Uint8ClampedArray(cw * cw * 4); for (let p = 0; p < cw * cw; p++) if (old.hide[p]) hideOld.fill(255, p * 4, p * 4 + 4);
const oldHide = await crop(await png(hideOld, cw));
const dollOld = await crop(await png(s.work.rgba, cw));
const up = (b: Buffer) => sharp(b).resize(W, W, { kernel: 'lanczos3' }).png().toBuffer();
const small = { create: { width: tile.from.w, height: tile.from.h, channels: 3 as const, background: BGC } };
const oldBare = await up(await sharp(small).composite([{ input: await minus(dollOld, oldHide) }, { input: oldItem }]).png().toBuffer());
const oldSock = await up(await sharp(small).composite([{ input: await minus(dollOld, oldHide) }, { input: sockCanvas }, { input: oldItem }]).png().toBuffer());
console.log(slug, 'shift', m.scale, m.dx, m.dy, 'old warnings:', old.warnings.map((w) => w.code).join(',') || 'none');
const panels = [await sharp(genPng).resize(W, W).png().toBuffer(), oldBare, newBare, oldSock, newSock];
const cropY = Math.round(W * 0.42);
const strip = await sharp({ create: { width: W * 5, height: W, channels: 3, background: '#fff' } }).composite(panels.map((b, i) => ({ input: b, left: i * W, top: 0 }))).png().toBuffer();
await sharp(strip).extract({ left: 0, top: cropY, width: W * 5, height: W - cropY }).jpeg({ quality: 90 }).toFile(`${OUT}${slug}-result.jpg`);
await sharp(`${OUT}${slug}-result.jpg`).resize({ width: 2000 }).jpeg({ quality: 90 }).toFile(`${OUT}${slug}-result-s.jpg`);
for (const [n, b] of [['shoe', shoeP], ['skin', skinP], ['hide', hideP]] as const) await fs.writeFile(`${OUT}${slug}-${n}.png`, b);
