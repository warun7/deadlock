/**
 * Raw WebGL ray-marched liquid metal: two SDF droplets joined with a smooth
 * union, lit by a procedural studio environment (white key softbox, brand-red
 * strip light, cool back light). The larger drop follows the pointer and the
 * smaller one counter-moves, so the pair reads as two players locked together.
 *
 * Performance guards: bounding-sphere early out, adaptive render scale driven
 * by measured frame time, DPR cap, pause when hidden or offscreen.
 */

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform float uEnergy;
uniform float uSplit;
uniform float uIntro;
uniform vec2 uOffset;
uniform float uScale;

vec3 c1;
vec3 c2;
float r1;
float r2;
float k;

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float smin(float a, float b, float kk) {
  float h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
  return mix(b, a, h) - kk * h * (1.0 - h);
}

float map(vec3 p) {
  float t = uTime;
  float w = sin(p.x * 3.1 + t * 1.3) * sin(p.y * 2.7 - t * 1.1) * sin(p.z * 3.3 + t * 0.9);
  float w2 = sin(p.x * 6.3 - t * 2.1 + p.y * 1.7) * sin(p.z * 5.1 + t * 1.6);
  float d1 = length(p - c1) - r1;
  float d2 = length(p - c2) - r2;
  float d = smin(d1, d2, k);
  return d + (0.05 + 0.06 * uEnergy) * w + (0.012 + 0.02 * uEnergy) * w2;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * map(p + e.xyy) +
    e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) +
    e.xxx * map(p + e.xxx)
  );
}

float softbox(vec2 a, vec2 c, vec2 size, float blur) {
  vec2 q = abs(a - c) - size;
  return 1.0 - smoothstep(0.0, blur, max(q.x, q.y));
}

// Procedural studio. a.x = azimuth (0 faces the viewer), a.y = elevation.
vec3 env(vec3 d) {
  vec2 a = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0)));

  vec3 sky = mix(vec3(0.06, 0.06, 0.075), vec3(0.17, 0.17, 0.2), smoothstep(0.0, 1.2, a.y));
  vec3 ground = mix(vec3(0.018, 0.018, 0.022), vec3(0.004), smoothstep(0.0, -0.9, a.y));
  vec3 col = mix(ground, sky, smoothstep(-0.03, 0.03, a.y));

  // Horizon line
  col += vec3(0.75, 0.78, 0.85) * exp(-abs(a.y - 0.015) * 70.0) * 0.55;

  // Key softbox: large, upper left, behind the viewer
  col += vec3(1.0, 0.99, 0.97) * softbox(a, vec2(-0.55, 0.55), vec2(0.42, 0.26), 0.06) * 2.2;
  // Fill softbox: smaller, upper right
  col += vec3(0.85, 0.88, 0.95) * softbox(a, vec2(0.75, 0.35), vec2(0.16, 0.2), 0.05) * 0.9;
  // Overhead strip
  col += vec3(0.9) * softbox(a, vec2(0.0, 1.15), vec2(1.2, 0.08), 0.08) * 0.8;
  // Brand-red vertical strip, hard right
  col += vec3(0.95, 0.17, 0.2) * softbox(a, vec2(1.55, 0.05), vec2(0.07, 0.62), 0.05) * 3.0;
  // White rim strip, hard left
  col += vec3(0.95) * softbox(a, vec2(-1.75, 0.1), vec2(0.05, 0.5), 0.05) * 1.4;
  // Faint red bounce on the floor
  col += vec3(0.35, 0.05, 0.07) * softbox(a, vec2(1.2, -0.35), vec2(0.5, 0.18), 0.35) * 0.35;
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  uv = (uv - uOffset) / uScale;

  float t = uTime * 0.42;
  float intro = uIntro;
  float introEase = 1.0 - pow(1.0 - intro, 3.0);

  float sep = mix(1.3, 2.7, uSplit) + 0.2 * sin(t * 1.7) + (1.0 - introEase) * 2.2;
  vec3 axis = normalize(vec3(cos(t * 0.8) + 0.35, 0.28 * sin(t * 1.3), 0.55 * sin(t * 0.8)));
  vec3 pull = vec3(uPointer * vec2(0.55, 0.4), 0.0);
  c1 = axis * sep * 0.5 + pull;
  c2 = -axis * sep * 0.5 - pull * 0.45;
  r1 = 0.78 * mix(0.35, 1.0, introEase);
  r2 = 0.62 * mix(0.35, 1.0, introEase);
  k = mix(0.54, 0.3, uSplit);

  vec3 ro = vec3(0.0, 0.0, 4.4);
  vec3 rd = normalize(vec3(uv, -1.65));
  mat2 yaw = rot(uPointer.x * 0.16);
  mat2 pitch = rot(-uPointer.y * 0.1);
  ro.xz = yaw * ro.xz;
  rd.xz = yaw * rd.xz;
  ro.yz = pitch * ro.yz;
  rd.yz = pitch * rd.yz;

  // Bounding sphere early out
  vec3 bc = (c1 + c2) * 0.5;
  float br = sep * 0.5 + max(r1, r2) + 0.35;
  vec3 oc = ro - bc;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - br * br;
  float disc = b * b - c;
  if (disc < 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float tt = max(-b - sqrt(disc), 0.0);
  float tMax = -b + sqrt(disc);
  float closest = 1e3;
  float closestT = tt;
  bool hit = false;

  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * tt;
    float d = map(p);
    if (d < closest) {
      closest = d;
      closestT = tt;
    }
    if (d < 0.0012) {
      hit = true;
      break;
    }
    tt += d * 0.8;
    if (tt > tMax) break;
  }

  // Pixel footprint in world units at the closest approach, for soft silhouettes
  float px = closestT / (uRes.y * uScale * 1.65);
  float cov = hit ? 1.0 : 1.0 - smoothstep(0.0, px * 1.5, closest);
  if (cov <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 p = ro + rd * (hit ? tt : closestT);
  vec3 n = calcNormal(p);
  vec3 r = reflect(rd, n);
  float ndv = max(dot(n, -rd), 0.0);
  float fres = pow(1.0 - ndv, 5.0);

  vec3 f0 = vec3(0.62, 0.62, 0.66);
  vec3 col = env(r) * mix(f0, vec3(1.0), fres);
  // Faint diffuse lift so the dark side keeps its form
  col += vec3(0.012) * (0.5 + 0.5 * n.y);

  // Cavity darkening where the two drops merge
  float ao = clamp(map(p + n * 0.14) / 0.14, 0.0, 1.0);
  col *= 0.3 + 0.7 * ao;

  // Faint red glow trapped in the neck between the drops
  float da = length(p - c1) - r1;
  float db = length(p - c2) - r2;
  float neck = exp(-abs(da - db) * 6.0) * smoothstep(0.7, 0.05, da + db);
  col += vec3(0.55, 0.08, 0.1) * neck * (1.0 - ao) * 0.9;

  col = 1.0 - exp(-col * 1.25);
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col * cov, cov);
}
`;

export interface LiquidMetalLayout {
  /** Center of the form in viewport-height units, relative to canvas center */
  offsetX: number;
  offsetY: number;
  /** Visual scale of the form */
  scale: number;
}

export interface LiquidMetalOptions {
  maxDpr?: number;
  /** Starting render scale (fraction of CSS pixels * dpr) */
  renderScale?: number;
  minRenderScale?: number;
  reducedMotion?: boolean;
  layout: (width: number, height: number) => LiquidMetalLayout;
  /** Read each frame, 0..1: how far the drops are pulled apart */
  getSplit?: () => number;
}

type Uniforms = Record<
  "uRes" | "uTime" | "uPointer" | "uEnergy" | "uSplit" | "uIntro" | "uOffset" | "uScale",
  WebGLUniformLocation | null
>;

export class LiquidMetalRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer | null;
  private uniforms: Uniforms;
  private opts: Required<Omit<LiquidMetalOptions, "getSplit">> & Pick<LiquidMetalOptions, "getSplit">;

  private raf = 0;
  private running = false;
  private visible = true;
  private pageVisible = true;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private frameTimes: number[] = [];
  private renderScale: number;
  private layout: LiquidMetalLayout = { offsetX: 0, offsetY: 0, scale: 1 };

  private pointerTarget = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private lastPointerSample = { x: 0, y: 0, t: 0 };
  private energy = 0;
  private energyTarget = 0;
  private intro = 0;

  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;

  static isSupported(): boolean {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, options: LiquidMetalOptions) {
    this.canvas = canvas;
    this.opts = {
      maxDpr: 1.5,
      renderScale: 1,
      minRenderScale: 0.45,
      reducedMotion: false,
      ...options,
    };
    this.renderScale = this.opts.renderScale;
    this.intro = this.opts.reducedMotion ? 1 : 0;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    this.program = this.createProgram(VERT, FRAG);
    gl.useProgram(this.program);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(this.program, name);
    this.uniforms = {
      uRes: u("uRes"),
      uTime: u("uTime"),
      uPointer: u("uPointer"),
      uEnergy: u("uEnergy"),
      uSplit: u("uSplit"),
      uIntro: u("uIntro"),
      uOffset: u("uOffset"),
      uScale: u("uScale"),
    };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0]?.isIntersecting ?? true;
        this.updateLoop();
      },
      { threshold: 0 }
    );
    this.intersectionObserver.observe(canvas);

    document.addEventListener("visibilitychange", this.onVisibility);
    if (!this.opts.reducedMotion) {
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    }

    this.resize();
    this.updateLoop();
  }

  private createShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return shader;
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, this.createShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, this.createShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private onVisibility = () => {
    this.pageVisible = document.visibilityState === "visible";
    this.updateLoop();
  };

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerTarget.x = Math.max(-1.2, Math.min(1.2, x));
    this.pointerTarget.y = Math.max(-1.2, Math.min(1.2, y));

    const now = performance.now();
    const dt = Math.max(now - this.lastPointerSample.t, 1);
    const dist = Math.hypot(x - this.lastPointerSample.x, y - this.lastPointerSample.y);
    const speed = dist / dt; // NDC per ms
    this.energyTarget = Math.min(1, this.energyTarget + speed * 6);
    this.lastPointerSample = { x, y, t: now };
  };

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr);
    const w = Math.max(1, Math.round(rect.width * dpr * this.renderScale));
    const h = Math.max(1, Math.round(rect.height * dpr * this.renderScale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.layout = this.opts.layout(rect.width, rect.height);
    if (!this.running) this.draw(performance.now());
  }

  private updateLoop() {
    const shouldRun = this.visible && this.pageVisible && !this.opts.reducedMotion;
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(now - this.lastFrame, 100);
    this.lastFrame = now;

    // Critically damped-ish follow for fluid lag
    const follow = 1 - Math.pow(0.001, dt / 1000);
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * follow * 0.9;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * follow * 0.9;
    this.energyTarget *= Math.pow(0.02, dt / 1000);
    this.energy += (this.energyTarget - this.energy) * follow;
    this.intro = Math.min(1, this.intro + dt / 1800);

    this.draw(now);
    this.adaptQuality(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  private adaptQuality(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 40) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    let next = this.renderScale;
    if (avg > 21) next = Math.max(this.opts.minRenderScale, this.renderScale - 0.12);
    else if (avg < 13 && this.renderScale < this.opts.renderScale) next = Math.min(this.opts.renderScale, this.renderScale + 0.06);
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.resize();
    }
  }

  private draw(now: number) {
    const gl = this.gl;
    const time = this.opts.reducedMotion ? 2.2 : (now - this.startTime) / 1000;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uTime, time);
    gl.uniform2f(this.uniforms.uPointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(this.uniforms.uEnergy, this.energy);
    gl.uniform1f(this.uniforms.uSplit, this.opts.getSplit ? this.opts.getSplit() : 0);
    gl.uniform1f(this.uniforms.uIntro, this.intro);
    gl.uniform2f(this.uniforms.uOffset, this.layout.offsetX, this.layout.offsetY);
    gl.uniform1f(this.uniforms.uScale, this.layout.scale);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Force a redraw (used when an external input such as scroll split changes while paused). */
  requestDraw() {
    if (!this.running) this.draw(performance.now());
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pointermove", this.onPointerMove);
    // Free GPU resources but keep the context: React StrictMode remounts on the same canvas.
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
