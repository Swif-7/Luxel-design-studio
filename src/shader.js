// SPDX-License-Identifier: MIT
// Independently authored iterative ribbon field; reference implementation is not bundled.
import {glyphsFor,createGlyphAtlas,glyphDensityLookup} from './glyphs.js';
import {palettePixels} from './color.js';
export const vertex=`attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;
const flowMap=`
mat2 turn(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float flowClock(float kind,float phase){return kind>2.5?time*(.34+.07*sin(phase*1.7))+phase*.21+5.2:time*.32+phase*.21;}
vec2 materialMap(vec2 uv){
 float phase=seed*.01371,kind=mode;
 if(kind<.5){
   float t=time*.65+phase;
   float breathe=sin(time*.73+phase)*.04+sin(time*.43)*.025;
   vec2 p=turn(angle*.01745329)*((uv-vec2(offsetX,offsetY))/scale-vec2(-.58,.14))*(1.+breathe);
   float theta=2.14+.006*sin(phase),c=cos(theta),s=sin(theta);
   mat2 fold=mat2(c,s,-.96,c);
   // Follow the same first six deformations as the layered silk pigment.
   for(int j=0;j<6;j++){
     float layer=float(j)*.016;
     p.x-=sin(p.y*.47+t+layer)*.13*distortion;
     p.y-=sin(p.x*2.45-t*.88+layer)*.027*distortion;
     p=fold*p*.952;
   }
   return p;
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
uniform float lowPrecision;
uniform float texture,textureStrength,textureScale;
uniform float time,seed,mode,glow,scale,detail,distortion,width,softness,angle,colorFlow,backgroundTint,backgroundSpread,offsetX,offsetY;
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
 float t=time*.65+phase;
 float breathe=sin(time*.73+phase)*.04+sin(time*.43)*.025;
 vec2 p=turn(angle*.01745329)*((uv-vec2(offsetX,offsetY))/scale-vec2(-.58,.14));
 p*=1.+breathe;
 vec2 grainCoordinate=p;
 float kind=mode;
 if(kind>1.5&&kind<2.5){float r=length(p);p=turn(.7*sin(r*1.8+t*.2))*p;}
 if(kind>3.5&&kind<4.5)p+=.13*vec2(sin(p.y*3.+t),cos(p.x*2.4-t*.7));
 // All scales share their path, clock and palette sample. The background is
 // the outer skirt of the same ribbon, never an unrelated screen gradient.
 vec3 pigment=vec3(0.),shoulderPigment=vec3(0.),auraPigment=vec3(0.);
 float mass=0.,shoulderMass=0.,auraMass=0.;
 float count=40.+detail*6.;
 float theta=2.14+.006*sin(phase)+kind*.002;
 float c=cos(theta),s=sin(theta);
 mat2 fold=mat2(c,s,-(.96+kind*.003),c);
 float feather=.0032;
 float breadth=1.8/width;
 if(kind<.5){
 for(int j=0;j<84;j++){
   float layer=float(j);
   if(layer>=count)break;
   float phaseLayer=layer*.016;
   p.x-=sin(p.y*.47+t+phaseLayer)*.13*distortion;
   p.y-=sin(p.x*2.45-t*.88+phaseLayer)*.027*distortion;
   p=fold*p*(.952+kind*.0007);
   if(j==5)grainCoordinate=p;
   vec2 delta=(p-vec2(.37+breathe,.015*sin(t*.6)))*vec2(breadth,.17);
   float distance2=dot(delta,delta);
   float shape=1./(1.+distance2/feather);
   float shoulder=1./(1.+distance2/(feather*(3.+backgroundSpread*5.)));
   float aura=1./(1.+distance2/(feather*(12.+backgroundSpread*34.)));
   if(kind>.5&&kind<1.5){
     vec2 echo=delta-vec2(.29,.04);float e=dot(echo,echo);
     shape+=.45/(1.+e/feather);
     shoulder+=.45/(1.+e/(feather*(3.+backgroundSpread*5.)));
     aura+=.45/(1.+e/(feather*(12.+backgroundSpread*34.)));
   }
   float envelope=exp(-length(p)*.28)*(1.-smoothstep(count-8.,count,layer));
   float weight=shape*.245*envelope;
   float shoulderWeight=shoulder*.065*envelope;
   float auraWeight=aura*.024*envelope;
   float phaseColor=layer*.055+length(p)*1.1+time*colorFlow*.35+phase*.17;
   float position=.5+.5*sin(phaseColor);
   vec3 dye=texture2D(palette,vec2(position,.5)).rgb;
   pigment+=dye*weight;mass+=weight;
   shoulderPigment+=dye*shoulderWeight;shoulderMass+=shoulderWeight;
   auraPigment+=dye*auraWeight;auraMass+=auraWeight;
 }
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
     d.y+=sheet*.018;
     vec2 radii=kind>2.5?vec2(.65+.08*sin(pool+phase),.28+.06*cos(pool*2.+phase)):vec2(.48,.62);
     radii*=vec2(1.,width);
     float distance2=dot(d/radii,d/radii);
     float body=exp(-distance2*1.6);
     float shoulder=exp(-distance2/(1.1+backgroundSpread*.8));
     float aura=exp(-distance2/(3.+backgroundSpread*2.));
     // Screen-space envelope is in subject coordinates, so size controls the
     // whole composition including its soft skirt without scaling the offset.
     float envelope=exp(-pow(length(material)/1.35,4.));
     float weight=body*.88*envelope;
     float shoulderWeight=shoulder*.13*envelope;
     float auraWeight=aura*.048*envelope;
     float colorPosition=.5+.5*sin(pool*1.9+q.x*1.65+q.y*.8+sheet*.16+phase*.17+time*colorFlow*.35);
     vec3 dye=texture2D(palette,vec2(colorPosition,.5)).rgb;
     pigment+=dye*weight;mass+=weight;
     shoulderPigment+=dye*shoulderWeight;shoulderMass+=shoulderWeight;
     auraPigment+=dye*auraWeight;auraMass+=auraWeight;
   }
 }

 vec3 dye=pigment/max(mass,.00001);
 vec3 shoulderDye=shoulderPigment/max(shoulderMass,.00001);
 vec3 auraDye=auraPigment/max(auraMass,.00001);
 // Softness changes only the body transfer curve, not the field radii.
 // Summing first keeps individual folds from becoming thin contour lines.
 float bodyDensity=max(mass-.34,0.);
 float edgePower=mix(1.65,1.,clamp((softness-.1)/1.9,0.,1.));
 float opacity=1.-exp(-pow(bodyDensity,edgePower)*glow*1.6);
 vec3 result=mix(background,auraDye,1.-exp(-auraMass*backgroundTint*.72));
 result=mix(result,shoulderDye,1.-exp(-shoulderMass*backgroundTint*.85));
 result=mix(result,dye,opacity);
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
const post=`
precision highp float;
uniform highp sampler2D field;
uniform sampler2D glyphAtlas,glyphLookup;
uniform float glyphCount,asciiOpacity,asciiSize,asciiSpacing,asciiRate,asciiDensity;
uniform vec2 fieldSize;
uniform vec2 resolution;
uniform float blur,regionalBlur;
uniform float time,seed,texture,textureStrength,textureScale,particles,particleType,density,particleSize;
uniform vec3 background,primary;
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
vec3 surface(vec2 uv){
 vec3 color=reconstruct(uv);
 // Normalized radius makes the control independent of pixel ratio/quality.
 // A symmetric positive kernel cannot introduce ringing at color boundaries.
 if(blur>0.){
   float region=regionalBlur>.5?texture2D(field,uv).a:1.;
   float amount=blur*.01;
   vec2 stride=vec2(resolution.y/resolution.x,1.)*amount*.085*region;
   vec3 soft=vec3(0.);
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
     float wx=x==0?2.:1.;
     float wy=y==0?2.:1.;
     soft+=texture2D(field,uv+vec2(float(x),float(y))*stride).rgb*(wx*wy/16.);
   }
   color=mix(color,soft,smoothstep(0.,.12,region)*smoothstep(0.,.08,amount));
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
 if(texture>1.5&&texture<2.5){vec2 center=(floor(point/cell)+.5)*cell/resolution;color=mix(color,texture2D(field,center).rgb,textureStrength);}
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
  this.main=program(materialSource,['texture','textureStrength','textureScale','lowPrecision','resolution','time','seed','mode','glow','scale','detail','distortion','width','softness','angle','colorFlow','backgroundTint','backgroundSpread','offsetX','offsetY','background','palette']);
  this.post=program(post,['asciiRate','asciiDensity','glyphLookup','asciiOpacity','asciiSize','asciiSpacing','glyphAtlas','glyphCount','blur','regionalBlur','fieldSize','resolution','time','seed','texture','textureStrength','textureScale','particles','particleType','density','particleSize','background','primary','field']);
  this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const makeTexture=()=>{const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);return texture;};
  const half=gl.getExtension('OES_texture_half_float');
  const halfLinear=gl.getExtension('OES_texture_half_float_linear');
  gl.getExtension('EXT_color_buffer_half_float');
  this.fieldType=half&&halfLinear?half.HALF_FLOAT_OES:gl.UNSIGNED_BYTE;
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
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);bind(this.main,fw,fh);gl.uniform1f(this.main.uniforms.lowPrecision,this.fieldType===gl.UNSIGNED_BYTE?1:0);
  for(const n of ['texture','textureStrength','textureScale','mode','glow','scale','detail','distortion','width','softness','angle','colorFlow','backgroundTint','backgroundSpread','offsetX','offsetY'])gl.uniform1f(this.main.uniforms[n],state[n]);
  gl.uniform1i(this.main.uniforms.palette,1);gl.drawArrays(gl.TRIANGLES,0,3);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);bind(this.post,width,height);gl.uniform2f(this.post.uniforms.fieldSize,fw,fh);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.field);gl.uniform1i(this.post.uniforms.field,0);gl.uniform1i(this.post.uniforms.glyphAtlas,2);gl.uniform1i(this.post.uniforms.glyphLookup,3);gl.uniform1f(this.post.uniforms.glyphCount,this.glyphCount);gl.uniform3fv(this.post.uniforms.primary,hexRGB(state.colors[0]));
  for(const n of ['asciiRate','asciiDensity','asciiOpacity','asciiSize','asciiSpacing','blur','regionalBlur','texture','textureStrength','textureScale','particles','particleType','density','particleSize'])gl.uniform1f(this.post.uniforms[n],Number(state[n]));
  gl.drawArrays(gl.TRIANGLES,0,3);

 }
 destroy(){const gl=this.gl;gl.deleteProgram(this.main.program);gl.deleteProgram(this.post.program);gl.deleteBuffer(this.buffer);gl.deleteTexture(this.field);gl.deleteTexture(this.palette);gl.deleteTexture(this.glyphAtlas);gl.deleteTexture(this.glyphLookup);gl.deleteFramebuffer(this.fbo);}
}
