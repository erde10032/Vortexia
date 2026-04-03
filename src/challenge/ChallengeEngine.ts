// ─────────────────────────────────────────────
//  Vortexia — Challenge Engine
// ─────────────────────────────────────────────
//
//  Plugs into SimLoop.onTick.
//  Each tick it:
//    1. Updates ChallengeContext (elapsed, deaths, reps, collisions)
//    2. Calls mission.condition() → progress 0–1
//    3. Checks mission.failure() → emit 'challenge:failed'
//    4. Checks mission.success() → emit 'challenge:success'
//
//  Events emitted (on world.events):
//    'challenge:progress'  { missionId, progress: 0–1, holdTicks }
//    'challenge:success'   { missionId, score: ScoreBreakdown, rank }
//    'challenge:failed'    { missionId, reason: string }
//    'challenge:tick'      { missionId, ctx }   (every tick, for HUD)
// ─────────────────────────────────────────────

import type { WorldState }                    from '../engine/WorldState';
import type { SimEvent }                      from '../engine/types';
import type { Mission, ChallengeContext }     from './ChallengeTypes';
import { rankFromScore }                      from './ChallengeTypes';

const TICKS_PER_SEC = 60;

// ─── ChallengeEngine ─────────────────────────

export class ChallengeEngine {
  private world:   WorldState;
  private mission: Mission | null = null;
  private ctx:     ChallengeContext | null = null;
  private status:  'idle' | 'active' | 'done' = 'idle';

  private _unsubs: Array<() => void> = [];

  constructor(world: WorldState) {
    this.world = world;
  }

  // ─── Start a mission ──────────────────────

  start(mission: Mission): void {
    if (this.status === 'active') this._cleanup();

    const ctx: ChallengeContext = {
      startTick:         this.world.tick,
      elapsedTicks:      0,
      timeLimitTicks:    mission.timeLimitSec * TICKS_PER_SEC,
      holdTicks:         0,
      holdRequiredTicks: mission.holdSec * TICKS_PER_SEC,
      deathCount:        0,
      replicationCount:  0,
      collisionCount:    0,
      data:              {},
    };

    this.mission = mission;
    this.ctx     = ctx;
    this.status  = 'active';

    // Wire world events for counters
    const onDeath = () => { ctx.deathCount++; };
    const onRep   = (e: SimEvent<{ parentId: string; childId: string }>) => {
      ctx.replicationCount++;
      // For chain reaction: count reps in rolling window
      if (mission.id === 'chain_reaction') {
        ctx.data.windowReps = ((ctx.data.windowReps as number) ?? 0) + 1;
      }
    };
    const onColl  = () => { ctx.collisionCount++; };

    this.world.events.on('entity:death',     onDeath as (e: SimEvent<unknown>) => void);
    this.world.events.on('entity:replicate', onRep   as (e: SimEvent<unknown>) => void);
    this.world.events.on('collision:enter',  onColl  as (e: SimEvent<unknown>) => void);

    this._unsubs.push(
      () => this.world.events.off('entity:death',     onDeath as (e: SimEvent<unknown>) => void),
      () => this.world.events.off('entity:replicate', onRep   as (e: SimEvent<unknown>) => void),
      () => this.world.events.off('collision:enter',  onColl  as (e: SimEvent<unknown>) => void),
    );

    // Call mission's onStart hook
    mission.onStart?.(this.world, ctx);

    // Emit start event
    this.world.events.emit('challenge:start', { missionId: mission.id }, this.world.tick);
  }

  // ─── Tick (called by SimLoop.onTick) ─────

  tick(): void {
    if (this.status !== 'active' || !this.mission || !this.ctx) return;

    const { mission, ctx, world } = this;

    // Update elapsed
    ctx.elapsedTicks = world.tick - ctx.startTick;

    // ── Check failure first ──
    if (mission.failure(world, ctx)) {
      this._resolve('failed', 'Conditions not met');
      return;
    }

    // ── Evaluate progress ──
    const progress = mission.condition(world, ctx);

    // ── Emit tick event for HUD ──
    world.events.emit('challenge:tick', {
      missionId: mission.id,
      progress,
      ctx: { ...ctx }, // shallow copy for HUD
    }, world.tick);

    // ── Check success ──
    if (mission.success(world, ctx)) {
      this._resolve('success');
    }
  }

  // ─── Abort ────────────────────────────────

  abort(): void {
    if (this.status !== 'active') return;
    this._resolve('failed', 'Aborted');
  }

  // ─── Getters ──────────────────────────────

  get isActive(): boolean { return this.status === 'active'; }
  get currentMission(): Mission | null { return this.mission; }
  get currentCtx(): ChallengeContext | null { return this.ctx; }

  // ─── Internal ─────────────────────────────

  private _resolve(outcome: 'success' | 'failed', reason?: string): void {
    if (!this.mission || !this.ctx) return;

    this.status = 'done';

    if (outcome === 'success') {
      const scoreBreakdown = this.mission.score(this.ctx);
      const rank = rankFromScore(scoreBreakdown.total, this.mission.maxScore);
      this.mission.onSuccess?.(this.world, this.ctx);
      this.world.events.emit('challenge:success', {
        missionId: this.mission.id,
        score:     scoreBreakdown,
        rank,
        ctx:       { ...this.ctx },
      }, this.world.tick);
    } else {
      this.world.events.emit('challenge:failed', {
        missionId: this.mission.id,
        reason:    reason ?? 'Unknown',
        ctx:       { ...this.ctx },
      }, this.world.tick);
    }

    this._cleanup();
  }

  private _cleanup(): void {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    this.status  = 'idle';
  }
}
