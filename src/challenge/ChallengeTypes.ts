// ─────────────────────────────────────────────
//  Vortexia — Challenge Mode Types
// ─────────────────────────────────────────────

import type { WorldState } from '../engine/WorldState';
import type { SimEvent }   from '../engine/types';

// ─── Mission phases ───────────────────────────

export type MissionStatus =
  | 'locked'      // not yet unlocked
  | 'idle'        // available, not started
  | 'active'      // running
  | 'success'     // completed
  | 'failed';     // failed (time out / condition broken)

// ─── Progress condition ───────────────────────

/**
 * A single measurable condition evaluated every tick.
 * Returns 0–1 (progress ratio). 1.0 = condition met.
 */
export type ConditionFn = (world: WorldState, ctx: ChallengeContext) => number;

// ─── Success condition ────────────────────────

/**
 * Returns true when the mission is definitively won.
 * Evaluated after all ConditionFns reach 1.0.
 */
export type SuccessFn = (world: WorldState, ctx: ChallengeContext) => boolean;

// ─── Failure condition ────────────────────────

/**
 * Returns true when the mission is definitively lost.
 * Checked every tick regardless of progress.
 */
export type FailureFn = (world: WorldState, ctx: ChallengeContext) => boolean;

// ─── Scoring ──────────────────────────────────

export interface ScoreBreakdown {
  base:       number;   // fixed reward for completion
  timeBonus:  number;   // bonus for finishing fast
  efficiency: number;   // bonus for low entity death count
  total:      number;
}

export type ScoreRank = 'S' | 'A' | 'B' | 'C';

export function rankFromScore(score: number, max: number): ScoreRank {
  const pct = score / max;
  if (pct >= 0.9) return 'S';
  if (pct >= 0.7) return 'A';
  if (pct >= 0.5) return 'B';
  return 'C';
}

// ─── Challenge context ────────────────────────

/**
 * Mutable context passed to all condition functions.
 * Tracks per-mission runtime state.
 */
export interface ChallengeContext {
  /** Tick when mission became active */
  startTick:       number;
  /** Elapsed ticks since start */
  elapsedTicks:    number;
  /** Time limit in ticks (60 ticks ≈ 1 second at 60fps) */
  timeLimitTicks:  number;
  /** How many ticks the primary condition has been continuously satisfied */
  holdTicks:       number;
  /** Required hold duration in ticks */
  holdRequiredTicks: number;
  /** Deaths since mission start */
  deathCount:      number;
  /** Replications since mission start */
  replicationCount: number;
  /** Collisions since mission start */
  collisionCount:  number;
  /** Arbitrary per-mission scratch data */
  data:            Record<string, unknown>;
}

// ─── Mission definition ───────────────────────

export interface Mission {
  id:          string;
  title:       string;
  subtitle:    string;
  description: string;
  /** Short one-liner shown in HUD */
  objective:   string;
  /** Icon emoji */
  icon:        string;
  /** Accent color (CSS) */
  color:       string;

  /** Time limit in seconds */
  timeLimitSec: number;
  /** How long the primary condition must hold (seconds) */
  holdSec:      number;

  /** Max possible score for rank calculation */
  maxScore:     number;

  /** Required rules to be active (shown as hints) */
  requiredRules: string[];

  /** Evaluate 0–1 progress toward primary condition */
  condition:   ConditionFn;
  /** True = mission won */
  success:     SuccessFn;
  /** True = mission failed */
  failure:     FailureFn;
  /** Compute score on completion */
  score:       (ctx: ChallengeContext) => ScoreBreakdown;

  /** Called once when mission starts — can seed entities/rules */
  onStart?:    (world: WorldState, ctx: ChallengeContext) => void;
  /** Called once on success */
  onSuccess?:  (world: WorldState, ctx: ChallengeContext) => void;
}
