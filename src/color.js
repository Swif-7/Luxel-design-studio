// SPDX-License-Identifier: MIT
// Standard sRGB / OKLab transforms. No third-party implementation is bundled.
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const encode = v => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
export function hexToLab(hex) {
  const [r,g,b] = [1,3,5].map(i => linear(parseInt(hex.slice(i,i+2),16)/255));
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
function labToLinear([L,a,b]) {
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
}
export function labToRgb(lab) {
  return labToLinear(lab).map(v=>Math.max(0,Math.min(1,encode(v))));
}
// Reduce chroma rather than clip RGB channels, preserving the chosen hue.
function lchToHex(L,C,hue) {
  const angle=hue*Math.PI/180;
  const at=chroma=>[L,chroma*Math.cos(angle),chroma*Math.sin(angle)];
  let low=0,high=C;
  for(let i=0;i<16;i++) {
    const mid=(low+high)/2;
    if(labToLinear(at(mid)).every(v=>v>=0&&v<=1))low=mid;else high=mid;
  }
  return '#'+labToRgb(at(low)).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
}
export function harmoniousPalette(random,count,background) {
  if(!Number.isInteger(count)||count<2||count>8)throw Error('配色需要 2–8 个色标');
  const base=random()*360;
  // Two complementary stops would interpolate through grey; prefer a related pair.
  const options=count<3?['analogous','tonal']:['analogous','analogous','split','tonal'];
  const harmony=options[Math.floor(random()*options.length)];
  const bgL=hexToLab(background)[0];
  const [low,high]=bgL>.82?[.59,.77]:bgL<.35?[.69,.87]:bgL<.6?[.79,.91]:[.35,.5];
  const chroma=.105+random()*.06;
  const spread=55+random()*35;
  const dominant=Math.max(2,Math.ceil(count*.65));
  const colors=[];
  for(let i=0;i<count;i++) {
    const t=i/(count-1);
    let hue=base+spread*(t-.5),L=low+(high-low)*(.5-.5*Math.cos(t*Math.PI)),C=chroma;
    if(harmony==='tonal'){hue=base+(t-.5)*12;C=chroma*(1.-t*.3);}
    if(harmony==='split'){
      const accent=i>=dominant;
      hue=accent?base+150+60*(i-dominant)/Math.max(1,count-dominant-1):base-18+36*i/(dominant-1);
      C*=accent?.8:1;
      L=low+(high-low)*(accent?.85:.2+.55*i/(dominant-1));
    }
    colors.push(lchToHex(L,C,hue));
  }
  return {colors,harmony:{analogous:'邻近色',split:'分裂互补色',tonal:'同色系'}[harmony]};
}
export function palettePixels(colors, size=256) {
  const labs=colors.map(hexToLab), result=new Uint8Array(size*4);
  for(let i=0;i<size;i++) {
    const t=i/(size-1)*(labs.length-1), index=Math.min(labs.length-2,Math.floor(t)), f=t-index;
    const rgb=labToRgb(labs[index].map((v,j)=>v+(labs[index+1][j]-v)*f));
    rgb.forEach((v,j)=>result[i*4+j]=Math.round(v*255));result[i*4+3]=255;
  }
  return result;
}
