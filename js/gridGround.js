// gridGround.js -----------------------------------------------------
import * as THREE from 'three';

/**
 * @param {THREE.Scene} scene
 * @param {object} opts
 * @returns {object} { mesh, floorFill, horizon, updateHue, update, uniforms }
 */
export function addGridGround(scene, opts = {}) {

  const {
    // GRID (lines)
    size         = 1000,
    spacing      = 1.0,
    lineWidth    = 0.01,
    fadeNear     = 5.5,
    fadeFar      = 30.0,   // lines fully gone here
    hueInit      = 0.66,   // default hue
    glowSize     = 12.0,   // line halo width (x uWidth)
    glowStrength = 0.6,
    coreBoost    = 1.0,

    // FLOOR FILL (radial ground tint to horizon)
    floorStart   = 0.0,   // start blending floor (radius from camera, in world units)
    floorEnd     = 10.0,  // full intensity at this radius
    floorAlpha   = 0.10,   // max opacity of the floor tint
    floorOuter   = 1500.0, // geometry outer radius (keep > far clip view)

    // HORIZON GLOW (over skybox)
    horizonRadius   = 120.0,
    horizonHeight   = 8.0,
    horizonAlpha    = 0.16,
    horizonSoftness = 1.35,
    horizonFalloff  = 0.75
  } = opts;

  /*============== GRID (lines + local halo) ==============*/
  const gridGeom = new THREE.PlaneGeometry(size * 2, size * 2, 1, 1);
  gridGeom.rotateX(-Math.PI / 2);

  const gridMat = new THREE.ShaderMaterial({
    uniforms: {
      uSpacing      : { value: spacing },
      uWidth        : { value: lineWidth },
      uFadeNear     : { value: fadeNear },
      uFadeFar      : { value: fadeFar },
      uColor        : { value: new THREE.Color().setHSL(hueInit, 1, 0.5) },
      uCamPos       : { value: new THREE.Vector3() },
      uGlowSize     : { value: glowSize },
      uGlowStrength : { value: glowStrength },
      uCoreBoost    : { value: coreBoost }
    },
    vertexShader: /* glsl */`
      varying vec3 vPos;
      void main(){
        vPos = (modelMatrix * vec4(position,1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.);
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;

      uniform vec3  uColor;
      uniform float uSpacing, uWidth, uFadeNear, uFadeFar;
      uniform vec3  uCamPos;
      uniform float uGlowSize, uGlowStrength, uCoreBoost;
      varying vec3  vPos;

      float distToLine(float c){
        float q = abs(fract(c / uSpacing) - 0.5) * uSpacing;
        return q;
      }

      float lineFade(vec3 cam, vec3 p){
        vec3  d = cam - p;
        float s = dot(d,d);
        float n2 = uFadeNear*uFadeNear;
        float f2 = uFadeFar *uFadeFar;
        return 1.0 - smoothstep(n2, f2, s); // near=1, far=0
      }

      void main(){
        float d = min(distToLine(vPos.x), distToLine(vPos.z));

        float core = 1.0 - smoothstep(0.0, uWidth, d);
        float halo = 1.0 - smoothstep(uWidth, uWidth*max(uGlowSize,1.001), d);

        float intensity = max(core*(1.0+uCoreBoost), halo*uGlowStrength);
        float alphaLines = intensity * lineFade(uCamPos, vPos);

        if(alphaLines < 0.01) discard;
        vec3 col = uColor * intensity;
        gl_FragColor = vec4(col, alphaLines);
      }`,
    transparent : true,
    depthWrite  : false,
    blending    : THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(gridGeom, gridMat);
  mesh.position.y = 0.01;
  mesh.renderOrder = 2; // draw after floor fill
  scene.add(mesh);

  /*============== FLOOR FILL (radial gradient on ground) ==============*/
  // Big ring that tints the *whole floor* from floorStart to floorEnd
  const ringGeom = new THREE.RingGeometry(0.0, floorOuter, 128, 1);
  ringGeom.rotateX(-Math.PI / 2);

  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor   : { value: new THREE.Color().setHSL(hueInit, 1, 0.5) },
      uCenter  : { value: new THREE.Vector2(0,0) }, // camera XZ
      uStart   : { value: floorStart },
      uEnd     : { value: floorEnd },
      uAlpha   : { value: floorAlpha }
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){
        vWorld = (modelMatrix * vec4(position,1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld,1.);
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3  uColor;
      uniform vec2  uCenter;
      uniform float uStart, uEnd, uAlpha;
      varying vec3  vWorld;

      void main(){
        float r = length(vWorld.xz - uCenter);
        // 0 inside start, 1 at/after end (radial ramp)
        float t = smoothstep(uStart, uEnd, r);
        float a = t * uAlpha;
        if(a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent       : true,
    depthWrite        : false,
    depthTest         : true,
    blending          : THREE.AdditiveBlending,
    polygonOffset     : true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits : -1
  });

  const floorFill = new THREE.Mesh(ringGeom, floorMat);
  floorFill.position.y = 0.009; // just under the grid plane
  floorFill.renderOrder = 1;
  scene.add(floorFill);

  /*============== HORIZON GLOW (cylinder that bleeds over skybox) ==============*/
  const cylGeom = new THREE.CylinderGeometry(
    horizonRadius, horizonRadius, horizonHeight, 96, 1, true
  );
  const horizonMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor  : { value: new THREE.Color().setHSL(hueInit, 1, 0.5) },
      uAlpha  : { value: horizonAlpha },
      uSoftV  : { value: horizonSoftness },
      uFall   : { value: horizonFalloff },
      uHeight : { value: horizonHeight }
    },
    vertexShader: /* glsl */`
      varying float vY;
      void main(){
        vY = position.y; // -H/2 .. +H/2
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.);
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3  uColor;
      uniform float uAlpha, uSoftV, uFall, uHeight;
      varying float vY;

      float verticalBand(){
        float halfH = 0.5 * uHeight;
        return 1.0 - smoothstep(0.0, uSoftV*halfH, abs(vY)); // peak near ground
      }

      void main(){
        float a = verticalBand() * (1.0 - uFall) * uAlpha;
        if(a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    side        : THREE.BackSide,
    transparent : true,
    depthWrite  : false,
    depthTest   : true,
    blending    : THREE.AdditiveBlending
  });

  const horizon = new THREE.Mesh(cylGeom, horizonMat);
  horizon.position.y = 0.5 * horizonHeight - 0.02;
  horizon.renderOrder = 3; // draw last
  scene.add(horizon);

  /*============== API / UPDATE ==============*/
  function update(cam){
    // keep grid centered and fade distances relative to camera
    mesh.position.x = Math.round(cam.position.x / spacing) * spacing;
    mesh.position.z = Math.round(cam.position.z / spacing) * spacing;
    gridMat.uniforms.uCamPos.value.copy(cam.position);

    // move the radial floor fill center with camera (XZ only)
    floorMat.uniforms.uCenter.value.set(cam.position.x, cam.position.z);

    // center the horizon cylinder around camera XZ
    horizon.position.x = cam.position.x;
    horizon.position.z = cam.position.z;
  }

  function updateHue(h){
    const c = new THREE.Color().setHSL(h, 1, 0.5);
    gridMat.uniforms.uColor.value.copy(c);
    floorMat.uniforms.uColor.value.copy(c);
    horizon.material.uniforms.uColor.value.copy(c);
  }

  return {
    mesh,
    floorFill,
    horizon,
    updateHue,
    update,
    uniforms: {
      grid: gridMat.uniforms,
      floor: floorMat.uniforms,
      horizon: horizon.material.uniforms
    }
  };
}
