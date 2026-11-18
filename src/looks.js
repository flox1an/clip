// Colour looks as one affine sRGB transform (3×3 matrix + offset) plus a vignette.
// The same shader draws the camera, the editor preview and the export, so all three match.
import { t } from './i18n/index.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LUMA = [0.2126, 0.7152, 0.0722];
const op = (m, o = [0, 0, 0]) => ({ m, o });
const diag = (r, g, b) => [r, 0, 0, 0, g, 0, 0, 0, b];
const matMul = (a, b) => a.map((_, i) => { const r = Math.floor(i / 3), c = i % 3; return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; });
const matVec = (m, v) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
// Applies the steps left to right.
export const chain = (...steps) => steps.reduce((acc, s) => ({ m: matMul(s.m, acc.m), o: matVec(s.m, acc.o).map((v, i) => v + s.o[i]) }), op(IDENTITY));
const saturate = s => op(IDENTITY.map((_, i) => (1 - s) * LUMA[i % 3] + (i % 4 === 0 ? s : 0)));
const contrast = c => op(diag(c, c, c), [0.5 * (1 - c), 0.5 * (1 - c), 0.5 * (1 - c)]);
const brightness = b => op(diag(b, b, b));
const tint = (r, g, b) => op(diag(r, g, b));
const lift = v => op(IDENTITY, [v, v, v]);
const sepia = k => op([0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131].map((v, i) => k * v + (1 - k) * IDENTITY[i]));

// shadow/high: colour pushed into dark and bright tones; fade: lifted black point; grain: film grain amount;
// curve: steepness of an S-shaped contrast curve whose steepest point (mid-grey) the exposure control moves.
const look = (id, { m, o }, extras = {}) => ({ id, name: t(`look.${id}`), m, o, vignette: 0, shadow: [0, 0, 0], high: [0, 0, 0], fade: 0, grain: 0, curve: 0, ...extras });
export const LOOKS = [
  look('normal', chain()),
  look('vivid', chain(saturate(1.4), contrast(1.08))),
  look('dusk', chain(contrast(1.08), saturate(1.1)), { shadow: [0.08, -0.03, 0.15], high: [0.09, 0.06, -0.11] }),
  look('warm', chain(tint(1.08, 1, 0.86), saturate(1.12), brightness(1.03))),
  look('cool', chain(tint(0.9, 0.99, 1.12), saturate(0.94), contrast(1.04))),
  look('pastel', chain(saturate(0.78), contrast(0.9), lift(0.05), tint(1.04, 0.99, 1.03))),
  look('film', chain(saturate(0.85), contrast(1.12), tint(1.03, 1, 0.94), lift(0.03)), { vignette: 0.35, grain: 0.035 }),
  look('retro', chain(sepia(0.55), contrast(1.06), lift(0.02)), { vignette: 0.45 }),
  look('mono', chain(saturate(0), contrast(1.12)), { grain: 0.075 }),
  look('noir', chain(saturate(0), brightness(0.94)), { curve: 6, vignette: 0.55, fade: 0.08 }),
];
export const lookById = id => LOOKS.find(look => look.id === id) ?? LOOKS[0];

const VERTEX = `attribute vec2 a_pos; attribute vec2 a_uv; varying vec2 v_uv; varying vec2 v_pos;
void main() { v_uv = a_uv; v_pos = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
// Grain sits on a fixed 540×960 grid of the frame, so it has the same size in preview and export.
const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv; varying vec2 v_pos;
uniform sampler2D u_tex; uniform mat3 u_m; uniform vec3 u_o; uniform float u_k; uniform float u_vig;
uniform vec3 u_shadow; uniform vec3 u_high; uniform float u_fade; uniform float u_grain; uniform float u_seed; uniform vec2 u_res;
uniform float u_curve; uniform float u_pivot;
vec3 sigmoid(vec3 x) { return 1.0 / (1.0 + exp(-u_curve * (x - u_pivot))); }
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec3 f = clamp(u_m * c + u_o, 0.0, 1.0);
  if (u_curve > 0.0) { // rescaled so 0 and 1 stay put; steepest at u_pivot
    vec3 lo = sigmoid(vec3(0.0)), hi = sigmoid(vec3(1.0));
    f = (sigmoid(f) - lo) / (hi - lo);
  }
  float l = dot(f, vec3(0.2126, 0.7152, 0.0722));
  f = clamp(f + u_shadow * (1.0 - smoothstep(0.0, 0.6, l)) + u_high * smoothstep(0.4, 1.0, l), 0.0, 1.0);
  f = u_fade + (1.0 - u_fade) * f;
  vec2 cell = floor(gl_FragCoord.xy / u_res * vec2(540.0, 960.0));
  float n = hash(cell + u_seed * vec2(37.0, 17.0)) + hash(cell.yx + u_seed * vec2(11.0, 29.0)) - 1.0;
  f += n * u_grain * (1.0 - 0.6 * abs(l * 2.0 - 1.0));
  f *= 1.0 - u_vig * smoothstep(0.6, 1.5, length(v_pos));
  gl_FragColor = vec4(mix(c, clamp(f, 0.0, 1.0), u_k), 1.0);
}`;

// Draws a video, image or canvas into `canvas` with object-fit semantics, mirroring and a look.
export function createRenderer(canvas, { preserve = false } = {}) {
  let gl, uniforms, buffer;
  function init() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: preserve });
    if (!gl) throw new Error('WebGL is not available');
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    gl.useProgram(program);
    uniforms = Object.fromEntries(['u_m', 'u_o', 'u_k', 'u_vig', 'u_shadow', 'u_high', 'u_fade', 'u_grain', 'u_seed', 'u_res', 'u_curve', 'u_pivot'].map(name => [name, gl.getUniformLocation(program, name)]));
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, offset] of [['a_pos', 0], ['a_uv', 8]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
    }
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
  }
  init();
  canvas.addEventListener('webglcontextlost', event => event.preventDefault());
  canvas.addEventListener('webglcontextrestored', init);

  return {
    // time (seconds) re-seeds the grain about 24 times a second, like film. exposure (−1…1) moves the
    // curve's mid-grey down (brighter) or up (darker) for looks that have a curve.
    draw(source, { width, height, fit = 'cover', mirror = false, look = 'normal', strength = 1, exposure = 0, time = 0 }) {
      if (gl.isContextLost() || !width || !height || (source instanceof HTMLVideoElement && source.readyState < 2)) return false;
      const W = canvas.width, H = canvas.height, ratio = (width / height) / (W / H);
      let x = 1, y = 1, u0 = 0, u1 = 1, v0 = 0, v1 = 1;
      if (fit === 'cover') ratio > 1 ? (u0 = (1 - 1 / ratio) / 2, u1 = 1 - u0) : (v0 = (1 - ratio) / 2, v1 = 1 - v0);
      else ratio > 1 ? (y = 1 / ratio) : (x = ratio);
      if (mirror) [u0, u1] = [u1, u0];
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-x, y, u0, v0, x, y, u1, v0, -x, -y, u0, v1, x, -y, u1, v1]), gl.STREAM_DRAW);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const l = lookById(look);
      const m = l.m;
      gl.uniformMatrix3fv(uniforms.u_m, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
      gl.uniform3fv(uniforms.u_o, l.o);
      gl.uniform1f(uniforms.u_k, strength);
      gl.uniform1f(uniforms.u_vig, l.vignette);
      gl.uniform3fv(uniforms.u_shadow, l.shadow);
      gl.uniform3fv(uniforms.u_high, l.high);
      gl.uniform1f(uniforms.u_fade, l.fade);
      gl.uniform1f(uniforms.u_grain, l.grain);
      gl.uniform1f(uniforms.u_seed, Math.floor(time * 24) % 997);
      gl.uniform2f(uniforms.u_res, W, H);
      gl.uniform1f(uniforms.u_curve, l.curve);
      gl.uniform1f(uniforms.u_pivot, 0.5 - exposure * 0.3);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    destroy() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

// Sizes a canvas's drawing buffer to its CSS box (device pixels, capped) so previews stay sharp but cheap.
export function fitCanvas(canvas, maxScale = 2) {
  const scale = Math.min(maxScale, devicePixelRatio || 1), w = Math.round(canvas.clientWidth * scale), h = Math.round(canvas.clientHeight * scale);
  if (w && h && (canvas.width !== w || canvas.height !== h)) Object.assign(canvas, { width: w, height: h });
}

let tileRenderer, tileCanvas;
// Small JPEG previews of every look applied to the current frame, for the filter strip.
export function lookTiles(source, options) {
  tileCanvas ??= Object.assign(document.createElement('canvas'), { width: 108, height: 192 });
  tileRenderer ??= createRenderer(tileCanvas, { preserve: true });
  return LOOKS.map(look => tileRenderer.draw(source, { ...options, look: look.id, strength: 1 }) ? tileCanvas.toDataURL('image/jpeg', 0.75) : '');
}
