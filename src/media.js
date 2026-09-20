// SPDX-License-Identifier: MIT
import {Renderer} from './shader.js';
export function exportSize(quality,width,height){
 if(!(width>0&&height>0))throw Error('预览尺寸无效');
 const edge=({'1':1920,'1.5':2560,'2':3840})[quality];
 if(!edge)throw Error('画质设置无效');
 const even=n=>Math.max(2,Math.round(n/2)*2);
 return width>=height?{width:edge,height:even(edge*height/width)}:{width:even(edge*width/height),height:edge};
}
// A small, original WebM writer for a single 10-second VP8/VP9 video track.
// EBML lengths are known; Duration and DefaultDuration allow seeking/playback
// without the missing-duration behavior of streamed MediaRecorder WebM files.
const bytes=(...n)=>new Uint8Array(n);
const concat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const uint=n=>{const result=[];do{result.unshift(n%256);n=Math.floor(n/256);}while(n);return new Uint8Array(result);};
const vint=n=>{let length=1;while(n>=2**(7*length)-1)length++;const result=new Uint8Array(length);for(let i=length-1;i>=0;i--){result[i]=n%256;n=Math.floor(n/256);}result[0]|=1<<(8-length);return result;};
const element=(id,data)=>concat([uint(id),vint(data.length),data]);
const number=(id,n)=>element(id,uint(n));
const str=(id,s)=>element(id,new TextEncoder().encode(s));
const master=(id,parts)=>element(id,concat(parts));
export function webmFile(chunks,{width,height,codec,fps=30,duration=10}){
 const float=new Uint8Array(8);new DataView(float.buffer).setFloat64(0,duration*1000);
 const header=master(0x1a45dfa3,[number(0x4286,1),number(0x42f7,1),number(0x42f2,4),number(0x42f3,8),str(0x4282,'webm'),number(0x4287,4),number(0x4285,2)]);
 const info=master(0x1549a966,[number(0x2ad7b1,1000000),element(0x4489,float),str(0x4d80,'Rheo'),str(0x5741,'Rheo')]);
 const tracks=master(0x1654ae6b,[master(0xae,[number(0xd7,1),number(0x73c5,1),number(0x83,1),number(0x9c,0),str(0x86,codec==='vp8'?'V_VP8':'V_VP9'),number(0x23e383,Math.round(1e9/fps)),master(0xe0,[number(0xb0,width),number(0xba,height)])])]);
 const ordered=[...chunks].sort((a,b)=>a.timestamp-b.timestamp);
 const cluster=master(0x1f43b675,[number(0xe7,0),...ordered.map(c=>{const ms=Math.round(c.timestamp/1000);if(ms<0||ms>32767)throw Error('视频时长超出范围');return element(0xa3,concat([bytes(0x81,ms>>8,ms&255,c.key?0x80:0),c.data]));})]);
 const cues=master(0x1c53bb6b,[master(0xbb,[number(0xb3,0),master(0xb7,[number(0xf7,1),number(0xf1,info.length+tracks.length)])])]);
 return new Blob([header,master(0x18538067,[info,tracks,cluster,cues])],{type:'video/webm'});
}
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
function abort(signal){if(signal?.aborted)throw new DOMException('已取消导出','AbortError');}
function makeRenderer(size){
 const canvas=document.createElement('canvas'),renderer=new Renderer(canvas,{fullResolution:true});
 const gl=renderer.gl,limit=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
 if(Math.max(size.width,size.height)>limit){renderer.destroy();gl.getExtension('WEBGL_lose_context')?.loseContext();throw Error('当前设备无法导出此分辨率，请降低画质');}
 return {canvas,renderer,dispose(){renderer.destroy();gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=1;}};
}
export async function exportPng(state,time,size){
 const job=makeRenderer(size);
 try{
  job.renderer.draw(state,time,size.width,size.height);
  if(job.renderer.gl.isContextLost()||job.renderer.gl.getError()!==job.renderer.gl.NO_ERROR)throw Error('图形资源不足，请降低画质后重试');
  return await new Promise((resolve,reject)=>job.canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片导出失败')),'image/png'));
 }finally{job.dispose();}
}
export async function exportVideo(state,time,size,{signal,onProgress=()=>{}}={}){
 abort(signal);
 if(typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined')throw Error('当前浏览器不支持逐帧视频导出，请使用新版 Chrome 或 Edge');
 const fps=30,count=300;
 let config;
 for(const codec of ['vp09.00.51.08','vp8']){
  const candidate={codec,width:size.width,height:size.height,framerate:fps,bitrate:Math.round(size.width*size.height*fps*.18),latencyMode:'realtime'};
  try{if((await VideoEncoder.isConfigSupported(candidate)).supported){config=candidate;break;}}catch{}
 }
 abort(signal);
 if(!config)throw Error('当前浏览器无法编码此分辨率，请降低画质或使用 Chrome / Edge');
 const job=makeRenderer(size),chunks=[];let encodingError,encoder;
 const cancel=()=>{if(encoder&&encoder.state!=='closed')encoder.close();};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  encoder=new VideoEncoder({output(chunk){const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);chunks.push({data,timestamp:chunk.timestamp,key:chunk.type==='key'});},error(error){encodingError=error;}});
  encoder.configure(config);
  for(let frame=0;frame<count;frame++){
   abort(signal);if(encodingError)throw encodingError;
   job.renderer.draw(state,time+frame/fps*state.speed,size.width,size.height);
   if(job.renderer.gl.isContextLost()||job.renderer.gl.getError()!==job.renderer.gl.NO_ERROR)throw Error('图形资源不足，请降低画质后重试');
   const timestamp=Math.round(frame*1e6/fps),duration=Math.round((frame+1)*1e6/fps)-timestamp;
   const image=new VideoFrame(job.canvas,{timestamp,duration});
   try{encoder.encode(image,{keyFrame:frame%60===0});}finally{image.close();}
   // Bound memory and yield for progress/cancel. Every frame has an explicit
   // media timestamp, so slow rendering never shortens the exported animation.
   if(encoder.encodeQueueSize>=4||frame%15===14)await encoder.flush();
   onProgress((frame+1)/count);
   await yieldTask();
  }
  await encoder.flush();abort(signal);if(encodingError)throw encodingError;
  if(chunks.length!==count)throw Error('视频帧不完整，请重试');
  return webmFile(chunks,{...size,codec:config.codec,fps,duration:10});
 }catch(error){abort(signal);throw error;}finally{signal?.removeEventListener('abort',cancel);cancel();job.dispose();}
}
