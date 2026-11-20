import { sharp, fs, OUT } from './common.mts';
import { cleanOutline } from './lib.mts';
const W = 1024;
const rawOf = async (f: string) => { const d = await sharp(f).ensureAlpha().raw().toBuffer(); return new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength); };
const png = (a: Uint8ClampedArray) => sharp(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
const on = (color: string, layers: Buffer[]) => sharp({ create: { width: W, height: W, channels: 3, background: color } }).composite(layers.map((input) => ({ input }))).png().toBuffer();
const rows: Buffer[][] = [];
for (const slug of ['h1-pink', 'h2-brown', 'h3-braids']) {
  const dollRaw = await rawOf(`${OUT}${slug}-doll.png`);
  const doll = await png(cleanOutline(dollRaw, W, W, 6));
  const sil = new Uint8ClampedArray(dollRaw.length); for (let p = 0; p < W * W; p++) { sil[p * 4] = 226; sil[p * 4 + 1] = 222; sil[p * 4 + 2] = 236; sil[p * 4 + 3] = dollRaw[p * 4 + 3]; }
  const silP = await png(sil);
  const front = await fs.readFile(`${OUT}${slug}-front.png`), back = await fs.readFile(`${OUT}${slug}-back.png`);
  // thumbnails: crop to the hair's bounding box (square), 192px, shown enlarged
  const bb = await sharp(back).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const { trimOffsetLeft: tl, trimOffsetTop: tt, width: bw, height: bh } = bb.info as any;
  const side = Math.min(W, Math.max(bw, bh) + 20); const left = Math.max(0, Math.min(W - side, -tl - Math.round((side - bw) / 2))); const top = Math.max(0, Math.min(W - side, -tt - Math.round((side - bh) / 2)));
  const thumb = async (layers: Buffer[]) => sharp(await sharp(await on('#f7f3fb', layers)).extract({ left, top, width: side, height: side }).resize(192, 192).png().toBuffer()).resize(512, 512, { kernel: 'nearest' }).extend({ top: 256, bottom: 256, left: 0, right: 0, background: '#fff' }).png().toBuffer();
  rows.push([await on('#fbe9f3', [back, doll, front]), await on('#78c88c', [back]), await on('#78c88c', [front])]);
  await sharp({ create: { width: 512 * 3 + 40, height: 512, channels: 3, background: '#fff' } }).composite([
    { input: await sharp(await thumb([back])).extract({ left: 0, top: 256, width: 512, height: 512 }).toBuffer(), left: 0, top: 0 },
    { input: await sharp(await thumb([back, silP])).extract({ left: 0, top: 256, width: 512, height: 512 }).toBuffer(), left: 532, top: 0 },
    { input: await sharp(await thumb([back, silP, front])).extract({ left: 0, top: 256, width: 512, height: 512 }).toBuffer(), left: 1064, top: 0 },
  ]).png().toFile(`${OUT}${slug}-thumbs.png`);
}
await sharp({ create: { width: W * 3, height: W * 3, channels: 3, background: '#fff' } }).composite(rows.flatMap((r, y) => r.map((b, x) => ({ input: b, left: x * W, top: y * W })))).resize({ width: 2100 }).jpeg({ quality: 88 }).toFile(`${OUT}A-hair-new.jpg`);
const th = await Promise.all(['h1-pink', 'h2-brown', 'h3-braids'].map((s) => fs.readFile(`${OUT}${s}-thumbs.png`)));
await sharp({ create: { width: 1576, height: 512 * 3 + 40, channels: 3, background: '#fff' } }).composite(th.map((b, i) => ({ input: b, left: 0, top: i * 532 }))).jpeg({ quality: 90 }).toFile(`${OUT}B-thumbnails.jpg`);
// shoes: [old bare | new bare | old sock | new sock] for the 3 shoes
const zs: Buffer[] = [];
for (const n of ['s1-pumps', 's2-sandals', 's3-boots']) { const m = await sharp(`${OUT}${n}-result.jpg`).metadata(); const t: Buffer[] = [];
  for (const k of [1, 2, 3, 4]) t.push(await sharp(`${OUT}${n}-result.jpg`).extract({ left: k * 1024 + 232, top: m.height! - 560, width: 560, height: 520 }).toBuffer());
  zs.push(await sharp({ create: { width: 2240, height: 520, channels: 3, background: '#fff' } }).composite(t.map((b, i) => ({ input: b, left: i * 560, top: 0 }))).png().toBuffer()); }
await sharp({ create: { width: 2240, height: 1560, channels: 3, background: '#fff' } }).composite(zs.map((b, i) => ({ input: b, left: 0, top: i * 520 }))).jpeg({ quality: 90 }).toFile(`${OUT}C-shoes-old-vs-new.jpg`);
