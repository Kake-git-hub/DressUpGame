import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_ID, STYLE_PRESETS, findStyle } from '../studio/stylePresets';

describe('絵柄の選択肢', () => {
  it('「マンガ」がアニメのすぐ後ろにある', () => {
    expect(STYLE_PRESETS.map((s) => s.id).slice(0, 2)).toEqual(['anime', 'manga']);
    expect(findStyle('manga').label).toBe('マンガ');
  });
  it('マンガの指示は、線とトーンと「色つき」を言う', () => {
    const p = findStyle('manga').prompt;
    expect(p).toMatch(/manga/i);
    expect(p).toMatch(/screentone/i);
    expect(p).toMatch(/full colou?r/i);
  });
  it('ID は重ならない。知らない ID・空は既定（アニメ）に戻る', () => {
    expect(new Set(STYLE_PRESETS.map((s) => s.id)).size).toBe(STYLE_PRESETS.length);
    expect(findStyle('no-such-style').id).toBe(DEFAULT_STYLE_ID);
    expect(findStyle(null).id).toBe('anime');
  });
});
