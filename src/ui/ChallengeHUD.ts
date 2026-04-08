// ─────────────────────────────────────────────
//  Vortexia — Challenge HUD
// ─────────────────────────────────────────────
//
//  Overlaid on the canvas during an active mission.
//  Shows:
//    - Mission title + objective
//    - Circular progress ring (SVG)
//    - Hold timer bar (fills as condition holds)
//    - Countdown timer (time remaining)
//    - Live stat counters (deaths, reps, collisions)
//    - SUCCESS / FAILED splash with score breakdown + rank badge
//
//  Wires to world.events:
//    'challenge:start'   → show HUD
//    'challenge:tick'    → update progress/timer
//    'challenge:success' → show success splash
//    'challenge:failed'  → show fail splash
// ─────────────────────────────────────────────

import type { WorldState }                from '../engine/WorldState';
import type { SimEvent }                  from '../engine/types';
import type { ChallengeContext, ScoreBreakdown } from '../challenge/ChallengeTypes';
import type { Mission }                   from '../challenge/ChallengeTypes';
import { ALL_MISSIONS }                   from '../challenge/missions';

// ─── ChallengeHUD ────────────────────────────

export class ChallengeHUD {
  private container: HTMLElement;
  private world:     WorldState;
  private el:        HTMLElement;
  private _unsubs:   Array<() => void> = [];
  private currentSplash: HTMLElement | null = null;

  constructor(container: HTMLElement, world: WorldState) {
    this.container = container;
    this.world     = world;
    this.el        = this._buildShell();
    container.appendChild(this.el);
    this._wireEvents();
  }

  // ─── Shell ────────────────────────────────

  private _buildShell(): HTMLElement {
    const el = document.createElement('div');
    el.id        = 'challenge-hud';
    el.className = 'challenge-hud challenge-hud--hidden';
    el.innerHTML = `
      <div class="chud-mission-bar">
        <span class="chud-icon" id="chud-icon">⚖</span>
        <div class="chud-mission-info">
          <span class="chud-title" id="chud-title">MISSION</span>
          <span class="chud-objective" id="chud-objective">Objective text</span>
        </div>
        <div class="chud-timer-wrap">
          <span class="chud-timer-label">TIME</span>
          <span class="chud-timer" id="chud-timer">0:00</span>
        </div>
        <button class="chud-abort" id="chud-abort" title="Abort mission">✕</button>
      </div>

      <div class="chud-progress-row">
        <div class="chud-progress-track">
          <div class="chud-progress-fill" id="chud-progress-fill" style="width:0%"></div>
          <div class="chud-hold-fill" id="chud-hold-fill" style="width:0%"></div>
        </div>
        <span class="chud-progress-pct" id="chud-progress-pct">0%</span>
      </div>

      <div class="chud-stats-row" id="chud-stats-row">
        <span class="chud-stat"><span class="chud-stat-icon">💀</span><span id="chud-deaths">0</span></span>
        <span class="chud-stat"><span class="chud-stat-icon">⚡</span><span id="chud-reps">0</span></span>
        <span class="chud-stat"><span class="chud-stat-icon">💥</span><span id="chud-colls">0</span></span>
      </div>

      <div class="chud-splash" id="chud-splash" style="display:none"></div>
    `;
    return el;
  }

  // ─── Event wiring ─────────────────────────

  private _wireEvents(): void {
    const { world } = this;

    const onStart = (e: SimEvent<{ missionId: string }>) => {
      const mission = ALL_MISSIONS.find(m => m.id === e.data.missionId);
      if (mission) {
        this._show(mission);
        return;
      }
      // Allow tutorial / custom missions not listed in ALL_MISSIONS.
      this._show({
        id: e.data.missionId,
        title: 'TRAINING',
        subtitle: 'Tutorial mission',
        description: '',
        objective: 'Complete the tutorial objective',
        icon: '🎯',
        color: '#FFD700',
        timeLimitSec: 60,
        holdSec: 0,
        maxScore: 1000,
        requiredRules: [],
        condition: () => 0,
        success: () => false,
        failure: () => false,
        score: () => ({ base: 0, timeBonus: 0, efficiency: 0, total: 0 }),
      } as Mission);
    };

    const onTick = (e: SimEvent<{ missionId: string; progress: number; ctx: ChallengeContext }>) => {
      this._update(e.data.progress, e.data.ctx);
    };

    const onSuccess = (e: SimEvent<{ missionId: string; score: ScoreBreakdown; rank: string; ctx: ChallengeContext }>) => {
      this._showSplash('success', e.data.score, e.data.rank as any, e.data.ctx);
    };

    const onFailed = (e: SimEvent<{ missionId: string; reason: string; ctx: ChallengeContext }>) => {
      this._showSplash('failed', null, null, e.data.ctx, e.data.reason);
    };

    world.events.on('challenge:start',   onStart   as (e: SimEvent<unknown>) => void);
    world.events.on('challenge:tick',    onTick    as (e: SimEvent<unknown>) => void);
    world.events.on('challenge:success', onSuccess as (e: SimEvent<unknown>) => void);
    world.events.on('challenge:failed',  onFailed  as (e: SimEvent<unknown>) => void);

    this._unsubs.push(
      () => world.events.off('challenge:start',   onStart   as (e: SimEvent<unknown>) => void),
      () => world.events.off('challenge:tick',    onTick    as (e: SimEvent<unknown>) => void),
      () => world.events.off('challenge:success', onSuccess as (e: SimEvent<unknown>) => void),
      () => world.events.off('challenge:failed',  onFailed  as (e: SimEvent<unknown>) => void),
    );
  }

  // ─── Show / hide ──────────────────────────

  private _show(mission: Mission): void {
    if (this.currentSplash) {
      this.currentSplash.remove();
      this.currentSplash = null;
    }
    this.el.classList.remove('challenge-hud--hidden');
    this.el.style.setProperty('--mission-color', mission.color);

    const icon      = this.el.querySelector<HTMLElement>('#chud-icon')!;
    const title     = this.el.querySelector<HTMLElement>('#chud-title')!;
    const objective = this.el.querySelector<HTMLElement>('#chud-objective')!;
    const splash    = this.el.querySelector<HTMLElement>('#chud-splash')!;
    const timerWrap = this.el.querySelector<HTMLElement>('.chud-timer-wrap')!;

    icon.textContent      = mission.icon;
    title.textContent     = mission.title;
    objective.textContent = mission.objective;
    splash.style.display  = 'none';

    // Tutorial missions can opt out of timer display.
    if (mission.id === 'tutorial_kill2') {
      timerWrap.style.display = 'none';
    } else {
      timerWrap.style.display = '';
    }

    // Reset progress
    this._setProgress(0);
    this._setTimer(mission.timeLimitSec);

    // Abort button
    const abortBtn = this.el.querySelector<HTMLButtonElement>('#chud-abort')!;
    abortBtn.onclick = () => {
      this.world.events.emit('challenge:abort', {}, this.world.tick);
    };
  }

  hide(): void {
    this.el.classList.add('challenge-hud--hidden');
    if (this.currentSplash) {
      this.currentSplash.remove();
      this.currentSplash = null;
    }
  }

  // ─── Live update ──────────────────────────

  private _update(progress: number, ctx: ChallengeContext): void {
    this._setProgress(progress);

    // Timer
    const secsLeft = Math.max(0, Math.ceil((ctx.timeLimitTicks - ctx.elapsedTicks) / 60));
    this._setTimer(secsLeft);

    // Stats
    const deaths = this.el.querySelector<HTMLElement>('#chud-deaths')!;
    const reps   = this.el.querySelector<HTMLElement>('#chud-reps')!;
    const colls  = this.el.querySelector<HTMLElement>('#chud-colls')!;
    deaths.textContent = String(ctx.deathCount);
    reps.textContent   = String(ctx.replicationCount);
    colls.textContent  = String(ctx.collisionCount);

    // Hold bar
    const holdFill = this.el.querySelector<HTMLElement>('#chud-hold-fill')!;
    if (ctx.holdRequiredTicks > 0) {
      holdFill.style.width = `${Math.min(100, (ctx.holdTicks / ctx.holdRequiredTicks) * 100)}%`;
    }

    // Flash timer red when < 10s
    const timer = this.el.querySelector<HTMLElement>('#chud-timer')!;
    if (secsLeft <= 10) {
      timer.classList.add('chud-timer--urgent');
    } else {
      timer.classList.remove('chud-timer--urgent');
    }
  }

  private _setProgress(p: number): void {
    const fill = this.el.querySelector<HTMLElement>('#chud-progress-fill')!;
    const pct  = this.el.querySelector<HTMLElement>('#chud-progress-pct')!;
    fill.style.width    = `${Math.round(p * 100)}%`;
    pct.textContent     = `${Math.round(p * 100)}%`;
  }

  private _setTimer(secs: number): void {
    const timer = this.el.querySelector<HTMLElement>('#chud-timer')!;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  // ─── Splash screen ────────────────────────

  private _showSplash(
    outcome: 'success' | 'failed',
    score:   ScoreBreakdown | null,
    rank:    'S' | 'A' | 'B' | 'C' | null,
    ctx:     ChallengeContext,
    reason?: string,
  ): void {
    if (this.currentSplash) {
      this.currentSplash.remove();
      this.currentSplash = null;
    }

    const splash = document.createElement('div');
    splash.className = 'chud-splash';
    splash.style.display = 'flex';

    if (outcome === 'success' && score) {
      const rankColors: Record<string, string> = { S: '#FFD700', A: '#39FF14', B: '#00F5FF', C: '#BF5FFF' };
      const rankColor = rankColors[rank ?? 'C'] ?? '#888';

      splash.innerHTML = `
        <div class="chud-splash-inner chud-splash--success">
          <div class="chud-splash-rank" style="color:${rankColor};border-color:${rankColor}">${rank}</div>
          <div class="chud-splash-title">MISSION COMPLETE</div>
          <div class="chud-score-breakdown">
            <div class="chud-score-row"><span>Base</span><span>+${score.base}</span></div>
            <div class="chud-score-row"><span>Time Bonus</span><span>+${score.timeBonus}</span></div>
            <div class="chud-score-row"><span>Efficiency</span><span>+${score.efficiency}</span></div>
            <div class="chud-score-total"><span>TOTAL</span><span>${score.total}</span></div>
          </div>
          <button class="chud-splash-btn" id="chud-splash-close">Continue →</button>
        </div>
      `;
    } else {
      splash.innerHTML = `
        <div class="chud-splash-inner chud-splash--failed">
          <div class="chud-splash-fail-icon">✕</div>
          <div class="chud-splash-title">MISSION FAILED</div>
          <div class="chud-splash-reason">${reason ?? 'Conditions not met'}</div>
          <div class="chud-splash-stats">
            <span>Deaths: ${ctx.deathCount}</span>
            <span>Reps: ${ctx.replicationCount}</span>
            <span>Time: ${Math.floor(ctx.elapsedTicks / 60)}s</span>
          </div>
          <button class="chud-splash-btn" id="chud-splash-close">Try Again</button>
        </div>
      `;
    }

    splash.querySelector('#chud-splash-close')?.addEventListener('click', () => {
      this.hide();
      this.world.events.emit('challenge:close', {}, this.world.tick);
    });

    document.body.appendChild(splash);
    this.currentSplash = splash;
  }

  destroy(): void {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    this.el.remove();
  }
}