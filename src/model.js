// SPDX-License-Identifier: MIT
import {glyphGroups,glyphsFor} from './glyphs.js';
import {harmoniousPalette} from './color.js';
export const modes=['潮汐铺展 · Tide','交汇融流 · Blend','双涡卷流 · Vortex','层流漫涌 · Drift'];
export const palettes=[
 ['#fffdfd','#ff80b1','#9a87ed','#66c6ed','#a0efcf','#ffc185'],
 ['#ffffff','#20d9e5','#70bcea','#b6edff'],
 ['#fffaf5','#ff995e','#ffd35c','#f47d9b'],
 ['#fdfaff','#e998ec','#977cf0','#63c6ec','#f4b4de'],
 ['#080c13','#55e1c4','#60a4ff','#d799ff']
];
export const defaults={version:3,seed:'silk-001',mode:0,background:'#fffdfd',primary:'#ff80b1',accent:'#9a87ed',colors:palettes[0].slice(1),glow:1.25,scale:1.1,offsetX:0,offsetY:0,detail:4.2,distortion:1.15,speed:1,width:1,softness:.8,backgroundTint:1,backgroundSpread:1.3,angle:24,colorFlow:.5,blur:0,regionalBlur:true,texture:0,asciiOpacity:1,asciiSize:1.5,asciiSpacing:1,asciiRate:1,asciiDensity:1,asciiGroup:'latin',asciiCustom:'流光01ABC+-',textureStrength:.55,textureScale:1,particles:false,particleType:0,density:25,particleSize:1.2,quality:1.5,lockColors:true,lockMode:true};
export const ranges={asciiRate:[0,4],asciiDensity:[0,1],asciiOpacity:[0,1],asciiSize:[.5,3],asciiSpacing:[.85,2],glow:[.2,2.5],scale:[.25,3],offsetX:[-1.5,1.5],offsetY:[-1.5,1.5],detail:[1,7],distortion:[0,2],speed:[0,2],density:[0,100],particleSize:[.4,3],width:[.3,2],softness:[.1,2],backgroundTint:[0,2],backgroundSpread:[.5,3],angle:[-90,90],colorFlow:[0,2],blur:[0,100],textureStrength:[0,1],textureScale:[.5,3]};
export function hashSeed(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.codePointAt(0),16777619);return h>>>0;}
export function rng(seed){let n=hashSeed(seed);return()=>{n+=0x6D2B79F5;let t=Math.imul(n^(n>>>15),1|n);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
export function generate(seed,current=defaults){
 const r=rng(seed),state={...current,colors:[...current.colors],seed};
 const mode=Math.floor(r()*modes.length),palette=palettes[Math.floor(r()*palettes.length)];
 if(!current.lockMode)state.mode=mode;
 if(!current.lockColors){state.background=palette[0];state.colors=palette.slice(1);[state.primary,state.accent]=state.colors;}
 for(const [key,min,max] of [['glow',1.05,1.65],['scale',.8,1.4],['detail',3,6.5],['distortion',.7,1.6],['speed',.8,1.3],['width',.7,1.3],['softness',.5,1.2],['angle',-65,65],['density',15,65],['particleSize',.7,1.7]])state[key]=Number((min+r()*(max-min)).toFixed(2));
 state.particleType=Math.floor(r()*3);return state;
}
export function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||![1,2,3].includes(value.version))throw Error('不支持的参数文件版本');
 const s={...defaults,colors:[...defaults.colors]};
 if(typeof value.seed!=='string'||!value.seed.length||value.seed.length>80)throw Error('种子需为 1–80 个字符');s.seed=value.seed;
 const isColor=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
 for(const k of ['background','primary','accent']){if(!isColor(value[k]))throw Error('颜色格式无效');s[k]=value[k];}
 if(value.version===1)s.colors=[s.primary,s.accent];else{if(!Array.isArray(value.colors)||value.colors.length<2||value.colors.length>8||!value.colors.every(isColor))throw Error('配色需要 2–8 个有效颜色');s.colors=[...value.colors];[s.primary,s.accent]=s.colors;}
 const optional=['width','softness','angle','colorFlow','textureStrength','textureScale'];
 for(const [k,[min,max]] of Object.entries(ranges)){if(value[k]===undefined&&((value.version===1&&optional.includes(k))||['asciiRate','asciiDensity','asciiOpacity','asciiSize','asciiSpacing','backgroundTint','backgroundSpread','offsetX','offsetY','blur'].includes(k)))continue;if(typeof value[k]!=='number'||!Number.isFinite(value[k])||value[k]<min||value[k]>max)throw Error('参数超出范围：'+k);s[k]=value[k];}
 for(const [k,max] of [['mode',value.version<3?9:modes.length-1],['particleType',3],['texture',5]]){if(k==='texture'&&value.version===1&&value[k]===undefined)continue;if(!Number.isInteger(value[k])||value[k]<0||value[k]>max)throw Error('效果类型无效');s[k]=value[k];}
 for(const k of ['particles','lockColors','lockMode','regionalBlur']){if(k==='regionalBlur'&&value[k]===undefined)continue;if(typeof value[k]!=='boolean')throw Error('开关参数无效');s[k]=value[k];}
 if(value.asciiGroup!==undefined){if(!Object.hasOwn(glyphGroups,value.asciiGroup))throw Error('字符分组无效');s.asciiGroup=value.asciiGroup;}
 if(value.asciiCustom!==undefined){if(typeof value.asciiCustom!=='string'||Array.from(value.asciiCustom).length>64||!glyphsFor('custom',value.asciiCustom).length)throw Error('自定义字符需要 1–64 个可见字符');s.asciiCustom=value.asciiCustom;}
 // Migrate the former surface effect into the independently enabled particle layer.
 if(s.texture===5){s.texture=0;s.particles=true;s.particleType=3;s.asciiOpacity=value.asciiOpacity??s.textureStrength;s.asciiSize=value.asciiSize??s.textureScale;}
 if(value.version<3)s.mode=[0,0,0,0,0,0,1,3,1,2][s.mode];
 if(![1,1.5,2].includes(value.quality))throw Error('画质参数无效');s.quality=value.quality;return s;
}

// Explicit palette-only action: independent of the global randomization locks.
export function randomizePalette(seed,current=defaults){
 const {colors,harmony}=harmoniousPalette(rng('palette:'+seed),current.colors.length,current.background);
 return {state:{...current,colors,primary:colors[0],accent:colors[1]},harmony};
}

// Original parameter study based on the user-supplied pink/coral image.
export const pinkStudy={...defaults,seed:'prism',mode:0,
 background:'#fff4f2',colors:['#ee79b6','#fb9299','#ffc077','#c6a4e9','#f899cd'],
 primary:'#ee79b6',accent:'#fb9299',scale:1.35,offsetX:.18,offsetY:-.42,width:1.1,softness:1.5,
 glow:1.5,backgroundTint:.85,backgroundSpread:1.4,detail:5.8,
 distortion:1.2,angle:10,speed:1,colorFlow:.24};
