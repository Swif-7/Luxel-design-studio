// SPDX-License-Identifier: MIT
// Rasterize locally installed fonts; no font files or third-party code shipped.
export const glyphGroups={
 binary:{label:'二进制 · 01',text:'01'},
 digits:{label:'数字 · 0–9',text:'0123456789'},
 latin:{label:'英文 · Aa',text:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'},
 symbols:{label:'符号 · + / @',text:'.:;+-=*/<>[]{}!?&%#@'},
 chinese:{label:'中文 · 山水流光',text:'山水风云光影流动星月花海梦雨'},
 japanese:{label:'日文 · かな',text:'あいうえおかきくけこさしすせそたちつてとなにぬねの'},
 custom:{label:'自定义字符',text:''}
};
export function glyphsFor(group,custom=''){
 const source=group==='custom'?custom:(glyphGroups[group]?.text??glyphGroups.latin.text);
 return [...new Set(Array.from(source.normalize('NFC')).filter(c=>!/[\s\p{C}]/u.test(c)))].slice(0,64);
}
export function createGlyphAtlas(characters){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
 const ctx=canvas.getContext('2d');
 ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='alphabetic';
 ctx.font='500 46px system-ui, "PingFang SC", "Hiragino Sans", sans-serif';
 characters.forEach((char,index)=>{
  const metrics=ctx.measureText(char);
  const top=metrics.actualBoundingBoxAscent,bottom=metrics.actualBoundingBoxDescent;
  ctx.fillText(char,(index%8+.5)*64,Math.floor(index/8)*64+32+(top-bottom)/2,52);
 });
 const pixels=ctx.getImageData(0,0,512,512).data;
 const coverage=characters.map((_,index)=>{
  let alpha=0;const ox=index%8*64,oy=Math.floor(index/8)*64;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)alpha+=pixels[((oy+y)*512+ox+x)*4+3]/255;
  return alpha/(64*64);
 });
 return {canvas,coverage};
}

// Select from actual rendered ink coverage, not a hardcoded character order.
// Each row is a desired coverage; each column is a quantile of its weighted CDF.
export function glyphDensityLookup(coverage){
 const pixels=new Uint8Array(256*64*4);
 const low=Math.min(...coverage),high=Math.max(...coverage),sigma=.025+(high-low)*.18;
 for(let row=0;row<64;row++){
  const target=low+(high-low)*row/63;
  const weights=coverage.map(c=>.015+Math.exp(-.5*((c-target)/sigma)**2));
  const total=weights.reduce((a,b)=>a+b,0);
  for(let column=0;column<256;column++){
   const quantile=(column+.5)/256*total;let sum=0,index=0;
   for(;index<weights.length-1;index++){sum+=weights[index];if(sum>=quantile)break;}
   const offset=(row*256+column)*4;pixels[offset]=index;pixels[offset+3]=255;
  }
 }
 return pixels;
}
