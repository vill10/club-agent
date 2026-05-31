"use client";

// run-shader.tsx — the RUN-page background: flowing VIOLET clouds + light
// streaks behind the live run, representing the agent fanning out parallel
// searches.
//
// This is the shader-only extraction of Matthias Hurrle's webgl2
// clouds/light-streams hero shader, recolored to violet/magenta and dimmed so
// overlaid cards/text stay readable. The orange Hero scaffold, badges,
// headlines, buttons, the `<style jsx>` block, AND the PointerHandler are
// dropped — a background needs no mouse interactivity; we feed only `time` +
// `resolution` uniforms.
//
// Retuned vs. the source:
//  - Recolored: the two RECOLOR lines below bias streaks + clouds to violet /
//    magenta on near-black (--bg ≈ #0b0c0e) instead of the original rainbow +
//    brown. STRUCTURE/motion are identical to the original.
//  - Dimmed: final color scaled (col *= 0.6) so overlaid text/cards stay crisp;
//    the run-view adds a scrim on top as a second line of defence.
//  - Perf guards (this runs for the multi-minute live run): pixel ratio capped
//    at ≤1.5, rAF paused on document.hidden, prefers-reduced-motion → ONE
//    static frame (no loop), full cleanup on unmount, try/catch fallback to
//    near-black.

import { useEffect, useRef } from "react";

// ── GLSL ────────────────────────────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec4 position;
void main() {
  gl_Position = position;
}
`;

// Matthias Hurrle's clouds / light-streams fragment shader, VERBATIM except the
// two RECOLOR lines (marked) which bias the streaks + cloud tint to violet, and
// the final dim (col *= 0.6).
const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)
float rnd(vec2 p){p=fract(p*vec2(12.9898,78.233));p+=dot(p,p+34.56);return fract(p.x*p.y);}
float noise(in vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);float a=rnd(i),b=rnd(i+vec2(1,0)),c=rnd(i+vec2(0,1)),d=rnd(i+1.);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float t=.0,a=1.;mat2 m=mat2(1.,-.5,.2,1.2);for(int i=0;i<5;i++){t+=a*noise(p);p*=2.*m;a*=.5;}return t;}
float clouds(vec2 p){float d=1.,t=.0;for(float i=.0;i<3.;i++){float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);t=mix(t,d,a);d=a;p*=2./(i+1.);}return t;}
void main(void){
  vec2 uv=(FC-.5*R)/MN,st=uv*vec2(2,1);
  vec3 col=vec3(0);
  float bg=clouds(vec2(st.x+T*.5,-st.y));
  uv*=1.-.3*(sin(T*.2)*.5+.5);
  for(float i=1.;i<12.;i++){
    uv+=.1*cos(i*vec2(.1+.01*i,.8)+i*i+T*.5+.1*uv.x);
    vec2 p=uv;
    float d=length(p);
    // RECOLOR: violet/magenta streaks instead of rainbow cos(sin(i)*vec3(1,2,3))
    col+=.00125/d*(cos(sin(i)*vec3(2.6,3.8,1.4))+1.);
    float b=noise(i+p+bg*1.731);
    col+=.002*b/length(max(p,vec2(b*p.x*.02,p.y)));
    // RECOLOR: violet cloud tint instead of brown vec3(bg*.25,bg*.137,bg*.05)
    col=mix(col,vec3(bg*.20,bg*.07,bg*.30),d);
  }
  col*=0.6; // dim so overlaid content stays readable
  O=vec4(col,1);
}
`;

// ── Minimal webgl2 renderer (PointerHandler dropped) ─────────────────────────

class RunShaderRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private uResolution: WebGLUniformLocation | null;
  private uTime: WebGLUniformLocation | null;
  private pixelRatio: number;

  constructor(canvas: HTMLCanvasElement, pixelRatio: number) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      powerPreference: "low-power",
      // The background is opaque; no need for an alpha buffer.
      alpha: false,
    });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.pixelRatio = pixelRatio;

    const vert = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const frag = this.compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const program = gl.createProgram();
    if (!program) throw new Error("program alloc failed");
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error(`program link failed: ${log ?? ""}`);
    }
    // Shaders are linked into the program; the standalone objects can go.
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    this.program = program;

    // Full-screen TRIANGLE_STRIP quad over the four corner vertices.
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("buffer alloc failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.buffer = buffer;

    this.uResolution = gl.getUniformLocation(program, "resolution");
    this.uTime = gl.getUniformLocation(program, "time");
  }

  private compile(type: number, source: string): WebGLShader {
    const { gl } = this;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader alloc failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`shader compile failed: ${log ?? ""}`);
    }
    return shader;
  }

  resize(width: number, height: number): void {
    const { gl } = this;
    const w = Math.floor(width * this.pixelRatio);
    const h = Math.floor(height * this.pixelRatio);
    if (gl.canvas.width !== w || gl.canvas.height !== h) {
      gl.canvas.width = w;
      gl.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  render(timeSeconds: number): void {
    const { gl } = this;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.uResolution) {
      gl.uniform2f(this.uResolution, gl.canvas.width, gl.canvas.height);
    }
    if (this.uTime) gl.uniform1f(this.uTime, timeSeconds);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.buffer);
    // Free the GPU context promptly — this background outlives a long run.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function RunShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Perf guard: pixel ratio = max(1, 0.5 * dpr), capped at ≤ 1.5.
    const dpr = window.devicePixelRatio || 1;
    const pixelRatio = Math.min(Math.max(1, 0.5 * dpr), 1.5);

    let renderer: RunShaderRenderer;
    try {
      renderer = new RunShaderRenderer(canvas, pixelRatio);
    } catch {
      // No webgl2 / compile failure — leave the near-black CSS background as
      // the static fallback.
      return;
    }

    function resize() {
      renderer.resize(window.innerWidth, window.innerHeight);
    }
    resize();

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    let running = false;

    function loop(now: number) {
      renderer.render(now * 1e-3);
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (running || reduceMotion) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    }

    function onVisibility() {
      // Perf guard: don't burn GPU/CPU while the tab is hidden.
      if (document.hidden) stopLoop();
      else startLoop();
    }

    function onResize() {
      resize();
      // Repaint immediately so a resize under reduced-motion isn't left stale.
      if (reduceMotion) renderer.render(performance.now() * 1e-3);
    }

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduceMotion) {
      // Perf + a11y guard: render a SINGLE static frame, never start rAF.
      renderer.render(performance.now() * 1e-3);
    } else {
      startLoop();
    }

    return () => {
      stopLoop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full bg-bg"
    />
  );
}
