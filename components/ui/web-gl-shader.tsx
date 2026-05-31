"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// "The beam" — one concentrated violet light-beam rendered as a fixed,
// pointer-transparent background layer behind the landing hero. Raymarched
// sine-distortion beams with subtle chromatic edges, retuned from a rainbow
// palette to read VIOLET / MAGENTA on near-black (matching --bg ≈ #0b0c0e and
// --accent ≈ #9d5bf4). Perf guards: capped pixel ratio, paused while the tab is
// hidden, and a single static frame under prefers-reduced-motion.

const vertexShader = /* glsl */ `
attribute vec3 position;
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

// The beam intensity is computed via stacked sine-distorted horizontal bands
// (the original rainbow effect), but instead of splitting the final color into
// R/G/B rainbow channels we keep a small chromatic split for the magenta edges
// and then tint the whole thing toward the brand violet. Renders on near-black
// (not pure black) so the canvas blends seamlessly with the page background.
const fragmentShader = /* glsl */ `
precision highp float;

uniform vec2 resolution;
uniform float time;
uniform float xScale;
uniform float yScale;
uniform float distortion;

// Single beam-intensity sample with a small horizontal offset used to fake
// chromatic aberration at the beam edges.
float beam(vec2 p, float offset) {
  float d = length(vec2(p.x, (p.y + offset) * 8.0));
  float rate = pow(abs(2.0 * fract(time * 0.05) - 1.0), 3.0) * 0.3 + 0.1;
  d += sin(p.x * xScale + time) * sin(p.y * yScale + time) * distortion * rate;
  // Brightness multiplier: raised from 0.0035 so the beam reads as an
  // obviously-glowing violet streak on the near-black background.
  return 0.011 / abs(d);
}

void main() {
  // Normalized, aspect-corrected coords centered on the screen.
  vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);

  // Chromatic split: sample the beam at three tiny vertical offsets. The
  // center carries most of the energy; the outer two bleed magenta/violet at
  // the edges rather than full rainbow.
  float core = beam(p, 0.0);
  float edgeA = beam(p, 0.0016);
  float edgeB = beam(p, -0.0016);

  // Map to a violet palette: boost R and B, keep G low so the beam glows
  // violet with magenta chromatic fringes. (~vec3(0.62, 0.30, 0.95) base tint.)
  vec3 col = vec3(0.0);
  col += core * vec3(0.72, 0.36, 1.05);   // violet core
  col += edgeA * vec3(0.95, 0.22, 0.85);  // magenta fringe
  col += edgeB * vec3(0.52, 0.26, 1.10);  // blue-violet fringe

  // Soft tone-map so the hot core doesn't blow out to white. A slightly higher
  // shoulder keeps the violet saturated (more headroom before it desaturates).
  col = col / (col + vec3(1.05));

  // Sit on near-black (matches --bg ≈ #0b0c0e ≈ 0.043 linear-ish) so the
  // canvas blends with the page rather than reading as a black box.
  vec3 base = vec3(0.043, 0.046, 0.055);
  col += base;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function WebGLShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      // No WebGL context available (e.g. headless / blocked) — leave the
      // near-black background as the static fallback.
      return;
    }

    // Perf guard: cap pixel ratio so we never render at an uncapped retina
    // density (the original used raw devicePixelRatio).
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pixelRatio);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    camera.position.z = 1;

    const geometry = new THREE.BufferGeometry();
    // Full-screen triangle.
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 3.0, -1.0, 0.0, -1.0, 3.0, 0.0,
    ]);
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    const uniforms = {
      resolution: { value: new THREE.Vector2() },
      time: { value: 0.0 },
      xScale: { value: 1.0 },
      yScale: { value: 0.5 },
      distortion: { value: 0.05 },
    };

    const material = new THREE.RawShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      // resolution is in device pixels (matches gl_FragCoord).
      uniforms.resolution.value.set(w * pixelRatio, h * pixelRatio);
    }
    resize();

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0 as number;
    let running = false;
    const start = performance.now();

    function renderFrame(t: number) {
      uniforms.time.value = t;
      renderer.render(scene, camera);
    }

    function loop() {
      uniforms.time.value = (performance.now() - start) / 1000;
      renderer.render(scene, camera);
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
      // Perf guard: don't burn cycles while the tab is hidden.
      if (document.hidden) stopLoop();
      else startLoop();
    }

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduceMotion) {
      // Perf + a11y guard: render a SINGLE static frame, never start rAF.
      renderFrame(0);
    } else {
      startLoop();
    }

    return () => {
      stopLoop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
