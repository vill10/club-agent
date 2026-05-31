"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

export function WebGLShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene | null
    camera: THREE.OrthographicCamera | null
    renderer: THREE.WebGLRenderer | null
    mesh: THREE.Mesh | null
    uniforms: any
    animationId: number | null
  }>({
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    uniforms: null,
    animationId: null,
  })

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const { current: refs } = sceneRef

    const prefersReducedMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const vertexShader = `
      attribute vec3 position;
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `

    const fragmentShader = `
      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform float xScale;
      uniform float yScale;
      uniform float distortion;

      // Vertical offset raising the beam UP so it sits behind the headline
      // area rather than mid-screen. p.y is +up; subtracting BEAM_Y shifts the
      // beam's center (where the line resolves) upward by BEAM_Y.
      #define BEAM_Y 0.4

      void main() {
        vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);

        float d = length(p) * distortion;

        float rx = p.x * (1.0 + d);
        float gx = p.x;
        float bx = p.x * (1.0 - d);

        float r = 0.05 / abs((p.y - BEAM_Y) + sin((rx + time) * xScale) * yScale);
        float g = 0.05 / abs((p.y - BEAM_Y) + sin((gx + time) * xScale) * yScale);
        float b = 0.05 / abs((p.y - BEAM_Y) + sin((bx + time) * xScale) * yScale);

        // Recolor the animated chromatic beams to violet/magenta (accent ~ #9d5bf4):
        // suppress green so the moving beams read purple instead of white/rainbow.
        vec3 col = vec3(
          r * 0.75 + b * 0.30,
          g * 0.28,
          b * 0.90 + r * 0.25
        );

        gl_FragColor = vec4(col, 1.0);
      }
    `

    const initScene = () => {
      refs.scene = new THREE.Scene()
      refs.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      refs.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
      refs.renderer.setClearColor(new THREE.Color(0x0b0c0e))

      refs.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, -1)

      refs.uniforms = {
        resolution: { value: [window.innerWidth, window.innerHeight] },
        time: { value: 0.0 },
        xScale: { value: 1.0 },
        yScale: { value: 0.5 },
        distortion: { value: 0.05 },
      }

      const position = [
        -1.0, -1.0, 0.0,
         1.0, -1.0, 0.0,
        -1.0,  1.0, 0.0,
         1.0, -1.0, 0.0,
        -1.0,  1.0, 0.0,
         1.0,  1.0, 0.0,
      ]

      const positions = new THREE.BufferAttribute(new Float32Array(position), 3)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", positions)

      const material = new THREE.RawShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: refs.uniforms,
        side: THREE.DoubleSide,
      })

      refs.mesh = new THREE.Mesh(geometry, material)
      refs.scene.add(refs.mesh)

      handleResize()
    }

    const renderFrame = () => {
      if (refs.renderer && refs.scene && refs.camera) {
        refs.renderer.render(refs.scene, refs.camera)
      }
    }

    const animate = () => {
      if (refs.uniforms) refs.uniforms.time.value += 0.01
      renderFrame()
      refs.animationId = requestAnimationFrame(animate)
    }

    const handleResize = () => {
      if (!refs.renderer || !refs.uniforms) return
      const width = window.innerWidth
      const height = window.innerHeight
      refs.renderer.setSize(width, height, false)
      refs.uniforms.resolution.value = [width, height]
    }

    const handleVisibility = () => {
      if (document.hidden) {
        if (refs.animationId) {
          cancelAnimationFrame(refs.animationId)
          refs.animationId = null
        }
      } else if (!refs.animationId && !prefersReducedMotion) {
        animate()
      }
    }

    initScene()
    if (prefersReducedMotion) {
      renderFrame()
    } else {
      animate()
    }
    window.addEventListener("resize", handleResize)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      if (refs.animationId) cancelAnimationFrame(refs.animationId)
      window.removeEventListener("resize", handleResize)
      document.removeEventListener("visibilitychange", handleVisibility)
      if (refs.mesh) {
        refs.scene?.remove(refs.mesh)
        refs.mesh.geometry.dispose()
        if (refs.mesh.material instanceof THREE.Material) {
          refs.mesh.material.dispose()
        }
      }
      refs.renderer?.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed top-0 left-0 w-full h-full block -z-10 pointer-events-none"
    />
  )
}
