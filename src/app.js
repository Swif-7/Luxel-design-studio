import {defaults,modes,palettes,hashSeed,generate,validate,randomizePalette} from './model.js';
import {glyphGroups,glyphsFor} from './glyphs.js';
import {Renderer} from './shader.js';
import {exportSize,exportPng,exportVideo} from './media.js';
import {exportStandaloneHtml} from './export.js';
const $=id=>document.getElementById(id);let state={...defaults,colors:[...defaults.colors]};let elapsed=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,last=0,frames=0,fpsStart=0,renderer,toastTimer,lost=false,exporting=false,exportAbort;
try{const saved=localStorage.getItem('flux-state-v3');if(saved)state=validate(JSON.parse(saved));}catch{}
const controls=[['asciiRate','换字速度',0,4,.05,'character-sliders'],['asciiDensity','疏密随色带',0,1,.01,'character-sliders'],['asciiOpacity','字符亮度',0,1,.01,'character-sliders'],['asciiSize','字符大小',.5,3,.01,'character-sliders'],['asciiSpacing','字符间距',.85,2,.01,'character-sliders'],['blur','模糊程度',0,100,1,'blur-controls'],['colorFlow','色彩流动',0,2,.01,'light-controls'],['textureStrength','纹理强度',0,1,.01,'texture-controls'],['textureScale','纹理尺寸',.5,3,.01,'texture-controls'],['width','色带宽度',.3,2,.01,'light-controls'],['softness','边缘柔度',.1,2,.01,'light-controls'],['backgroundTint','背景染色',0,2,.01,'light-controls'],['backgroundSpread','背景扩散',.5,3,.01,'light-controls'],['angle','色带角度',-90,90,1,'motion-controls'],['glow','色彩浓度',.2,2.5,.01,'light-controls'],['speed','运动速度',0,2,.01,'motion-controls'],['scale','主体大小',.25,3,.01,'motion-controls'],['offsetX','中心 X 偏移',-1.5,1.5,.01,'motion-controls'],['offsetY','中心 Y 偏移',-1.5,1.5,.01,'motion-controls'],['distortion','扭曲程度',0,2,.01,'motion-controls'],['detail','流动细节',1,7,.1,'motion-controls'],['density','粒子密度',0,100,1,'particle-sliders'],['particleSize','粒子大小',.4,3,.1,'particle-sliders']];
for(const [key,label,min,max,step,parent] of controls){const div=document.createElement('div');div.className='range-field';div.innerHTML=`<div class="range-head"><label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output></div><input type="range" id="${key}" min="${min}" max="${max}" step="${step}">` ;$(parent).append(div);$(key).addEventListener('input',e=>{state[key]=Number(e.target.value);sync(false);save();});}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2300);}
function save(){try{localStorage.setItem('flux-state-v3',JSON.stringify(state));}catch{}}
function draw(target=renderer,t=elapsed,w,h,s=state){if(!target)return;const rect=target.canvas.getBoundingClientRect();const ratio=Math.min(devicePixelRatio||1,s.quality);target.draw({...s,seedValue:hashSeed(s.seed)%10000},t,w||Math.max(1,Math.round(rect.width*ratio)),h||Math.max(1,Math.round(rect.height*ratio)));}
for(const [value,{label}] of Object.entries(glyphGroups)){const option=document.createElement('option');option.value=value;option.textContent=label;$('ascii-group').append(option);}
function sync(all=true){if(all){$('seed').value=state.seed;for(const key of ['background','quality'])$(key).value=state[key];for(const [key] of controls)$(key).value=state[key];$('particle-type').value=state.particleType;$('texture').value=state.texture;$('ascii-group').value=state.asciiGroup;$('ascii-custom').value=state.asciiCustom;renderColors();$('particles').checked=state.particles;$('regional-blur').checked=state.regionalBlur;$('lock-colors').checked=state.lockColors;$('lock-mode').checked=state.lockMode;}
$('ascii-options').hidden=state.particleType!==3;$('particle-sliders').hidden=state.particleType===3;$('ascii-custom-row').hidden=state.asciiGroup!=='custom';

const hex=state.background.slice(1);const bgLuma=.2126*parseInt(hex.slice(0,2),16)+.7152*parseInt(hex.slice(2,4),16)+.0722*parseInt(hex.slice(4,6),16);$('stage').classList.toggle('light-canvas',bgLuma>150);for(const [key] of controls)$(key+'-value').textContent=(key==='density'||key==='blur')?Math.round(state[key])+'%':state[key].toFixed(key==='angle'?0:2)+(key==='speed'?'×':key==='angle'?'°':'');$('background-hex').textContent=state.background;$('effect-name').textContent=modes[state.mode];$('seed-caption').textContent='SEED / '+state.seed;$('particle-controls').classList.toggle('disabled',!state.particles);for(const el of $('particle-controls').querySelectorAll('input,select'))el.disabled=!state.particles;document.querySelectorAll('.preset').forEach(el=>{const selected=Number(el.dataset.mode)===state.mode;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',selected);});$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'播放动画':'暂停动画');if(!lost)draw();}
// Display order is independent of the stable IDs used by shaders and saved parameters.
const modeOrder=[1,0,2,3];
for(const [position,i] of modeOrder.entries()){const button=document.createElement('button');button.className='preset';button.dataset.mode=i;button.setAttribute('aria-label',modes[i]);button.innerHTML=`<img alt="" width="180" height="120"><span class="preset-label">${modes[i].split(' · ')[0]}<small>${String(position+1).padStart(2,'0')}</small></span>`;button.onclick=()=>{state.mode=i;elapsed=0;sync();save();};$('presets').append(button);}
function renderColors(){
 $('color-stops').replaceChildren();
 state.colors.forEach((color,index)=>{
  const row=document.createElement('div');row.className='color-stop';
  row.innerHTML=`<label for="stop-${index}">${index+1}</label><input id="stop-${index}" type="color" value="${color}" aria-label="色标 ${index+1}"><input class="hex-input" aria-label="色标 ${index+1} HEX" value="${color}" maxlength="7" spellcheck="false"><button aria-label="删除色标 ${index+1}" ${state.colors.length<=2?'disabled':''}>×</button>`;
  const update=value=>{state.colors[index]=value;[state.primary,state.accent]=state.colors;sync(false);save();};
  row.querySelector('input[type=color]').oninput=e=>{row.querySelector('.hex-input').value=e.target.value;update(e.target.value);};
  row.querySelector('.hex-input').oninput=e=>{if(/^#[0-9a-f]{6}$/i.test(e.target.value)){row.querySelector('input[type=color]').value=e.target.value;update(e.target.value);}};
  row.querySelector('.hex-input').onchange=e=>{if(!/^#[0-9a-f]{6}$/i.test(e.target.value)){e.target.value=state.colors[index];toast('请输入 #RRGGBB 格式');return;}row.querySelector('input[type=color]').value=e.target.value;update(e.target.value);};
  row.querySelector('button').onclick=()=>{state.colors.splice(index,1);[state.primary,state.accent]=state.colors;sync();save();};
  $('color-stops').append(row);
 });
 $('add-color').disabled=state.colors.length>=8;$('color-count').textContent=state.colors.length+' / 8';
}
$('random-palette').onclick=()=>{
 const seed=new Uint32Array(1);crypto.getRandomValues(seed);
 const result=randomizePalette(seed[0].toString(36),state);
 state=result.state;sync();save();toast('已生成'+result.harmony+'配色');
};
$('add-color').onclick=()=>{if(state.colors.length>=8)return;state.colors.push('#80e8de');sync();save();};
palettes.forEach((p,i)=>{const b=document.createElement('button');b.className='palette';b.style.background=`linear-gradient(110deg,${p.slice(1).join(',')})`;b.setAttribute('aria-label',['虹彩','清透青','落日','紫晶','深海','粉霞'][i]+'配色');b.title=b.getAttribute('aria-label');b.onclick=()=>{state.background=p[0];state.colors=p.slice(1);[state.primary,state.accent]=state.colors;sync();save();};$('palettes').append(b);});
$('background').oninput=e=>{state.background=e.target.value;sync(false);save();};
$('ascii-group').onchange=e=>{state.asciiGroup=e.target.value;sync();save();};
$('ascii-custom').oninput=e=>{const text=e.target.value;if(!glyphsFor('custom',text).length||Array.from(text).length>64){e.target.setCustomValidity('请输入 1–64 个可见字符');return;}e.target.setCustomValidity('');state.asciiCustom=text;sync(false);save();};
$('ascii-custom').onchange=e=>{if(!e.target.checkValidity()){e.target.reportValidity();toast('自定义字符需为 1–64 个可见字符，暂时保留上一次设置');}};
$('texture').onchange=e=>{state.texture=Number(e.target.value);sync();save();};
$('quality').onchange=e=>{state.quality=Number(e.target.value);sync();save();};$('particle-type').onchange=e=>{state.particleType=Number(e.target.value);sync();save();};for(const [id,key] of [['regional-blur','regionalBlur'],['particles','particles'],['lock-colors','lockColors'],['lock-mode','lockMode']])$(id).onchange=e=>{state[key]=e.target.checked;sync();save();};
function applySeed(seed){state=generate(seed,state);elapsed=0;sync();save();}
$('apply-seed').onclick=()=>{const seed=$('seed').value.trim();if(!seed){toast('请输入种子');return;}applySeed(seed);toast('已应用种子');};$('seed').onkeydown=e=>{if(e.key==='Enter')$('apply-seed').click();};$('random').onclick=()=>{const a=new Uint32Array(1);crypto.getRandomValues(a);applySeed(a[0].toString(36));toast('新的流动，已生成');};$('reset').onclick=()=>{state={...defaults,mode:modeOrder[0],colors:[...defaults.colors]};elapsed=0;sync();save();toast('已恢复初始参数');};$('pause').onclick=()=>{paused=!paused;sync(false);};$('restart').onclick=()=>{elapsed=0;sync(false);};
// Theme: follows the system until the user picks one, then their choice sticks.
const darkQuery=matchMedia('(prefers-color-scheme: dark)');
function paintTheme(){const forced=document.documentElement.dataset.theme;const dark=forced?forced==='dark':darkQuery.matches;
 $('theme').querySelector('svg').innerHTML=dark
  ?'<circle cx="12" cy="12" r="4.2"/><path d="M12 3.4v2.1M12 18.5v2.1M3.4 12h2.1M18.5 12h2.1M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>'
  :'<path d="M20 13.6A8.2 8.2 0 0 1 10.4 4a8.6 8.6 0 1 0 9.6 9.6z"/>';
 $('theme').setAttribute('aria-label',dark?'切换到浅色模式':'切换到深色模式');
 document.querySelector('meta[name=theme-color]').content=dark?'#0f0f0f':'#ffffff';}
$('theme').onclick=()=>{const forced=document.documentElement.dataset.theme;
 const next=(forced?forced==='dark':darkQuery.matches)?'light':'dark';
 document.documentElement.dataset.theme=next;try{localStorage.setItem('rheo-theme',next);}catch{}paintTheme();};
darkQuery.addEventListener('change',()=>{if(!document.documentElement.dataset.theme)paintTheme();});
paintTheme();
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stage').requestFullscreen();}catch{toast('当前浏览器不支持全屏');}};
function download(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const exportMenu=$('export-menu'),exportTrigger=$('export-menu-button');
function positionExportMenu(){const rect=exportTrigger.getBoundingClientRect();exportMenu.style.left=Math.max(12,Math.min(rect.right-exportMenu.offsetWidth,innerWidth-exportMenu.offsetWidth-12))+'px';exportMenu.style.top=Math.max(12,Math.min(rect.bottom+8,innerHeight-exportMenu.offsetHeight-12))+'px';}
exportMenu.addEventListener('toggle',e=>{const open=e.newState==='open';exportTrigger.setAttribute('aria-expanded',String(open));if(open){updateExportSizes();positionExportMenu();exportMenu.querySelector('button').focus();}});
window.addEventListener('resize',()=>{if(exportMenu.matches(':popover-open'))positionExportMenu();});
exportMenu.addEventListener('keydown',e=>{const items=[...exportMenu.querySelectorAll('button')];let i=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();i=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[i].focus();}});
function closeExportMenu(){exportMenu.hidePopover();exportTrigger.focus();}
exportMenu.addEventListener('click',e=>{if(e.target.closest('button'))closeExportMenu();});
$('export-html').onclick=async()=>{
 if(!renderer||lost){toast('画面尚未就绪');return;}
 const snapshot={...state,colors:[...state.colors],seedValue:hashSeed(state.seed)%10000},time=elapsed,stopped=paused;
 exportTrigger.disabled=true;
 try{const html=await exportStandaloneHtml(snapshot,time,stopped);download(new Blob([html],{type:'text/html;charset=utf-8'}),'rheo-'+hashSeed(snapshot.seed)+'.html');toast('独立网页已导出');}
 catch(error){toast('导出失败：'+error.message);}finally{exportTrigger.disabled=false;}
};
function mediaSize(){const rect=$('canvas').getBoundingClientRect();return exportSize(state.quality,rect.width,rect.height);}
function updateExportSizes(){const {width,height}=mediaSize();$('png-size').textContent=`${width} × ${height} · 当前画面`;$('video-size').textContent=`${width} × ${height} · 10 秒 · 30 帧 / 秒`;}
$('cancel-export').onclick=()=>exportAbort?.abort();
async function saveMedia(video){
 if(exporting||!renderer||lost){toast('画面尚未就绪或正在导出');return;}
 const snapshot={...state,colors:[...state.colors],seedValue:hashSeed(state.seed)%10000},time=elapsed,size=mediaSize();
 exporting=true;exportAbort=new AbortController();exportTrigger.disabled=true;
 $('export-progress').hidden=false;$('cancel-export').hidden=!video;$('export-progress-bar').value=0;
 $('export-progress-label').textContent=`正在生成${video?'10 秒视频':'图片'} · ${size.width} × ${size.height}`;
 try{
  // Allow the progress UI to paint before allocating the large export canvas.
  await new Promise(resolve=>setTimeout(resolve,20));
  const blob=video?await exportVideo(snapshot,time,size,{signal:exportAbort.signal,onProgress:value=>{
   $('export-progress-bar').value=value;$('export-progress-label').textContent=`视频 ${Math.floor(value*100)}% · ${size.width} × ${size.height}`;
  }}):await exportPng(snapshot,time,size);
  download(blob,`rheo-${hashSeed(snapshot.seed)}-${size.width}x${size.height}${video?'-10s.webm':'.png'}`);
  toast(`${video?'10 秒视频':'图片'}已导出 · ${size.width} × ${size.height}`);
 }catch(error){toast(error.name==='AbortError'?'已取消导出':'导出失败：'+error.message);}
 finally{exporting=false;exportAbort=null;exportTrigger.disabled=false;$('export-progress').hidden=true;last=0;}
}
$('snapshot').onclick=()=>saveMedia(false);$('export-video').onclick=()=>saveMedia(true);
$('export').onclick=()=>{download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'rheo-parameters.json');toast('参数已导出');};$('import-button').onclick=()=>$('import').click();$('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>20000)throw Error('参数文件过大');state=validate(JSON.parse(await f.text()));elapsed=0;sync();save();toast('参数已恢复');}catch(error){toast('导入失败：'+error.message);}finally{e.target.value='';}};
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key.toLowerCase()==='r')$('random').click();if(e.code==='Space'){e.preventDefault();$('pause').click();}});
function fail(message){$('error').textContent=message;$('error').hidden=false;}
function init(){try{renderer=new Renderer($('canvas'));lost=false;$('error').hidden=true;sync();}catch(error){fail('无法渲染：'+error.message);}}
$('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;fail('图形上下文已暂停，正在等待浏览器恢复…');});$('canvas').addEventListener('webglcontextrestored',init);
init();
// Render static previews in one temporary context; no six extra animation loops.
try{const c=document.createElement('canvas');const preview=new Renderer(c);document.querySelectorAll('.preset img').forEach(img=>{preview.draw({...defaults,mode:Number(img.closest('.preset').dataset.mode),seedValue:hashSeed(defaults.seed)%10000,particles:false},3,240,150);img.src=c.toDataURL();});preview.destroy();}catch{}
function frame(now){const delta=last?Math.min((now-last)/1000,.1):0;last=now;if(!document.hidden&&!lost&&!exporting){if(!paused)elapsed+=delta*state.speed;draw();frames++;if(now-fpsStart>1000){$('fps').textContent=Math.round(frames*1000/(now-fpsStart))+' FPS';frames=0;fpsStart=now;$('resolution').textContent='预览 '+$('canvas').width+' × '+$('canvas').height;}const seconds=Math.floor(elapsed);$('time').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}requestAnimationFrame(frame);}requestAnimationFrame(frame);
