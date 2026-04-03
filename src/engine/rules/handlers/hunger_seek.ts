// src/engine/rules/handlers/hunger_seek.ts

// ─────────────────────────────────────────────
//  Rule: HUNGER_SEEK
// ─────────────────────────────────────────────
//
//  When an agent's hunger falls below a threshold (default 50),
//  it seeks the nearest food source. Otherwise, no force is applied.
//  This allows agents to conserve energy when not hungry.
//
//  params:
//    hungerThreshold  number  hunger below which to seek (default: 50)
//    radius           number  search radius for food (default: 200)
//    strength         number  force multiplier (default: 250)
// ─────────────────────────────────────────────

import { vec2Norm, vec2Sub, vec2Dist } from '../../Entity';
import type { RuleHandler } from '../RuleEngine';

export const hungerSeekHandler: RuleHandler = (entity, world, rule, _dt) => {
  // Only agents
  if (entity.type !== 'agent') return;

  const threshold = (rule.params.hungerThreshold as number) ?? 50;
  const radius    = (rule.params.radius as number) ?? 200;
  const strength  = rule.strength * 250;

  // If hunger above threshold, do nothing
  if (entity.hunger > threshold) return;

  // Stronger pull when closer to starvation
  const urgency = 1 + Math.max(0, (threshold - entity.hunger) / Math.max(1, threshold)) * 2.2;

  // Find nearest food
  let candidates = world
    .getNearby(entity.position.x, entity.position.y, radius, entity.id)
    .filter(e => e.type === 'food' && !e.isDead());

  // No food nearby: chase nearest food anywhere so agents do not drift with other rules
  if (candidates.length === 0) {
    const allFood = world.getByType('food').filter(e => !e.isDead());
    if (allFood.length === 0) return;
    let nearest = allFood[0];
    let minDist = vec2Dist(entity.position, nearest.position);
    for (let i = 1; i < allFood.length; i++) {
      const d = vec2Dist(entity.position, allFood[i].position);
      if (d < minDist) {
        minDist = d;
        nearest = allFood[i];
      }
    }
    candidates = [nearest];
  }

  let nearest = candidates[0];
  let minDist = vec2Dist(entity.position, nearest.position);
  for (let i = 1; i < candidates.length; i++) {
    const d = vec2Dist(entity.position, candidates[i].position);
    if (d < minDist) { minDist = d; nearest = candidates[i]; }
  }

  const dir = vec2Norm(vec2Sub(nearest.position, entity.position));
  const searchSpan = candidates.length > 1 || minDist <= radius ? radius : Math.max(radius, minDist);
  const falloff = Math.max(0.35, 1 - minDist / Math.max(searchSpan, 1));
  entity.applyForce({
    x: dir.x * strength * falloff * urgency,
    y: dir.y * strength * falloff * urgency,
  });
};