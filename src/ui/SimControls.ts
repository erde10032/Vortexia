// src/ui/SimControls.ts

// ─────────────────────────────────────────────
//  Vortexia — Sim Controls
// ─────────────────────────────────────────────
//
//  Top toolbar: Start/Pause, Reset, Speed, stats display.
//  Wires directly to SimLoop + WorldState.
//
//  Visual feedback:
//    - Play button pulses green when running
//    - Pause button glows amber when paused
//    - Reset triggers a brief flash on the canvas
//    - Stats (tick, entity count) update every frame
// ─────────────────────────────────────────────

import type { SimLoop }    from '../engine/SimLoop';
import type { WorldState } from '../engine/WorldState';
import type { Entity }     from '../engine/Entity';
import { UIState }         from './UIState';

const ICON_PLAY_SVG =
  '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M4 2.5 L11 7 L4 11.5 Z"/></svg>';
const ICON_PAUSE_SVG =
  '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="3.25" y="2.5" width="2.75" height="9" rx="0.5"/><rect x="8" y="2.5" width="2.75" height="9" rx="0.5"/></svg>';

// ─── SimControls ─────────────────────────────

export class SimControls {
  private loop:    SimLoop;
  private world:   WorldState;
  private toolbar: HTMLElement;

  // DOM refs
  private btnPlay:      HTMLButtonElement;
  private btnPlayIcon:  HTMLElement;
  private btnPlayLabel: HTMLElement;
  private btnReset:     HTMLButtonElement;
  private btnSpeed:  HTMLButtonElement;
  private statTick:  HTMLElement;
  private statCount: HTMLElement;
  private statSpeed: HTMLElement;

  // Speed cycle
  private speedLevels: number[] = [1, 2, 3, 5];
  private speedIndex: number = 0; // 0 = 1x

  // Callbacks for reset side-effects
  private onReset?: () => void;

  private speedHidden = false;

  constructor(toolbar: HTMLElement, loop: SimLoop, world: WorldState) {
    this.toolbar = toolbar;
    this.loop    = loop;
    this.world   = world;

    this.btnPlay      = toolbar.querySelector<HTMLButtonElement>('#btn-play')!;
    this.btnPlayIcon  = toolbar.querySelector<HTMLElement>('#btn-play-icon')!;
    this.btnPlayLabel = toolbar.querySelector<HTMLElement>('#btn-play-label')!;
    this.btnReset     = toolbar.querySelector<HTMLButtonElement>('#btn-reset')!;
    this.btnSpeed  = toolbar.querySelector<HTMLButtonElement>('#btn-speed')!;
    this.statTick  = toolbar.querySelector<HTMLElement>('#stat-tick')!;
    this.statCount = toolbar.querySelector<HTMLElement>('#stat-count')!;
    this.statSpeed = toolbar.querySelector<HTMLElement>('#stat-speed')!;

    this._bindEvents();
    this._syncPlayState(UIState.get('simRunning'));
    this._updateSpeedDisplay();
  }

  /** Hide speed button and stat (survival / simplified toolbar). */
  setSpeedVisible(visible: boolean): void {
    this.speedHidden = !visible;
    const vis = visible ? '' : 'none';
    this.btnSpeed.style.display = vis;
    const statSpeedEl = this.toolbar.querySelector<HTMLElement>('#stat-speed');
    const parent = statSpeedEl?.closest('.stat-item');
    if (parent) (parent as HTMLElement).style.display = vis;
  }

  // ─── Register reset callback ──────────────

  /** Called after world.reset() — use to clear renderer trails, chips, etc. */
  setOnReset(cb: () => void): void {
    this.onReset = cb;
  }

  // ─── Events ───────────────────────────────

  private _bindEvents(): void {
    // ── Play / Pause ──
    this.btnPlay.addEventListener('click', () => {
      const running = UIState.get('simRunning');
      if (running) {
        this.loop.pause();
        UIState.set('simRunning', false);
      } else {
        this.loop.resume();
        UIState.set('simRunning', true);
      }
      this._syncPlayState(!running);
    });

    // ── Reset ──
    this.btnReset.addEventListener('click', () => {
      // Pause first
      this.loop.pause();
      UIState.set('simRunning', false);
      this._syncPlayState(false);

      // Flash feedback
      this.btnReset.classList.add('btn--flash');
      setTimeout(() => this.btnReset.classList.remove('btn--flash'), 400);

      // Reset world
      this.world.resetEntities();
      UIState.set('selectedEntity', null);

      // Notify listeners (renderer trails, active zone chips, etc.)
      this.onReset?.();
    });

    // ── Speed control ──
    this.btnSpeed.addEventListener('click', () => {
      this._cycleSpeed();
    });

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // ignore when typing
      if (e.code === 'Space') {
        e.preventDefault();
        this.btnPlay.click();
      }
      if (e.code === 'KeyR' && e.shiftKey) {
        e.preventDefault();
        this.btnReset.click();
      }
      if (e.code === 'KeyS') {
        if (this.speedHidden) return;
        e.preventDefault();
        this._cycleSpeed();
      }
    });

    // ── Sync play state from UIState ──
    UIState.on('simRunning', (running) => this._syncPlayState(running as boolean));
  }

  private _cycleSpeed(): void {
    // Cycle through speed levels
    this.speedIndex = (this.speedIndex + 1) % this.speedLevels.length;
    const newSpeed = this.speedLevels[this.speedIndex];
    this.loop.setSpeed(newSpeed);
    this._updateSpeedDisplay();
  }

  private _updateSpeedDisplay(): void {
    const currentSpeed = this.speedLevels[this.speedIndex];
    this.statSpeed.textContent = `${currentSpeed}x`;
    // Add visual pulse to button
    this.btnSpeed.classList.add('btn--flash');
    setTimeout(() => this.btnSpeed.classList.remove('btn--flash'), 200);
  }

  // ─── Visual sync ──────────────────────────

  private _syncPlayState(running: boolean): void {
    if (running) {
      this.btnPlayIcon.innerHTML = ICON_PAUSE_SVG;
      this.btnPlayLabel.textContent = 'Pause';
      this.btnPlay.classList.add('btn--running');
      this.btnPlay.classList.remove('btn--paused');
    } else {
      this.btnPlayIcon.innerHTML = ICON_PLAY_SVG;
      this.btnPlayLabel.textContent = 'Start';
      this.btnPlay.classList.remove('btn--running');
      this.btnPlay.classList.add('btn--paused');
    }
  }

  // ─── Stats update (called every frame) ───

  tick(): void {
    const tick  = this.world.tick;
    const count = this.world.entityCount;

    // Throttle DOM writes — only update if changed
    if (this.statTick.textContent  !== String(tick))  this.statTick.textContent  = String(tick);
    if (this.statCount.textContent !== String(count)) this.statCount.textContent = String(count);

    // Sync UIState stats
    UIState.set('tick', tick);
    UIState.set('entityCount', count);
  }
}