// Survival mode tick logic: events, health, obstacles, overlays, abilities.

import type { WorldState } from '../engine/WorldState';
import type { AutoDifficulty } from '../ui/autoDifficulty';
import { Entity, vec2, vec2Dist, vec2DistWrapped } from '../engine/Entity';
import { saveSurvivalBestIfBetter, type SurvivalBestRecord } from './survivalScore';

const DEFAULT_GOAL_SEEK_STRENGTH = 0.5;

const PLAYER_ACCEL = 340;
const SHIELD_MS = 5000;
const SHIELD_CD_MS = 120_000;
const DASH_MS = 3000;
const DASH_CD_MS = 60_000;
const REP_ABILITY_COOLDOWN_YEARS = 6;
const GAME_YEAR_REAL_MS = 60_000;
const REP_ABILITY_COOLDOWN_MS = REP_ABILITY_COOLDOWN_YEARS * GAME_YEAR_REAL_MS;
const EAT_CD_MS = 3000;
const ATTRACT_DAMAGE_RADIUS = 250;
const COLLISION_R = 20;
const VICTORY_AGENTS = 50;

export interface ShadowStone {
  wx: number;
  wy: number;
  t01: number;
  shadowSec: number;
}

export interface FallingStoneFx {
  wx: number;
  wy: number;
  progress: number;
  fallDur: number;
}

export interface SurvivalRuntimeSaveState {
  gameYear: number;
  playerAgentId: string | null;
  shieldCooldownRemainingMs: number;
  dashCooldownRemainingMs: number;
  repCooldownRemainingMs: number;
  claimedMissionIds: string[];
  runChallengeLog: Array<{ missionId: string; rank: string; score: number }>;
  runElapsedSec: number;
}

export class SurvivalRuntime {
  difficulty: AutoDifficulty;
  private world: WorldState;
  private worldW: number;
  private worldH: number;

  gameYear = 0;
  playerAgentId: string | null = null;
  keys = { w: false, a: false, s: false, d: false };

  shadows: ShadowStone[] = [];
  falling: FallingStoneFx[] = [];

  private lastShieldUseGameYear = -1e9;
  private shieldEndReal = 0;

  private lastDashUseGameYear = -1e9;
  dashEndReal = 0;

  private lastRepAbilityGameYear = -1e9;
  private victoryShown = false;
  private defeatShown = false;

  private vortexEventUntilReal = 0;
  private storedGoalSeekStrength: number | null = null;

  /** Next survival random event when `gameYear` reaches this (game-time, scales with sim speed). */
  private nextRandomEventGameYear = 0;

  plagueEndGameYear = 0;

  runStartReal: number | null = null;
  peakAgents = 0;
  runChallengeLog: Array<{ missionId: string; rank: string; score: number }> = [];
  private claimedMissionIds = new Set<string>();
  private runActive = false;

  constructor(
    world: WorldState,
    difficulty: AutoDifficulty,
    worldW: number,
    worldH: number,
  ) {
    this.world = world;
    this.difficulty = difficulty;
    this.worldW = worldW;
    this.worldH = worldH;
    this.scheduleNextEvent();
  }

  private scheduleNextEvent(): void {
    // Spaced in game years so real-world frequency scales with sim speed (1 game year ≈ 1 min at 1×).
    // Former real-time targets: easy ~45–100s → 0.75–1.67y, medium 35–75s, hard 25–55s.
    let minY = 45 / 60;
    let maxY = 100 / 60;
    if (this.difficulty === 'medium') {
      minY = 35 / 60;
      maxY = 75 / 60;
    } else if (this.difficulty === 'hard') {
      minY = 25 / 60;
      maxY = 55 / 60;
    }
    this.nextRandomEventGameYear = this.gameYear + minY + Math.random() * (maxY - minY);
  }

  /** Full reset on simulation toolbar reset */
  resetSession(): void {
    this.gameYear = 0;
    this.playerAgentId = null;
    this.keys = { w: false, a: false, s: false, d: false };
    this.shadows = [];
    this.falling = [];
    this.lastShieldUseGameYear = -1e9;
    this.shieldEndReal = 0;
    this.lastDashUseGameYear = -1e9;
    this.dashEndReal = 0;
    this.lastRepAbilityGameYear = -1e9;
    this.victoryShown = false;
    this.defeatShown = false;
    this.vortexEventUntilReal = 0;
    this.storedGoalSeekStrength = null;
    this.plagueEndGameYear = 0;
    this.runStartReal = null;
    this.peakAgents = 0;
    this.runChallengeLog = [];
    this.claimedMissionIds.clear();
    this.runActive = false;
    this.scheduleNextEvent();
    const r = this.world.getRule('auto-attraction');
    if (r) r.strength = DEFAULT_GOAL_SEEK_STRENGTH;
  }

  private beginRunIfNeeded(): void {
    if (this.runActive) return;
    this.runStartReal = performance.now();
    this.peakAgents = 0;
    this.runChallengeLog = [];
    this.runActive = true;
  }

  setPlayerAgent(id: string | null): void {
    const prev = this.playerAgentId;
    if (prev && prev !== id) {
      const e = this.world.getEntity(prev);
      if (e) {
        delete e.meta.playerControlled;
        // Do not store Set in meta (breaks JSON save/load); if needed,
        // store an array of rule ids instead.
        delete e.meta.disabledRules;
        delete e.meta.survivalDashUntilReal;
        delete e.meta.survivalBaseMaxSpeed;
      }
    }
    this.playerAgentId = id;
    if (!id) return;
    const e = this.world.getEntity(id);
    if (!e || e.type !== 'agent') return;
    // Infected amoeba cannot be taken under player control until recovery.
    if (this.isPlagueInfected(e)) {
      this.playerAgentId = null;
      return;
    }
    e.meta.playerControlled = true;
    e.meta.survival = true;
    e.meta.survivalBaseMaxSpeed = e.maxSpeed;
    // Drop any previous AI/plague momentum when control is transferred to player.
    e.velocity.x = 0;
    e.velocity.y = 0;
    // Player-controlled amoeba should NOT move autonomously.
    // Disable all autonomous steering rules while player controls the amoeba.
    e.meta.disabledRules = [
      'auto-flocking',
      'auto-hunger-seek',
      'auto-repulsion',
      // Keep auto-replication enabled so the player can mate when in range (handler skips auto-chase for WASD).
    ];
    this.beginRunIfNeeded();
  }

  isPlagueInfected(e: Entity): boolean {
    return e.meta.survivalPlague === true;
  }

  shieldActive(): boolean {
    return performance.now() < this.shieldEndReal;
  }

  tryShield(): boolean {
    const now = performance.now();
    const simSpeed = this.world.config.simSpeed ?? 1;
    const shieldCdYears = SHIELD_CD_MS / GAME_YEAR_REAL_MS;
    if (this.gameYear - this.lastShieldUseGameYear < shieldCdYears) return false;
    if (!this.playerAgentId) return false;
    this.lastShieldUseGameYear = this.gameYear;
    this.shieldEndReal = now + SHIELD_MS / simSpeed;
    const p = this.world.getEntity(this.playerAgentId);
    if (p) this.world.events.emit('survival:ability', { kind: 'shield', entityId: p.id }, this.world.tick);
    return true;
  }

  tryDash(): boolean {
    const now = performance.now();
    const simSpeed = this.world.config.simSpeed ?? 1;
    const dashCdYears = DASH_CD_MS / GAME_YEAR_REAL_MS;
    if (this.gameYear - this.lastDashUseGameYear < dashCdYears) return false;
    if (!this.playerAgentId) return false;
    this.lastDashUseGameYear = this.gameYear;
    this.dashEndReal = now + DASH_MS / simSpeed;
    const p = this.world.getEntity(this.playerAgentId);
    if (p) this.world.events.emit('survival:ability', { kind: 'dash', entityId: p.id }, this.world.tick);
    return true;
  }

  tryReproductionAbility(): boolean {
    if (!this.playerAgentId) return false;
    if (this.gameYear - this.lastRepAbilityGameYear < REP_ABILITY_COOLDOWN_YEARS) return false;
    this.lastRepAbilityGameYear = this.gameYear;
    // Clear per-entity reproduction cooldowns for all amoeba (including NPCs)
    for (const a of this.world.getByType('agent')) {
      if (a.isDead()) continue;
      a.meta.lastReplicated = -Infinity;
      a.meta.lastReplicatedAgeYears = -Infinity;
    }
    const p = this.world.getEntity(this.playerAgentId);
    if (p) this.world.events.emit('survival:ability', { kind: 'reproduction', entityId: p.id }, this.world.tick);
    return true;
  }

  reproductionAbilityReady(): boolean {
    return this.gameYear - this.lastRepAbilityGameYear >= REP_ABILITY_COOLDOWN_YEARS;
  }

  eatCooldownRemainingMs(entity: Entity): number {
    const until = entity.meta.survivalEatCooldownUntilReal as number | undefined;
    if (!until) return 0;
    return Math.max(0, until - performance.now());
  }

  shieldCooldownRemainingMs(): number {
    const shieldCdYears = SHIELD_CD_MS / GAME_YEAR_REAL_MS;
    const remYears = Math.max(0, shieldCdYears - (this.gameYear - this.lastShieldUseGameYear));
    return remYears * GAME_YEAR_REAL_MS;
  }

  dashCooldownRemainingMs(): number {
    const dashCdYears = DASH_CD_MS / GAME_YEAR_REAL_MS;
    const remYears = Math.max(0, dashCdYears - (this.gameYear - this.lastDashUseGameYear));
    return remYears * GAME_YEAR_REAL_MS;
  }

  repAbilityCooldownRemainingYears(): number {
    return Math.max(0, REP_ABILITY_COOLDOWN_YEARS - (this.gameYear - this.lastRepAbilityGameYear));
  }

  repAbilityCooldownRemainingMs(): number {
    const elapsedYears = this.gameYear - this.lastRepAbilityGameYear;
    const elapsedMs = elapsedYears * GAME_YEAR_REAL_MS;
    return Math.max(0, REP_ABILITY_COOLDOWN_MS - elapsedMs);
  }

  recordChallenge(rank: string, missionId: string, score: number): void {
    this.runChallengeLog.push({ missionId, rank, score });
  }

  hasMissionReward(missionId: string): boolean {
    return this.claimedMissionIds.has(missionId);
  }

  markMissionReward(missionId: string): void {
    this.claimedMissionIds.add(missionId);
  }

  buildSaveState(): SurvivalRuntimeSaveState {
    return {
      gameYear: this.gameYear,
      playerAgentId: this.playerAgentId,
      shieldCooldownRemainingMs: this.shieldCooldownRemainingMs(),
      dashCooldownRemainingMs: this.dashCooldownRemainingMs(),
      repCooldownRemainingMs: this.repAbilityCooldownRemainingMs(),
      claimedMissionIds: Array.from(this.claimedMissionIds),
      runChallengeLog: [...this.runChallengeLog],
      runElapsedSec: this.runStartReal == null ? 0 : Math.max(0, (performance.now() - this.runStartReal) / 1000),
    };
  }

  buildBestRecordCandidate(currentAgents: number): Omit<SurvivalBestRecord, 'savedAt'> | null {
    if (this.runStartReal == null) return null;
    const survivedSec = (performance.now() - this.runStartReal) / 1000;
    const peakAgents = Math.max(this.peakAgents, currentAgents);
    return {
      survivedSec,
      peakAgents,
      challenges: [...this.runChallengeLog],
      difficulty: this.difficulty,
    };
  }

  applySaveState(state: SurvivalRuntimeSaveState): void {
    this.gameYear = Number.isFinite(state.gameYear) ? state.gameYear : this.gameYear;
    const now = performance.now();

    const shRem = Math.max(0, state.shieldCooldownRemainingMs || 0);
    const dashRem = Math.max(0, state.dashCooldownRemainingMs || 0);
    const repRemMs = Math.max(0, state.repCooldownRemainingMs || 0);

    const shieldCdYears = SHIELD_CD_MS / GAME_YEAR_REAL_MS;
    const dashCdYears = DASH_CD_MS / GAME_YEAR_REAL_MS;
    this.lastShieldUseGameYear = this.gameYear - (shieldCdYears - shRem / GAME_YEAR_REAL_MS);
    this.lastDashUseGameYear = this.gameYear - (dashCdYears - dashRem / GAME_YEAR_REAL_MS);
    const repRemYears = repRemMs / GAME_YEAR_REAL_MS;
    this.lastRepAbilityGameYear = this.gameYear - (REP_ABILITY_COOLDOWN_YEARS - repRemYears);
    this.claimedMissionIds = new Set(Array.isArray(state.claimedMissionIds) ? state.claimedMissionIds : []);
    this.runChallengeLog = Array.isArray(state.runChallengeLog) ? [...state.runChallengeLog] : [];
    this.runStartReal = now - Math.max(0, (state.runElapsedSec || 0) * 1000);
    this.runActive = true;

    if (state.playerAgentId) {
      this.setPlayerAgent(state.playerAgentId);
    }
    this.scheduleNextEvent();
  }

  beforeIntegrate(dt: number): void {
    const pid = this.playerAgentId;
    if (!pid) return;
    const p = this.world.getEntity(pid);
    if (!p || p.isDead()) return;

    const k = this.keys;
    let ix = 0;
    let iy = 0;
    if (k.w) iy -= 1;
    if (k.s) iy += 1;
    if (k.a) ix -= 1;
    if (k.d) ix += 1;
    const now = performance.now();
    const shieldOn = now < this.shieldEndReal;
    const dashOn = now < this.dashEndReal;
    const accelMult = dashOn ? 2 : 1;
    if ((ix !== 0 || iy !== 0) && !p.stalled) {
      const len = Math.hypot(ix, iy);
      p.applyForce({ x: (ix / len) * PLAYER_ACCEL * accelMult, y: (iy / len) * PLAYER_ACCEL * accelMult });
    }
    const base = (p.meta.survivalBaseMaxSpeed as number) ?? 200;
    p.maxSpeed = dashOn ? base * 2 : base;
    if (dashOn) {
      p.meta.survivalDashUntilReal = this.dashEndReal;
    } else {
      delete p.meta.survivalDashUntilReal;
    }
    if (shieldOn) {
      p.meta.survivalShieldUntilReal = this.shieldEndReal;
    } else {
      delete p.meta.survivalShieldUntilReal;
    }
  }

  beforePurge(dt: number): void {
    this.gameYear += dt / 60;

    const diff = this.difficulty;
    const dScale = diff === 'easy' ? 0.75 : diff === 'medium' ? 1 : 1.35;

    const alive = this.world.getAlive().filter(e => e.type === 'agent');
    this.peakAgents = Math.max(this.peakAgents, alive.length);

    const survivalAlive = alive.filter(a => a.meta.survival === true);
    const survivalCount = survivalAlive.length;

    if (
      !this.victoryShown &&
      !this.defeatShown &&
      this.runStartReal != null &&
      survivalCount < 2
    ) {
      this.defeatShown = true;
      if (this.runActive) this.finalizeRun();
      this.world.events.emit('survival:defeat', { agents: survivalCount }, this.world.tick);
    }

    if (!this.victoryShown && alive.length >= VICTORY_AGENTS) {
      this.victoryShown = true;
      this.world.events.emit('survival:victory', { agents: alive.length }, this.world.tick);
    }

    for (const a of alive) {
      if (a.meta.survival !== true) continue;

      let hp = a.health;

      if (a.hunger <= 0) {
        hp -= 14 * dScale * dt;
      } else if (hp < 100) {
        const reg = diff === 'easy' ? 3.5 : diff === 'medium' ? 2.2 : 1.1;
        const slow = a.hunger < 35 ? 0.45 : 1;
        hp += reg * slow * dt;
      }

      const attractors = this.world.getByType('attractor');
      const W = this.world.config.width;
      const H = this.world.config.height;
      const useWrap = this.world.config.boundary === 'wrap';
      for (const at of attractors) {
        const d = useWrap ? vec2DistWrapped(a.position, at.position, W, H) : vec2Dist(a.position, at.position);
        if (d >= ATTRACT_DAMAGE_RADIUS) continue;
        const t = 1 - d / ATTRACT_DAMAGE_RADIUS;
        hp -= 8 * t * t * dScale * dt;
      }

      if (a.meta.survivalPlague === true && this.gameYear < this.plagueEndGameYear) {
        if (a.hunger < 50) {
          a.hunger = Math.min(200, a.hunger + 18 * dt);
        }
      }

      a.health = Math.max(0, Math.min(100, hp));
    }

    if (this.plagueEndGameYear > 0 && this.gameYear >= this.plagueEndGameYear) {
      for (const a of this.world.getByType('agent')) {
        const baseMax = a.meta.survivalPlagueBaseMaxSpeed as number | undefined;
        const baseMass = a.meta.survivalPlagueBaseMass as number | undefined;
        const baseEnergy = a.meta.survivalPlagueBaseEnergy as number | undefined;
        if (baseMax !== undefined) a.maxSpeed = baseMax;
        if (baseMass !== undefined) a.mass = baseMass;
        if (baseEnergy !== undefined) a.energy = baseEnergy;
        delete a.meta.survivalPlagueBaseMaxSpeed;
        delete a.meta.survivalPlagueBaseMass;
        delete a.meta.survivalPlagueBaseEnergy;
        delete a.meta.survivalPlague;
      }
      this.plagueEndGameYear = 0;
    }

    const now = performance.now();
    const shieldOn = now < this.shieldEndReal;

    for (let i = this.shadows.length - 1; i >= 0; i--) {
      const sh = this.shadows[i];
      sh.t01 += dt / sh.shadowSec;
      if (sh.t01 >= 1) {
        this.spawnRockAt(sh.wx, sh.wy);
        this.shadows.splice(i, 1);
      }
    }

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.progress += dt / f.fallDur;
      if (f.progress >= 1) this.falling.splice(i, 1);
    }

    const obstacles = this.world.getByType('obstacle');
    for (const obs of obstacles) {
      for (const a of alive) {
        if (vec2Dist(a.position, obs.position) < COLLISION_R) {
          const rockDmg = diff === 'easy' ? 50 : diff === 'medium' ? 70 : 80;
          const isPlayer = a.id === this.playerAgentId;
          if (isPlayer && shieldOn) {
            this.shieldEndReal = 0;
            this.world.events.emit('survival:shield-block', { entityId: a.id }, this.world.tick);
          } else {
            a.health = Math.max(0, a.health - rockDmg);
          }
          this.world.removeEntity(obs.id);
          break;
        }
      }
    }

    if (this.gameYear >= this.nextRandomEventGameYear) {
      this.triggerRandomEvent();
      this.scheduleNextEvent();
    }

    if (now > this.vortexEventUntilReal) {
      const r = this.world.getRule('auto-attraction');
      if (r && this.storedGoalSeekStrength != null) {
        r.strength = this.storedGoalSeekStrength;
        this.storedGoalSeekStrength = null;
      }
    }

    if (this.gameYear < this.plagueEndGameYear) {
      const plagueAgents = alive.filter(
        a => a.meta.survivalPlague === true && a.id !== this.playerAgentId,
      );
      for (const a of plagueAgents) {
        this.applyPlagueMutation(a);
      }
    }

    const pl = this.playerAgentId ? this.world.getEntity(this.playerAgentId) : null;
    if (this.runActive && pl && pl.isDead()) {
      this.finalizeRun();
    }
  }

  private applyPlagueMutation(a: Entity): void {
    // Temporary "crazy" behavior: stats and movement fluctuate while infected.
    // All baseline stats are restored in recovery block above.
    const baseMax = Number(a.meta.survivalPlagueBaseMaxSpeed ?? a.maxSpeed);
    const baseMass = Number(a.meta.survivalPlagueBaseMass ?? a.mass);
    const baseEnergy = Number(a.meta.survivalPlagueBaseEnergy ?? a.energy);
    const t = performance.now() * 0.008 + (a.id.length % 17) * 0.33;
    const pulseA = Math.sin(t);
    const pulseB = Math.cos(t * 1.7);
    const rand = () => Math.random() * 2 - 1;

    a.maxSpeed = Math.max(20, baseMax * (1 + 0.55 * pulseA + 0.18 * rand()));
    a.mass = Math.max(0.2, baseMass * (1 + 0.40 * pulseB + 0.12 * rand()));
    a.energy = Math.max(5, Math.min(300, baseEnergy * (1 + 0.45 * pulseA - 0.20 * pulseB + 0.10 * rand())));
    a.velocity.x += rand() * 18;
    a.velocity.y += rand() * 18;
  }

  private triggerRandomEvent(): void {
    const picks = ['rockfall', 'vortex', 'plague'] as const;
    const which = picks[(Math.random() * 3) | 0];
    if (which === 'rockfall') this.startRockfall(true);
    else if (which === 'vortex') this.startVortex(true);
    else this.startPlague(true);
  }

  private shadowDurationSec(): number {
    return this.difficulty === 'easy' ? 10 : this.difficulty === 'medium' ? 5 : 2;
  }

  private startRockfall(emitBanner = true): void {
    if (emitBanner) this.world.events.emit('survival:event', { name: 'Rockfall' }, this.world.tick);
    const sec = this.shadowDurationSec();
    const count = this.difficulty === 'easy' ? 3 : this.difficulty === 'medium' ? 5 : 8;
    const stagger = 0.55;
    for (let i = 0; i < count; i++) {
      this.shadows.push({
        wx: 50 + Math.random() * (this.worldW - 100),
        wy: 50 + Math.random() * (this.worldH - 100),
        t01: -Math.min(0.85, i * stagger / sec),
        shadowSec: sec,
      });
    }
  }

  private spawnRockAt(wx: number, wy: number): void {
    this.world.addEntity(
      new Entity({
        type: 'obstacle',
        position: vec2(wx, wy),
        velocity: vec2(0, 0),
        energy: 100,
        mass: 10,
        maxSpeed: 0,
      }),
    );
    this.falling.push({ wx, wy, progress: 0, fallDur: 0.4 });
  }

  private startVortex(emitBanner = true): void {
    if (emitBanner) this.world.events.emit('survival:event', { name: 'Vortex surge' }, this.world.tick);
    const r = this.world.getRule('auto-attraction');
    if (!r) return;
    if (this.storedGoalSeekStrength === null) {
      this.storedGoalSeekStrength = r.strength;
    }
    r.strength = (this.storedGoalSeekStrength ?? 0.5) * 1.65;
    const simSpeed = this.world.config.simSpeed ?? 1;
    this.vortexEventUntilReal = performance.now() + 28_000 / simSpeed;
  }

  private startPlague(emitBanner = true): void {
    if (emitBanner) this.world.events.emit('survival:event', { name: 'Plague' }, this.world.tick);
    const pct = this.difficulty === 'easy' ? 0.3 : this.difficulty === 'medium' ? 0.5 : 0.8;
    const agents = this.world
      .getByType('agent')
      .filter(a => !a.isDead() && a.id !== this.playerAgentId && !this.isPlagueInfected(a));
    const n = Math.max(0, Math.floor(agents.length * pct));
    const shuffled = [...agents].sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const a = shuffled[i];
      a.meta.survivalPlague = true;
      if (a.meta.survivalPlagueBaseMaxSpeed === undefined) a.meta.survivalPlagueBaseMaxSpeed = a.maxSpeed;
      if (a.meta.survivalPlagueBaseMass === undefined) a.meta.survivalPlagueBaseMass = a.mass;
      if (a.meta.survivalPlagueBaseEnergy === undefined) a.meta.survivalPlagueBaseEnergy = a.energy;
    }
    this.plagueEndGameYear = this.gameYear + 6;
  }

  private finalizeRun(): void {
    this.runActive = false;
    const rec = this.buildBestRecordCandidate(this.world.getByType('agent').length);
    if (rec) saveSurvivalBestIfBetter(rec);
    this.playerAgentId = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, scaleX: number, scaleY: number): void {
    const now = performance.now();
    const stormOn = now < this.vortexEventUntilReal;

    if (stormOn) {
      // Vortex storm visual amplification: rotating shock rings around attractors.
      const attractors = this.world.getByType('attractor');
      const avgScale = (scaleX + scaleY) * 0.5;
      for (const a of attractors) {
        const cx = a.position.x * scaleX;
        const cy = a.position.y * scaleY;
        const base = 90 * avgScale;
        const phase = now * 0.006;
        for (let i = 0; i < 3; i++) {
          const t = (phase + i * 0.33) % 1;
          const rr = base * (0.75 + t * 1.2);
          const alpha = 0.32 * (1 - t);
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0,245,255,${alpha.toFixed(3)})`;
          ctx.lineWidth = 2.2 - t * 1.1;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    for (const sh of this.shadows) {
      const p = Math.max(0, Math.min(1, sh.t01));
      const cx = sh.wx * scaleX;
      const cy = sh.wy * scaleY;
      // Shadow grows up to rock size, not larger.
      const rockR = COLLISION_R * ((scaleX + scaleY) * 0.5);
      const r = rockR * (0.45 + p * 0.55);
      ctx.save();
      ctx.globalAlpha = 0.15 + p * 0.35;
      ctx.fillStyle = '#101018';
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,45,120,0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    for (const f of this.falling) {
      const drop = (1 - f.progress) * 55 * scaleY;
      const cx = f.wx * scaleX;
      const cy = f.wy * scaleY - drop;
      const s = 6 + f.progress * 7;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(180,180,200,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
