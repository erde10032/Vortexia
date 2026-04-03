// src/engine/rules/handlers/flocking.ts

// ─────────────────────────────────────────────
//  Rule: FLOCKING
// ─────────────────────────────────────────────
//
//  Classic boids behaviour: separation, alignment, cohesion.
//  Only active for agents with hunger >= 50 and not stalled.
//  Also excludes hungry/stalled agents from being considered as neighbors.
//
//  params:
//    radius            number  interaction radius (default: 100)
//    separationWeight  number  weight for separation (default: 1.5)
//    alignmentWeight   number  weight for alignment (default: 1.0)
//    cohesionWeight    number  weight for cohesion (default: 1.0)
// ─────────────────────────────────────────────

import { vec2Norm, vec2Sub, vec2Len } from '../../Entity';
import type { RuleHandler } from '../RuleEngine';

export const flockingHandler: RuleHandler = (entity, world, rule, _dt) => {
  // Only agents
  if (entity.type !== 'agent') return;
  // Skip if hungry (hunger < 50) or stalled
  if (entity.hunger < 50) return;
  if (entity.stalled) return;

  const radius   = (rule.params.radius            as number) ?? 100;
  const sepW     = (rule.params.separationWeight  as number) ?? 1.5;
  const alignW   = (rule.params.alignmentWeight   as number) ?? 1.0;
  const cohW     = (rule.params.cohesionWeight    as number) ?? 1.0;
  const strength = rule.strength * 150;

  // Get all agents within radius, but exclude those that are hungry (hunger < 50) or stalled
  const neighbors = world
    .getNearby(entity.position.x, entity.position.y, radius, entity.id)
    .filter(e => e.type === 'agent' && !e.isDead() && e.hunger >= 50 && !e.stalled);

  // Solo cruise: no flockmates nearby — keep moving with smooth wander + speed floor (same force scale as flock)
  if (neighbors.length === 0) {
    const spd = vec2Len(entity.velocity);
    const minCruise = 52;
    let dirX = 0;
    let dirY = 0;
    if (spd > 10) {
      const n = vec2Norm(entity.velocity);
      const jitter = (Math.random() - 0.5) * 1.5;
      dirX = n.x - n.y * jitter;
      dirY = n.y + n.x * jitter;
      const len = vec2Len({ x: dirX, y: dirY }) || 1;
      dirX /= len;
      dirY /= len;
    } else {
      const a = Math.random() * Math.PI * 2;
      dirX = Math.cos(a);
      dirY = Math.sin(a);
    }
    let mag = strength * 0.48;
    if (spd < minCruise) {
      mag += strength * 0.58 * (1 - spd / minCruise);
    }
    entity.applyForce({ x: dirX * mag, y: dirY * mag });
    return;
  }

  let sepX = 0, sepY = 0, avgVx = 0, avgVy = 0, cx = 0, cy = 0;
  for (const n of neighbors) {
    const diff = vec2Sub(entity.position, n.position);
    const dist = vec2Len(diff);
    // Separation across full perception radius (stronger when closer) — avoids tight stacking unrelated to mating
    if (dist > 0 && dist < radius) {
      const near = 1 - dist / radius;
      sepX += (diff.x / dist) * near;
      sepY += (diff.y / dist) * near;
    }
    avgVx += n.velocity.x;
    avgVy += n.velocity.y;
    cx += n.position.x;
    cy += n.position.y;
  }
  const c = neighbors.length;
  avgVx /= c;
  avgVy /= c;
  cx /= c;
  cy /= c;

  const cohDir   = vec2Norm({ x: cx - entity.position.x, y: cy - entity.position.y });
  const alignDir = vec2Norm({ x: avgVx, y: avgVy });

  entity.applyForce({
    x: (sepX * sepW + alignDir.x * alignW + cohDir.x * cohW) * strength,
    y: (sepY * sepW + alignDir.y * alignW + cohDir.y * cohW) * strength,
  });
};