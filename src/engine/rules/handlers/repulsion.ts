// ─────────────────────────────────────────────
//  Rule: REPULSION
// ─────────────────────────────────────────────
//
//  Entities push away from nearby entities of a target type.
//  Force is strongest at close range (inverse falloff).
//
//  params:
//    targetType  EntityType  which entity type to repel from  (default: 'obstacle')
//    radius      number      influence radius in world-units   (default: 80)
// ─────────────────────────────────────────────

import { vec2Sub, vec2Len } from '../../Entity';
import type { RuleHandler } from '../RuleEngine';
import type { EntityType } from '../../types';

export const repulsionHandler: RuleHandler = (entity, world, rule, _dt) => {
  const radius     = (rule.params.radius     as number)     ?? 80;
  const targetType = (rule.params.targetType as EntityType) ?? 'obstacle';
  const strength   = rule.strength * 400;

  const nearby = world
    .getNearby(entity.position.x, entity.position.y, radius, entity.id)
    .filter(e => e.type === targetType);

  for (const other of nearby) {
    const diff = vec2Sub(entity.position, other.position);
    const dist = vec2Len(diff);
    if (dist < 0.001) continue; // avoid division by zero / NaN

    const dir     = { x: diff.x / dist, y: diff.y / dist };
    // Stronger push the closer they are
    const falloff = Math.max(0, 1 - dist / radius);
    entity.applyForce({
      x: dir.x * strength * falloff,
      y: dir.y * strength * falloff,
    });
  }
};
