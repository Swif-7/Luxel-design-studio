// SPDX-License-Identifier: MIT
// Bundle only our own renderer. Exported files make no network requests.
const scriptJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c');
// 导出文件里给观众看的几句话：默认中文，页面按界面语言传进来（words）
const WORDS={play:'播放',pause:'暂停',playLabel:'播放动画',pauseLabel:'暂停动画',cantShow:'无法显示效果：',suspended:'图形上下文已暂停，等待恢复…',title:'Rheo · 流动作品',canvas:'流动视觉效果',lang:'zh-CN'};
export function createStandaloneHtml({state,time=0,paused=false,sources,license,words={}}){
 const w={...WORDS,...words},q=scriptJSON;
 const code=sources.map(source=>source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
 // HTML's raw-text parser must not mistake user content for a closing script.
 const runtime=`${code}\nconst settings=${scriptJSON(state)};
let elapsed=${Number.isFinite(time)?time:0},paused=${Boolean(paused)},last=0,renderer;
const canvas=document.getElementById('canvas'),button=document.getElementById('play'),error=document.getElementById('error');
function label(){button.textContent=paused?${q(w.play)}:${q(w.pause)};button.setAttribute('aria-label',paused?${q(w.playLabel)}:${q(w.pauseLabel)});}
button.onclick=()=>{paused=!paused;label();};label();
function init(){try{renderer=new Renderer(canvas);error.hidden=true;}catch(e){error.hidden=false;error.textContent=${q(w.cantShow)}+e.message;}}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();renderer=null;error.hidden=false;error.textContent=${q(w.suspended)};});
canvas.addEventListener('webglcontextrestored',init);init();
function frame(now){const delta=last?Math.min((now-last)/1000,.1):0;last=now;
 if(renderer&&!document.hidden){if(!paused)elapsed+=delta*settings.speed;
 const ratio=Math.min(devicePixelRatio||1,settings.quality);
 try{renderer.draw(settings,elapsed,Math.max(1,Math.round(innerWidth*ratio)),Math.max(1,Math.round(innerHeight*ratio)));}catch(e){error.hidden=false;error.textContent=${q(w.cantShow)}+e.message;renderer=null;}}
 requestAnimationFrame(frame);}
requestAnimationFrame(frame);`;
 return `<!doctype html>
<html lang="${w.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${w.title.replace(/</g,'&lt;')}</title><link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Cstyle%3E.bg%7Bfill:#0d0d0d%7D.c%7Bfill:#fff%7D%40media(prefers-color-scheme:dark)%7B.bg%7Bfill:#ececec%7D.c%7Bfill:#0f0f0f%7D%7D%3C/style%3E%3Crect%20class='bg'%20width='64'%20height='64'%20rx='15'/%3E%3Crect%20class='c'%20x='11'%20y='11'%20width='20'%20height='20'/%3E%3Crect%20class='c'%20x='33'%20y='11'%20width='20'%20height='20'%20fill-opacity='.55'/%3E%3Crect%20class='c'%20x='11'%20y='33'%20width='20'%20height='20'%20fill-opacity='.55'/%3E%3C/svg%3E">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${state.background}}canvas{display:block;width:100%;height:100%}button{position:fixed;bottom:20px;right:20px;padding:9px 16px;border:1px solid #8885;border-radius:8px;background:#ffffffc9;color:#222;cursor:pointer;font:14px system-ui}#error{position:fixed;inset:40% 10% auto;padding:20px;background:#fff;color:#222;font:16px system-ui}</style></head>
<body><canvas id="canvas" aria-label="${w.canvas.replace(/"/g,'&quot;')}"></canvas><button id="play">${w.pause.replace(/</g,'&lt;')}</button><p id="error" role="alert" hidden></p>
<script id="rheo-parameters" type="application/json">${scriptJSON(state)}</script>
<script type="text/plain" id="license">${license.replace(/</g,'&lt;')}</script>
<script>${runtime.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
}
export async function exportStandaloneHtml(state,time,paused,words={}){
 const paths=['glyphs.js','color.js','shader.js','../LICENSE'].map(p=>new URL(p,import.meta.url));   // 相对模块自己定位：部署在子路径下也能取到
 const files=await Promise.all(paths.map(async path=>{const response=await fetch(path);if(!response.ok)throw Error('无法读取导出资源');return response.text();}));
 return createStandaloneHtml({state,time,paused,sources:files.slice(0,3),license:files[3],words});
}
