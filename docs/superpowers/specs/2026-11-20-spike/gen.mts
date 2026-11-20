// usage: gen.mts <hair|feet> <slug> <bg r,g,b> <description>
import { setup, sharp, fs, OUT } from './common.mts';
import { renderFrame } from '/home/user/DressUpGame/tools/studio/frame.ts';
import { createAiFromEnv } from '/home/user/DressUpGame/tools/studio/ai.ts';
const [kind, slug, bgArg, description] = process.argv.slice(2);
const bg = bgArg.split(',').map(Number) as [number, number, number];
const NAMES: Record<string, string> = { '0,255,0': 'pure bright green (#00FF00)', '255,0,255': 'pure magenta (#FF00FF)', '0,255,255': 'pure cyan (#00FFFF)', '0,0,255': 'pure blue (#0000FF)' };
const bgName = NAMES[bgArg];
const s = await setup();
const tiles = s.tiles(kind === 'hair' ? 'upper' : 'feet');
const reference = await renderFrame(s.hi, 2, tiles, bg, null);
await fs.writeFile(`${OUT}${slug}-ref.png`, reference);
const style = 'Japanese anime style, clean thin dark outlines, flat cel shading with soft highlights';
const prompt = kind === 'hair' ? [
  `The image is a close-up of the upper half (head to hips) of a bald doll with a blank face, for a paper-doll dress-up game, on a flat ${bgName} background.`,
  `Give the doll this hairstyle: ${description}`,
  `Art style: ${style}`,
  'Draw the complete hairstyle on the doll the way it would naturally look: the bangs and the hair on top of the head in front of the head, and the hair that falls behind the neck, shoulders and back hidden behind the body where the body is in front of it.',
  'Strict rules:',
  '- Keep the doll exactly as it is: same position, size, pose, outline, skin colour and underwear. Do not move, resize, redraw or restyle it. Keep the same framing; do not zoom or crop.',
  '- The face stays completely blank: no eyes, eyebrows, nose, mouth or blush. Faces are a separate item.',
  '- Draw only the hair (a small hair ornament is fine if the description asks for one). No hat, no clothes, no other objects.',
  `- The background stays the same flat ${bgName} with no shadow, gradient, text or frame. Every gap between strands of hair shows the flat background or the doll.`,
  `- The hair must not contain ${bgName} or colours close to it.`,
  '- The whole hairstyle fits inside the image with a clear margin on every side, and ends above the bottom edge.',
  '- Same art style and thin dark outlines as the doll.',
].join('\n') : [
  `The image is a close-up of the lower legs and bare feet of a doll for a paper-doll dress-up game, on a flat ${bgName} background.`,
  `Put this pair of shoes on the feet: ${description}`,
  `Art style: ${style}`,
  'The shoes replace the bare feet: draw each foot inside its shoe naturally (skin visible in the opening of a low shoe or between sandal straps is fine), with no part of the original bare foot sticking out beside or below the shoe.',
  'Strict rules:',
  '- Keep both legs exactly as they are above the shoes: same position, size, outline and skin colour.',
  '- Keep the same framing. Do not zoom, crop, move or rotate anything.',
  `- The background stays the same flat ${bgName} with no shadow, floor, gradient, text or frame.`,
  `- The item must not contain ${bgName} or colours close to it.`,
  '- Draw the item in the same art style and with the same thin outlines as the doll.',
  '- Draw only this one item, fully visible and not cut off by the image edge.',
].join('\n');
await fs.writeFile(`${OUT}${slug}-prompt.txt`, prompt);
const ai = createAiFromEnv().image!;
const t = Date.now();
const out = await ai.generate({ prompt, images: [reference] });
await fs.writeFile(`${OUT}${slug}-gen.png`, out);
const meta = await sharp(out).metadata();
console.log(slug, meta.width, meta.height, `${Date.now() - t}ms`);
