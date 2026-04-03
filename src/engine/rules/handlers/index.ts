// ─────────────────────────────────────────────
//  Rule Handler Registry
// ─────────────────────────────────────────────
//
//  Maps RuleType → handler function.
//  Import this in RuleEngine — nowhere else needs to know about
//  individual handler files.
//
//  To add a new rule:
//    1. Create handlers/my_rule.ts  (export const myRuleHandler: RuleHandler)
//    2. Add one line here:          my_rule: myRuleHandler
//    Done. Zero other changes needed.
// ─────────────────────────────────────────────

import type { RuleType } from '../../types';
import type { RuleHandler } from '../RuleEngine';

import { attractionHandler }     from './attraction';
import { repulsionHandler }      from './repulsion';
import { goalSeekHandler }       from './goal_seek';
import { replicationHandler }    from './replication';
import { speedModifierHandler }  from './speed_modifier';
import { mutationHandler }       from './mutation';
import { hungerSeekHandler }     from './hunger_seek';
import { flockingHandler }       from './flocking';

// ── Handlers that were already in the monolithic RuleEngine ──
// (kept inline here to avoid extra files for simple rules)

import type { EntityType } from '../../types';

const gravityHandler: RuleHandler = (entity, _world, rule, _dt) => {
  entity.freeMovement = true;
  const angle    = ((rule.params.angle as number) ?? 90) * (Math.PI / 180);
  const strength = rule.strength * 200;
  entity.applyForce({ x: Math.cos(angle) * strength, y: Math.sin(angle) * strength });
};

function survivalHealOnEat(diff: 'easy' | 'medium' | 'hard' | undefined): number {
  if (!diff) return 0;
  if (diff === 'easy') return 14;
  if (diff === 'medium') return 10;
  return 6;
}

const predationHandler: RuleHandler = (entity, world, rule, _dt) => {
  const predatorType   = (rule.params.predatorType   as EntityType) ?? 'agent';
  const preyType       = (rule.params.preyType       as EntityType) ?? 'food';
  const contactRadius  = (rule.params.contactRadius  as number)     ?? 15;
  const energyTransfer = (rule.params.energyTransfer as number)     ?? 30;
  if (entity.type !== predatorType) return;
  const survivalAgent = entity.type === 'agent' && entity.meta.survival === true;
  const playerSkipHungerCap = survivalAgent && entity.meta.playerControlled === true;
  if (entity.type === 'agent' && entity.hunger > 100 && !playerSkipHungerCap) return;

  // Optional eating cooldown (primarily for survival player so food isn't vacuumed instantly).
  const eatCooldownMs = (rule.params.eatCooldownMs as number) ?? 0;
  const playerOnlyCooldown = (rule.params.playerOnlyCooldown as boolean) ?? false;
  if (eatCooldownMs > 0 && entity.type === 'agent') {
    if (!playerOnlyCooldown || entity.meta.playerControlled === true) {
      const until = (entity.meta.survivalEatCooldownUntilReal as number) ?? 0;
      if (performance.now() < until) return;
    }
  }

  const prey = world
    .getNearby(entity.position.x, entity.position.y, contactRadius, entity.id)
    .filter(e => e.type === preyType && !e.isDead());
  for (const p of prey) {
    const transfer = Math.min(energyTransfer * rule.strength, p.energy);
    p.energy -= transfer;
    entity.energy += transfer;
    if (entity.type === 'agent') {
      entity.hunger = Math.min(200, entity.hunger + 100);
      if (survivalAgent && world.config.survivalDifficulty) {
        const h = survivalHealOnEat(world.config.survivalDifficulty);
        if (h > 0) {
          entity.health = Math.min(100, entity.health + h);
        }
      }
    }
    if (p.type !== 'agent' && p.energy <= 0) {
      p.kill();
      world.events.emit('entity:death', { entityId: p.id, cause: 'predation' }, world.tick);
    }
    if (eatCooldownMs > 0 && entity.type === 'agent') {
      if (!playerOnlyCooldown || entity.meta.playerControlled === true) {
        entity.meta.survivalEatCooldownUntilReal = performance.now() + eatCooldownMs;
      }
    }
    break;
  }
};

const decayHandler: RuleHandler = (entity, _world, rule, dt) => {
  entity.energy -= ((rule.params.rate as number) ?? 5) * rule.strength * dt;
  if (entity.type !== 'agent' && entity.energy <= 0) {
    entity.kill();
  }
};

// ─── Registry ─────────────────────────────────

export const DEFAULT_HANDLERS: Partial<Record<RuleType, RuleHandler>> = {
  attraction:     attractionHandler,
  repulsion:      repulsionHandler,
  goal_seek:      goalSeekHandler,
  replication:    replicationHandler,
  speed_modifier: speedModifierHandler,
  mutation:       mutationHandler,
  gravity:        gravityHandler,
  flocking:       flockingHandler,
  predation:      predationHandler,
  decay:          decayHandler,
  hunger_seek:    hungerSeekHandler,
};