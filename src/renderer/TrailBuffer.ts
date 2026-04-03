// ─────────────────────────────────────────────
//  Vortexia — Trail Buffer
// ─────────────────────────────────────────────
//
//  Stores the last N positions for each entity.
//  Uses a fixed-size ring buffer per entity — no GC pressure.
//
//  Called by Renderer.update() each frame (before draw).
//  Renderer layers read from this to draw trails.
// ─────────────────────────────────────────────

import type { Vec2 } from '../engine/types';
import { TRAIL_CONFIG } from './RendererConfig';

// ─── Trail point ──────────────────────────────

export interface TrailPoint {
  x: number;
  y: number;
}

// ─── Per-entity ring buffer ───────────────────

class EntityTrail {
  private buf: TrailPoint[];
  private head = 0;
  private count = 0;
  private lastX = NaN;
  private lastY = NaN;
  readonly maxLen: number;

  constructor(maxLen: number) {
    this.maxLen = maxLen;
    this.buf = new Array(maxLen).fill(null).map(() => ({ x: 0, y: 0 }));
  }

  /** Push a new position. Skips if entity hasn't moved enough. */
  push(x: number, y: number): void {
    if (!isNaN(this.lastX)) {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      if (dx * dx + dy * dy < TRAIL_CONFIG.minDist * TRAIL_CONFIG.minDist) return;
    }
    this.buf[this.head].x = x;
    this.buf[this.head].y = y;
    this.head = (this.head + 1) % this.maxLen;
    if (this.count < this.maxLen) this.count++;
    this.lastX = x;
    this.lastY = y;
  }

  /**
   * Returns trail points from oldest → newest.
   * Caller gets a stable array slice — no allocation if reusing.
   */
  getPoints(): TrailPoint[] {
    if (this.count === 0) return [];
    const result: TrailPoint[] = [];
    const start = this.count < this.maxLen
      ? 0
      : this.head; // oldest slot when full

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.maxLen;
      result.push(this.buf[idx]);
    }
    return result;
  }

  get length(): number { return this.count; }

  clear(): void {
    this.head  = 0;
    this.count = 0;
    this.lastX = NaN;
    this.lastY = NaN;
  }
}

// ─── TrailBuffer ──────────────────────────────

/**
 * Manages motion trail history for all entities.
 *
 * Usage:
 *   trails.update(entities);   // call each frame
 *   trails.get(entityId);      // returns ordered TrailPoint[]
 *   trails.prune(aliveIds);    // call after entity purge
 */
export class TrailBuffer {
  private trails = new Map<string, EntityTrail>();
  private maxLen: number;

  constructor(maxLen = TRAIL_CONFIG.maxLength) {
    this.maxLen = maxLen;
  }

  /** Push current positions for all entities */
  update(entities: Array<{ id: string; position: Vec2 }>): void {
    for (const e of entities) {
      let trail = this.trails.get(e.id);
      if (!trail) {
        trail = new EntityTrail(this.maxLen);
        this.trails.set(e.id, trail);
      }
      trail.push(e.position.x, e.position.y);
    }
  }

  /** Get trail points for a specific entity (oldest → newest) */
  get(entityId: string): TrailPoint[] {
    return this.trails.get(entityId)?.getPoints() ?? [];
  }

  /**
   * Remove trails for entities that no longer exist.
   * Call after WorldState.purgeDeadEntities().
   */
  prune(aliveIds: Set<string>): void {
    for (const id of this.trails.keys()) {
      if (!aliveIds.has(id)) this.trails.delete(id);
    }
  }

  /** Clear all trails (e.g. on world reset) */
  clear(): void {
    this.trails.clear();
  }
}
