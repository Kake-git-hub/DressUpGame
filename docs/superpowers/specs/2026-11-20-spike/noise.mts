import { sharp, OUT } from './common.mts';
const W = 1024;
const raw = async (f: string) => { const d = await sharp(f).removeAlpha().resize(W, W, { fit: 'fill' }).raw().toBuffer(); return d; };
for (const n of process.argv.slice(2)) {
  const a = await raw(`${OUT}${n}-gen.png`), b = await raw(`${OUT}${n}-ref.png`);
  const hist = new Int32Array(8); let cnt = 0;
  // sample: box given as fraction args via env BOX=x0,y0,x1,y1
  const [x0, y0, x1, y1] = (process.env.BOX ?? '0.45,0.62,0.55,0.70').split(',').map((v) => Math.round(+v * W));
  const dr: number[] = [], dg: number[] = [], db: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 3; const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]); hist[Math.min(7, Math.floor(d / 4))]++; cnt++; dr.push(a[i] - b[i]); dg.push(a[i + 1] - b[i + 1]); db.push(a[i + 2] - b[i + 2]); }
  const med = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1];
  console.log(n, 'dist histogram (0-4,4-8,...,28+) %:', Array.from(hist).map((h) => (100 * h / cnt).toFixed(1)).join(' '), 'median drift', med(dr), med(dg), med(db));
}
