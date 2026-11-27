import { expect, it } from 'vitest';

// variety.ts を先に読み込んでも、動く（generate.ts と互いに読み込まない）
it('variety.ts だけを先に読み込める', async () => {
  const variety = await import('./variety.ts');
  expect(variety.VARIETY_REQUIRED).toContain('specificity');
  const generate = await import('./generate.ts');
  expect(generate.categoryKind('くつ')).toBe('shoes');
});
