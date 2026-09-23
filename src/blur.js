// SPDX-License-Identifier: MIT
// 真正的高斯模糊，在 GPU 上做：所有浏览器结果一致（Safari 的 2D canvas 不支持 filter，之前只能缩小再放大，边缘发硬）。
// 做法：先一级一级减半（每级 2×2 平均，不丢细节也不闪），把要模糊的半径缩到 4–8 像素，
// 在小图上做横竖两遍可分离的高斯卷积，最后由调用方按双线性放大铺满 —— 模糊过的图放大不会出块。
// 纹理都用 CLAMP_TO_EDGE：画面边缘按边上的颜色往外延，不会拉出一圈白边或暗边。
// 不 import 任何东西：Rise 导出 HTML 时原样内联。
export class Blur {
  constructor() {
    const canvas = this.canvas = document.createElement('canvas');
    const gl = this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw Error('WebGL unavailable');
    const vs = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    const copy = 'precision mediump float;uniform sampler2D t;varying vec2 uv;void main(){gl_FragColor=texture2D(t,uv);}';
    // 每边 24 个采样点，σ 最大 8 时覆盖到 3σ；权重按 σ 现算，再归一化
    const gauss = `precision highp float;uniform sampler2D t;uniform vec2 d;uniform float s;varying vec2 uv;
void main(){vec4 c=texture2D(t,uv);float n=1.;for(int i=1;i<=24;i++){float x=float(i);float w=exp(-x*x/(2.*s*s));c+=(texture2D(t,uv+d*x)+texture2D(t,uv-d*x))*w;n+=2.*w;}gl_FragColor=c/n;}`;
    const program = (fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      return p;
    };
    this.copy = program(copy); this.gauss = program(gauss);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // 带透明的背景（缩小露底）也要模糊得干净：按预乘 alpha 算
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.fbo = gl.createFramebuffer();
    this.pool = [];
  }
  texture(w, h, i) {
    const gl = this.gl;
    let t = this.pool[i];
    if (!t) {
      t = this.pool[i] = { tex: gl.createTexture(), w: 0, h: 0 };
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (t.w !== w || t.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      t.w = w; t.h = h;
    }
    return t;
  }
  pass(prog, src, dst, uniforms = {}) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? this.fbo : null);
    if (dst) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst.tex, 0);
    const w = dst ? dst.w : this.canvas.width, h = dst ? dst.h : this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
    if (uniforms.d) gl.uniform2f(gl.getUniformLocation(prog, 'd'), uniforms.d[0], uniforms.d[1]);
    if (uniforms.s) gl.uniform1f(gl.getUniformLocation(prog, 's'), uniforms.s);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  /* source：canvas / 图片；sigma：高斯标准差，按「最终铺满的尺寸 W」算的像素（等同 CSS 的 blur(σpx)）。
     源图可以比 W 小（比如按一半分辨率画的 Rheo）：换算成源图自己的像素再模糊。
     返回一张小画布（已经模糊），调用方 drawImage 到 W×H 即可。 */
  apply(source, W, sigma) {
    const gl = this.gl;
    const sw = source.width, sh = source.height;
    const s0 = sigma * sw / W;                      // 源图像素里的 σ
    // 缩到 σ 在 4–8 像素之间；每级都是精确的 2×2 平均
    let levels = 0;
    while (s0 / 2 ** (levels + 1) >= 4 && Math.min(sw, sh) / 2 ** (levels + 1) >= 16) levels++;
    const base = this.texture(sw, sh, 0);
    gl.bindTexture(gl.TEXTURE_2D, base.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    let cur = base, w = sw, h = sh;
    for (let i = 1; i <= levels; i++) {
      w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2));
      const next = this.texture(w, h, i);
      this.pass(this.copy, cur, next);
      cur = next;
    }
    const s = Math.max(.5, s0 / 2 ** levels);
    const a = this.texture(w, h, 20), b = this.texture(w, h, 21);
    this.pass(this.gauss, cur, a, { d: [1 / w, 0], s });
    this.pass(this.gauss, a, b, { d: [0, 1 / h], s });
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.pass(this.copy, b, null);
    return this.canvas;
  }
}
