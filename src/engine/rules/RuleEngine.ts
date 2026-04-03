// src/engine/rules/RuleEngine.ts

// ─────────────────────────────────────────────
//  Vortexia — Rule Engine
// ─────────────────────────────────────────────
//
//  Architecture
//  ────────────
//  Each rule type is a pure handler function:
//
//    type RuleHandler = (entity, world, rule, dt) => void
//
//  The engine holds a mutable registry (Map<RuleType, RuleHandler>).
//  Calling registerHandler() replaces a handler at runtime — no restart,
//  no world reset. The new handler takes effect on the very next tick.
//
//  Per-tick execution order (inside SimLoop._tick):
//    1. ruleEngine.applyAll(world, dt)   ← forces accumulated here
//    2. entity.integrate(dt, damping)    ← velocity + position updated
//    3. world.applyBoundary(entity)
//    4. world.purgeDeadEntities()
//    5. world.flushSpawnQueue()          ← replication children added
//
//  Toggle ON/OFF
//  ─────────────
//  Global:     rule.enabled = false  →  WorldState.getActiveRules() skips it
//  Per-entity: entity.meta.disabledRules = new Set(['rule-id-1', 'rule-id-2'])
//              RuleEngine checks this set before calling the handler.
//
//  Extensibility
//  ─────────────
//  Add a new rule at runtime (hot-swap):
//    engine.registerHandler('my_rule', myHandler);
//    world.setRule({ id: 'r1', type: 'my_rule', enabled: true, ... });
//  The new rule is live on the next tick.
// ─────────────────────────────────────────────

import type { Entity }     from '../Entity';
import type { WorldState } from '../WorldState';
import type { Rule, RuleType } from '../types';
import { DEFAULT_HANDLERS } from './handlers/index';

// ─── Public handler type (exported so handler files can import it) ─

export type RuleHandler = (
  entity: Entity,
  world:  WorldState,
  rule:   Rule,
  dt:     number,
) => void;

// ─── Helper ───────────────────────────────────

/** Returns true if this rule should run on this entity */
function isTargeted(rule: Rule, entity: Entity): boolean {
  return rule.targets.length === 0 || rule.targets.includes(entity.type);
}

/** Returns true if this entity has suppressed this specific rule */
function isEntitySuppressed(entity: Entity, ruleId: string): boolean {
  const overrides = entity.meta.disabledRules;
  if (!overrides) return false;
  // `disabledRules` historically stored as `Set<string>` (runtime),
  // but saves/load via JSON will deserialize it into a plain object.
  // Be defensive to avoid hard-crashing the sim loop on bad meta.
  const o: any = overrides as any;
  if (typeof o?.has === 'function') {
    return o.has(ruleId);
  }
  if (Array.isArray(o)) {
    return o.includes(ruleId);
  }
  return false;
}

// ─── RuleEngine ───────────────────────────────

/**
 * Applies all active rules to all alive entities each tick.
 *
 * Handlers are pure functions — no internal state.
 * The registry is mutable so handlers can be hot-swapped at runtime.
 */
export class RuleEngine {
  /** Mutable handler registry — supports hot-swap via registerHandler() */
  private registry = new Map<RuleType, RuleHandler>(
    Object.entries(DEFAULT_HANDLERS) as [RuleType, RuleHandler][],
  );

  // ─── Core: apply all rules ────────────────────

  /**
   * Main entry point — called once per physics tick by SimLoop.
   *
   * For each alive entity:
   *   For each active (enabled) rule:
   *     1. Check global target filter  (rule.targets)
   *     2. Check per-entity suppression (entity.meta.disabledRules)
   *     3. If entity is stalled, only allow attraction and gravity rules.
   *     4. Call handler
   */
  applyAll(world: WorldState, dt: number): void {
    const rules    = world.getActiveRules(); // only enabled rules
    const entities = world.getAlive();

    for (const entity of entities) {
      for (const rule of rules) {
        // ── Global target filter ──
        if (!isTargeted(rule, entity)) continue;

        // ── Per-entity suppression ──
        if (isEntitySuppressed(entity, rule.id)) continue;

        // ── Stalled agents only allowed attraction and gravity ──
        if (entity.stalled && rule.type !== 'attraction' && rule.type !== 'gravity') {
          if (
            rule.type === 'goal_seek' &&
            entity.type === 'agent' &&
            (rule.params.targetType as string) === 'attractor'
          ) {
            /* allow — goal_seek sets freeMovement for cost-free drift toward attractor */
          } else if (rule.type === 'replication') {
            /* allow — mates already in contact can reproduce while stamina recovers */
          } else {
            continue;
          }
        }

        // ── Apply ──
        const handler = this.registry.get(rule.type);
        if (handler) {
          try {
            handler(entity, world, rule, dt);
          } catch (err) {
            console.error(`Error in rule handler ${rule.type} for entity ${entity.id}:`, err);
          }
        }
      }
    }
  }

  // ─── Single-entity apply (debug / preview) ───

  /**
   * Apply one rule to one entity.
   * Respects target filter and per-entity suppression.
   * Useful for rule preview without running the full sim.
   */
  applyOne(entity: Entity, world: WorldState, rule: Rule, dt: number): void {
    if (!isTargeted(rule, entity)) return;
    if (isEntitySuppressed(entity, rule.id)) return;
    const handler = this.registry.get(rule.type);
    if (handler) handler(entity, world, rule, dt);
  }

  // ─── Hot-swap API ─────────────────────────────

  /**
   * Register or replace a rule handler at runtime.
   * Takes effect on the very next tick — no restart needed.
   *
   * @example
   * // Override attraction with a custom implementation
   * engine.registerHandler('attraction', myAttractionV2);
   *
   * // Add a brand-new rule type (must also be in RuleType union)
   * engine.registerHandler('my_rule', myHandler);
   */
  registerHandler(type: RuleType, handler: RuleHandler): void {
    this.registry.set(type, handler);
  }

  /**
   * Remove a handler entirely.
   * Any rules of this type will silently no-op until re-registered.
   */
  unregisterHandler(type: RuleType): void {
    this.registry.delete(type);
  }

  /** List all currently registered rule types */
  getSupportedRuleTypes(): RuleType[] {
    return Array.from(this.registry.keys());
  }

  /** Check if a handler is registered for a given type */
  hasHandler(type: RuleType): boolean {
    return this.registry.has(type);
  }
}