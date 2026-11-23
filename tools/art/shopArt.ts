/**
 * 演出（注文・チケットを切る・服が届く）の絵を作る道具（コマンド）
 *
 *   絵柄の見本を作る:  npx tsx tools/art/shopArt.ts ref <素材フォルダ> <ドールの ID> <出力の PNG>
 *                      （ドールに、顔・髪・服を 1 点ずつ着せた絵。店員を、ゲームと同じ絵柄にするための見本）
 *   絵を作る:          npx tsx tools/art/shopArt.ts <order|ticket|deliver|shop> <出力フォルダ> <見本の画像>…
 *                      （order は絵柄の見本だけ。ticket・deliver は、えらんだ order の絵（raw）も渡して、同じ人にする）
 *   処理だけやり直す:  npx tsx tools/art/shopArt.ts cut <order|ticket|deliver|shop> <もとの絵（raw）> <出力の WebP>
 *                      （画像生成はしない。背景の抜き方を直したときなどに）
 *
 * 店員の絵は、緑の背景で作って背景を抜く。出力: <種類>-raw-<時刻>.png（もとの絵）と <種類>-<時刻>.webp（長い辺 768px）。
 * 生成には GEMINI_API_KEY が要る（クラウド環境では NODE_USE_ENV_PROXY=1 と仮のキー）。1 回の実行で 1 枚。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Manifest, ManifestImage } from '../../src/content/manifest.ts';
import { createAiFromEnv } from '../studio/ai.ts';
import { cutOutDoll } from '../studio/makeDoll.ts';

const SIDE = 768;
// どの絵にも付ける決まり（服を作るときの指示と同じ: キャラクター名・作品名・ブランド名を書かない、文字を入れない）
const RULES = [
  'Original character only: do not depict or name any existing character, franchise, brand or logo.',
  'No text, letters, numbers, signs or watermarks anywhere in the image.',
  'Friendly, gentle and suitable for young children.',
].join(' ');
const CLERK = [
  'A friendly young woman who runs a small clothing shop (a tailor / dressmaker).',
  'She wears a simple pastel apron over a plain blouse, with a yellow measuring tape hanging around her neck, and her hair tied back.',
  'Draw her in the SAME art style as the reference character image (same line weight, flat anime colouring and proportions), but as a different, adult person with a kind smiling face.',
  'Framing: from the top of her head down to just above the knees, centred, facing the viewer, the whole figure inside the frame with a small margin.',
  'Background: one flat pure green colour (#00FF00) with nothing else — no floor, no shadow, no gradient. Do not use green anywhere on the character.',
].join(' ');
const SAME_PERSON = 'She must be the SAME person as in the second reference image (same face, hair, apron and colours).';

export const PROMPTS: Record<'order' | 'ticket' | 'deliver' | 'shop', string> = {
  order: `${CLERK} Pose: she is taking an order — holding a small notepad in one hand and a pencil in the other, looking up at the viewer with a welcoming smile. ${RULES}`,
  ticket: `${CLERK} ${SAME_PERSON} Pose: she happily holds up a pair of scissors in one hand and a small plain paper ticket (a blank pastel-yellow rectangle with a perforated edge) in the other hand, about to snip it. ${RULES}`,
  deliver: `${CLERK} ${SAME_PERSON} Pose: she proudly presents a neatly folded piece of clothing tied with a ribbon, holding it out toward the viewer with both hands, with a big smile. ${RULES}`,
  shop:
    'The inside of a small, cosy clothing shop for a children\'s picture book, drawn in the same soft anime art style and pastel colours as the reference image. ' +
    'A wooden counter in the lower third, shelves with folded fabrics and spools of thread, a dress form (mannequin) and a few clothes on hangers in the background, warm soft light. ' +
    'No people. The middle of the image is calm and uncluttered (a soft pastel wall), because text and characters will be placed on top of it. ' +
    RULES,
};

// ドールに、顔・髪・服を 1 点ずつ着せた絵（絵柄の見本）
async function reference(contentDir: string, dollId: string, out: string): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(path.join(contentDir, 'manifest.json'), 'utf8')) as Manifest;
  const doll = manifest.dolls.find((d) => d.id === dollId);
  if (!doll) throw new Error(`ドール「${dollId}」が見つかりません`);
  const W = doll.image.canvasW;
  const H = doll.image.canvasH;
  const labelOf = (categoryId: string) => doll.categories.find((c) => c.id === categoryId)?.label ?? '';
  const pick = (pattern: RegExp) => doll.items.find((item) => pattern.test(labelOf(item.category)));
  const layers: sharp.OverlayOptions[] = [];
  // 服のキャンバスは、ドールのキャンバスのまわりに余白を足した大きさのことがある（中心は同じ）
  const add = async (image: ManifestImage | undefined) => {
    if (!image) return;
    const left = Math.round(image.box.x - (image.canvasW - W) / 2);
    const top = Math.round(image.box.y - (image.canvasH - H) / 2);
    const input = await sharp(path.join(contentDir, image.file)).resize(image.box.w, image.box.h, { fit: 'fill' }).png().toBuffer();
    // はみ出す分は、切る
    const region = { left: Math.max(0, -left), top: Math.max(0, -top), width: Math.min(image.box.w, W - Math.max(0, left)) - Math.max(0, -left), height: Math.min(image.box.h, H - Math.max(0, top)) - Math.max(0, -top) };
    if (region.width <= 0 || region.height <= 0) return;
    layers.push({ input: await sharp(input).extract(region).png().toBuffer(), left: Math.max(0, left), top: Math.max(0, top) });
  };
  const hair = pick(/ヘア|かみ|髪/);
  const face = pick(/かお|顔/);
  const dress = pick(/ドレス|ワンピ/) ?? pick(/トップス/);
  await add(hair?.back);
  await add(doll.image);
  await add(dress?.image);
  await add(face?.image);
  await add(hair?.image);
  await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } }).composite(layers).png().toFile(out);
  console.log(`見本: ${out}（髪「${hair?.name ?? 'なし'}」・顔「${face?.name ?? 'なし'}」・服「${dress?.name ?? 'なし'}」）`);
}

async function generate(kind: keyof typeof PROMPTS, outDir: string, references: string[]): Promise<void> {
  const { image } = createAiFromEnv();
  if (!image) throw new Error('GEMINI_API_KEY が設定されていません');
  await fs.mkdir(outDir, { recursive: true });
  const images = await Promise.all(references.map((file) => sharp(file).png().toBuffer()));
  const raw = await image.generate({ prompt: PROMPTS[kind], images });
  const stamp = Date.now().toString(36);
  const rawFile = path.join(outDir, `${kind}-raw-${stamp}.png`);
  await fs.writeFile(rawFile, raw);
  console.log(`もとの絵: ${rawFile}`);
  await finish(kind, raw, path.join(outDir, `${kind}-${stamp}.webp`));
}

// 店員の絵は、ひざの所で下の端まで届いている（まわりが単色でない）。背景の色（左上のすみの色）で、まわりに余白を足す
async function framed(raw: Buffer): Promise<Buffer> {
  const corner = await sharp(raw).extract({ left: 0, top: 0, width: 16, height: 16 }).removeAlpha().raw().toBuffer();
  const channel = (c: number) => [...corner.filter((_, i) => i % 3 === c)].sort((a, b) => a - b)[128];
  const background = { r: channel(0), g: channel(1), b: channel(2), alpha: 1 };
  return sharp(raw).extend({ top: 16, bottom: 16, left: 16, right: 16, background }).png().toBuffer();
}

// もとの絵（raw）から、使う絵にする: 店員は、緑の背景を抜いて、まわりの余白を切る。お店は、そのまま。長い辺 768px の WebP
async function finish(kind: keyof typeof PROMPTS, raw: Buffer, out: string): Promise<void> {
  const cut = kind === 'shop' ? raw : await sharp(await cutOutDoll(await framed(raw))).trim().png().toBuffer();
  await sharp(cut).resize(SIDE, SIDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: kind === 'shop' ? 78 : 88, alphaQuality: 90 }).toFile(out);
  console.log(`できました: ${out}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'ref' && args.length === 3) await reference(args[0], args[1], args[2]);
else if (command === 'cut' && args.length === 3 && args[0] in PROMPTS) await finish(args[0] as keyof typeof PROMPTS, await fs.readFile(args[1]), args[2]);
else if (command && command in PROMPTS && args.length >= 2) await generate(command as keyof typeof PROMPTS, args[0], args.slice(1));
else {
  console.error('使い方: shopArt.ts ref <素材フォルダ> <ドールの ID> <出力の PNG> ／ shopArt.ts <order|ticket|deliver|shop> <出力フォルダ> <見本の画像>…');
  process.exitCode = 1;
}
