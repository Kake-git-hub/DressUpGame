import sharp from '/home/user/DressUpGame/node_modules/sharp/lib/index.js';
const raw=async(f,w,h)=>{let s=sharp(f).removeAlpha();if(w)s=s.resize(w,h,{fit:'fill'});const {data,info}=await s.raw().toBuffer({resolveWithObject:true});return {d:data,w:info.width,h:info.height};};
const isGreen=(d,i)=>d[i+1]>140&&d[i]<150&&d[i+2]<150&&d[i+1]-Math.max(d[i],d[i+2])>60;
const isBlue=(d,i)=>d[i+2]>140&&d[i]<110&&d[i+1]<110;
const doll=await raw('doll_new1.png');const W=doll.w,H=doll.h;
async function build(shoe,out){
  const img=Buffer.alloc(W*H*3);
  // background lavender, doll over
  for(let p=0;p<W*H;p++){const g=isGreen(doll.d,p*3);img[p*3]=g?200:doll.d[p*3];img[p*3+1]=g?208:doll.d[p*3+1];img[p*3+2]=g?224:doll.d[p*3+2];}
  // shoes: crop 600 at (724,H-600)
  const ref=await raw('feet_ref.png',600,600), s=await raw(shoe,600,600);
  const ankle=Math.round(640/1024*600);let stats=0;
  for(let y=0;y<600;y++)for(let x=0;x<600;x++){const i=(y*600+x)*3,o=((H-600+y)*W+724+x)*3;
    const fg=!isGreen(s.d,i);const diff=Math.abs(s.d[i]-ref.d[i])+Math.abs(s.d[i+1]-ref.d[i+1])+Math.abs(s.d[i+2]-ref.d[i+2]);
    if(y>=ankle){ if(fg){img[o]=s.d[i];img[o+1]=s.d[i+1];img[o+2]=s.d[i+2];} else {img[o]=200;img[o+1]=208;img[o+2]=224;} }
    else if(fg&&diff>90){img[o]=s.d[i];img[o+1]=s.d[i+1];img[o+2]=s.d[i+2];stats++;}
  }
  console.log(shoe,'changed px above ankle',stats);
  // hair: crop 1024 at (512,0)
  const h=await raw('hair1.png',1024,1024);
  for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*3,o=(y*W+512+x)*3;
    if(!isGreen(h.d,i)&&!isBlue(h.d,i)){img[o]=h.d[i];img[o+1]=h.d[i+1];img[o+2]=h.d[i+2];}}
  await sharp(img,{raw:{width:W,height:H,channels:3}}).resize(1100).jpeg({quality:88}).toFile(out);
}
await build('shoe1.png','try1.jpg');await build('shoe2.png','try2.jpg');
const a=await sharp('try1.jpg').extract({left:250,top:0,width:600,height:1100}).toBuffer(),b=await sharp('try2.jpg').extract({left:250,top:0,width:600,height:1100}).toBuffer();
await sharp({create:{width:1200,height:1100,channels:3,background:'#fff'}}).composite([{input:a,left:0,top:0},{input:b,left:600,top:0}]).jpeg({quality:88}).toFile('/home/user/DressUpGame/docs/superpowers/specs/2026-11-19-spike-new-doll.jpg');
