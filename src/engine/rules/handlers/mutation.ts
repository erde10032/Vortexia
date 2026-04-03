// ─────────────────────────────────────────────
//  Rule: MUTATION
// ─────────────────────────────────────────────
//
//  Each tick, randomly perturbs entity properties within bounds.
//  Simulates genetic drift, environmental noise, or chaos.
//
//  What can mutate (controlled by params flags):
//    velocity   — random impulse added to current velocity
//    maxSpeed   — small random walk on maxSpeed
//    energy     — small random energy gain/loss
//    mass       — small random walk on mass
//
//  params:
//    velocityNoise  number   max random velocity impulse per tick  (default: 20)
//    speedNoise     number   max random maxSpeed delta per tick     (default: 5)
//    energyNoise    number   max random energy delta per tick       (default: 2)
//    massNoise      number   max random mass delta per tick         (default: 0)
//    mutateVelocity boolean  enable velocity mutation               (default: true)
//    mutateSpeed    boolean  enable maxSpeed mutation               (default: false)
//    mutateEnergy   boolean  enable energy mutation                 (default: false)
//    mutateMass     boolean  enable mass mutation                   (default: false)
//
//  rule.strength acts as a global scale on ALL noise values.
//
//  How it integrates with the update cycle:
//    Mutation runs in the rule-application phase (before integrate).
//    Velocity noise is added directly to entity.velocity — it bypasses
//    the force accumulator so it's always applied regardless of mass.
//    maxSpeed/mass changes persist until overwritten by another rule
//    or a reset.
// ─────────────────────────────────────────────

import type { RuleHandler } from '../RuleEngine';

/** Returns a random float in [-1, 1] */
const rand = () => Math.random() * 2 - 1;

export const mutationHandler: RuleHandler = (entity, _world, rule, _dt) => {
  const s = rule.strength; // global scale

  // ── Velocity noise ──
  const mutateVelocity = (rule.params.mutateVelocity as boolean) ?? true;
  if (mutateVelocity) {
    const vNoise = (rule.params.velocityNoise as number) ?? 20;
    entity.velocity.x += rand() * vNoise * s;
    entity.velocity.y += rand() * vNoise * s;
    // Note: velocity is clamped to maxSpeed in Entity.integrate()
  }

  // ── maxSpeed noise ──
  const mutateSpeed = (rule.params.mutateSpeed as boolean) ?? false;
  if (mutateSpeed) {
    const sNoise = (rule.params.speedNoise as number) ?? 5;
    entity.maxSpeed = Math.max(10, entity.maxSpeed + rand() * sNoise * s);
  }

  // ── Energy noise ──
  const mutateEnergy = (rule.params.mutateEnergy as boolean) ?? false;
  if (mutateEnergy) {
    const eNoise = (rule.params.energyNoise as number) ?? 2;
    entity.energy = Math.max(0, entity.energy + rand() * eNoise * s);
  }

  // ── Mass noise ──
  const mutateMass = (rule.params.mutateMass as boolean) ?? false;
  if (mutateMass) {
    const mNoise = (rule.params.massNoise as number) ?? 0;
    if (mNoise > 0) {
      entity.mass = Math.max(0.1, entity.mass + rand() * mNoise * s);
    }
  }
};
