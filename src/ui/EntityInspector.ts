// src/ui/EntityInspector.ts

// ─────────────────────────────────────────────
//  Vortexia — Entity Inspector
// ─────────────────────────────────────────────
//
//  Right panel. Shows live data for the selected entity.
//  Updates every animation frame via tick().
//
//  Sections:
//    - Header: ID, type badge, state
//    - Physics: position, velocity magnitude, age (amoeba only)
//    - Energy bar (animated fill)
//    - Hunger bar (only for agents)
//    - Meta: any custom meta keys
// ─────────────────────────────────────────────

import type { Entity }     from '../engine/Entity';
import { vec2Len }         from '../engine/Entity';
import { UIState }         from './UIState';
import { entityTypeLabel } from './entityDisplay';
import type { SurvivalRuntime } from '../survival/SurvivalRuntime';

const REPRODUCTION_AGE_COOLDOWN_YEARS = 2;

export interface EntityInspectorContext {
  appMode: 'manual' | 'auto' | 'survival';
  survival: SurvivalRuntime | null;
}

// ─── EntityInspector ─────────────────────────

export class EntityInspector {
  private el:       HTMLElement;
  private entity:   Entity | null = null;
  private _unsub:   () => void;
  private ctx:      EntityInspectorContext;
  private activeTab: 'main' | 'other' = 'main';
  private hintUntilReal = 0;
  private hintMessage = '';
  private hintTimer: number | null = null;

  constructor(el: HTMLElement, ctx: EntityInspectorContext) {
    this.el  = el;
    this.ctx = ctx;
    this._render(null);

    // React to selection changes
    this._unsub = UIState.on('selectedEntity', (entity) => {
      this.entity = entity as Entity | null;
      this.activeTab = 'main';
      this._render(this.entity);
    });
  }

  // ─── Tick (called every rAF) ──────────────

  /** Call this every frame to keep live values fresh */
  tick(): void {
    if (!this.entity) return;
    this._updateLive(this.entity);
  }

  // ─── Render ───────────────────────────────

  private _render(entity: Entity | null): void {
    if (!entity) {
      this.el.innerHTML = `
        <div class="inspector-empty">
          <div class="inspector-empty-orb" aria-hidden="true"></div>
          <div class="inspector-empty-icon icon icon--organism" aria-hidden="true"></div>
          <p>Select an entity to inspect</p>
        </div>
      `;
      return;
    }

    const speed = vec2Len(entity.velocity).toFixed(1);
    const energyPct = Math.max(0, Math.min(100, entity.energy));
    const hungerPct = entity.hunger !== undefined ? (entity.hunger / 200) * 100 : 0;
    const surv = this.ctx.appMode === 'survival' && entity.type === 'agent' && entity.meta.survival === true;
    const healthPct = surv ? entity.health : 0;
    const plague = !!(surv && this.ctx.survival && this.ctx.survival.isPlagueInfected(entity));
    const isPlayer = surv && this.ctx.survival?.playerAgentId === entity.id;

    const tabBtn = (id: 'main' | 'other', label: string) => {
      const active = this.activeTab === id;
      return `<button type="button" class="inspector-tab-btn ${active ? 'inspector-tab-btn--active' : ''}" data-tab="${id}">${label}</button>`;
    };

    this.el.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-id">${entity.id}</span>
        <span class="inspector-type-badge inspector-type--${entity.type}">${entityTypeLabel(entity.type)}</span>
        <span class="inspector-state inspector-state--${entity.state}">${entity.state}</span>
      </div>

      <div class="inspector-tabs" style="display:flex;gap:8px;padding:10px 0 4px">
        ${tabBtn('main', 'Main')}
        ${tabBtn('other', 'Other')}
      </div>

      <div class="inspector-tab-pane" id="ins-tab-main" style="${this.activeTab === 'main' ? '' : 'display:none'}">
        <div class="inspector-cards">
          ${entity.type === 'agent' ? `
          <div class="inspector-stat-card">
            <div class="inspector-stat-top">
              <span class="inspector-stat-icon icon icon--hunger" aria-hidden="true"></span>
              <span class="inspector-stat-label">Hunger</span>
              <span class="inspector-stat-mono" id="ins-hunger-val">${entity.hunger?.toFixed(1)}</span>
            </div>
            <div class="inspector-bar">
              <div class="inspector-bar-fill inspector-bar-fill--energy" id="ins-hunger-fill" style="width: ${hungerPct}%"></div>
            </div>
          </div>
          ` : ''}

          ${surv ? `
          <div class="inspector-stat-card">
            <div class="inspector-stat-top">
              <span class="inspector-stat-icon icon icon--energy" aria-hidden="true"></span>
              <span class="inspector-stat-label">Health</span>
              <span class="inspector-stat-mono" id="ins-health-val">${entity.health.toFixed(1)}</span>
            </div>
            <div class="inspector-bar">
              <div class="inspector-bar-fill inspector-bar-fill--hunger" id="ins-health-fill" style="width: ${healthPct}%"></div>
            </div>
          </div>
          ` : ''}

          <div class="inspector-stat-card">
            <div class="inspector-stat-top">
              <span class="inspector-stat-icon icon icon--energy" aria-hidden="true"></span>
              <span class="inspector-stat-label">Energy</span>
              <span class="inspector-stat-mono" id="ins-energy-val">${entity.energy.toFixed(1)}</span>
            </div>
            <div class="inspector-bar">
              <div class="inspector-bar-fill inspector-bar-fill--energy" id="ins-energy-fill" style="width: ${energyPct}%"></div>
            </div>
          </div>
        </div>

        ${surv && entity.type === 'agent' && !isPlayer ? `
        <div class="inspector-survival-actions">
          <button type="button" class="inspector-play-btn" id="ins-play" ${plague ? 'disabled' : ''}>
            ▶ Play as this amoeba
          </button>
          ${plague ? '<p class="inspector-play-hint">Infected amoeba cannot be controlled.</p>' : ''}
        </div>` : ''}

        ${isPlayer ? `
        <div class="inspector-stat-card inspector-abilities">
          <div class="inspector-stat-top">
            <span class="inspector-stat-label">Abilities</span>
          </div>
          <div class="inspector-ability-row">
            <button type="button" class="btn inspector-ab-btn" id="ins-ab-shield" title="Cooldown 2 min real">Shield (1)</button>
            <button type="button" class="btn inspector-ab-btn" id="ins-ab-dash" title="Cooldown 1 min real">Dash (2)</button>
            <button type="button" class="btn inspector-ab-btn" id="ins-ab-rep" title="Every 6 game years (~6 min real, global)">Stimulation of reproduction (3)</button>
          </div>
          <p class="inspector-ability-hint" id="ins-ab-hint"></p>
          <p class="inspector-ability-hint" id="ins-ab-cd"></p>
        </div>` : ''}
      </div>

      <div class="inspector-tab-pane" id="ins-tab-other" style="${this.activeTab === 'other' ? '' : 'display:none'}">
        <div class="inspector-cards">
          <div class="inspector-stat-card">
            <div class="inspector-stat-top">
              <span class="inspector-stat-icon icon icon--dna" aria-hidden="true"></span>
              <span class="inspector-stat-label">Name / Type</span>
            </div>
            <div class="inspector-stat-main">
              <span class="inspector-stat-primary">${entity.id}</span>
              <span class="inspector-stat-secondary">${entityTypeLabel(entity.type)}</span>
            </div>
          </div>

          <div class="inspector-stat-card">
            <div class="inspector-stat-top">
              <span class="inspector-stat-icon icon icon--mass" aria-hidden="true"></span>
              <span class="inspector-stat-label">Mass</span>
              <span class="inspector-stat-mono">${entity.mass.toFixed(2)}</span>
            </div>
          </div>

          <div class="inspector-stat-card">
            <div class="inspector-stat-top">
              <span class="inspector-stat-icon icon icon--velocity" aria-hidden="true"></span>
              <span class="inspector-stat-label">Velocity</span>
              <span class="inspector-stat-mono" id="ins-speed">${speed}</span>
            </div>
            <div class="inspector-row inspector-row--sub">
              <span class="inspector-label inspector-label--meta">Position</span>
              <span class="inspector-val" id="ins-pos">${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}</span>
            </div>
            ${entity.type === 'agent' ? `
            <div class="inspector-row inspector-row--sub">
              <span class="inspector-label inspector-label--meta">Age (years)</span>
              <span class="inspector-val" id="ins-age">${entity.ageYears !== undefined ? entity.ageYears.toFixed(1) : '?'}</span>
            </div>
            ` : ''}
            ${entity.type === 'agent' ? `
            <div class="inspector-row inspector-row--sub">
              <span class="inspector-label inspector-label--meta">Gender</span>
              <span class="inspector-val">${entity.gender === 'male' ? '♂ Male' : '♀ Female'}</span>
            </div>
            ` : ''}
            ${entity.type === 'agent' ? `
            <div class="inspector-row inspector-row--sub">
              <span class="inspector-label inspector-label--meta">Stimulation cooldown</span>
              <span class="inspector-val" id="ins-repro-cd">${this._reproductionCooldownYears(entity).toFixed(1)}y</span>
            </div>
            ` : ''}
          </div>
        </div>
      </div>

      <button class="inspector-deselect" id="ins-deselect">✕ Deselect</button>
    `;

    this.el.querySelector('#ins-deselect')?.addEventListener('click', () => {
      UIState.set('selectedEntity', null);
    });

    this.el.querySelector('#ins-play')?.addEventListener('click', () => {
      if (!plague && this.ctx.survival) {
        this.ctx.survival.setPlayerAgent(entity.id);
        this._render(entity);
      }
    });

    this.el.querySelector('#ins-ab-shield')?.addEventListener('click', () => {
      if (this.ctx.survival?.tryShield()) {
        // Live hint is shown while shield is actually active.
      } else {
        this._flashAbilityHint('Shield on cooldown');
      }
    });
    this.el.querySelector('#ins-ab-dash')?.addEventListener('click', () => {
      if (this.ctx.survival?.tryDash()) {
        // Live hint is shown while dash is actually active.
      } else {
        this._flashAbilityHint('Dash on cooldown');
      }
    });
    this.el.querySelector('#ins-ab-rep')?.addEventListener('click', () => {
      if (this.ctx.survival?.tryReproductionAbility()) {
        this._flashAbilityHintFor('Stimulation of reproduction activated for all amoeba', 5000);
      } else {
        this._flashAbilityHint('Ability on cooldown (~6 min real)');
      }
    });

    this.el.querySelectorAll<HTMLButtonElement>('.inspector-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = (btn.dataset.tab as 'main' | 'other' | undefined) ?? 'main';
        this.activeTab = tab;
        this._render(entity);
      });
    });
  }

  private _flashAbilityHint(msg: string): void {
    this._flashAbilityHintFor(msg, 1800);
  }

  private _flashAbilityHintFor(msg: string, durationMs: number): void {
    this.hintMessage = msg;
    this.hintUntilReal = performance.now() + durationMs;
    const el = this.el.querySelector('#ins-ab-hint');
    if (el) el.textContent = msg;
    if (this.hintTimer) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hintMessage = '';
      this.hintUntilReal = 0;
      const elNow = this.el.querySelector('#ins-ab-hint');
      if (elNow) elNow.textContent = '';
    }, durationMs);
  }

  private _formatMs(ms: number): string {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
  }

  private _reproductionCooldownYears(entity: Entity): number {
    if (entity.type !== 'agent') return 0;
    const lastAge = entity.meta.lastReplicatedAgeYears as number | undefined;
    if (lastAge === undefined || !Number.isFinite(lastAge)) return 0;
    const elapsed = entity.ageYears - lastAge;
    return Math.max(0, REPRODUCTION_AGE_COOLDOWN_YEARS - elapsed);
  }

  // ─── Live update (hot path) ───────────────

  private _updateLive(entity: Entity): void {
    const pos   = this.el.querySelector<HTMLElement>('#ins-pos');
    const speed = this.el.querySelector<HTMLElement>('#ins-speed');
    const age   = this.el.querySelector<HTMLElement>('#ins-age');
    const fill  = this.el.querySelector<HTMLElement>('#ins-energy-fill');
    const eval_ = this.el.querySelector<HTMLElement>('#ins-energy-val');
    const hungerFill = this.el.querySelector<HTMLElement>('#ins-hunger-fill');
    const hungerVal  = this.el.querySelector<HTMLElement>('#ins-hunger-val');

    if (pos)   pos.textContent   = `${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}`;
    if (speed) speed.textContent = vec2Len(entity.velocity).toFixed(1);
    if (entity.type === 'agent' && age && entity.ageYears !== undefined) {
      age.textContent = entity.ageYears.toFixed(1);
    }

    const pct = Math.max(0, Math.min(100, entity.energy));
    if (fill)  fill.style.width  = `${pct}%`;
    if (eval_) eval_.textContent = entity.energy.toFixed(1);

    if (entity.type === 'agent' && entity.hunger !== undefined) {
      const hungerPct = (entity.hunger / 200) * 100;
      if (hungerFill) hungerFill.style.width = `${hungerPct}%`;
      if (hungerVal) hungerVal.textContent = entity.hunger.toFixed(1);
    }

    const healthFill = this.el.querySelector<HTMLElement>('#ins-health-fill');
    const healthVal  = this.el.querySelector<HTMLElement>('#ins-health-val');
    const reproCdVal = this.el.querySelector<HTMLElement>('#ins-repro-cd');
    if (entity.meta.survival === true && entity.type === 'agent') {
      if (healthFill) healthFill.style.width = `${entity.health}%`;
      if (healthVal) healthVal.textContent = entity.health.toFixed(1);
    }
    if (entity.type === 'agent' && reproCdVal) {
      reproCdVal.textContent = `${this._reproductionCooldownYears(entity).toFixed(1)}y`;
    }

    // Ability cooldown display (survival player)
    const surv = this.ctx.appMode === 'survival' && entity.type === 'agent' && entity.meta.survival === true;
    const isPlayer = surv && this.ctx.survival?.playerAgentId === entity.id;
    if (isPlayer && this.ctx.survival) {
      const shieldBtn = this.el.querySelector<HTMLButtonElement>('#ins-ab-shield');
      const dashBtn   = this.el.querySelector<HTMLButtonElement>('#ins-ab-dash');
      const repBtn    = this.el.querySelector<HTMLButtonElement>('#ins-ab-rep');
      const cdEl      = this.el.querySelector<HTMLElement>('#ins-ab-cd');

      const shieldRem = this.ctx.survival.shieldCooldownRemainingMs();
      const dashRem   = this.ctx.survival.dashCooldownRemainingMs();
      const eatRem    = this.ctx.survival.eatCooldownRemainingMs(entity);
      const now = performance.now();
      const dashActive = ((entity.meta.survivalDashUntilReal as number | undefined) ?? 0) > now;
      const shieldActive = ((entity.meta.survivalShieldUntilReal as number | undefined) ?? 0) > now;

      if (shieldBtn) {
        shieldBtn.disabled = shieldRem > 0;
        shieldBtn.textContent = shieldRem > 0 ? `Shield (1) · ${this._formatMs(shieldRem)}` : 'Shield (1)';
      }
      if (dashBtn) {
        dashBtn.disabled = dashRem > 0;
        dashBtn.textContent = dashRem > 0 ? `Dash (2) · ${this._formatMs(dashRem)}` : 'Dash (2)';
      }
      if (repBtn) {
        const repRemMs = this.ctx.survival.repAbilityCooldownRemainingMs();
        const onCd = repRemMs > 0;
        repBtn.disabled = onCd;
        repBtn.textContent = onCd
          ? `Stimulation of reproduction (3) · ${this._formatMs(repRemMs)}`
          : 'Stimulation of reproduction (3)';
      }
      if (cdEl) {
        cdEl.textContent =
          eatRem > 0
            ? `Eat cooldown: ${(eatRem / 1000).toFixed(1)}s`
            : '';
      }

      const hintEl = this.el.querySelector<HTMLElement>('#ins-ab-hint');
      if (hintEl) {
        if (dashActive) {
          hintEl.textContent = 'Dash active — no stamina cost';
        } else if (shieldActive) {
          hintEl.textContent = 'Shield active (~5s or until rock hit)';
        } else if (this.hintUntilReal > now && this.hintMessage) {
          hintEl.textContent = this.hintMessage;
        } else {
          hintEl.textContent = '';
        }
      }
    }

    // If entity died, re-render full panel
    if (entity.isDead()) {
      UIState.set('selectedEntity', null);
    }
  }

  destroy(): void {
    this._unsub();
  }
}