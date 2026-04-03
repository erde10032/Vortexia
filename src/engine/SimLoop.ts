// src/engine/SimLoop.ts

// ─────────────────────────────────────────────
//  Vortexia — Simulation Loop
// ─────────────────────────────────────────────
//
//  Fixed-step physics (60Hz) decoupled from render rate.
//  Pattern: accumulator-based fixed timestep.
//
//  Why fixed-step?
//  - Deterministic: same input → same output regardless of FPS
//  - Stable: no physics explosion at low framerates
//  - Predictable: rules behave consistently at any speed multiplier
// ─────────────────────────────────────────────

import { WorldState } from './WorldState';
import { RuleEngine }  from './rules/RuleEngine';
import type { SimStats } from './types';

// ─── Constants ────────────────────────────────

const FIXED_HZ      = 60;
const FIXED_STEP_MS = 1000 / FIXED_HZ;       // 16.667ms
const FIXED_STEP_S  = FIXED_STEP_MS / 1000;  // 0.01667s
/** Max accumulated time before we drop frames (prevents spiral of death) */
const MAX_ACCUMULATOR_MS = 200;

// ─── Callbacks ────────────────────────────────

export type OnTickCallback  = (stats: SimStats) => void;
export type OnRenderCallback = (world: WorldState, alpha: number) => void;

// ─── SimLoop ──────────────────────────────────

/**
 * Drives the simulation at a fixed physics rate (60Hz) while
 * rendering at the display's native refresh rate.
 *
 * Usage:
 * ```ts
 * const loop = new SimLoop(world);
 * loop.onTick   = (stats) => updateUI(stats);
 * loop.onRender = (world, alpha) => renderer.draw(world, alpha);
 * loop.start();
 * ```
 */
export class SimLoop {
  private world:      WorldState;
  private ruleEngine: RuleEngine;

  // ── Loop state ──
  private rafId:       number | null = null;
  private lastTime:    number = 0;
  private accumulator: number = 0;

  // ── Speed multiplier (1 = normal, 2 = 2x, 0.5 = slow-mo) ──
  private _speed: number = 1;

  // ── Running state ──
  private _running: boolean = false;
  private _paused:  boolean = false;

  // ── Callbacks ──
  onTick:   OnTickCallback   | null = null;
  onRender: OnRenderCallback | null = null;

  /** After rules, before integrate — e.g. player steering */
  beforeIntegrate: ((world: WorldState, dt: number) => void) | null = null;

  /** After movement energy / stalled clamp, before purge — survival health, collisions */
  beforePurge: ((world: WorldState, dt: number) => void) | null = null;

  constructor(world: WorldState, ruleEngine?: RuleEngine) {
    this.world      = world;
    this.ruleEngine = ruleEngine ?? new RuleEngine();
  }

  // ─── Public API ───────────────────────────────

  get running(): boolean { return this._running; }
  get paused():  boolean { return this._paused; }
  get speed():   number  { return this._speed; }

  /** Start the simulation loop */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._paused  = false;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this._loop);
  }

  /** Pause — keeps world state, stops ticking */
  pause(): void {
    this._paused = true;
  }

  /** Resume from pause */
  resume(): void {
    if (!this._running) { this.start(); return; }
    this._paused  = false;
    this.lastTime = performance.now(); // reset to avoid time jump
    this.accumulator = 0;
  }

  /** Stop and clean up RAF */
  stop(): void {
    this._running = false;
    this._paused  = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Full reset: stop loop, reset world, restart.
   * Rules are preserved (soft reset).
   */
  reset(): void {
    this.stop();
    this.world.resetEntities();
    this.accumulator = 0;
  }

  /** Set simulation speed multiplier */
  setSpeed(multiplier: number): void {
    this._speed = Math.max(0.1, Math.min(10, multiplier));
  }

  // ─── Core Loop ────────────────────────────────

  private _loop = (timestamp: number): void => {
    if (!this._running) return;

    // Schedule next frame immediately
    this.rafId = requestAnimationFrame(this._loop);

    if (this._paused) return;

    // ── Delta time ──
    const rawDelta = timestamp - this.lastTime;
    this.lastTime  = timestamp;

    // ── Accumulate time (scaled by speed, capped to prevent spiral) ──
    const scaledDelta = rawDelta * this._speed;
    this.accumulator += Math.min(scaledDelta, MAX_ACCUMULATOR_MS);

    // ── Fixed-step physics ticks ──
    while (this.accumulator >= FIXED_STEP_MS) {
      this._tick(FIXED_STEP_S);
      this.accumulator -= FIXED_STEP_MS;
    }

    // ── Render interpolation alpha (0–1 between last two physics frames) ──
    const alpha = this.accumulator / FIXED_STEP_MS;

    // ── Render callback ──
    if (this.onRender) {
      this.onRender(this.world, alpha);
    }
  };

  // ─── Single Physics Tick ──────────────────────

  private _tick(dt: number): void {
    // Reset free movement flags for all entities
    const alive = this.world.getAlive();
    for (const entity of alive) {
      entity.resetFreeMovementFlag();
    }

    // 1. Apply all active rules → accumulate forces on entities
    this.ruleEngine.applyAll(this.world, dt);

    // 1b. Idle Brownian drift — only if no active rules AND agent is not stalled
    const hasActiveRules = this.world.getActiveRules().length > 0;
    if (!hasActiveRules) {
      for (const entity of alive) {
        // Stalled agents do not drift
        if (entity.stalled) continue;
        // Small random impulse (max ±15 world-units/s²)
        entity.velocity.x += (Math.random() - 0.5) * 15 * dt;
        entity.velocity.y += (Math.random() - 0.5) * 15 * dt;
        // Soft speed cap so they don't drift off-screen
        const spd = Math.sqrt(entity.velocity.x ** 2 + entity.velocity.y ** 2);
        if (spd > 60) {
          entity.velocity.x = (entity.velocity.x / spd) * 60;
          entity.velocity.y = (entity.velocity.y / spd) * 60;
        }
      }
    }

    if (this.beforeIntegrate) {
      this.beforeIntegrate(this.world, dt);
    }

    // 2. Integrate physics: velocity + position update
    for (const entity of alive) {
      entity.integrate(dt, this.world.config.damping);
      this.world.applyBoundary(entity);
    }

    // 3. Update age in years for all entities (only agents)
    for (const entity of alive) {
      entity.updateAge(dt);
    }

    // 4. Update hunger (only agents)
    for (const entity of alive) {
      entity.updateHunger(dt);
    }

    // 5. Check death by old age for agents
    for (const entity of alive) {
      entity.checkDeathByAge();
    }

    // 6. Consume/recover energy for movement (handles stalled state internally)
    for (const entity of alive) {
      entity.consumeMovementEnergy(dt);
    }

    // 7. If energy <= 0 or stalled, ensure velocity is 0 (except free movement)
    for (const entity of alive) {
      if (entity.stalled && !entity.freeMovement) {
        entity.velocity = { x: 0, y: 0 };
      }
    }

    if (this.beforePurge) {
      this.beforePurge(this.world, dt);
    }

    // 8. Lifecycle: remove dead entities
    this.world.purgeDeadEntities();

    // 9. Flush spawn queue (children from replication, etc.)
    this.world.flushSpawnQueue();

    // 10. Advance tick counter
    this.world.tick++;

    // 11. Emit tick:end event + call onTick callback
    const stats = this.world.getStats();
    this.world.events.emit('tick:end', stats, this.world.tick);
    if (this.onTick) this.onTick(stats);
  }

  // ─── Manual tick (for testing / headless mode) ─

  /**
   * Advance simulation by exactly one fixed step.
   * Useful for unit tests and deterministic replay.
   */
  tickOnce(): void {
    this._tick(FIXED_STEP_S);
  }

  /**
   * Advance simulation by N ticks synchronously.
   * Useful for fast-forward / pre-warming the world.
   */
  tickN(n: number): void {
    for (let i = 0; i < n; i++) this._tick(FIXED_STEP_S);
  }
}