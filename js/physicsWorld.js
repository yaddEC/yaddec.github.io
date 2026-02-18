// physicsWorld.js
import * as CANNON from 'cannon-es';

export class PhysicsWorld {
  constructor ({ gravity = new CANNON.Vec3(0, -9.82, 0) } = {}) {
    this.world = new CANNON.World({ gravity });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world); // rapide sur scènes statiques
    this.world.allowSleep = true;
    this.pairs = new Map();      // association mesh ↔ body
  }

  add(mesh, shape, { mass = 1, ...opt } = {}) {
    const body = new CANNON.Body({ mass, shape, ...opt });
    body.position.copy(mesh.position);
    body.quaternion.copy(mesh.quaternion);
    this.world.addBody(body);
    this.pairs.set(mesh, body);
    return body;
  }

  step(dt) {
    const fixed = 1 / 60;              // 60 Hz recommandé
    this.world.step(fixed, dt, 3);     // max 3 sous-pas
    for (const [mesh, body] of this.pairs)
      mesh.position.copy(body.position),
      mesh.quaternion.copy(body.quaternion);
  }
}
