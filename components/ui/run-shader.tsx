"use client";

// run-shader.tsx — the RUN-page background: the landing's violet beam
// "branching" into many flowing light-streams, representing the agent fanning
// out parallel searches.
//
// This is the shader-only extraction of a webgl2 full-screen fractal-noise
// "clouds"/light-streams effect (after Matthias Hurrle's animated-shader-hero):
// a self-contained `WebGLRenderer` class + a `#version 300 es` GLSL fragment
// shader producing flowing light streams. The orange Hero scaffold, trust
// badge, headlines, buttons, the `<style jsx>` block, AND the PointerHandler
// are all dropped — a background needs no mouse interactivity; we feed only
// `time` + `resolution` uniforms.
//
// Retuned vs. the source:
//  - Purplized: streams read VIOLET / MAGENTA on near-black (--bg ≈ #0b0c0e),
//    continuous with the landing beam's identity (no rainbow channels).
//  - Dimmed: final color scaled down so overlaid text/cards stay crisp; the
//    run-view adds a scrim on top as a second line of defence.
//  - Perf guards (this runs for the multi-minute live run): pixel ratio capped
//    at 1.5, rAF paused on document.hidden, prefers-reduced-motion → ONE static
//    frame (no loop), full cleanup on unmount, try/catch fallback to near-black.

import { useEffect, useRef } from "react";

// ── GLSL ────────────────────────────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Flowing light-streams: stacked, domain-warped sine bands swept upward over
// time. Each "stream" is a thin bright filament; many of them fanning out of a
// shared origin near the top read as the landing beam BRANCHING. Color is
// biased hard to violet/magenta (low green) and the whole field is dimmed.
const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float time;

out vec4 fragColor;

// 2D rotation.
mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  // Aspect-corrected coords, centered horizontally; origin biased toward the
  // top so the streams appear to fan DOWN-and-OUT from a single beam — the
  // branching read.
  vec2 uv = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
  uv.y += 0.85; // push the convergence point up off-screen

  float t = time * 0.18;

  vec3 col = vec3(0.0);

  // Accumulate several light-stream filaments. Each is a sine-distorted
  // horizontal-ish band rotated to fan out from the shared origin.
  const int STREAMS = 9;
  for (int i = 0; i < STREAMS; i++) {
    float fi = float(i);

    // Fan angle: spread the streams in a cone, drifting slowly over time.
    float ang = (fi - float(STREAMS - 1) * 0.5) * 0.16 + sin(t + fi) * 0.04;
    vec2 p = rot(ang) * uv;

    // Domain warp: stack two sines so the filament flows rather than sits.
    float warp = sin(p.y * 1.4 + t * 2.0 + fi * 1.7) * 0.35
               + sin(p.y * 3.1 - t * 1.3 + fi) * 0.15;
    float d = abs(p.x + warp);

    // Thin bright filament. Falloff with distance from origin so the cone
    // dissolves outward.
    float intensity = 0.012 / (d + 0.015);
    intensity *= smoothstep(2.4, 0.0, length(p)); // fade with radius

    // Per-stream violet/magenta tint, leaning magenta on alternating streams.
    vec3 tint = mix(
      vec3(0.62, 0.30, 0.95),   // violet
      vec3(0.85, 0.18, 0.75),   // magenta
      0.5 + 0.5 * sin(fi * 1.3)
    );
    col += intensity * tint;
  }

  // Bias the whole field toward violet, suppress green hard.
  col *= vec3(0.78, 0.40, 1.0);

  // Soft tone-map so hot filament cores don't blow out to white.
  col = col / (col + vec3(0.9));

  // DIM: keep the canvas quiet enough that overlaid cards/text stay crisp.
  col *= 0.6;

  // Sit on near-black (matches --bg ≈ #0b0c0e) so the canvas blends with the
  // page rather than reading as a black box.
  vec3 base = vec3(0.043, 0.046, 0.055);
  col += base;

  fragColor = vec4(col, 1.0);
}
`;

// ── Minimal webgl2 renderer (PointerHandler dropped) ─────────────────────────

class RunShaderRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
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

    // Full-screen triangle.
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error("vao/buffer alloc failed");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.vao = vao;
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
    gl.bindVertexArray(this.vao);
    if (this.uResolution) {
      gl.uniform2f(this.uResolution, gl.canvas.width, gl.canvas.height);
    }
    if (this.uTime) gl.uniform1f(this.uTime, timeSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
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

    // Perf guard: cap pixel ratio LOWER than the landing (1.5 vs 1.75) since
    // this background runs for the full multi-minute live run.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

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
    const start = performance.now();

    function loop() {
      renderer.render((performance.now() - start) / 1000);
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
      if (reduceMotion) renderer.render(0);
    }

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduceMotion) {
      // Perf + a11y guard: render a SINGLE static frame, never start rAF.
      renderer.render(0);
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
