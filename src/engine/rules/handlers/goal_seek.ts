// ─────────────────────────────────────────────
//  Rule: GOAL_SEEK
// ─────────────────────────────────────────────
//
//  Entity steers toward the single nearest target of a given type.
//  Unlike attraction (which pulls toward ALL nearby), goal_seek
//  picks ONE target and applies full steering force toward it.
//  This produces purposeful, directed movement.
//
//  params:
//    targetType  EntityType  entity type to seek          (default: 'food')
//    radius      number      max search radius             (default: 300)
//    arriveRadius number     slow-down zone near target    (default: 40)
// ─────────────────────────────────────────────

import { vec2Norm, vec2Sub, vec2Dist, vec2DistWrapped, vec2WrappedDelta } from '../../Entity';
import type { RuleHandler } from '../RuleEngine';
import type { EntityType } from '../../types';

export const goalSeekHandler: RuleHandler = (entity, world, rule, _dt) => {
  const radius       = (rule.params.radius       as number)     ?? 300;
  const arriveRadius = (rule.params.arriveRadius as number)     ?? 40;
  const targetType   = (rule.params.targetType   as EntityType) ?? 'food';
  const strength     = rule.strength * 250;

  // While hungry, agents should not steer toward non-food goals — unless stalled (resting) near an attractor
  if (entity.type === 'agent') {
    const foodPriorityTh = (rule.params.foodPriorityThreshold as number) ?? 50;
    if (targetType !== 'food' && entity.hunger <= foodPriorityTh && !entity.stalled) return;
  }

  const W = world.config.width;
  const H = world.config.height;
  const wrap = world.config.boundary === 'wrap';

  // With wrap, attractors on an edge must pull across the seam — plain Euclidean misses distant agents.
  let candidates: Entity[];
  if (wrap && targetType === 'attractor') {
    candidates = world
      .getByType('attractor')
      .filter(e => e.id !== entity.id && vec2DistWrapped(entity.position, e.position, W, H) <= radius);
  } else {
    candidates = world
      .getNearby(entity.position.x, entity.position.y, radius, entity.id)
      .filter(e => e.type === targetType);
  }

  if (candidates.length === 0) return;

  const distTo = (other: Entity): number =>
    wrap && targetType === 'attractor'
      ? vec2DistWrapped(entity.position, other.position, W, H)
      : vec2Dist(entity.position, other.position);

  // ── Find nearest ──
  let nearest = candidates[0];
  let minDist = distTo(nearest);
  for (let i = 1; i < candidates.length; i++) {
    const d = distTo(candidates[i]);
    if (d < minDist) {
      minDist = d;
      nearest = candidates[i];
    }
  }

  const dir = vec2Norm(
    wrap && targetType === 'attractor'
      ? vec2WrappedDelta(entity.position, nearest.position, W, H)
      : vec2Sub(nearest.position, entity.position),
  );

  // ── Arrive behaviour: scale down force inside arriveRadius ──
  const arrive = minDist < arriveRadius
    ? minDist / arriveRadius   // 0→1 as we approach
    : 1;

  // Stalled agents sliding toward attractor: no movement energy cost (see Entity.consumeMovementEnergy)
  if (entity.stalled && entity.type === 'agent' && targetType === 'attractor') {
    entity.freeMovement = true;
  }

  entity.applyForce({
    x: dir.x * strength * arrive,
    y: dir.y * strength * arrive,
  });
};
