import sharp from '/home/user/DressUpGame/node_modules/sharp/lib/index.js';
const {data,info}=await sharp('doll_new1.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height;
// feet closeup: real doll on green
await sharp('doll_new1.png').extract({left:724,top:H-600,width:600,height:600}).resize(1024,1024).png().toFile('feet_ref.png');
// upper-half silhouette: blue doll on green
const out=Buffer.alloc(W*H*3);
for(let p=0;p<W*H;p++){const r=data[p*4],g=data[p*4+1],b=data[p*4+2];const bg=g>150&&r<140&&b<140;out[p*3]=0;out[p*3+1]=bg?255:0;out[p*3+2]=bg?0:255;}
await sharp(out,{raw:{width:W,height:H,channels:3}}).extract({left:512,top:0,width:1024,height:1024}).png().toFile('upper_sil.png');
await sharp('doll_new1.png').extract({left:512,top:0,width:1024,height:1024}).png().toFile('upper_ref.png');
