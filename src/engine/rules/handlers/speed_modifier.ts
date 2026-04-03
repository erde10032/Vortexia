// ─────────────────────────────────────────────
//  Rule: SPEED_MODIFIER
// ─────────────────────────────────────────────
//
//  Scales an entity's maxSpeed at runtime.
//  Does NOT apply a force — directly mutates entity.maxSpeed
//  each tick so it stays in sync with rule.strength changes.
//
//  Two modes controlled by params.mode:
//    'scale'   — multiply base speed by a factor  (default)
//    'set'     — override maxSpeed to a fixed value
//
//  params:
//    mode       'scale' | 'set'   how to apply the modifier  (default: 'scale')
//    baseSpeed  number            reference speed for 'scale' mode  (default: 200)
//    fixedSpeed number            target speed for 'set' mode       (default: 100)
//
//  How it integrates with the update cycle:
//    maxSpeed is read by Entity.integrate() when clamping velocity.
//    By mutating maxSpeed here (before integrate runs), the clamp
//    automatically enforces the new limit that same tick.
//    On rule disable the entity keeps its last maxSpeed — callers
//    should reset via entity.maxSpeed = originalSpeed if needed.
// ─────────────────────────────────────────────

import type { RuleHandler } from '../RuleEngine';

export const speedModifierHandler: RuleHandler = (entity, _world, rule, _dt) => {
  const mode = (rule.params.mode as string) ?? 'scale';

  if (mode === 'set') {
    // Hard override: set maxSpeed to a fixed value scaled by strength
    const fixedSpeed = (rule.params.fixedSpeed as number) ?? 100;
    entity.maxSpeed  = fixedSpeed * rule.strength;

  } else {
    // Scale mode: multiply the base speed by strength
    // strength=1.0 → normal, strength=2.0 → double, strength=0.5 → half
    const baseSpeed  = (rule.params.baseSpeed as number) ?? 200;
    entity.maxSpeed  = baseSpeed * rule.strength;
  }
};
