// src/engine/WorldState.ts

// ─────────────────────────────────────────────
//  Vortexia — World State Manager
// ─────────────────────────────────────────────

import { Entity } from './Entity';
import type { Rule, WorldConfig, SimStats, EntityType, SimEvent, SimEventType, EventHandler } from './types';

// ─── Default world config ─────────────────────

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  width:       1200,
  height:      800,
  boundary:    'wrap',
  damping:     0.02,   // 2% velocity loss per tick
  maxEntities: 1000,
  movementEnergyCost: 0.5, // energy lost per unit of speed^2 per second
};

// ─── EventBus ────────────────────────────────

/**
 * Synchronous pub/sub bus.
 * Kept synchronous so tick execution stays deterministic —
 * no async surprises mid-simulation.
 */
export class EventBus {
  private listeners = new Map<SimEventType, Set<EventHandler<unknown>>>();

  on<T>(type: SimEventType, handler: EventHandler<T>): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler as EventHandler<unknown>);
  }

  off<T>(type: SimEventType, handler: EventHandler<T>): void {
    this.listeners.get(type)?.delete(handler as EventHandler<unknown>);
  }

  emit<T>(type: SimEventType, data: T, tick: number): void {
    const event: SimEvent<T> = { type, data, tick };
    this.listeners.get(type)?.forEach(h => h(event as SimEvent<unknown>));
  }

  /** Remove all listeners (useful on reset) */
  clear(): void { this.listeners.clear(); }
}

// ─── WorldState ───────────────────────────────

/**
 * Central registry for all simulation state.
 *
 * Responsibilities:
 * - Entity CRUD (add / remove / query)
 * - Rule set management (hot-swappable)
 * - World config (bounds, damping, etc.)
 * - Boundary resolution
 * - Stats aggregation
 * - Event bus access
 */
export class WorldState {
  readonly config: WorldConfig;
  readonly events: EventBus;

  /** Primary entity store — keyed by entity ID */
  private entities = new Map<string, Entity>();

  /** Pending spawns collected during a tick (applied after tick completes) */
  private spawnQueue: Entity[] = [];

  /** Active rules — mutated by UI in real-time */
  private rules: Map<string, Rule> = new Map();

  /** Current simulation tick */
  tick = 0;

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = { ...DEFAULT_WORLD_CONFIG, ...config };
    this.events = new EventBus();
  }

  // ─── Entity Management ────────────────────────

  /** Add an entity immediately */
  addEntity(entity: Entity): void {
    if (this.entities.size >= this.config.maxEntities) return;
    this.entities.set(entity.id, entity);
    this.events.emit('entity:spawn', { entity }, this.tick);
  }

  /** Queue a spawn to be applied after the current tick finishes */
  queueSpawn(entity: Entity): void {
    if (this.entities.size + this.spawnQueue.length < this.config.maxEntities) {
      this.spawnQueue.push(entity);
    }
  }

  /** Flush the spawn queue — called by SimLoop at end of tick */
  flushSpawnQueue(): void {
    for (const entity of this.spawnQueue) {
      this.addEntity(entity);
    }
    this.spawnQueue = [];
  }

  removeEntity(id: string): void {
    const entity = this.entities.get(id);
    if (entity) {
      this.entities.delete(id);
      this.events.emit('entity:death', { entityId: id }, this.tick);
    }
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Iterate all alive entities */
  getAlive(): Entity[] {
    const result: Entity[] = [];
    for (const e of this.entities.values()) {
      if (!e.isDead()) result.push(e);
    }
    return result;
  }

  /** Get all entities of a specific type */
  getByType(type: EntityType): Entity[] {
    return this.getAlive().filter(e => e.type === type);
  }

  /**
   * Spatial query: entities within radius of a point.
   * O(n) — acceptable for ≤1000 entities. Upgrade to spatial hash if needed.
   */
  getNearby(x: number, y: number, radius: number, excludeId?: string): Entity[] {
    const r2 = radius * radius;
    const result: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.isDead()) continue;
      if (e.id === excludeId) continue;
      const dx = e.position.x - x;
      const dy = e.position.y - y;
      if (dx * dx + dy * dy <= r2) result.push(e);
    }
    return result;
  }

  get entityCount(): number { return this.entities.size; }

  // ─── Rule Management ──────────────────────────

  setRule(rule: Rule): void {
    const old = this.rules.get(rule.id);
    this.rules.set(rule.id, rule);
    this.events.emit('rule:changed', { ruleId: rule.id, oldVal: old, newVal: rule }, this.tick);
  }

  removeRule(id: string): void { this.rules.delete(id); }

  getRule(id: string): Rule | undefined { return this.rules.get(id); }

  /** All enabled rules */
  getActiveRules(): Rule[] {
    const result: Rule[] = [];
    for (const r of this.rules.values()) {
      if (r.enabled) result.push(r);
    }
    return result;
  }

  getAllRules(): Rule[] { return Array.from(this.rules.values()); }

  // ─── Boundary Resolution ──────────────────────

  /**
   * Apply world boundary to an entity based on config.boundary mode.
   * Called after integration, before next tick.
   */
  applyBoundary(entity: Entity): void {
    const { width, height, boundary } = this.config;
    const p = entity.position;
    const v = entity.velocity;

    if (boundary === 'wrap') {
      if (p.x < 0)      p.x += width;
      if (p.x > width)  p.x -= width;
      if (p.y < 0)      p.y += height;
      if (p.y > height) p.y -= height;

    } else if (boundary === 'bounce') {
      if (p.x < 0)      { p.x = 0;      v.x = Math.abs(v.x); }
      if (p.x > width)  { p.x = width;  v.x = -Math.abs(v.x); }
      if (p.y < 0)      { p.y = 0;      v.y = Math.abs(v.y); }
      if (p.y > height) { p.y = height; v.y = -Math.abs(v.y); }

    }
    // 'open' — entities drift off-canvas, cleaned up by lifecycle pass
  }

  // ─── Lifecycle Cleanup ────────────────────────

  /**
   * Remove all dead entities.
   * Returns count of removed entities.
   */
  purgeDeadEntities(): number {
    let count = 0;
    for (const [id, entity] of this.entities) {
      if (entity.isDead()) {
        this.entities.delete(id);
        this.events.emit('entity:death', { entityId: id }, this.tick);
        count++;
      }
    }
    return count;
  }

  // ─── Stats ────────────────────────────────────

  getStats(): SimStats {
    const typeCounts: Partial<Record<EntityType, number>> = {};
    for (const e of this.entities.values()) {
      typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    }
    return {
      tick:        this.tick,
      entityCount: this.entities.size,
      typeCounts,
    };
  }

  // ─── Reset ────────────────────────────────────

  /** Full world reset — clears entities, rules, tick counter */
  reset(): void {
    this.entities.clear();
    this.spawnQueue = [];
    this.rules.clear();
    this.tick = 0;
    this.events.clear();
  }

  /** Soft reset — keeps rules, clears entities only */
  resetEntities(): void {
    this.entities.clear();
    this.spawnQueue = [];
    this.tick = 0;
  }

  /**
   * Replace entities, rules, and tick from a save snapshot.
   * Does not emit spawn events (bulk load).
   */
  restoreFromSnapshot(entities: Entity[], rules: Rule[], tick: number): void {
    this.entities.clear();
    this.spawnQueue = [];
    this.rules.clear();
    this.tick = tick;
    for (const r of rules) {
      this.rules.set(r.id, r);
    }
    for (const e of entities) {
      if (this.entities.size >= this.config.maxEntities) break;
      this.entities.set(e.id, e);
    }
  }
}