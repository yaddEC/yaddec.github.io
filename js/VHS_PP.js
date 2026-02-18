// VHS_PP.js
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const VHSShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    distortion: { value: 0.6 },
    scanlineIntensity: { value: 0.25 },
    scanlineCount: { value: 40.0 },
    scanlineSpeed: { value: 3.2 },   // ← NEW: lines per second downward
    noiseIntensity: { value: 0.14 },
    glitchSpeed: { value: 2.5 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float distortion;
    uniform float scanlineIntensity;
    uniform float scanlineCount;
    uniform float scanlineSpeed;   // ← NEW
    uniform float noiseIntensity;
    uniform float glitchSpeed;
    varying vec2 vUv;

    float rand(vec2 co){
      return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;

      // Chromatic aberration
      float offset = sin(time * glitchSpeed + uv.y * 20.0) * 0.003 * distortion;
      vec4 col;
      col.r = texture2D(tDiffuse, uv + vec2(offset, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(offset, 0.0)).b;
      col.a = 1.0;

      // Scanlines (animated downward)
      float phase = uv.y * scanlineCount - time * scanlineSpeed;
      float scan = 0.5 + 0.5 * sin(phase);      // 0..1 stripe signal
      col.rgb *= 1.0 - scanlineIntensity * scan;

      // Noise
      float noise = rand(uv + time) * noiseIntensity;
      col.rgb += noise;

      gl_FragColor = col;
    }
  `
};

export function createVHSPass() {
  return new ShaderPass(VHSShader);
}
