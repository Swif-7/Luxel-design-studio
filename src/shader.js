// SPDX-License-Identifier: MIT
// Independently authored advected pigment fields; reference implementation is not bundled.
import {glyphsFor,createGlyphAtlas,glyphDensityLookup} from './glyphs.js';
import {palettePixels} from './color.js';
export const vertex=`attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;
const flowMap=`
mat2 turn(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float flowClock(float kind,float phase){return kind>2.5?time*(.34+.07*sin(phase*1.7))+phase*.21+5.2:time*.32+phase*.21;}
vec2 materialMap(vec2 uv){
 float phase=seed*.01371,kind=mode;
 if(kind<.5){
   // Broad tidal fronts, folded by an area-preserving sequence of shears.
   // Unlike the former iterative silk, this retains an actual pigment edge.
   vec2 q=turn(angle*.01745329)*(uv-vec2(offsetX,offsetY))/scale;
   float clock=time*.38+phase*.21;
   float strength=.35+distortion*.4;
   for(int k=0;k<3;k++){
     float i=float(k);
     q.y+=strength*.42*sin(q.x*(1.7+detail*.08)+clock+i*1.8);
     q.x+=strength*.32*sin(q.y*2.4-clock*.71+i*1.3);
   }
   return q;
 }
 vec2 q=turn(angle*.01745329)*(uv-vec2(offsetX,offsetY))/scale;
 float clock=flowClock(kind,phase);
   float strength=.38+distortion*.34;
   for(int k=0;k<5;k++){
     float stepIndex=float(k);
     float frequency=1.6+stepIndex*.22+detail*.09;
     if(kind<1.5){
       // Opposing streams share shear and eddies through the meeting region.
       q.x+=sin(q.y*frequency+clock+stepIndex*.47)*strength*.48;
       q.y+=sin(q.x*(frequency+.35)-clock*.8+stepIndex*.61)*strength*.42;
       vec2 center=vec2(.35*cos(clock*.6),.22*sin(clock*.47+stepIndex));
       vec2 d=q-center;
       q=center+turn(strength*.48*exp(-dot(d,d)*1.7)*sin(clock+stepIndex))*d;
     }else if(kind<2.5){
       // Two displaced counter-rotating eddies; no single shared orbit.
       vec2 center=vec2(mod(stepIndex,2.)<.5?-.4:.4,.18*sin(clock*.6+stepIndex));
       vec2 d=q-center;
       float direction=mod(stepIndex,2.)<.5?1.:-1.;
       q=center+turn(direction*strength*(1.8+.65*sin(clock*.8))*exp(-dot(d,d)*1.35))*d;
       q.x+=.12*strength*sin(q.y*2.3-clock+stepIndex);
     }else{
       // Seeded oblique local flows, rather than a fixed horizontal/vertical
       // shear. Continuous phases redirect the currents without random jumps.
       float heading=phase*.73+stepIndex*2.399
         +.28*sin(clock*.31+stepIndex)+.16*sin(clock*.57+phase);
       vec2 local=turn(heading)*q;
       local.x+=.36*strength*sin(local.y*frequency-clock*.65+stepIndex*.8);
       local.y+=.31*strength*sin(local.x*(frequency+.2)+clock*.53+stepIndex*1.3);
       q=turn(-heading)*local;
       vec2 center=vec2(.5*sin(phase+stepIndex*1.7+clock*.25),
                        .4*cos(phase*.7+stepIndex*2.3-clock*.19));
       vec2 d=q-center;
       float curl=.55*strength*sin(phase*.4+stepIndex*1.8+clock*.37);
       q=center+turn(curl*exp(-dot(d,d)*1.8))*d;
     }
   }
 return q;
}
`;
export const fragment=`
precision highp float;
uniform vec2 resolution;
uniform float lowPrecision,inkOnly;
uniform float texture,textureStrength,textureScale;
uniform float time,seed,mode,glow,scale,detail,distortion,width,softness,angle,colorFlow,offsetX,offsetY;
uniform vec3 background;
uniform highp sampler2D palette;
${flowMap}
float grainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+seed)*43758.5453);}
float materialGrain(vec2 p){
 vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(grainHash(cell),grainHash(cell+vec2(1.,0.)),f.x),mix(grainHash(cell+vec2(0.,1.)),grainHash(cell+1.),f.x),f.y);
}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 float phase=seed*.01371;
 vec2 grainCoordinate=vec2(0.);
 float kind=mode;
 // Shape and color share one advected pigment field.
 vec3 pigment=vec3(0.);
 float mass=0.;
 if(kind<.5){
   vec2 q=materialMap(uv);
   grainCoordinate=q;
   float clock=time*.38+phase*.21;
   float front=q.y+.14*sin(q.x*2.1-clock*.43)+.08*sin(phase);
   float feather=.014+softness*.015;
#ifdef MATERIAL_DERIVATIVES
   feather=max(feather,fwidth(front)*1.2);
#endif
   float tail=.32*width;
   float crest=smoothstep(-feather,feather,front);
   float body=crest*exp(-max(front,0.)/tail);
   vec2 material=(uv-vec2(offsetX,offsetY))/scale;
   float envelope=exp(-pow(length(material)/1.65,4.));
   float colorPosition=.5+.5*sin(q.x*.95+front*3.2/width+phase*.17+time*colorFlow*.35);
   vec3 dye=texture2D(palette,vec2(colorPosition,.5)).rgb;
   mass=body*3.4*envelope;pigment=dye*mass;
 }else{
   // One material flow map acts on every pigment layer. Alternating shears
   // and radius-preserving twists stretch and fold areas, rather than moving
   // fixed-width centerlines. This is procedural advection, not a fluid solver.
   vec2 material=turn(angle*.01745329)*(uv-vec2(offsetX,offsetY))/scale;
   vec2 q=materialMap(uv);
   float clock=flowClock(kind,phase);
   grainCoordinate=q;
   // Advected clouds carry both shape and internal color. Unequal widths and
   // soft volume overlap eliminate uniform tubes and rigid crossing seams.
   for(int j=0;j<12;j++){
     float layer=float(j),pool=floor(layer/4.),sheet=mod(layer,4.)-1.5;
     vec2 center;
     if(kind<1.5)center=vec2((pool-1.)*.5,.16*sin(clock*.8+pool*2.));
     else if(kind<2.5)center=vec2((pool-1.)*.46,.18*cos(pool*2.+clock*.4));
     else{
       float sourceAngle=pool*2.094+phase*.31;
       center=vec2(.4*cos(sourceAngle)+.12*sin(clock*.43+pool*1.7),
                   .34*sin(sourceAngle)+.1*cos(clock*.29+pool*2.1));
     }
     vec2 d=q-center;
     float orientation=kind<1.5?(pool-1.)*.75:(kind<2.5?pool*1.8:phase*.31+pool*1.4+.3*sin(clock*.3+pool));
     d=turn(orientation)*d;
     d.y+=sheet*(kind<1.5?.018:.002);
     vec2 radii=kind>2.5?vec2(.65+.08*sin(pool+phase),.28+.06*cos(pool*2.+phase)):vec2(.48,.62);
     radii*=vec2(1.,width);
     float distance2=dot(d/radii,d/radii);
     float body;
     if(kind<1.5){body=exp(-distance2*1.6);}else{
       // A leading edge and a long dissolving wake, not a symmetric tube.
       // The shared flow map bends this entire dyed area into eddies/currents.
       float front=d.y+.11*sin(d.x*2.2+pool*1.7+clock*.37);
       float feather=.008+softness*.01;
#ifdef MATERIAL_DERIVATIVES
       feather=max(feather,fwidth(front)*1.2);
#endif
       float wake=(kind<2.5?.34:.28)*width;
       body=smoothstep(-feather,feather,front)*exp(-max(front,0.)/wake)
         *exp(-pow(abs(d.x)/(kind<2.5?.75:.95),4.));
     }
     // Screen-space envelope is in subject coordinates, so size controls the
     // pigment composition without scaling the offset.
     float envelope=exp(-pow(length(material)/1.35,4.));
     float weight=body*.88*envelope;
     float colorPosition=.5+.5*sin(pool*1.9+q.x*1.65+q.y*.8+sheet*.16+phase*.17+time*colorFlow*.35);
     vec3 dye=texture2D(palette,vec2(colorPosition,.5)).rgb;
     pigment+=dye*weight;mass+=weight;
   }
 }

 vec3 dye=pigment/max(mass,.00001);
 // Softness controls the pigment shoulder, not the surrounding aura radius.
 // Summing first keeps individual folds from becoming thin contour lines.
 float bodyDensity=max(mass-.34,0.);
 float edgePower=mix(1.65,1.,clamp((softness-.1)/1.9,0.,1.));
 float opacity=1.-exp(-pow(bodyDensity,edgePower)*glow*1.6);
 if(inkOnly>.5){gl_FragColor=vec4(dye*opacity,opacity);return;}
 // The source field contains only pigment. Background diffusion is generated
 // from these actual pixels in the post pass, outside the body's envelope.
 vec3 result=mix(background,dye,opacity);
 // Pigment grain lives in the same material coordinates as the color field.
 // No independent clock, random frame swaps, or sliding screen-space overlay.
 if(texture>.5&&texture<1.5){
   vec2 grainPoint=grainCoordinate*(min(320.,resolution.y*.65)/textureScale);
   float visibleGrain=1.;
#ifdef MATERIAL_DERIVATIVES
   // Fade detail smaller than a field texel instead of aliasing into moving lines.
   float footprint=max(length(dFdx(grainPoint)),length(dFdy(grainPoint)));
   visibleGrain=1.-smoothstep(.65,1.5,footprint);
#endif
   float grain=materialGrain(grainPoint);
   float coverage=clamp(length(result-background)*1.1,0.,1.);
   result+=(grain-.5)*.13*textureStrength*coverage*visibleGrain;
 }
 // Dither before quantizing the fallback attachment, not just after upscaling.
 float noise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
 result+=(noise-.5)*lowPrecision/255.;
 // Geometric ribbon density acts as a shallow height field. The dense
 // ridge touches the imagined glass; its shoulders recede into the distance.
 // Independent of palette, brightness and background tint; no screen-space
 // focus patches. This is an artistic depth proxy, not a physical simulation.
 float glassDistance=1.-smoothstep(.45,1.8,mass);
 gl_FragColor=vec4(result,glassDistance);
}`;
// Repeated low-resolution filtering gives a dense blur footprint without
// sparse, widely spaced taps producing displaced copies of a ribbon edge.
const blurFragment=`
precision highp float;
uniform sampler2D source;
uniform vec2 resolution,sourceTexel;
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 vec4 color=vec4(0.);
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
   float wx=x==0?2.:1.,wy=y==0?2.:1.;
   color+=texture2D(source,uv+vec2(float(x),float(y))*sourceTexel*2.)*(wx*wy/16.);
 }
 gl_FragColor=color;
}`;
// Diffuse premultiplied dye and its coverage separately. Empty samples contain
// transparent black, never the user's background; unpremultiplication recovers
// the neighboring dye hue before a separate optical-density falloff is applied.
const tintFragment=`
precision highp float;
uniform sampler2D source,nearLo,nearHi,farLo,farHi;
uniform vec2 resolution,levelMix;
uniform vec3 background;
uniform float strength;
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 vec4 body=texture2D(source,uv);
 vec4 nearInk=mix(texture2D(nearLo,uv),texture2D(nearHi,uv),levelMix.x);
 vec4 farInk=mix(texture2D(farLo,uv),texture2D(farHi,uv),levelMix.y);
 vec4 ink=mix(nearInk,farInk,.65);
 vec3 dye=ink.rgb/max(ink.a,.0001);
 float coverage=1.-exp(-ink.a*strength*5.);
 // Background stays fully dyed, but foreground shoulders reject the haze.
 // A steeper continuous depth mask preserves their local contrast for focus.
 gl_FragColor=vec4(mix(body.rgb,clamp(dye,0.,1.),coverage*pow(body.a,4.)),body.a);
}`;
const post=`
precision highp float;
uniform highp sampler2D field;
uniform sampler2D blur2,blur3,blur4,blur5,blur6;
uniform sampler2D glyphAtlas,glyphLookup;
uniform float glyphCount,asciiOpacity,asciiSize,asciiSpacing,asciiRate,asciiDensity;
uniform vec2 fieldSize;
uniform vec2 resolution;
uniform float blur,regionalBlur;
uniform float time,seed,texture,textureStrength,textureScale,particles,particleType,density,particleSize;
uniform vec3 background,primary;
uniform float mode,scale,angle,offsetX,offsetY,detail,distortion;
${flowMap}
float focusDistance(vec2 uv){
 float shoulder=texture2D(field,uv).a;
 if(mode>.5&&mode<1.5)return shoulder;
 // Depth follows the advected material, so focus travels with the folds and
 // respects subject scale/translation. Coverage remains a separate quantity
 // in field.a for the fixed character display.
 vec2 point=(uv-.5)*vec2(resolution.x/resolution.y,1.);
 vec2 q=materialMap(point);
 float phase=seed*.01371;
 float fold=sin(q.y*3.1+q.x*1.7+phase*.13);
 float recession=smoothstep(-.25,.65,fold);
 return clamp(shoulder*mix(.65,1.7,recession),0.,1.);
}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+seed)*43758.5453);}
// Cubic B-spline reconstruction has positive weights: no ringing/overshoot
// around pale moving edges. Four bilinear fetches integrate sixteen texels.
vec3 reconstruct(vec2 uv){
 vec2 p=uv*fieldSize-.5,base=floor(p),f=fract(p);
 vec2 a=1.-f;
 vec2 w0=a*a*a/6.;
 vec2 w1=(3.*f*f*f-6.*f*f+4.)/6.;
 vec2 w2=(-3.*f*f*f+3.*f*f+3.*f+1.)/6.;
 vec2 w3=f*f*f/6.;
 vec2 left=w0+w1,right=w2+w3;
 vec2 lo=(base-.5+w1/left)/fieldSize;
 vec2 hi=(base+1.5+w3/right)/fieldSize;
 return texture2D(field,vec2(lo.x,lo.y)).rgb*left.x*left.y
       +texture2D(field,vec2(hi.x,lo.y)).rgb*right.x*left.y
       +texture2D(field,vec2(lo.x,hi.y)).rgb*left.x*right.y
       +texture2D(field,vec2(hi.x,hi.y)).rgb*right.x*right.y;
}
vec3 diffuseField(vec2 uv,float radius){
 float level=clamp(log2(max(radius,3.2)/3.2),0.,4.);
 if(level<1.)return mix(texture2D(blur2,uv).rgb,texture2D(blur3,uv).rgb,level);
 if(level<2.)return mix(texture2D(blur3,uv).rgb,texture2D(blur4,uv).rgb,level-1.);
 if(level<3.)return mix(texture2D(blur4,uv).rgb,texture2D(blur5,uv).rgb,level-2.);
 return mix(texture2D(blur5,uv).rgb,texture2D(blur6,uv).rgb,level-3.);
}
vec3 surface(vec2 uv){
 vec3 color=reconstruct(uv);
 // Normalized radius makes the control independent of pixel ratio/quality.
 // Positive filter weights avoid reconstruction overshoot at boundaries.
 if(blur>0.){
   // Protect the touching ridge, then bring the receding shoulder out of focus
   // sooner. The full-frame blur response is independent of this depth curve.
   float region=regionalBlur>.5?pow(focusDistance(uv),.7):1.;
   float amount=blur*.01;
   // A dense positive-weight pyramid also avoids the repeated edge copies
   // produced by a wide, sparse 3x3 kernel in the former Blend focus pass.
   float radius=amount*(regionalBlur>.5?.13:.11)*fieldSize.y*region;
   color=mix(color,diffuseField(uv,radius),smoothstep(0.,3.2,radius));
 }
 return color;
}
float chooseGlyph(vec2 grid,float cycle,float tone){
 float choice=hash(grid+vec2(47.,13.)+cycle*vec2(17.17,53.31));
 if(asciiDensity<=0.)return floor(choice*glyphCount);
 float target=mix(hash(grid+cycle+81.),tone,asciiDensity);
 return floor(texture2D(glyphLookup,vec2(choice,(.5+target*63.)/64.)).r*255.+.5);
}
float glyphInk(float glyph,vec2 local){
 vec2 tile=vec2(mod(glyph,8.),floor(glyph/8.));
 return texture2D(glyphAtlas,(tile+vec2(clamp(local.x,0.,1.),1.-clamp(local.y,0.,1.)))/8.).a;
}
void main(){
 vec2 point=gl_FragCoord.xy;vec2 uv=point/resolution;vec3 color=surface(uv);
 float cell=max(2.,textureScale*7.);
 if(texture>1.5&&texture<2.5){vec2 center=(floor(point/cell)+.5)*cell/resolution;color=mix(color,surface(center),textureStrength);}
 float coverage=clamp(length(color-background)*1.1,0.,1.);
 if(texture>2.5&&texture<3.5){vec2 f=fract(point/cell)-.5;float mask=1.-smoothstep(.24,.36,length(f));color=mix(color,mix(background,color,mask),textureStrength*coverage);}
 if(texture>3.5&&texture<4.5){vec2 grid=floor(point/max(2.,textureScale*3.));float pattern=mod(grid.x+grid.y*2.,4.)/4.;vec3 ink=background-color;vec3 quantized=floor(ink*7.+pattern)/7.;color=mix(color,background-quantized,textureStrength*coverage);}
 if(particles>.5&&particleType>2.5&&asciiOpacity>0.){
   // An upright display lattice in screen coordinates. Geometry, clock, scale
   // and distortion never influence anchors, spacing or character identity.
   float glyphSide=resolution.y*asciiSize/24.;
   float pitch=glyphSide*asciiSpacing;
   vec2 grid=floor(point/pitch);
   vec2 center=(grid+.5)*pitch/resolution;
   vec4 ribbon=texture2D(field,center);
   // Only a narrow geometric shoulder fades; the body stays fully lit and
   // the extended background stays off. The whole cell shares one opacity.
   float lit=(1.-smoothstep(.78,.90,ribbon.a))*smoothstep(.045,.07,length(ribbon.rgb-background));
   vec2 local=(point-(grid+.5)*pitch)/glyphSide+.5;
   float inside=step(0.,local.x)*step(0.,local.y)*(1.-step(1.,local.x))*(1.-step(1.,local.y));
   // Stagger refresh times and rates per cell. The global animation clock
   // still controls pause, restart, speed=0 and seeded reproducibility.
   float clock=time*asciiRate*(.75+.5*hash(grid+19.))+hash(grid+73.)*8.;
   float cycle=floor(clock),tone=clamp(1.-ribbon.a,0.,1.);
   float current=chooseGlyph(grid,cycle,tone),next=chooseGlyph(grid,cycle+1.,tone);
   float blend=asciiRate>0.?smoothstep(.82,1.,fract(clock)):0.;
   float ink=mix(glyphInk(current,local),glyphInk(next,local),blend);
   color=mix(color,vec3(1.),ink*inside*lit*asciiOpacity);
 }
 if(particles>.5&&particleType<2.5){
   vec2 pp=(point-.5*resolution)/resolution.y;
   if(particleType>.5&&particleType<1.5){float a=time*.1;pp=mat2(cos(a),sin(a),-sin(a),cos(a))*pp;}
   pp+=time*(particleType>1.5?vec2(.11,.08):vec2(.01,.02));pp*=18.;
   vec2 cellID=floor(pp),f=fract(pp)-.5;
   for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
     vec2 id=cellID+vec2(float(x),float(y));float h=hash(id);
     vec2 d=f-vec2(float(x),float(y))-(vec2(hash(id+14.),hash(id+83.))-.5)*.6;
     if(particleType>1.5){d=mat2(.8,.6,-.6,.8)*d;d.x*=.2;}
     float sparkle=exp(-dot(d,d)/(.0005*particleSize*particleSize))*step(h,density*.008)*(.55+.45*sin(time+h*30.));
     vec3 tint=dot(background,vec3(.333))>.5?primary*.65:mix(primary,vec3(1.),.5);
     color=mix(color,tint,sparkle*.75);
   }
 }
 color+=(hash(point)-.5)/255.;gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;
const hexRGB=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
export class Renderer {
 constructor(canvas){
  this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true,antialias:false});
  if(!gl)throw Error('此浏览器无法启动 WebGL，请开启硬件加速。');
  const program=(source,names,vertexSource=vertex)=>{
   const p=gl.createProgram();for(const [type,code] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,source]]){
    const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(p,shader);gl.deleteShader(shader);
   }gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
   return {program:p,position:gl.getAttribLocation(p,'position'),uniforms:Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(p,n)]))};
  };
  const materialSource=gl.getExtension('OES_standard_derivatives')?'#extension GL_OES_standard_derivatives : enable\n#define MATERIAL_DERIVATIVES\n'+fragment:fragment;
  this.main=program(materialSource,['inkOnly','texture','textureStrength','textureScale','lowPrecision','resolution','time','seed','mode','glow','scale','detail','distortion','width','softness','angle','colorFlow','offsetX','offsetY','background','palette']);
  this.blurPass=program(blurFragment,['resolution','source','sourceTexel']);
  this.tintPass=program(tintFragment,['resolution','source','nearLo','nearHi','farLo','farHi','levelMix','background','strength']);
  this.post=program(post,['blur2','blur3','blur4','blur5','blur6','mode','scale','angle','offsetX','offsetY','detail','distortion','asciiRate','asciiDensity','glyphLookup','asciiOpacity','asciiSize','asciiSpacing','glyphAtlas','glyphCount','blur','regionalBlur','fieldSize','resolution','time','seed','texture','textureStrength','textureScale','particles','particleType','density','particleSize','background','primary','field']);
  this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const makeTexture=()=>{const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);return texture;};
  const half=gl.getExtension('OES_texture_half_float');
  const halfLinear=gl.getExtension('OES_texture_half_float_linear');
  gl.getExtension('EXT_color_buffer_half_float');
  this.fieldType=half&&halfLinear?half.HALF_FLOAT_OES:gl.UNSIGNED_BYTE;
  this.blurLevels=Array.from({length:6},()=>makeTexture());this.blurFbo=gl.createFramebuffer();
  this.inkSource=makeTexture();this.sourceField=makeTexture();this.inkLevels=Array.from({length:8},()=>makeTexture());
  this.field=makeTexture();this.palette=makeTexture();this.glyphLookup=makeTexture();gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));this.glyphAtlas=makeTexture();this.glyphKey='';this.glyphCount=1;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));this.fbo=gl.createFramebuffer();this.size='';this.paletteKey='';
 }
 draw(state,time,width,height){
  const gl=this.gl;
  if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
  // Expensive folding runs at capped resolution; postprocessing remains full resolution.
  const factor=Math.min(1,850/width,650/height),fw=Math.max(1,Math.round(width*factor)),fh=Math.max(1,Math.round(height*factor));
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.field);
  if(this.size!==fw+'x'+fh){
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);
   const allocate=()=>{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,fw,fh,0,gl.RGBA,this.fieldType,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.field,0);return gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;};
   if(!allocate()){
    this.fieldType=gl.UNSIGNED_BYTE;
    if(!allocate())throw Error('离屏渲染缓冲区不可用');
   }
   let bw=fw,bh=fh;
   for(const texture of this.blurLevels){
    bw=Math.max(1,Math.ceil(bw/2));bh=Math.max(1,Math.ceil(bh/2));
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bw,bh,0,gl.RGBA,this.fieldType,null);
   }
   for(const [texture,w,h] of [[this.sourceField,fw,fh],[this.inkSource,Math.ceil(fw/2),Math.ceil(fh/2)]]){
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,this.fieldType,null);
   }
   bw=Math.ceil(fw/2);bh=Math.ceil(fh/2);
   for(const texture of this.inkLevels){
    bw=Math.max(1,Math.ceil(bw/2));bh=Math.max(1,Math.ceil(bh/2));
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bw,bh,0,gl.RGBA,this.fieldType,null);
   }
   gl.bindTexture(gl.TEXTURE_2D,this.field);
   this.size=fw+'x'+fh;
  }
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.palette);
  const key=state.colors.join(',');if(key!==this.paletteKey){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,palettePixels(state.colors));this.paletteKey=key;}
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.glyphAtlas);
  if(state.particles&&state.particleType===3){
   const characters=glyphsFor(state.asciiGroup??'latin',state.asciiCustom??'01');
   const glyphKey=characters.join('');
   if(glyphKey!==this.glyphKey){
    const atlas=createGlyphAtlas(characters);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    this.glyphKey=glyphKey;this.glyphCount=Math.max(1,characters.length);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.glyphLookup);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,64,0,gl.RGBA,gl.UNSIGNED_BYTE,glyphDensityLookup(atlas.coverage));
   }
  }
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.glyphLookup);
  const bind=(p,w,h)=>{gl.useProgram(p.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(p.position);gl.vertexAttribPointer(p.position,2,gl.FLOAT,false,0,0);gl.viewport(0,0,w,h);gl.uniform2f(p.uniforms.resolution,w,h);gl.uniform1f(p.uniforms.time,time);gl.uniform1f(p.uniforms.seed,state.seedValue);gl.uniform3fv(p.uniforms.background,hexRGB(state.background));};
  const tintEnabled=state.backgroundTint>0;
  gl.bindFramebuffer(gl.FRAMEBUFFER,tintEnabled?this.blurFbo:this.fbo);
  if(tintEnabled)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.sourceField,0);
  bind(this.main,fw,fh);gl.uniform1f(this.main.uniforms.inkOnly,0);gl.uniform1f(this.main.uniforms.lowPrecision,this.fieldType===gl.UNSIGNED_BYTE?1:0);
  for(const n of ['texture','textureStrength','textureScale','mode','glow','scale','detail','distortion','width','softness','angle','colorFlow','offsetX','offsetY'])gl.uniform1f(this.main.uniforms[n],state[n]);
  gl.uniform1i(this.main.uniforms.palette,1);gl.drawArrays(gl.TRIANGLES,0,3);
  const pyramid=(source,sw,sh,levels)=>{
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.blurFbo);gl.activeTexture(gl.TEXTURE0);
   for(const texture of levels){
    const bw=Math.max(1,Math.ceil(sw/2)),bh=Math.max(1,Math.ceil(sh/2));
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    bind(this.blurPass,bw,bh);gl.bindTexture(gl.TEXTURE_2D,source);
    gl.uniform1i(this.blurPass.uniforms.source,0);gl.uniform2f(this.blurPass.uniforms.sourceTexel,1/sw,1/sh);
    gl.drawArrays(gl.TRIANGLES,0,3);source=texture;sw=bw;sh=bh;
   }
  };
  if(tintEnabled){
   // A half-resolution dye-only pass supplies actual opacity, independent of
   // the geometric depth alpha used by focus and character placement.
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.inkSource,0);
   bind(this.main,Math.ceil(fw/2),Math.ceil(fh/2));gl.uniform1f(this.main.uniforms.inkOnly,1);gl.drawArrays(gl.TRIANGLES,0,3);
   pyramid(this.inkSource,Math.ceil(fw/2),Math.ceil(fh/2),this.inkLevels);
   const radius=fh*Math.min(2,Math.max(.5,state.scale))*(.05+state.backgroundSpread*.08);
   const level=r=>Math.max(0,Math.min(6.999,Math.log2(Math.max(3.2,r)/3.2)));
   const near=level(radius*.45),far=level(radius);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);bind(this.tintPass,fw,fh);
   const textures=[this.sourceField,this.inkLevels[Math.floor(near)],this.inkLevels[Math.ceil(near)],this.inkLevels[Math.floor(far)],this.inkLevels[Math.ceil(far)]];
   ['source','nearLo','nearHi','farLo','farHi'].forEach((name,i)=>{
    gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.uniform1i(this.tintPass.uniforms[name],i);
   });
   gl.uniform2f(this.tintPass.uniforms.levelMix,near%1,far%1);gl.uniform1f(this.tintPass.uniforms.strength,state.backgroundTint);
   gl.drawArrays(gl.TRIANGLES,0,3);
  }
  if(state.blur>0)pyramid(this.field,fw,fh,this.blurLevels);
  // The tint pass reused atlas units; restore them before drawing any glyphs.
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.glyphAtlas);
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.glyphLookup);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);bind(this.post,width,height);gl.uniform2f(this.post.uniforms.fieldSize,fw,fh);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.field);gl.uniform1i(this.post.uniforms.field,0);gl.uniform1i(this.post.uniforms.glyphAtlas,2);gl.uniform1i(this.post.uniforms.glyphLookup,3);gl.uniform1f(this.post.uniforms.glyphCount,this.glyphCount);gl.uniform3fv(this.post.uniforms.primary,hexRGB(state.colors[0]));
  for(const n of ['mode','scale','angle','offsetX','offsetY','detail','distortion','asciiRate','asciiDensity','asciiOpacity','asciiSize','asciiSpacing','blur','regionalBlur','texture','textureStrength','textureScale','particles','particleType','density','particleSize'])gl.uniform1f(this.post.uniforms[n],Number(state[n]));
  // Palette is no longer read in the post pass; reuse unit 1 and stay within
  // WebGL 1's guaranteed eight fragment texture units, including ASCII.
  for(let i=1;i<6;i++){
   const unit=i===1?1:i+2;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this.blurLevels[i]);gl.uniform1i(this.post.uniforms['blur'+(i+1)],unit);
  }
  gl.drawArrays(gl.TRIANGLES,0,3);

 }
 destroy(){const gl=this.gl;gl.deleteProgram(this.tintPass.program);gl.deleteTexture(this.sourceField);gl.deleteTexture(this.inkSource);for(const texture of this.inkLevels)gl.deleteTexture(texture);gl.deleteProgram(this.main.program);gl.deleteProgram(this.blurPass.program);for(const texture of this.blurLevels)gl.deleteTexture(texture);gl.deleteFramebuffer(this.blurFbo);gl.deleteProgram(this.post.program);gl.deleteBuffer(this.buffer);gl.deleteTexture(this.field);gl.deleteTexture(this.palette);gl.deleteTexture(this.glyphAtlas);gl.deleteTexture(this.glyphLookup);gl.deleteFramebuffer(this.fbo);}
}
