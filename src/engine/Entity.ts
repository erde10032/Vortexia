// src/engine/Entity.ts

// ─────────────────────────────────────────────
//  Vortexia — Entity
// ─────────────────────────────────────────────

import type { Vec2, EntityType, EntityState } from './types';

/** Max stamina for agents (Survival uses full range; UI and rings use this scale). */
export const AGENT_ENERGY_MAX = 200;
/** Passive recovery rate (all modes), 2.25× legacy 5/s. */
export const AGENT_ENERGY_RECOVERY_PER_SEC = 11.25;
/** Passive recovery does not raise stamina above this (standing still, stalled, free-movement drift, dash idle). */
export const AGENT_ENERGY_REST_CAP = 150;

let _nextId = 0;

/** Generate a unique entity ID */
function nextId(): string {
  return `E-${(++_nextId).toString().padStart(4, '0')}`;
}

// ─── Vec2 helpers (pure, no class overhead) ──

export function vec2(x = 0, y = 0): Vec2 { return { x, y }; }
export function vec2Add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function vec2Sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function vec2Scale(v: Vec2, s: number): Vec2 { return { x: v.x * s, y: v.y * s }; }
export function vec2Len(v: Vec2): number { return Math.sqrt(v.x * v.x + v.y * v.y); }
export function vec2Norm(v: Vec2): Vec2 {
  const len = vec2Len(v);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}
export function vec2Dist(a: Vec2, b: Vec2): number { return vec2Len(vec2Sub(b, a)); }

/** Shortest toroidal displacement from `a` toward `b` when the world wraps at width/height. */
export function vec2WrappedDelta(a: Vec2, b: Vec2, width: number, height: number): Vec2 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (width > 0) {
    if (dx > width / 2) dx -= width;
    else if (dx < -width / 2) dx += width;
  }
  if (height > 0) {
    if (dy > height / 2) dy -= height;
    else if (dy < -height / 2) dy += height;
  }
  return { x: dx, y: dy };
}

/** Shortest distance between two points on a wrapping (torus) world. */
export function vec2DistWrapped(a: Vec2, b: Vec2, width: number, height: number): number {
  const d = vec2WrappedDelta(a, b, width, height);
  return Math.sqrt(d.x * d.x + d.y * d.y);
}
export function vec2Clamp(v: Vec2, maxLen: number): Vec2 {
  const len = vec2Len(v);
  return len > maxLen ? vec2Scale(vec2Norm(v), maxLen) : v;
}

// ─── Entity Options ───────────────────────────

export interface EntityOptions {
  /** Restore a saved id (keeps snapshots stable) */
  id?: string;
  type?: EntityType;
  position?: Vec2;
  velocity?: Vec2;
  energy?: number;
  hunger?: number;
  health?: number;
  mass?: number;
  /** Max speed in world-units per second */
  maxSpeed?: number;
  /** Custom metadata for rule-specific data (e.g. pheromone strength) */
  meta?: Record<string, unknown>;
  /** Gender: 'male' or 'female' (only for agents) */
  gender?: 'male' | 'female';
  /** Age in years (only for agents) */
  ageYears?: number;
  /** Frailty factor (0.8–1.2) affecting death probability */
  frailty?: number;
  state?: EntityState;
  stalled?: boolean;
  acceleration?: Vec2;
  age?: number;
  freeMovement?: boolean;
}

// ─── Entity Class ─────────────────────────────

/**
 * Autonomous agent in the simulation world.
 *
 * Entities are plain data objects with a thin class wrapper.
 * Rules read and mutate entity properties each tick — the entity
 * itself has no AI logic. This keeps it fully data-driven.
 */
export class Entity {
  readonly id: string;

  // ── Core properties ──
  type: EntityType;
  state: EntityState;

  // ── Physics ──
  position: Vec2;
  velocity: Vec2;
  /** Accumulated force for this tick — reset each frame */
  acceleration: Vec2;
  mass: number;
  maxSpeed: number;

  // ── Lifecycle ──
  energy: number;
  hunger: number;           // 0–200, decreases over time, death at 0 (non-survival agents)
  /** 0–100 for agents in survival mode; ignored otherwise */
  health: number;
  age: number; // in ticks

  // ── Reproductive properties (only for agents) ──
  gender: 'male' | 'female';
  /** Age in years (real-time seconds → years) */
  ageYears: number;
  /** Frailty factor (higher = more likely to die early) */
  frailty: number;

  // ── Extensible metadata ──
  meta: Record<string, unknown>;

  // ── Temporary flags ──
  /** Set to true when this tick's movement is forced by attraction/gravity (free movement) */
  freeMovement: boolean = false;
  /** When energy drops to 0, agent is stalled until energy reaches 100 again */
  stalled: boolean = false;

  constructor(options: EntityOptions = {}) {
    if (options.id !== undefined) {
      this.id = options.id;
      const m = /^E-(\d+)$/.exec(options.id);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > _nextId) _nextId = n;
      }
    } else {
      this.id = nextId();
    }
    this.type     = options.type     ?? 'agent';
    this.state    = options.state    ?? 'alive';
    this.position = options.position ?? vec2();
    this.velocity = options.velocity ?? vec2();
    this.acceleration = options.acceleration ? { ...options.acceleration } : vec2();
    this.mass     = options.mass     ?? 1;
    this.maxSpeed = options.maxSpeed ?? 200; // world-units/sec

    // Energy — agents cap at AGENT_ENERGY_MAX (200)
    let initEnergy = options.energy ?? (this.type === 'agent' ? 100 + Math.random() * 100 : 100);
    this.energy   = Math.min(this.type === 'agent' ? AGENT_ENERGY_MAX : 100, initEnergy);
    // Hunger (0–200), only for agents, default random 100–200
    let initHunger = options.hunger ?? (this.type === 'agent' ? 100 + Math.random() * 100 : 100);
    this.hunger   = Math.min(200, Math.max(0, initHunger));
    this.health   = options.health ?? (this.type === 'agent' ? 100 : 0);

    this.age      = options.age ?? 0;
    this.meta     = options.meta     ? { ...options.meta } : {};

    // Gender and age (only meaningful for agents, but set anyway)
    this.gender = options.gender ?? (Math.random() < 0.5 ? 'male' : 'female');
    // Age in years: for new agents (born) start at 0, for initial agents random between 0 and 60
    this.ageYears = options.ageYears ?? (this.type === 'agent' ? Math.random() * 60 : 0);
    // Frailty: random between 0.8 and 1.2 for agents, 1 for others
    this.frailty = options.frailty ?? (this.type === 'agent' ? 0.8 + Math.random() * 0.4 : 1);
    if (options.stalled !== undefined) this.stalled = options.stalled;
    if (options.freeMovement !== undefined) this.freeMovement = options.freeMovement;
  }

  // ─── Physics helpers ─────────────────────────

  /** Apply a force vector (F = ma → a += F/m) */
  applyForce(force: Vec2): void {
    this.acceleration.x += force.x / this.mass;
    this.acceleration.y += force.y / this.mass;
  }

  /**
   * Integrate velocity and position using semi-implicit Euler.
   * Called once per fixed physics step.
   * @param dt  Delta time in seconds
   * @param damping  Global damping coefficient (0–1)
   */
  integrate(dt: number, damping: number): void {
    // v += a * dt
    this.velocity.x += this.acceleration.x * dt;
    this.velocity.y += this.acceleration.y * dt;

    // Apply damping (friction)
    this.velocity.x *= (1 - damping);
    this.velocity.y *= (1 - damping);

    // Clamp to maxSpeed
    const clamped = vec2Clamp(this.velocity, this.maxSpeed);
    this.velocity.x = clamped.x;
    this.velocity.y = clamped.y;

    // p += v * dt
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;

    // Reset acceleration for next tick
    this.acceleration.x = 0;
    this.acceleration.y = 0;

    this.age++;
  }

  /**
   * Update age in years based on real time.
   * Called once per physics tick.
   * @param dt  Delta time in seconds (usually ~0.0167)
   */
  updateAge(dt: number): void {
    if (this.type === 'agent') {
      // 1 year = 60 seconds (so age grows slowly)
      this.ageYears += dt / 60;
    }
  }

  /**
   * Update hunger over time.
   * Called once per physics tick.
   * @param dt  Delta time in seconds
   */
  updateHunger(dt: number): void {
    if (this.type !== 'agent') return;
    // Hunger decreases at a constant rate (2 per second)
    const HUNGER_DECAY_RATE = 2.0;
    this.hunger = Math.max(0, this.hunger - HUNGER_DECAY_RATE * dt);
  }

  /**
   * Check if the agent dies due to old age.
   * Probability increases with age, using frailty.
   * Called once per tick after age update.
   * @returns true if the agent dies.
   */
  checkDeathByAge(): boolean {
    if (this.type !== 'agent') return false;
    // Only consider death after 70 years
    if (this.ageYears < 70) return false;

    // Logistic hazard: probability per year = (age - 70) / 20, clamped to 0..1
    // Then multiply by frailty (higher frailty = higher risk)
    let yearlyProb = (this.ageYears - 70) / 20;
    yearlyProb = Math.min(1, Math.max(0, yearlyProb)) * this.frailty;
    // Convert to per-tick probability (1 year = 60 seconds, dt = 1/60 sec → 1 tick = 1/3600 years)
    const tickProb = 1 - Math.pow(1 - yearlyProb, 1 / 3600);
    if (Math.random() < tickProb) {
      this.kill();
      return true;
    }
    return false;
  }

  /**
   * Consume energy based on current speed, and recover if speed == 0.
   * Called after integration.
   * @param dt  Delta time in seconds
   */
  consumeMovementEnergy(dt: number): void {
    // Only agents consume/recover energy
    if (this.type !== 'agent') return;

    const speed = vec2Len(this.velocity);
    const isMoving = speed > 0.01;

    const dashUntil = this.meta.survivalDashUntilReal as number | undefined;
    const restRecover = (e: number): number =>
      e >= AGENT_ENERGY_REST_CAP
        ? e
        : Math.min(AGENT_ENERGY_REST_CAP, e + AGENT_ENERGY_RECOVERY_PER_SEC * dt);

    // Update stalled state first (so player-controlled agents also freeze at 0 energy).
    if (this.energy <= 0 && !this.stalled) {
      this.stalled = true;
    } else if (this.energy >= 100 && this.stalled) {
      this.stalled = false;
    }

    // Dash: no stamina cost for the player while active, but stalled still stops motion.
    if (
      this.meta.playerControlled === true &&
      dashUntil !== undefined &&
      performance.now() < dashUntil &&
      !this.stalled
    ) {
      if (!isMoving) {
        this.energy = restRecover(this.energy);
      }
      return;
    }

    // If free movement (attraction/gravity), no energy cost, but still can recover if speed == 0
    if (this.freeMovement) {
      // Recover even while being dragged (e.g. vortex pull), because the agent itself is "resting".
      this.energy = restRecover(this.energy);
      return;
    }

    // Normal movement (only allowed if not stalled)
    if (this.stalled) {
      // Stalled agents cannot move on their own; set velocity to 0
      this.velocity = { x: 0, y: 0 };
      // Recover energy when stalled and not moving
      this.energy = restRecover(this.energy);
      return;
    }

    // Not stalled and not free movement
    if (isMoving) {
      // Consume energy: reduced by factor 3 (0.125 → 0.0417)
      const cost = 0.0417 * speed * dt;
      this.energy = Math.max(0, this.energy - cost);
    } else {
      // Recover energy when standing still (speed == 0)
      this.energy = restRecover(this.energy);
    }
  }

  /**
   * Reset free movement flag at start of each tick.
   */
  resetFreeMovementFlag(): void {
    this.freeMovement = false;
  }

  // ─── Lifecycle helpers ────────────────────────

  isDead(): boolean {
    if (this.state === 'dead') return true;
    if (this.type === 'agent') {
      if (this.meta.survival === true) {
        return this.health <= 0;
      }
      return this.hunger <= 0;
    }
    // Non-agent entities die from energy exhaustion
    return this.energy <= 0;
  }

  kill(): void { this.state = 'dead'; this.energy = 0; this.hunger = 0; this.health = 0; }

  /**
   * Spawn a child entity inheriting this entity's type and position.
   * Energy is split 50/50 between parent and child.
   * @deprecated Replaced by partner‑based reproduction; kept for compatibility.
   */
  replicate(): Entity {
    this.state = 'alive'; // reset from replicating
    this.energy *= 0.5;

    const child = new Entity({
      type:     this.type,
      position: { x: this.position.x + (Math.random() - 0.5) * 10,
                  y: this.position.y + (Math.random() - 0.5) * 10 },
      velocity: { x: (Math.random() - 0.5) * 50,
                  y: (Math.random() - 0.5) * 50 },
      energy:   this.energy,
      hunger:   100 + Math.random() * 100,
      mass:     this.mass,
      maxSpeed: this.maxSpeed,
      // New child gets random gender and age 0
      gender:   Math.random() < 0.5 ? 'male' : 'female',
      ageYears: 0,
      frailty:  0.8 + Math.random() * 0.4,
    });

    return child;
  }

  // ─── Serialization ────────────────────────────

  toJSON() {
    return {
      id:       this.id,
      type:     this.type,
      state:    this.state,
      position: this.position,
      velocity: this.velocity,
      acceleration: this.acceleration,
      mass:     this.mass,
      maxSpeed: this.maxSpeed,
      energy:   this.energy,
      hunger:   this.hunger,
      health:   this.health,
      age:      this.age,
      gender:   this.gender,
      ageYears: this.ageYears,
      frailty:  this.frailty,
      stalled:  this.stalled,
      freeMovement: this.freeMovement,
      meta:     { ...this.meta },
    };
  }

  /** Rebuild from save payload (see toJSON shape). */
  static fromSavedRecord(raw: Record<string, unknown>): Entity {
    const pos = raw.position as { x: number; y: number } | undefined;
    const vel = raw.velocity as { x: number; y: number } | undefined;
    const acc = raw.acceleration as { x: number; y: number } | undefined;
    return new Entity({
      id:       raw.id as string,
      type:     raw.type as EntityType,
      state:    raw.state as EntityState,
      position: pos ? vec2(pos.x, pos.y) : undefined,
      velocity: vel ? vec2(vel.x, vel.y) : undefined,
      acceleration: acc ? vec2(acc.x, acc.y) : undefined,
      mass:     raw.mass as number | undefined,
      maxSpeed: raw.maxSpeed as number | undefined,
      energy:   raw.energy as number | undefined,
      hunger:   raw.hunger as number | undefined,
      health:   raw.health as number | undefined,
      age:      raw.age as number | undefined,
      gender:   raw.gender as 'male' | 'female' | undefined,
      ageYears: raw.ageYears as number | undefined,
      frailty:  raw.frailty as number | undefined,
      stalled:  raw.stalled as boolean | undefined,
      freeMovement: raw.freeMovement as boolean | undefined,
      meta:     (raw.meta && typeof raw.meta === 'object') ? raw.meta as Record<string, unknown> : undefined,
    });
  }
}