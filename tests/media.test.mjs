import test from 'node:test';
import assert from 'node:assert/strict';
import {exportSize,webmFile} from '../src/media.js';
test('quality determines PNG/video dimensions independently of viewport pixels',()=>{
 for(const [quality,w,h] of [[1,1920,1080],[1.5,2560,1440],[2,3840,2160]]){
  assert.deepEqual(exportSize(quality,160,90),{width:w,height:h});
  assert.deepEqual(exportSize(quality,1600,900),{width:w,height:h});
  assert.deepEqual(exportSize(quality,90,160),{width:h,height:w});
 }
 assert.deepEqual(exportSize(2,1,1),{width:3840,height:3840});
 assert.equal(exportSize(1.5,1512,592).height,1002);
 assert.throws(()=>exportSize(3,16,9));assert.throws(()=>exportSize(2,0,0));
});
// Parse the actual EBML payload rather than matching the writer's byte layout.
function readVint(data,at,strip=true){let len=1,mask=128;while(!(data[at]&mask)){len++;mask>>=1;if(len>8)throw Error('Invalid EBML integer');}let value=strip?data[at]&(mask-1):data[at];for(let i=1;i<len;i++)value=value*256+data[at+i];return {value,len};}
function elements(data){const result=[];let at=0;while(at<data.length){const id=readVint(data,at,false);at+=id.len;const size=readVint(data,at);at+=size.len;result.push({id:id.value,data:data.slice(at,at+size.value),position:at-id.len-size.len});at+=size.value;}assert.equal(at,data.length);return result;}
test('WebM contains explicit 10-second duration, 300 ordered frames and selected dimensions',async()=>{
 const chunks=Array.from({length:300},(_,i)=>({timestamp:Math.round(i*1e6/30),key:i%60===0,data:new Uint8Array([i%256])})).reverse();
 for(const codec of ['vp8','vp09.00.51.08']){
  const blob=webmFile(chunks,{width:3840,height:2160,codec});assert.equal(blob.type,'video/webm');
  const root=elements(new Uint8Array(await blob.arrayBuffer())),segment=elements(root.find(x=>x.id===0x18538067).data);
  const info=elements(segment.find(x=>x.id===0x1549a966).data),duration=info.find(x=>x.id===0x4489).data;
  assert.equal(new DataView(duration.buffer,duration.byteOffset).getFloat64(0),10000);
  const track=elements(elements(segment.find(x=>x.id===0x1654ae6b).data)[0].data);
  assert.equal(new TextDecoder().decode(track.find(x=>x.id===0x86).data),codec==='vp8'?'V_VP8':'V_VP9');
  const video=elements(track.find(x=>x.id===0xe0).data),asInt=data=>data.reduce((a,v)=>a*256+v,0);
  assert.equal(asInt(video.find(x=>x.id===0xb0).data),3840);assert.equal(asInt(video.find(x=>x.id===0xba).data),2160);
  const frames=elements(segment.find(x=>x.id===0x1f43b675).data).filter(x=>x.id===0xa3);
  assert.equal(frames.length,300);
  frames.forEach((f,i)=>{assert.equal(f.data[1]*256+f.data[2],Math.round(i*1000/30));assert.equal(Boolean(f.data[3]&128),i%60===0);});
 }
});
