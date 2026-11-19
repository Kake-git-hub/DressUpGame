// usage: node gen.mjs out.png size "prompt" [ref.png ...]
import { createGemini } from '/home/user/DressUpGame/tools/studio/ai.ts';
import fs from 'node:fs';
const [out,size,prompt,...refs]=process.argv.slice(2);
const ai=createGemini('dummy', process.env.MODEL||'gemini-nano-banana-2.1', fetch, size);
const buf=await ai.generate({prompt, images: refs.map(r=>fs.readFileSync(r))});
fs.writeFileSync(out,buf); console.log('ok',out,buf.length);
