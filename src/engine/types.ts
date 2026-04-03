// ─────────────────────────────────────────────
//  Vortexia — Shared Types & Interfaces
// ─────────────────────────────────────────────

/** 2D vector used for position, velocity, force */
export interface Vec2 {
  x: number;
  y: number;
}

/** All possible entity classifications */
export type EntityType = 'agent' | 'food' | 'attractor' | 'obstacle';

/** Lifecycle state of an entity */
export type EntityState = 'alive' | 'dead' | 'replicating';

/** All supported rule types */
export type RuleType =
  | 'gravity'
  | 'attraction'
  | 'repulsion'
  | 'goal_seek'
  | 'flocking'
  | 'predation'
  | 'replication'
  | 'decay'
  | 'mutation'
  | 'speed_modifier'
  | 'pheromone_trail'
  | 'boundary_warp'
  | 'energy_burst'
  | 'hunger_seek'; 

/** How the world handles entities reaching the edge */
export type BoundaryMode = 'wrap' | 'bounce' | 'open';

// ─── Rule ────────────────────────────────────

/** A single rule card — the user's lever on the world */
export interface Rule {
  id: string;
  type: RuleType;
  enabled: boolean;
  /** Normalized strength: -1.0 (full reverse) to 1.0 (full forward) */
  strength: number;
  /** Entity tags this rule applies to. Empty = applies to all */
  targets: EntityType[];
  /** Rule-specific numeric/string parameters */
  params: Record<string, number | string | boolean>;
}

// ─── World Config ────────────────────────────

export interface WorldConfig {
  width: number;
  height: number;
  boundary: BoundaryMode;
  damping: number;
  maxEntities: number;
  movementEnergyCost: number;
  /** Set in survival mode — used by rules (e.g. predation heal scaling). */
  survivalDifficulty?: 'easy' | 'medium' | 'hard';
  /** SimLoop speed (1–10); updated each tick for survival timing + rules. */
  simSpeed?: number;
}

// ─── Simulation Stats ────────────────────────

export interface SimStats {
  tick: number;
  entityCount: number;
  /** Counts per entity type */
  typeCounts: Partial<Record<EntityType, number>>;
}

// ─── Events ──────────────────────────────────

export type SimEventType =
  | 'entity:spawn'
  | 'entity:death'
  | 'entity:replicate'
  | 'rule:changed'
  | 'collision:enter'
  | 'tick:end'
  // ── Survival mode ──
  | 'survival:victory'
  | 'survival:defeat'
  | 'survival:event'
  | 'survival:ability'
  // ── Challenge mode ──
  | 'challenge:start'
  | 'challenge:tick'
  | 'challenge:success'
  | 'challenge:failed'
  | 'challenge:select'
  | 'challenge:abort'
  | 'challenge:close';

export interface SimEvent<T = unknown> {
  type: SimEventType;
  data: T;
  tick: number;
}

export type EventHandler<T = unknown> = (event: SimEvent<T>) => void;