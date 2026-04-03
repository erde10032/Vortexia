// src/engine/rules/handlers/attraction.ts

// ─────────────────────────────────────────────
//  Rule: ATTRACTION
// ─────────────────────────────────────────────
//
//  Entities pull toward nearby entities of a target type.
//  Force magnitude falls off linearly with distance.
//
//  params:
//    targetType  EntityType  which entity type to attract toward  (default: 'food')
//    radius      number      search radius in world-units          (default: 200)
// ─────────────────────────────────────────────


import { vec2Norm, vec2Sub, vec2Dist } from '../../Entity';
import type { RuleHandler } from '../RuleEngine';
import type { EntityType } from '../../types';

export const attractionHandler: RuleHandler = (entity, world, rule, _dt) => {
  const radius     = (rule.params.radius     as number)     ?? 200;
  const targetType = (rule.params.targetType as EntityType) ?? 'food';
  const strength   = rule.strength * 300;

  // Mark as free movement so energy is not consumed and movement allowed even if stalled
  entity.freeMovement = true;

  const nearby = world
    .getNearby(entity.position.x, entity.position.y, radius, entity.id)
    .filter(e => e.type === targetType);

  for (const target of nearby) {
    const dir     = vec2Norm(vec2Sub(target.position, entity.position));
    const dist    = vec2Dist(entity.position, target.position);
    const falloff = Math.max(0, 1 - dist / radius);
    entity.applyForce({
      x: dir.x * strength * falloff,
      y: dir.y * strength * falloff,
    });
  }
};