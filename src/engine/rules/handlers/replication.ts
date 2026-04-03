// src/engine/rules/handlers/replication.ts

// ─────────────────────────────────────────────
//  Rule: REPLICATION (revised)
// ─────────────────────────────────────────────
//
//  NEW BEHAVIOR:
//    When two agents of opposite gender are within a small radius,
//    and both are aged between 18 and 60 (inclusive), and neither is
//    on cooldown, they produce one child. Child spawns near the pair,
//    inherits random gender and age 0.
//
//  Cooldown prevents rapid reproduction.
//
//  Energy cost: each parent loses 50 energy.
//    If either parent has less than 50 energy, reproduction fails.
//
//  params:
//    contactRadius  number  distance required for mating  (default: 25)
//    cooldown       number  ticks between reproductions   (default: 120)
// ─────────────────────────────────────────────

import type { RuleHandler } from '../RuleEngine';
import { Entity, vec2Dist } from '../../Entity';
import { WorldState } from '../../WorldState';

export const replicationHandler: RuleHandler = (entity, world, rule, _dt) => {
  // Only agents can reproduce
  if (entity.type !== 'agent') return;
  if (entity.isDead()) return;
  if (entity.hunger < 50) return;

  const contactRadius = (rule.params.contactRadius as number) ?? 25;
  const cooldown      = (rule.params.cooldown      as number) ?? 120;
  const mateSearchRadius = (rule.params.mateSearchRadius as number) ?? 250;
  const reproductionAgeCooldownYears = 2;

  // Cooldown check
  const lastReplicated = (entity.meta.lastReplicated as number) ?? -Infinity;
  if (world.tick - lastReplicated < cooldown) return;
  const lastReplicatedAgeYears = (entity.meta.lastReplicatedAgeYears as number) ?? -Infinity;
  if (entity.ageYears - lastReplicatedAgeYears < reproductionAgeCooldownYears) return;

  // Age check (18–60 years)
  if (entity.ageYears < 18 || entity.ageYears > 60) return;

  // Energy check (need at least 50)
  if (entity.energy < 50) return;

  const possibleMates = world
    .getNearby(entity.position.x, entity.position.y, mateSearchRadius, entity.id)
    .filter(e => e.type === 'agent' && !e.isDead() && e.gender !== entity.gender);
  if (possibleMates.length === 0) return;

  const readyMates = possibleMates.filter((mate) => {
    const mateLastReplicated = (mate.meta.lastReplicated as number) ?? -Infinity;
    if (world.tick - mateLastReplicated < cooldown) return false;
    const mateLastReplicatedAgeYears = (mate.meta.lastReplicatedAgeYears as number) ?? -Infinity;
    if (mate.ageYears - mateLastReplicatedAgeYears < reproductionAgeCooldownYears) return false;
    if (mate.ageYears < 18 || mate.ageYears > 60) return false;
    if (mate.energy < 50) return false;
    return true;
  });
  if (readyMates.length === 0) return;

  let mate = readyMates[0];
  let nearestDistance = vec2Dist(entity.position, mate.position);
  for (let i = 1; i < readyMates.length; i++) {
    const d = vec2Dist(entity.position, readyMates[i].position);
    if (d < nearestDistance) {
      mate = readyMates[i];
      nearestDistance = d;
    }
  }

  // Move toward a ready partner before contact, so only truly-ready pairs collide
  if (nearestDistance > contactRadius) {
    const dx = mate.position.x - entity.position.x;
    const dy = mate.position.y - entity.position.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const chaseForce = 220 * rule.strength;
      entity.applyForce({ x: (dx / len) * chaseForce, y: (dy / len) * chaseForce });
    }
    return;
  }

  // --- Reproduction successful ---

  // Subtract energy from both parents
  entity.energy -= 50;
  mate.energy -= 50;

  // Mark both parents with cooldown
  entity.meta.lastReplicated = world.tick;
  mate.meta.lastReplicated   = world.tick;
  entity.meta.lastReplicatedAgeYears = entity.ageYears;
  mate.meta.lastReplicatedAgeYears   = mate.ageYears;

  // Create child
  const survivalBaby = entity.meta.survival === true || mate.meta.survival === true;
  const child = new Entity({
    type:     'agent',
    position: {
      x: (entity.position.x + mate.position.x) / 2 + (Math.random() - 0.5) * 10,
      y: (entity.position.y + mate.position.y) / 2 + (Math.random() - 0.5) * 10,
    },
    velocity: {
      x: (entity.velocity.x + mate.velocity.x) / 2 + (Math.random() - 0.5) * 30,
      y: (entity.velocity.y + mate.velocity.y) / 2 + (Math.random() - 0.5) * 30,
    },
    energy:   50, // initial energy for newborn
    hunger:   100 + Math.random() * 100,
    health:   survivalBaby ? 100 : undefined,
    mass:     (entity.mass + mate.mass) / 2,
    maxSpeed: (entity.maxSpeed + mate.maxSpeed) / 2,
    gender:   Math.random() < 0.5 ? 'male' : 'female',
    ageYears: 0,
    frailty:  0.8 + Math.random() * 0.4,
    meta:     survivalBaby ? { survival: true } : undefined,
  });

  // Queue child spawn
  world.queueSpawn(child);

  // Nudge parents apart so they do not stay stacked; flocking then resumes normal spacing
  {
    let dx = entity.position.x - mate.position.x;
    let dy = entity.position.y - mate.position.y;
    let len = Math.sqrt(dx * dx + dy * dy);
    const nudge = 14;
    if (len < 0.01) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
      len = 1;
    }
    entity.position.x += (dx / len) * nudge;
    entity.position.y += (dy / len) * nudge;
    mate.position.x -= (dx / len) * nudge;
    mate.position.y -= (dy / len) * nudge;
  }

  // Emit event for visual effects
  world.events.emit('entity:replicate', { parentId: entity.id, childId: child.id }, world.tick);
};