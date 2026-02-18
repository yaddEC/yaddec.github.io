// starfield.js ------------------------------------------------------
import * as THREE from 'three';
export let hue = 0;   

export function addStarfield(scene) {

    const STAR_COUNT   = 15000;
    const R            = 600;          // demi‑côté du cube où on disperse X/Y
    const MIN_CAM_DIST = 300;           // rayon “interdit” autour de la caméra

    const FAR_Z        = 2000;          // *** distance max avant recyclage ***
                                        //  ➜ recycle quand z < –FAR_Z

    const SPEED_MIN    = 35;
    const SPEED_MAX    = 60;

    /*------------- géométrie -----------------*/
    const positions  = new Float32Array(STAR_COUNT * 3);
    const velocities = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {

        // positions XY aléatoires dans un carré 2R×2R,
        // Z aléatoire dans le volume visible
        let x, y, z, d;
        do {
            x = THREE.MathUtils.randFloatSpread(2 * R);
            y = THREE.MathUtils.randFloatSpread(2 * R);
            z = THREE.MathUtils.randFloatSpread(2 * FAR_Z);
            d = Math.sqrt(x * x + y * y + z * z);
        } while (d < MIN_CAM_DIST);

        const i3 = i * 3;
        positions[i3]     = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;
        velocities[i]     = THREE.MathUtils.randFloat(SPEED_MIN, SPEED_MAX);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity',  new THREE.BufferAttribute(velocities, 1));

    /*------------- sprite cercle -------------*/
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
    const circleTex = new THREE.CanvasTexture(canvas);

    /*------------- matière -------------------*/
    const material = new THREE.PointsMaterial({
        map:             circleTex,
        transparent:     true,
        alphaTest:       0.5,
        size:            0.5,
        sizeAttenuation: true,
        depthWrite:      false,
        color:           0xffffff
    });

    const HUE_PERIOD = 20;              // secondes pour un tour complet
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);

    /*------------- mise à jour ---------------*/
    const pos = geometry.attributes.position;
    const vel = geometry.attributes.velocity;

    function update(dt) {
        for (let i = 0; i < STAR_COUNT; i++) {

            const i3 = i * 3;
            pos.array[i3 + 2] -= vel.array[i] * dt;        // avance

            if (pos.array[i3 + 2] < -FAR_Z) {              // recycle hors champ
                // replace uniquement sur l’axe Z pour éviter un flash
                pos.array[i3 + 2] += 2 * FAR_Z;

                // nouvelle vitesse aléatoire
                vel.array[i] = THREE.MathUtils.randFloat(SPEED_MIN, SPEED_MAX);
            }
        }
        pos.needsUpdate = true;
        hue = (hue + dt / HUE_PERIOD) % 1;           // avance la teinte
        //material.color.setHSL(hue, 1, 0.5);          // S=100 %, L≈50 %
    }

    return update;          // à appeler dans ta boucle principale
}
