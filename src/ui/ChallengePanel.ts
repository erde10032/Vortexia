// src/ui/ChallengePanel.ts

// ─────────────────────────────────────────────
//  Vortexia — Challenge Panel
// ─────────────────────────────────────────────
//
//  Full-screen mission select overlay.
//  Shows 3 mission cards with:
//    - Icon, title, subtitle, description
//    - Time limit + hold requirement
//    - Required rules hint
//    - Best score + rank badge (from localStorage)
//    - "Start Mission" button
//
//  Emits 'challenge:select' on world.events when user picks a mission.
//  Caller (app) should then call challengeEngine.start(mission).
// ─────────────────────────────────────────────

import type { WorldState } from '../engine/WorldState';
import { ALL_MISSIONS }    from '../challenge/missions';
import type { Mission }    from '../challenge/ChallengeTypes';

const STORAGE_KEY = 'rc_challenge_scores';

// ─── Score persistence ────────────────────────

interface SavedScore {
  total: number;
  rank:  string;
}

function loadScores(): Record<string, SavedScore> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveScore(missionId: string, total: number, rank: string): void {
  const scores = loadScores();
  const prev   = scores[missionId];
  if (!prev || total > prev.total) {
    scores[missionId] = { total, rank };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  }
}

// ─── ChallengePanel ───────────────────────────

export type ChallengePanelStyle = 'standard' | 'survival';

export class ChallengePanel {
  private container: HTMLElement;
  private world:     WorldState;
  private el:        HTMLElement;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private style:     ChallengePanelStyle;

  constructor(container: HTMLElement, world: WorldState, style: ChallengePanelStyle = 'standard') {
    this.container = container;
    this.world     = world;
    this.style     = style;
    this.el        = this._build();
    container.appendChild(this.el);
  }

  // ─── Build ────────────────────────────────

  private _build(): HTMLElement {
    const scores = loadScores();
    const el     = document.createElement('div');
    el.id        = 'challenge-panel';
    el.className = 'challenge-panel challenge-panel--hidden';

    const cards = ALL_MISSIONS.map((m, i) => this._buildCard(m, i, scores[m.id], this.style)).join('');

    el.innerHTML = `
      <div class="cpanel-backdrop"></div>
      <div class="cpanel-inner">
        <div class="cpanel-header">
          <span class="cpanel-header-icon">🏆</span>
          <h2 class="cpanel-title">CHALLENGE MODE</h2>
          <p class="cpanel-subtitle">${this.style === 'survival'
            ? 'Complete for a one-time reward — food and amoeba (best rank S: +5 / +10).'
            : 'Three missions. One world. No mercy.'}</p>
          <button class="cpanel-close" id="cpanel-close">✕</button>
        </div>
        <div class="cpanel-cards">
          ${cards}
        </div>
      </div>
    `;

    // Close button
    el.querySelector('#cpanel-close')?.addEventListener('click', () => this.hide());

    // Backdrop click closes
    el.querySelector('.cpanel-backdrop')?.addEventListener('click', () => this.hide());

    // Start buttons
    el.querySelectorAll<HTMLButtonElement>('.cpanel-start-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const missionId = btn.dataset.missionId!;
        const mission   = ALL_MISSIONS.find(m => m.id === missionId);
        if (!mission) return;
        this.hide();
        this.world.events.emit('challenge:select', { missionId }, this.world.tick);
      });
    });

    return el;
  }

  private _buildCard(mission: Mission, index: number, saved: SavedScore | undefined, panelStyle: ChallengePanelStyle): string {
    const rankColors: Record<string, string> = { S: '#FFD700', A: '#39FF14', B: '#00F5FF', C: '#BF5FFF' };
    const rankBadge = saved
      ? `<div class="cpanel-rank-badge" style="color:${rankColors[saved.rank]};border-color:${rankColors[saved.rank]}">${saved.rank}</div>`
      : `<div class="cpanel-rank-badge cpanel-rank-badge--empty">—</div>`;

    const bestScore = saved
      ? `<span class="cpanel-best-score">Best: ${saved.total.toLocaleString()}</span>`
      : `<span class="cpanel-best-score cpanel-best-score--none">Not attempted</span>`;

    const rulesHint = mission.requiredRules
      .map(r => `<span class="cpanel-rule-tag">${r}</span>`)
      .join('');

    const holdText = mission.holdSec > 0
      ? `Hold ${mission.holdSec}s`
      : 'Count target';

    const survivalReward =
      panelStyle === 'survival'
        ? `<div class="cpanel-card-meta"><span class="cpanel-meta-item">🎁 One completion reward (S: 5 amoeba · 10 food)</span></div>`
        : '';

    return `
      <div class="cpanel-card" style="--card-color:${mission.color}" data-mission-id="${mission.id}">
        <div class="cpanel-card-header">
          <span class="cpanel-card-icon">${mission.icon}</span>
          <div class="cpanel-card-titles">
            <span class="cpanel-card-title">${mission.title}</span>
            <span class="cpanel-card-subtitle">${mission.subtitle}</span>
          </div>
          ${rankBadge}
        </div>

        <p class="cpanel-card-desc">${mission.description}</p>

        <div class="cpanel-card-meta">
          <span class="cpanel-meta-item">⏱ ${mission.timeLimitSec}s limit</span>
          <span class="cpanel-meta-item">🎯 ${holdText}</span>
          <span class="cpanel-meta-item">🏅 Max ${mission.maxScore.toLocaleString()}</span>
        </div>
        ${survivalReward}

        <div class="cpanel-rules-hint">
          <span class="cpanel-rules-label">Activate:</span>
          ${rulesHint}
        </div>

        <div class="cpanel-card-footer">
          ${bestScore}
          <button class="cpanel-start-btn" data-mission-id="${mission.id}">
            Start Mission ${index + 1} →
          </button>
        </div>
      </div>
    `;
  }

  /** Call before show() when app mode changes between standard and survival. */
  setStyle(style: ChallengePanelStyle): void {
    this.style = style;
  }

  // ─── Show / hide ──────────────────────────

  show(): void {
    // Rebuild to refresh scores
    const fresh = this._build();
    this.el.replaceWith(fresh);
    this.el = fresh;
    this.el.classList.remove('challenge-panel--hidden');

    // Add Escape key listener
    this._bindEscape();
  }

  hide(): void {
    this.el.classList.add('challenge-panel--hidden');
    this._unbindEscape();
  }

  get isVisible(): boolean {
    return !this.el.classList.contains('challenge-panel--hidden');
  }

  destroy(): void {
    this._unbindEscape();
    this.el.remove();
  }

  // ─── Escape handling ──────────────────────

  private _bindEscape(): void {
    if (this.escapeHandler) return;
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  private _unbindEscape(): void {
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
  }
}