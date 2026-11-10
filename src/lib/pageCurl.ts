/**
 * WebGL page curl: the turning page is a mesh wrapped around a moving cylinder
 * (the classic iBooks-style curl), lit by the curvature, with soft shadows cast
 * on the pages underneath.
 *
 * Page-local coordinates: x runs from the spine (0) to the free edge (W), y from top (0) to bottom (H).
 * `side` mirrors the page to the left of the spine for backward turns.
 */

const LEAF_VS = `
attribute vec2 a_pos;
uniform vec2 u_size;
uniform float u_c;
uniform float u_r;
uniform float u_phi;
uniform vec2 u_canvas;
uniform vec2 u_origin;
uniform float u_side;
uniform float u_focal;
varying vec2 v_uv;
varying float v_a;
varying float v_d;
varying vec2 v_p;
const float PI = 3.14159265;
void main() {
  vec2 m = vec2(cos(u_phi), sin(u_phi));
  vec2 c0 = vec2(u_c, u_size.y * 0.5);
  vec2 p = a_pos;
  float d = dot(p - c0, m);
  vec2 base = p - d * m;
  vec3 q;
  float a = 0.0;
  if (d <= 0.0) {
    q = vec3(p, 0.0);
  } else if (d < PI * u_r) {
    a = d / u_r;
    q = vec3(base + m * (u_r * sin(a)), u_r * (1.0 - cos(a)));
  } else {
    a = PI;
    q = vec3(base - m * (d - PI * u_r), 2.0 * u_r);
  }
  v_uv = p / u_size;
  v_a = a;
  v_d = d;
  v_p = p;
  vec2 s = vec2(u_origin.x + u_side * q.x, u_origin.y + q.y);
  vec2 ctr = vec2(u_origin.x, u_origin.y + u_size.y * 0.5);
  s = ctr + (s - ctr) * (u_focal / (u_focal - q.z));
  vec2 clip = s / u_canvas * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, -q.z / (u_size.x * 4.0), 1.0);
}`;

const LEAF_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_front;
uniform sampler2D u_back;
uniform float u_hasBack;
uniform float u_side;
uniform float u_r;
uniform float u_c;
uniform float u_phi;
uniform vec2 u_size;
uniform vec3 u_paper;
varying vec2 v_uv;
varying float v_a;
varying float v_d;
varying vec2 v_p;
const float PI = 3.14159265;
void main() {
  bool isFront = (gl_FrontFacing == (u_side > 0.0));
  float fu = u_side > 0.0 ? v_uv.x : 1.0 - v_uv.x;
  vec3 col;
  float shade;
  if (isFront) {
    col = texture2D(u_front, vec2(fu, v_uv.y)).rgb;
    shade = 0.62 + 0.38 * abs(cos(v_a));
    shade += 0.09 * exp(-pow((v_a - 0.62) / 0.24, 2.0));
    if (v_d < 0.0) shade *= 1.0 - 0.14 * exp(v_d / (0.45 * u_r + 1.0));
    vec2 m = vec2(cos(u_phi), sin(u_phi));
    float de = dot(vec2(u_size.x, v_p.y) - vec2(u_c, u_size.y * 0.5), m);
    float smin = PI * u_r - de;
    if (de > PI * u_r && v_d < smin) shade *= 1.0 - 0.22 * exp((v_d - smin) / 26.0);
  } else {
    col = u_hasBack > 0.5 ? texture2D(u_back, vec2(1.0 - fu, v_uv.y)).rgb : u_paper;
    shade = (0.7 + 0.3 * abs(cos(v_a))) * 0.97;
  }
  gl_FragColor = vec4(col * clamp(shade, 0.0, 1.15), 1.0);
}`;

const SHADOW_VS = `
attribute vec2 a_pos;
uniform vec2 u_canvas;
uniform vec2 u_origin;
uniform float u_side;
varying vec2 v_p;
void main() {
  v_p = a_pos;
  vec2 s = vec2(u_origin.x + u_side * a_pos.x, u_origin.y + a_pos.y);
  vec2 clip = s / u_canvas * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.9, 1.0);
}`;

const SHADOW_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_c;
uniform float u_r;
uniform float u_phi;
uniform float u_env;
uniform vec2 u_size;
varying vec2 v_p;
const float PI = 3.14159265;
void main() {
  vec2 m = vec2(cos(u_phi), sin(u_phi));
  vec2 c0 = vec2(u_c, u_size.y * 0.5);
  float d = dot(v_p - c0, m);
  float a = 0.0;
  if (v_p.x > 0.0 && d > 0.0) a = 0.42 * exp(-max(d - u_r * 0.55, 0.0) / (u_r * 0.9 + 10.0));
  float de = dot(vec2(u_size.x, v_p.y) - c0, m);
  float smin = PI * u_r - de;
  if (v_p.x < 0.0 && de > PI * u_r && d < smin) a = max(a, 0.3 * exp((d - smin) / 24.0));
  float vy = smoothstep(-14.0, 4.0, v_p.y) * (1.0 - smoothstep(u_size.y - 4.0, u_size.y + 14.0, v_p.y));
  float vx = 1.0 - smoothstep(u_size.x - 2.0, u_size.x + 12.0, abs(v_p.x));
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * u_env * vy * vx);
}`;

export interface CurlJob {
  canvas: HTMLCanvasElement;
  front: HTMLCanvasElement;
  back: HTMLCanvasElement | null;
  pageW: number;
  pageH: number;
  originX: number; // spine, CSS px inside the overlay canvas
  originY: number; // page top, CSS px inside the overlay canvas
  side: 1 | -1;
  paper: [number, number, number];
}

export interface CurlController {
  /** Draw the curl at progress e: 0 = lying flat on its own side, 1 = fully turned over. */
  set: (e: number) => void;
  /** Ease toward e a little every frame; used while a finger or mouse is dragging the page. */
  follow: (e: number) => void;
  /** Which corner leads the curl: 1 = bottom, -1 = top. */
  setTilt: (sign: 1 | -1) => void;
  animateTo: (target: 0 | 1, ms: number, onDone: () => void, ease?: (t: number) => number) => void;
  progress: () => number;
  cancel: () => void;
}

const PHI0 = 0.27; // initial tilt of the curl line (radians)

export const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const R_END = 0.004;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const foldStart = (W: number, H: number) => W + (H / 2) * Math.tan(PHI0) + 6;
const foldEnd = (W: number) => (-Math.PI * W * R_END) / 2;

function curlParams(e: number, W: number, H: number, tilt: number) {
  const phi = tilt * PHI0 * Math.pow(1 - e, 1.3);
  // The radius follows the fold's travel: a tight corner lift, a soft roll mid-page, then it
  // tightens as the fold reaches the spine so the full page length lands on the other side.
  const r = W * (R_END + 0.012 * (1 - e) + 0.14 * Math.pow(Math.sin(Math.PI * e), 0.85));
  const c = foldStart(W, H) + (foldEnd(W) - foldStart(W, H)) * e;
  return { c, r, phi, env: Math.pow(Math.sin(Math.PI * e), 0.6) };
}

/**
 * Progress that puts the page's free edge roughly under the pointer.
 * `x` is the pointer's distance from the spine, measured toward the page's own side.
 * (Folding a sheet at c mirrors its edge from W to about 2c − W.)
 */
export function progressAtPointer(x: number, W: number, H: number) {
  const c = (x + W) / 2;
  return clamp01((foldStart(W, H) - c) / (foldStart(W, H) - foldEnd(W)));
}

function compile(gl: WebGLRenderingContext, vs: string, fs: string) {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

function texture(gl: WebGLRenderingContext, src: HTMLCanvasElement, unit: number) {
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  return t;
}

/** Sets up the curl and draws it flat. Returns null if WebGL isn't available. */
export function createCurl(job: CurlJob): CurlController | null {
  const { canvas, pageW: W, pageH: H } = job;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true });
  if (!gl) return null;

  let leaf: WebGLProgram;
  let shadow: WebGLProgram;
  try {
    leaf = compile(gl, LEAF_VS, LEAF_FS);
    shadow = compile(gl, SHADOW_VS, SHADOW_FS);
  } catch (e) {
    console.warn('page curl unavailable', e);
    return null;
  }

  // Page mesh
  const NX = 56;
  const NY = 36;
  const verts = new Float32Array((NX + 1) * (NY + 1) * 2);
  for (let j = 0, k = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      verts[k++] = (W * i) / NX;
      verts[k++] = (H * j) / NY;
    }
  const idx = new Uint16Array(NX * NY * 6);
  for (let j = 0, k = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  const leafBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, leafBuf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  const quad = new Float32Array([-W, -0.1 * H, W, -0.1 * H, -W, 1.1 * H, W, 1.1 * H]);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  texture(gl, job.front, 0);
  if (job.back) texture(gl, job.back, 1);

  const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthFunc(gl.LESS);

  let tilt = 1;
  const draw = (e: number) => {
    const k = curlParams(clamp01(e), W, H, tilt);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // shadows on the pages underneath
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(shadow);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    const sp = gl.getAttribLocation(shadow, 'a_pos');
    gl.enableVertexAttribArray(sp);
    gl.vertexAttribPointer(sp, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(U(shadow, 'u_canvas'), cssW, cssH);
    gl.uniform2f(U(shadow, 'u_origin'), job.originX, job.originY);
    gl.uniform1f(U(shadow, 'u_side'), job.side);
    gl.uniform1f(U(shadow, 'u_c'), k.c);
    gl.uniform1f(U(shadow, 'u_r'), k.r);
    gl.uniform1f(U(shadow, 'u_phi'), k.phi);
    gl.uniform1f(U(shadow, 'u_env'), k.env);
    gl.uniform2f(U(shadow, 'u_size'), W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // the curling page
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(leaf);
    gl.bindBuffer(gl.ARRAY_BUFFER, leafBuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    const lp = gl.getAttribLocation(leaf, 'a_pos');
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(U(leaf, 'u_size'), W, H);
    gl.uniform1f(U(leaf, 'u_c'), k.c);
    gl.uniform1f(U(leaf, 'u_r'), k.r);
    gl.uniform1f(U(leaf, 'u_phi'), k.phi);
    gl.uniform2f(U(leaf, 'u_canvas'), cssW, cssH);
    gl.uniform2f(U(leaf, 'u_origin'), job.originX, job.originY);
    gl.uniform1f(U(leaf, 'u_side'), job.side);
    gl.uniform1f(U(leaf, 'u_focal'), W * 6);
    gl.uniform1i(U(leaf, 'u_front'), 0);
    gl.uniform1i(U(leaf, 'u_back'), 1);
    gl.uniform1f(U(leaf, 'u_hasBack'), job.back ? 1 : 0);
    gl.uniform3f(U(leaf, 'u_paper'), ...job.paper);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  };

  let cur = 0;
  let target = 0;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let following = false;
  let dead = false;

  const stop = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    following = false;
  };
  const set = (e: number) => {
    cur = clamp01(e);
    if (!dead) draw(cur);
  };
  set(0);

  return {
    set: (e) => {
      stop();
      set(e);
    },
    follow: (e) => {
      target = clamp01(e);
      if (following || dead) return;
      stop();
      following = true;
      const step = () => {
        if (dead || !following) return;
        const d = target - cur;
        if (Math.abs(d) < 0.002) {
          set(target);
          following = false;
          return;
        }
        set(cur + d * 0.32);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    setTilt: (sign) => {
      tilt = sign;
    },
    animateTo: (to, ms, onDone, ease = easeInOut) => {
      stop();
      const from = cur;
      const start = performance.now();
      let done = false;
      const finish = () => {
        if (done || dead) return;
        done = true;
        stop();
        set(to);
        onDone();
      };
      const tick = (now: number) => {
        const t = clamp01((now - start) / ms);
        set(from + (to - from) * ease(t));
        if (t >= 1) finish();
        else raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      // rAF pauses in background windows; make sure the turn still completes.
      timer = setTimeout(finish, ms + 400);
    },
    progress: () => cur,
    cancel: () => {
      dead = true;
      stop();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Page snapshots (canvas + highlights + page filter, as displayed)   */
/* ------------------------------------------------------------------ */

const FILTERS: Record<string, string> = {
  none: 'none',
  warm: 'sepia(0.22) saturate(1.05) brightness(0.98)',
  night: 'invert(0.9) hue-rotate(180deg) contrast(0.92) brightness(1.05)',
};

export function snapshotPage(
  pageEl: HTMLElement,
  rotation: number,
  rects: { color: string; x: number; y: number; w: number; h: number }[],
  filter: string,
): HTMLCanvasElement | null {
  const src = pageEl.querySelector<HTMLCanvasElement>('.canvas-wrap canvas');
  if (!src || !src.width) return null;
  const W = pageEl.offsetWidth;
  const H = pageEl.offsetHeight;
  const rotated = rotation % 180 !== 0;
  const w = rotated ? H : W;
  const h = rotated ? W : H;
  const s = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = Math.round(W * s);
  c.height = Math.round(H * s);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = filter === 'night' ? '#1a1a1a' : '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  // same mapping as rotationTransform(): surface (x, y) -> outer box
  const m: Record<number, [number, number, number, number, number, number]> = {
    0: [1, 0, 0, 1, 0, 0],
    90: [0, 1, -1, 0, h, 0],
    180: [-1, 0, 0, -1, w, h],
    270: [0, -1, 1, 0, 0, w],
  };
  const [a, b, cc, d, e, f] = m[rotation] ?? m[0];
  ctx.setTransform(a * s, b * s, cc * s, d * s, e * s, f * s);
  ctx.filter = FILTERS[filter] ?? 'none';
  ctx.drawImage(src, 0, 0, w, h);
  ctx.filter = 'none';
  const night = filter === 'night';
  ctx.globalCompositeOperation = night ? 'screen' : 'multiply';
  ctx.globalAlpha = night ? 0.4 : 0.55;
  for (const r of rects) {
    ctx.fillStyle = r.color;
    ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
  }
  return c;
}
