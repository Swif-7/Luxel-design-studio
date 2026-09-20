import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createStandaloneHtml} from '../src/export.js';
import {defaults,hashSeed,validate} from '../src/model.js';
const sources=await Promise.all(['glyphs','color','shader'].map(name=>readFile(new URL('../src/'+name+'.js',import.meta.url),'utf8')));
const license=await readFile(new URL('../LICENSE',import.meta.url),'utf8');
const build=state=>createStandaloneHtml({state,time:12.5,paused:true,sources,license});
test('standalone HTML contains a compilable renderer with no imports or remote assets',()=>{
 const html=build({...defaults,seedValue:hashSeed(defaults.seed)%10000});
 const runtime=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 assert.doesNotThrow(()=>new vm.Script(runtime));
 assert.doesNotMatch(runtime,/^import |^export /m);
 assert.doesNotMatch(html,/<(?:script|link)[^>]*(?:src|href)=/);
 assert.match(runtime,/let elapsed=12.5,paused=true/);
 assert.match(html,/Permission is hereby granted/);
});
test('Unicode and script-like user text round trip without escaping the parameter element',()=>{
 const state={...defaults,seed:'</script><script>alert(1)</script>',asciiCustom:'山水あ </script>',particles:true,particleType:3,blur:60};
 const html=build(state),json=html.match(/id="rheo-parameters" type="application\/json">([\s\S]*?)<\/script>/)[1];
 assert.deepEqual(JSON.parse(json),state);
 assert.deepEqual(validate(JSON.parse(json)),state);
 assert.equal((html.match(/<script[ >]/g)||[]).length,3);
 assert.doesNotThrow(()=>new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
