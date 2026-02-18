// neonMaterial.js
import * as THREE from 'three';

/* ---------- Shaders ---------- */
const VERT = /* glsl */`
  varying vec3  vN;        // normal en vue
  varying vec3  vV;        // view-dir normalisée (pour le rim)
  varying float vDist;     // distance caméra -> fragment (pour le fade)

  void main(){
    vec4 wPos = modelMatrix * vec4(position, 1.0);

    // normal vue + direction vers la caméra
    vN = normalize(normalMatrix * normal);
    vec3 viewVec = cameraPosition - wPos.xyz;
    vV    = normalize(viewVec);
    vDist = length(viewVec);

    gl_Position = projectionMatrix * viewMatrix * wPos;
  }
`;

// HSL -> RGB compact (L=0.5 pour un néon propre)
const FRAG = /* glsl */`
  precision mediump float;
  varying vec3  vN;
  varying vec3  vV;
  varying float vDist;

  uniform float uHue;         // 0..1
  uniform float uSat;         // 0..2
  uniform float uIntensity;   // 0..∞
  uniform float uRimStrength; // 0..4
  uniform float uRimPower;    // 0.5..6
  uniform float uAlpha;       // opacité de base 0..1
  uniform float uTime;

  // distance fade (optionnel)
  uniform float uUseDistFade; // 0.0 OFF / 1.0 ON
  uniform float uFadeNear;    // distance pleine opacité
  uniform float uFadeFar;     // distance opacité minimale
  uniform float uMinAlpha;    // plancher d'alpha (ex: 0 pour disparaître)

  vec3 hsl2rgb(float h, float s){
    float r = abs(h*6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h*6.0 - 2.0);
    float b = 2.0 - abs(h*6.0 - 4.0);
    vec3 rgb = clamp(vec3(r,g,b), 0.0, 1.0);
    return mix(vec3(0.5), rgb, clamp(s, 0.0, 2.0));
  }

  void main(){
    vec3 base = hsl2rgb(uHue, uSat);

    // Rim / Fresnel
    float ndotv = max(dot(normalize(vN), normalize(vV)), 0.0);
    float rim = pow(1.0 - ndotv, uRimPower) * uRimStrength;

    float pulse = 0.95 + 0.05 * sin(uTime * 2.0);
    vec3 col = base * (1.0 + rim) * uIntensity * pulse;

    // ---- Opacité finale ----
    float alpha = uAlpha;

    // fondu par distance (optionnel)
    if (uUseDistFade > 0.5) {
      // facteur 1 à near -> 0 à far (lissé)
      float f = smoothstep(uFadeFar, uFadeNear, vDist);
      // applique et garde un plancher
      alpha = max(alpha * f, uMinAlpha);
    }

    gl_FragColor = vec4(col, alpha);
  }
`;

/* ---------- API ---------- */
export function createNeonMaterial({
  hue = 0.66,
  saturation = 1.0,
  intensity = 1.2,
  rimStrength = 1.0,
  rimPower = 2.0,
  alpha = 1.0,
  // distance fade options
  distanceFade = {
    enabled: false,
    near: 20,   // distance où l'objet est pleinement opaque
    far:  80,   // distance où il atteint minAlpha
    minAlpha: 0 // plancher d’opacité (ex: 0.15 pour rester visible au loin)
  }
} = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uHue:         { value: hue },
      uSat:         { value: saturation },
      uIntensity:   { value: intensity },
      uRimStrength: { value: rimStrength },
      uRimPower:    { value: rimPower },
      uAlpha:       { value: alpha },
      uTime:        { value: 0 },

      uUseDistFade: { value: distanceFade?.enabled ? 1.0 : 0.0 },
      uFadeNear:    { value: distanceFade?.near ?? 20 },
      uFadeFar:     { value: distanceFade?.far ?? 80 },
      uMinAlpha:    { value: distanceFade?.minAlpha ?? 0.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    // transparent true => permet les alphas animés + distance fade propres
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false // évite les artefacts d’alpha (utile pour fades)
  });
  mat.toneMapped = false;
  return mat;
}

/** À appeler chaque frame pour hue/time global */
export function syncNeon(materials, hue, time){
  for (const m of materials){
    if (!m || !m.uniforms) continue;
    if (hue  !== undefined) m.uniforms.uHue.value  = hue;
    if (time !== undefined) m.uniforms.uTime.value = time;
  }
}

/* ===== Helpers pratiques pour piloter l’opacité ===== */

/** Active/désactive le fondu par distance sur un material */
export function setDistanceFadeEnabled(mat, enabled){
  if (!mat?.uniforms) return;
  mat.uniforms.uUseDistFade.value = enabled ? 1.0 : 0.0;
}

/** Met à jour les paramètres du fondu par distance */
export function setDistanceFade(mat, { near, far, minAlpha } = {}){
  if (!mat?.uniforms) return;
  if (near     !== undefined) mat.uniforms.uFadeNear.value  = near;
  if (far      !== undefined) mat.uniforms.uFadeFar.value   = far;
  if (minAlpha !== undefined) mat.uniforms.uMinAlpha.value  = minAlpha;
}

/** Change l’opacité immédiatement (0..1) */
export function setOpacity(mat, alpha){
  if (!mat?.uniforms) return;
  mat.uniforms.uAlpha.value = Math.max(0, Math.min(1, alpha));
}

/**
 * Tween linéaire de l’opacité (ex: pour despawn en douceur).
 * Retourne une fonction "cancel" si tu veux interrompre le tween.
 */
export function fadeOpacity(mat, toAlpha, seconds = 0.6, onDone){
  if (!mat?.uniforms) return () => {};
  const from = mat.uniforms.uAlpha.value;
  const dur  = Math.max(0.0001, seconds);
  const t0   = performance.now();

  let stopped = false;
  function step(){
    if (stopped) return;
    const t = (performance.now() - t0) / (dur * 1000);
    const k = t >= 1 ? 1 : t;
    mat.uniforms.uAlpha.value = from + (toAlpha - from) * k;
    if (k < 1) {
      requestAnimationFrame(step);
    } else if (onDone) {
      onDone();
    }
  }
  requestAnimationFrame(step);
  return () => { stopped = true; };
}
