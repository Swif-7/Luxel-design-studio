// SPDX-License-Identifier: MIT
// Bundle only our own renderer. Exported files make no network requests.
const scriptJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c');
export function createStandaloneHtml({state,time=0,paused=false,sources,license}){
 const code=sources.map(source=>source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
 // HTML's raw-text parser must not mistake user content for a closing script.
 const runtime=`${code}\nconst settings=${scriptJSON(state)};
let elapsed=${Number.isFinite(time)?time:0},paused=${Boolean(paused)},last=0,renderer;
const canvas=document.getElementById('canvas'),button=document.getElementById('play'),error=document.getElementById('error');
function label(){button.textContent=paused?'播放':'暂停';button.setAttribute('aria-label',paused?'播放动画':'暂停动画');}
button.onclick=()=>{paused=!paused;label();};label();
function init(){try{renderer=new Renderer(canvas);error.hidden=true;}catch(e){error.hidden=false;error.textContent='无法显示效果：'+e.message;}}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();renderer=null;error.hidden=false;error.textContent='图形上下文已暂停，等待恢复…';});
canvas.addEventListener('webglcontextrestored',init);init();
function frame(now){const delta=last?Math.min((now-last)/1000,.1):0;last=now;
 if(renderer&&!document.hidden){if(!paused)elapsed+=delta*settings.speed;
 const ratio=Math.min(devicePixelRatio||1,settings.quality);
 try{renderer.draw(settings,elapsed,Math.max(1,Math.round(innerWidth*ratio)),Math.max(1,Math.round(innerHeight*ratio)));}catch(e){error.hidden=false;error.textContent='无法显示效果：'+e.message;renderer=null;}}
 requestAnimationFrame(frame);}
requestAnimationFrame(frame);`;
 return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rheo · 流动作品</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${state.background}}canvas{display:block;width:100%;height:100%}button{position:fixed;bottom:20px;right:20px;padding:9px 16px;border:1px solid #8885;border-radius:8px;background:#ffffffc9;color:#222;cursor:pointer;font:14px system-ui}#error{position:fixed;inset:40% 10% auto;padding:20px;background:#fff;color:#222;font:16px system-ui}</style></head>
<body><canvas id="canvas" aria-label="流动视觉效果"></canvas><button id="play">暂停</button><p id="error" role="alert" hidden></p>
<script id="rheo-parameters" type="application/json">${scriptJSON(state)}</script>
<script type="text/plain" id="license">${license.replace(/</g,'&lt;')}</script>
<script>${runtime.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
}
export async function exportStandaloneHtml(state,time,paused){
 const paths=['/src/glyphs.js','/src/color.js','/src/shader.js','/LICENSE'];
 const files=await Promise.all(paths.map(async path=>{const response=await fetch(path);if(!response.ok)throw Error('无法读取导出资源');return response.text();}));
 return createStandaloneHtml({state,time,paused,sources:files.slice(0,3),license:files[3]});
}
