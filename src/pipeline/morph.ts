/**
 * 2 値の絵（1 = ある、0 = ない）の、太らせ・細らせ・かたまり分け
 */

// 上下左右 r px の正方形で太らせる（横 → 縦の 2 回に分けて、画素数に比例する時間で済ませる）
export function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const pass = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let last = -Infinity;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) last = x;
      if (x - last <= r) pass[row + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x]) last = x;
      if (last - x <= r) pass[row + x] = 1;
    }
  }
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (pass[y * width + x]) last = y;
      if (y - last <= r) out[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (pass[y * width + x]) last = y;
      if (last - y <= r) out[y * width + x] = 1;
    }
  }
  return out;
}

// 同じ正方形で細らせる。絵の外は「ない」とみなす（端の画素は細る）
export function erode(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const w = width + 2;
  const h = height + 2;
  const inverted = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) inverted[(y + 1) * w + x + 1] = 0;
  const grown = dilate(inverted, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = grown[(y + 1) * w + x + 1] ? 0 : 1;
  return out;
}

/**
 * ひと続き（上下左右）のかたまりごとに visit を呼ぶ。
 * pixels は使い回す配列で、先頭の count 個がそのかたまりの画素。touchesBorder は、絵の端に触れているか
 */
export function components(mask: Uint8Array, width: number, height: number, visit: (pixels: Int32Array, count: number, touchesBorder: boolean) => void): void {
  const total = width * height;
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const piece = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    let count = 0;
    let border = false;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      piece[count++] = p;
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
      const push = (n: number) => {
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }
    visit(piece, count, border);
  }
}
