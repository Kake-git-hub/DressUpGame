import { sharp, fs, OUT, setup } from './common.mts';
import { cleanOutline } from './lib.mts';
import { tileTemplate } from '/home/user/DressUpGame/tools/studio/frame.ts';
const W = 1024;
const s = await setup();
const rawOf = async (f: string) => { const d = await sharp(f).ensureAlpha().raw().toBuffer(); return new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength); };
const png = (a: Uint8ClampedArray) => sharp(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
// render layers (tile space) as they would be stored at `px` pixels per frame, then shown at 1024
async function shown(layers: Buffer[], px: number, bg: string) {
  const small = await Promise.all(layers.map((b) => sharp(b).resize(px, px, { kernel: 'lanczos3' }).png().toBuffer()));
  const c = await sharp({ create: { width: px, height: px, channels: 3, background: bg } }).composite(small.map((input) => ({ input }))).png().toBuffer();
  return sharp(c).resize(W, W, { kernel: 'cubic' }).png().toBuffer(); // the game enlarges with smooth scaling
}
const out: Buffer[] = [];
{ // hair
  const [tile] = s.tiles('upper'); const doll = await png(cleanOutline(await rawOf(`${OUT}h1-pink-doll.png`), W, W, 6));
  const L = [await fs.readFile(`${OUT}h1-pink-back.png`), doll, await fs.readFile(`${OUT}h1-pink-front.png`)];
  for (const k of [1, 2]) out.push(await sharp(await shown(L, tile.from.w * k, '#fbe9f3')).extract({ left: 262, top: 90, width: 500, height: 500 }).resize(700, 700, { kernel: 'cubic' }).png().toBuffer());
}
{ // shoes
  const [tile] = s.tiles('feet'); const dollT = await tileTemplate(s.hi, 2, tile); const doll = await png(cleanOutline(dollT.rgba, W, W, 6));
  const dollHidden = await sharp(doll).composite([{ input: await fs.readFile(`${OUT}s1-pumps-hide.png`), blend: 'dest-out' }]).png().toBuffer();
  const L = [dollHidden, await fs.readFile(`${OUT}s1-pumps-skin.png`), await fs.readFile(`${OUT}s1-pumps-shoe.png`)];
  for (const k of [1, 2]) out.push(await sharp(await shown(L, tile.from.w * k, '#fbe9f3')).extract({ left: 262, top: 480, width: 500, height: 500 }).resize(700, 700, { kernel: 'cubic' }).png().toBuffer());
}
await sharp({ create: { width: 1420, height: 1420, channels: 3, background: '#fff' } }).composite(out.map((b, i) => ({ input: b, left: (i % 2) * 720, top: Math.floor(i / 2) * 720 }))).jpeg({ quality: 92 }).toFile(`${OUT}D-resolution-1x-vs-2x.jpg`);
