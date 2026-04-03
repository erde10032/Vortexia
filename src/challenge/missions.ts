// ─────────────────────────────────────────────
//  Vortexia — The 3 Challenge Missions
// ─────────────────────────────────────────────
//
//  MISSION 1 — EQUILIBRIUM
//    Anchor: Ecosystem stability
//    Spark:  Cardiac medicine (stable vitals = healthy patient)
//    Goal:   Keep agents + food ratio in 2:1–4:1 band for 30 seconds
//    Fail:   Any entity type goes extinct OR timer runs out
//
//  MISSION 2 — CHAIN REACTION
//    Anchor: Replication cascade
//    Spark:  Nuclear fission (one neutron → chain → critical mass)
//    Goal:   Trigger 20 replication events within 10 seconds
//    Fail:   Agent count drops below 5 OR timer runs out
//
//  MISSION 3 — CONVERGENCE
//    Anchor: All entities cluster to a single attractor
//    Spark:  Black hole accretion disk (gravity pulls everything in)
//    Goal:   80% of agents within 200 world-units of any attractor for 15s
//    Fail:   All attractors die OR timer runs out
// ─────────────────────────────────────────────

import type { Mission, ChallengeContext } from './ChallengeTypes';
import type { WorldState }                from '../engine/WorldState';
import { Entity, vec2 }                   from '../engine/Entity';

const TICKS_PER_SEC = 60; // nominal — engine runs at ~60 ticks/s

// ═══════════════════════════════════════════════
//  MISSION 1 — EQUILIBRIUM
// ═══════════════════════════════════════════════

export const MISSION_EQUILIBRIUM: Mission = {
  id:          'equilibrium',
  title:       'EQUILIBRIUM',
  subtitle:    'Stable Ecosystem',
  description: 'Balance predator and prey. Keep the amoeba-to-food ratio between 2:1 and 4:1 for 30 unbroken seconds. One extinction ends it all.',
  objective:   'Hold amoeba:food ratio 2–4× for 30 s',
  icon:        '⚖',
  color:       '#39FF14',
  timeLimitSec:  90,
  holdSec:       30,
  maxScore:      3000,
  requiredRules: ['goal_seek', 'replication', 'decay'],

  condition(world, ctx) {
    const agents = world.getAlive().filter(e => e.type === 'agent').length;
    const food   = world.getAlive().filter(e => e.type === 'food').length;

    if (food === 0 || agents === 0) {
      ctx.holdTicks = 0; // reset hold — condition broken
      return 0;
    }

    const ratio = agents / food;
    const inBand = ratio >= 2 && ratio <= 4;

    if (inBand) {
      ctx.holdTicks++;
    } else {
      ctx.holdTicks = Math.max(0, ctx.holdTicks - 2); // decay faster than it builds
    }

    return Math.min(1, ctx.holdTicks / ctx.holdRequiredTicks);
  },

  success(world, ctx) {
    return ctx.holdTicks >= ctx.holdRequiredTicks;
  },

  failure(world, ctx) {
    const alive = world.getAlive();
    const agents = alive.filter(e => e.type === 'agent').length;
    const food   = alive.filter(e => e.type === 'food').length;
    // Extinction of either type = fail
    if (agents === 0 || food === 0) return true;
    // Time out
    if (ctx.elapsedTicks >= ctx.timeLimitTicks) return true;
    return false;
  },

  score(ctx) {
    const base      = 1000;
    const timeLeft  = Math.max(0, ctx.timeLimitTicks - ctx.elapsedTicks);
    const timeBonus = Math.floor((timeLeft / ctx.timeLimitTicks) * 1200);
    const efficiency = Math.max(0, 800 - ctx.deathCount * 20);
    return { base, timeBonus, efficiency, total: base + timeBonus + efficiency };
  },

  onStart(world, ctx) {
    // Ensure food exists
    const { width: W, height: H } = world.config;
    const foodCount = world.getAlive().filter(e => e.type === 'food').length;
    for (let i = foodCount; i < 12; i++) {
      world.addEntity(new Entity({
        type: 'food',
        position: vec2(Math.random() * W, Math.random() * H),
        velocity: vec2(0, 0),
        energy: 100,
        mass: 2,
      }));
    }
  },
};

// ═══════════════════════════════════════════════
//  MISSION 2 — CHAIN REACTION
// ═══════════════════════════════════════════════

export const MISSION_CHAIN_REACTION: Mission = {
  id:          'chain_reaction',
  title:       'CHAIN REACTION',
  subtitle:    'Replication Cascade',
  description: 'Trigger a replication cascade. Achieve 20 replication events within 10 seconds. If live amoeba drop below 5, the chain collapses.',
  objective:   'Trigger 20 replications in 10 s',
  icon:        '⚛',
  color:       '#BF5FFF',
  timeLimitSec:  60,
  holdSec:       0,   // no hold — it's a count target
  maxScore:      4000,
  requiredRules: ['replication', 'attraction'],

  condition(world, ctx) {
    // Count replications accumulated in this window
    const windowTicks = 10 * TICKS_PER_SEC;
    const windowReps  = (ctx.data.windowReps as number) ?? 0;
    // After the 10s window expires, progress no longer increases.
    if (ctx.elapsedTicks > windowTicks) {
      return Math.min(1, windowReps / 20);
    }
    return Math.min(1, windowReps / 20);
  },

  success(world, ctx) {
    const windowTicks = 10 * TICKS_PER_SEC;
    const windowReps = (ctx.data.windowReps as number) ?? 0;
    return ctx.elapsedTicks <= windowTicks && windowReps >= 20;
  },

  failure(world, ctx) {
    const windowTicks = 10 * TICKS_PER_SEC;
    const agents = world.getAlive().filter(e => e.type === 'agent').length;
    const windowReps = (ctx.data.windowReps as number) ?? 0;
    if (agents < 5) return true;
    if (ctx.elapsedTicks > windowTicks && windowReps < 20) return true;
    if (ctx.elapsedTicks >= ctx.timeLimitTicks) return true;
    return false;
  },

  score(ctx) {
    const base       = 1500;
    const reps       = (ctx.data.windowReps as number) ?? 0;
    const timeBonus  = Math.floor(Math.max(0, (10 * TICKS_PER_SEC - ctx.elapsedTicks) / (10 * TICKS_PER_SEC)) * 1500);
    const efficiency = Math.min(1000, reps * 40);
    return { base, timeBonus, efficiency, total: base + timeBonus + efficiency };
  },

  onStart(world, ctx) {
    // Seed agents with high energy to make replication easier to trigger.
    ctx.data.windowReps    = 0;
    ctx.data.windowStartTick = ctx.startTick;

    // Boost existing agent energy
    for (const e of world.getAlive()) {
      if (e.type === 'agent') e.energy = 90;
    }
  },
};

// ═══════════════════════════════════════════════
//  MISSION 3 — CONVERGENCE
// ═══════════════════════════════════════════════

export const MISSION_CONVERGENCE: Mission = {
  id:          'convergence',
  title:       'CONVERGENCE',
  subtitle:    'Gravitational Collapse',
  description: 'Pull 80% of all amoeba within 200 units of any vortex and hold it for 15 seconds. The vortex must survive.',
  objective:   'Cluster 80% of amoeba near vortex for 15 s',
  icon:        '◉',
  color:       '#00F5FF',
  timeLimitSec:  120,
  holdSec:       15,
  maxScore:      5000,
  requiredRules: ['attraction', 'gravity'],

  condition(world, ctx) {
    const alive      = world.getAlive();
    const agents     = alive.filter(e => e.type === 'agent');
    const attractors = alive.filter(e => e.type === 'attractor');

    if (agents.length === 0 || attractors.length === 0) {
      ctx.holdTicks = 0;
      return 0;
    }

    const RADIUS = 200;
    let clustered = 0;

    for (const agent of agents) {
      for (const att of attractors) {
        const dx = agent.position.x - att.position.x;
        const dy = agent.position.y - att.position.y;
        if (dx * dx + dy * dy <= RADIUS * RADIUS) {
          clustered++;
          break; // count agent once even if near multiple attractors
        }
      }
    }

    const ratio = clustered / agents.length;
    const inBand = ratio >= 0.8;

    if (inBand) {
      ctx.holdTicks++;
    } else {
      ctx.holdTicks = Math.max(0, ctx.holdTicks - 1);
    }

    // Progress = weighted blend of ratio + hold progress
    const ratioProg = Math.min(1, ratio / 0.8);
    const holdProg  = Math.min(1, ctx.holdTicks / ctx.holdRequiredTicks);
    return ratioProg * 0.4 + holdProg * 0.6;
  },

  success(world, ctx) {
    return ctx.holdTicks >= ctx.holdRequiredTicks;
  },

  failure(world, ctx) {
    const attractors = world.getAlive().filter(e => e.type === 'attractor').length;
    if (attractors === 0) return true;
    if (ctx.elapsedTicks >= ctx.timeLimitTicks) return true;
    return false;
  },

  score(ctx) {
    const base      = 2000;
    const timeLeft  = Math.max(0, ctx.timeLimitTicks - ctx.elapsedTicks);
    const timeBonus = Math.floor((timeLeft / ctx.timeLimitTicks) * 2000);
    const efficiency = Math.max(0, 1000 - ctx.deathCount * 30);
    return { base, timeBonus, efficiency, total: base + timeBonus + efficiency };
  },

  onStart(world, ctx) {
    const { width: W, height: H } = world.config;

    // Ensure at least 1 attractor exists
    const attCount = world.getAlive().filter(e => e.type === 'attractor').length;
    if (attCount === 0) {
      world.addEntity(new Entity({
        type: 'attractor',
        position: vec2(W / 2, H / 2),
        velocity: vec2(0, 0),
        energy: 100,
        mass: 10,
      }));
    }
  },
};

// ─── Export all missions in order ────────────

export const ALL_MISSIONS: Mission[] = [
  MISSION_EQUILIBRIUM,
  MISSION_CHAIN_REACTION,
  MISSION_CONVERGENCE,
];
