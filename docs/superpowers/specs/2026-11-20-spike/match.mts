import { sharp, OUT } from './common.mts';
import { matchToReference } from '/home/user/DressUpGame/src/pipeline/diffMatte.ts';
const raw = async (f: string) => { const d = await sharp(f).removeAlpha().ensureAlpha().resize(1024, 1024, { fit: 'fill' }).raw().toBuffer(); return new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength); };
for (const n of process.argv.slice(2)) {
  const img = await raw(`${OUT}${n}-gen.png`), ref = await raw(`${OUT}${n}-ref.png`);
  const m = matchToReference(img, ref, 1024, 1024);
  // residual: mean abs diff on pixels where ref is doll-ish and unchanged
  console.log(n, 'scale', m.scale, 'dx', m.dx, 'dy', m.dy);
}
