import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,generate,validate} from '../src/model.js';
import {hexToLab,labToRgb,palettePixels} from '../src/color.js';
test('identical seeds reproduce parameters; distinct seeds vary',()=>{const base={...defaults,lockColors:false};assert.deepEqual(generate('流动-42',base),generate('流动-42',base));assert.notDeepEqual(generate('流动-42',base),generate('流动-43',base));});
test('locks preserve all custom palette stops and form without aliasing',()=>{const base={...defaults,mode:2,colors:['#abcdef','#123456','#ff00ff'],lockColors:true,lockMode:true};const next=generate('new-seed',base);assert.equal(next.mode,2);assert.deepEqual(next.colors,base.colors);next.colors[0]='#000000';assert.equal(base.colors[0],'#abcdef');});
test('generated configurations are valid and JSON round trips are lossless',()=>{for(let i=0;i<200;i++){const s=generate(String(i),{...defaults,lockColors:false});assert.deepEqual(validate(JSON.parse(JSON.stringify(s))),s);}});
test('invalid imported values are rejected',()=>{for(const v of [null,[],{}, {...defaults,version:4},{...defaults,mode:10},{...defaults,glow:Infinity},{...defaults,density:-1},{...defaults,primary:'red'},{...defaults,seed:''},{...defaults,colors:['#000000']},{...defaults,colors:Array(9).fill('#ffffff')},{...defaults,colors:['#ffffff','red']},{...defaults,texture:7},{...defaults,angle:NaN}])assert.throws(()=>validate(v));});
test('v1 two-color files migrate to explicit color stops',()=>{const old={...defaults,version:1};for(const k of ['colors','width','softness','angle','texture','textureScale','textureStrength','colorFlow'])delete old[k];const migrated=validate(old);assert.equal(migrated.version,3);assert.deepEqual(migrated.colors,[old.primary,old.accent]);assert.equal(migrated.softness,defaults.softness);});
test('sRGB/OKLab round trip preserves color endpoints',()=>{for(const color of ['#ff0000','#00ff00','#0000ff','#000000','#ffffff','#c68abd']){const actual=labToRgb(hexToLab(color)).map(v=>Math.round(v*255));const expected=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<=1));}});
test('palette texture includes all editable stops and opaque endpoints',()=>{const colors=['#ff0000','#00ff00','#0000ff'];const data=palettePixels(colors,257);assert.deepEqual([...data.slice(0,4)],[255,0,0,255]);assert.deepEqual([...data.slice(128*4,128*4+4)],[0,255,0,255]);assert.deepEqual([...data.slice(-4)],[0,0,255,255]);});
test('palette-only randomization preserves every non-color parameter and stop count',async()=>{
 const {randomizePalette}=await import('../src/model.js');
 const current={...defaults,seed:'keep-this',speed:1.37,lockColors:true,mode:2};
 const {state,harmony}=randomizePalette('new-palette',current);
 const omitColors=({colors,primary,accent,...rest})=>rest;
 assert.deepEqual(omitColors(state),omitColors(current));
 assert.equal(state.colors.length,current.colors.length);
 assert.notDeepEqual(state.colors,current.colors);
 assert.deepEqual(validate(state),state);
 assert.ok(['邻近色','分裂互补色','同色系'].includes(harmony));
 assert.deepEqual(randomizePalette('new-palette',current).state,state);
});
test('generated palettes retain distinct stops and background lightness separation',async()=>{
 const {randomizePalette}=await import('../src/model.js');
 for(const background of ['#ffffff','#080c13','#777777','#c58ba8'])for(let count=2;count<=8;count++)for(let seed=0;seed<30;seed++){
  const {state}=randomizePalette(String(seed),{...defaults,background,colors:Array(count).fill('#00aacc')});
  assert.equal(new Set(state.colors).size,count);
  for(const color of state.colors){assert.match(color,/^#[0-9a-f]{6}$/);assert.ok(Math.abs(hexToLab(color)[0]-hexToLab(background)[0])>.07);}
 }
});

test('older v2 files acquire independent background and framing defaults',()=>{
 const old={...defaults,version:2};for(const k of ['backgroundTint','backgroundSpread','offsetX','offsetY'])delete old[k];
 assert.deepEqual(validate(old),defaults);
 for(const patch of [{backgroundTint:-1},{backgroundSpread:4},{offsetX:Infinity},{offsetY:-2}])assert.throws(()=>validate({...defaults,...patch}));
});
test('pink reference study survives full parameter export/import',async()=>{
 const {pinkStudy}=await import('../src/model.js');assert.deepEqual(validate(JSON.parse(JSON.stringify(pinkStudy))),pinkStudy);
});

test('blur controls migrate, round trip and reject malformed input',()=>{
 const old={...defaults};delete old.blur;delete old.regionalBlur;
 assert.equal(validate(old).blur,0);assert.equal(validate(old).regionalBlur,true);
 const edited={...defaults,blur:73,regionalBlur:false};assert.deepEqual(validate(JSON.parse(JSON.stringify(edited))),edited);
 for(const patch of [{blur:-1},{blur:101},{blur:NaN},{regionalBlur:1}])assert.throws(()=>validate({...defaults,...patch}));
});

test('all motion families are valid and available to unlocked randomization',async()=>{
 const {modes}=await import('../src/model.js');const seen=new Set();
 for(let i=0;i<400;i++)seen.add(generate('motion-'+i,{...defaults,lockMode:false}).mode);
 assert.equal(seen.size,modes.length);for(let mode=0;mode<modes.length;mode++)assert.equal(validate({...defaults,mode}).mode,mode);
 assert.deepEqual(validate({...defaults,scale:.25,offsetX:1.5,offsetY:-1.5}),{...defaults,scale:.25,offsetX:1.5,offsetY:-1.5});
});

test('legacy ten-mode presets migrate into four families without losing controls',()=>{
 const expected=[0,0,0,0,0,0,1,3,1,2];
 expected.forEach((mode,oldMode)=>{const previous={...defaults,version:2,mode:oldMode,blur:48,offsetX:.22,scale:.7};const current=validate(previous);assert.equal(current.version,3);assert.equal(current.mode,mode);assert.equal(current.blur,48);assert.equal(current.offsetX,.22);assert.equal(current.scale,.7);assert.deepEqual(current.colors,previous.colors);});
 assert.throws(()=>validate({...defaults,mode:4}));
});

test('ASCII parameters survive JSON export and import',()=>{const state={...defaults,particles:true,particleType:3,asciiSize:2.3,asciiOpacity:.87};assert.deepEqual(validate(JSON.parse(JSON.stringify(state))),state);assert.throws(()=>validate({...state,texture:6}));});


test('character groups migrate and custom Unicode survives round trips',async()=>{
 const {glyphGroups,glyphsFor}=await import('../src/glyphs.js');
 const old={...defaults};delete old.asciiGroup;delete old.asciiCustom;
 assert.equal(validate(old).asciiGroup,'latin');
 for(const asciiGroup of Object.keys(glyphGroups)){
  const s={...defaults,asciiGroup,asciiCustom:'山水あア01+-'};
  assert.deepEqual(validate(JSON.parse(JSON.stringify(s))),s);
  assert.ok(glyphsFor(asciiGroup,s.asciiCustom).length);
 }
 assert.deepEqual(glyphsFor('custom','山 山水水 01'),['山','水','0','1']);
 for(const patch of [{asciiGroup:'unknown'},{asciiCustom:''},{asciiCustom:'  '},{asciiCustom:'a'.repeat(65)}])assert.throws(()=>validate({...defaults,...patch}));
});

test('legacy ASCII surface migrates to character particles',()=>{
 const old={...defaults,texture:5,textureScale:2.2,textureStrength:.7};delete old.asciiOpacity;delete old.asciiSize;
 const next=validate(old);assert.equal(next.texture,0);assert.equal(next.particles,true);assert.equal(next.particleType,3);assert.equal(next.asciiSize,2.2);assert.equal(next.asciiOpacity,.7);
 assert.deepEqual(next.colors,old.colors);assert.equal(next.seed,old.seed);
});

test('fixed display spacing migrates and round trips independently of framing',()=>{
 const old={...defaults};delete old.asciiSpacing;assert.equal(validate(old).asciiSpacing,1);
 const edited={...defaults,asciiSpacing:1.42,asciiSize:.8,scale:2.5};assert.deepEqual(validate(JSON.parse(JSON.stringify(edited))),edited);
 for(const asciiSpacing of [0,3,NaN])assert.throws(()=>validate({...defaults,asciiSpacing}));
});


test('density sampling favors measured sparse and dense glyphs while retaining variety',async()=>{
 const {glyphDensityLookup}=await import('../src/glyphs.js');
 const coverage=[.03,.08,.15,.24],lookup=glyphDensityLookup(coverage);
 const mean=row=>{let sum=0;for(let x=0;x<256;x++)sum+=coverage[lookup[(row*256+x)*4]];return sum/256;};
 assert.ok(mean(0)<mean(63)*.5);
 assert.ok(new Set(Array.from({length:256},(_,x)=>lookup[(63*256+x)*4])).size>1);
 for(let i=0;i<lookup.length;i+=4)assert.ok(lookup[i]<coverage.length);
 const single=glyphDensityLookup([.1]);for(let i=0;i<single.length;i+=4)assert.equal(single[i],0);
});
test('character animation settings migrate and round trip',()=>{
 const old={...defaults};delete old.asciiRate;delete old.asciiDensity;
 assert.equal(validate(old).asciiRate,1);assert.equal(validate(old).asciiDensity,1);
 const edited={...defaults,asciiRate:2.35,asciiDensity:.64};assert.deepEqual(validate(JSON.parse(JSON.stringify(edited))),edited);
 for(const patch of [{asciiRate:-1},{asciiRate:5},{asciiDensity:1.1}])assert.throws(()=>validate({...defaults,...patch}));
});
