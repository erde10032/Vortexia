// ─────────────────────────────────────────────────────────────────────────────
//  Vortexia — Observer Mode
// ─────────────────────────────────────────────────────────────────────────────
//
//  Cinematic "screensaver" mode:
//    - Hides all UI panels and toolbar
//    - Applies a slow drifting camera (pan + gentle zoom)
//    - Auto-pilots toward entity clusters (center of mass)
//    - Overlay hint + LIVE badge (no letterboxing — canvas goes full viewport)
//    - Shows a minimal exit hint that fades out
//    - Ensures simulation is running autonomously
//
//  Camera model:
//    The camera is a 2D viewport into world space.
//    We track: camX, camY (world-space center), zoom (scale multiplier).
//    Each frame we lerp toward a target, giving buttery smooth movement.
//
//  Autopilot:
//    Every AUTOPILOT_INTERVAL ms we pick a new target:
//      - 70% chance: center of mass of all alive entities (follow the swarm)
//      - 30% chance: random world position (explore empty space)
//    The camera drifts there over ~8 seconds.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { WorldState } from '../engine/WorldState';
import type { SimLoop }    from '../engine/SimLoop';

// ─── Constants ───────────────────────────────────────────────────────────────

const LERP_PAN      = 0.008;   // camera pan smoothing (lower = slower drift)
const LERP_ZOOM     = 0.004;   // zoom smoothing
const ZOOM_MIN      = 0.7;     // max zoom-out
const ZOOM_MAX      = 2.2;     // max zoom-in
const ZOOM_DEFAULT  = 1.0;
const AUTOPILOT_INTERVAL = 7000; // ms between target changes
const HINT_VISIBLE_MS    = 3500; // how long the exit hint stays visible

// ─── Camera state ────────────────────────────────────────────────────────────

export interface CameraState {
  /** World-space X of viewport center */
  x: number;
  /** World-space Y of viewport center */
  y: number;
  /** Zoom multiplier (1 = normal) */
  zoom: number;
  /** Whether observer mode is active */
  active: boolean;
}

// ─── ObserverMode ────────────────────────────────────────────────────────────

export class ObserverMode {
  private world:  WorldState;
  private loop:   SimLoop;
  private canvas: HTMLCanvasElement;

  // ── Camera current state (smoothed) ──
  private cam: CameraState = { x: 600, y: 400, zoom: ZOOM_DEFAULT, active: false };

  // ── Camera target (autopilot destination) ──
  private targetX    = 600;
  private targetY    = 400;
  private targetZoom = ZOOM_DEFAULT;

  // ── Autopilot timer ──
  private autopilotTimer: ReturnType<typeof setTimeout> | null = null;

  // ── DOM refs ──
  private overlay:   HTMLElement;
  private hint:      HTMLElement;
  // ── Hint fade timer ──
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Keyboard handler ref (for cleanup) ──
  private _onKey: (e: KeyboardEvent) => void;

  constructor(world: WorldState, loop: SimLoop, canvas: HTMLCanvasElement) {
    this.world  = world;
    this.loop   = loop;
    this.canvas = canvas;

    this.overlay = this._buildOverlay();
    this.hint    = this.overlay.querySelector('.obs-hint')!;

    document.body.appendChild(this.overlay);

    // Keyboard: Escape or O exits
    this._onKey = (e: KeyboardEvent) => {
      if (!this.cam.active) return;
      if (e.code === 'Escape' || e.code === 'KeyO') {
        e.preventDefault();
        this.exit();
      }
    };
    document.addEventListener('keydown', this._onKey);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get active(): boolean { return this.cam.active; }

  /** Enter observer mode */
  enter(): void {
    if (this.cam.active) return;
    this.cam.active = true;

    // Ensure sim is running
    if (!this.loop.running) {
      this.loop.start();
    }

    // Center camera on current entity cluster
    this._pickTarget(true);
    this.cam.x    = this.targetX;
    this.cam.y    = this.targetY;
    this.cam.zoom = ZOOM_DEFAULT;

    this.overlay.classList.add('obs-active');

    // Full-viewport canvas: collapse chrome via #app.app--observer (see index.html)
    document.getElementById('app')!.classList.add('app--observer');
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Show hint, then fade it out
    this.hint.classList.add('obs-hint--visible');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hint.classList.remove('obs-hint--visible');
    }, HINT_VISIBLE_MS);

    // Start autopilot cycle
    this._scheduleAutopilot();
  }

  /** Exit observer mode */
  exit(): void {
    if (!this.cam.active) return;
    this.cam.active = false;

    this.overlay.classList.remove('obs-active');
    document.getElementById('app')!.classList.remove('app--observer');
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Stop autopilot
    if (this.autopilotTimer) {
      clearTimeout(this.autopilotTimer);
      this.autopilotTimer = null;
    }

    // Reset camera to identity
    this.cam.x    = this.world.config.width  / 2;
    this.cam.y    = this.world.config.height / 2;
    this.cam.zoom = ZOOM_DEFAULT;
  }

  toggle(): void {
    this.cam.active ? this.exit() : this.enter();
  }

  /**
   * Call every render frame.
   * Smoothly advances camera toward target.
   * Returns current camera state for Renderer to consume.
   */
  tick(): CameraState {
    if (!this.cam.active) return this.cam;

    // Lerp camera toward target
    this.cam.x    += (this.targetX    - this.cam.x)    * LERP_PAN;
    this.cam.y    += (this.targetY    - this.cam.y)    * LERP_PAN;
    this.cam.zoom += (this.targetZoom - this.cam.zoom) * LERP_ZOOM;

    return this.cam;
  }

  destroy(): void {
    document.removeEventListener('keydown', this._onKey);
    if (this.autopilotTimer) clearTimeout(this.autopilotTimer);
    if (this.hintTimer)      clearTimeout(this.hintTimer);
    this.overlay.remove();
  }

  // ─── Autopilot ───────────────────────────────────────────────────────────

  private _scheduleAutopilot(): void {
    this.autopilotTimer = setTimeout(() => {
      if (!this.cam.active) return;
      this._pickTarget(false);
      this._scheduleAutopilot();
    }, AUTOPILOT_INTERVAL);
  }

  /**
   * Pick a new camera target.
   * @param immediate  If true, snap zoom too (used on enter)
   */
  private _pickTarget(immediate: boolean): void {
    const W = this.world.config.width;
    const H = this.world.config.height;
    const entities = this.world.getAlive();

    if (entities.length === 0) {
      // No entities — drift to center
      this.targetX    = W / 2;
      this.targetY    = H / 2;
      this.targetZoom = ZOOM_DEFAULT;
      return;
    }

    const roll = Math.random();

    if (roll < 0.65 && entities.length > 0) {
      // ── Follow center of mass (with slight random offset for drama) ──
      let sx = 0, sy = 0;
      // Sample up to 60 entities for perf
      const sample = entities.length > 60
        ? entities.sort(() => Math.random() - 0.5).slice(0, 60)
        : entities;
      for (const e of sample) { sx += e.position.x; sy += e.position.y; }
      sx /= sample.length;
      sy /= sample.length;

      // Add a small cinematic offset so it's not perfectly centered
      const offsetX = (Math.random() - 0.5) * W * 0.15;
      const offsetY = (Math.random() - 0.5) * H * 0.15;
      this.targetX = sx + offsetX;
      this.targetY = sy + offsetY;

      // Zoom in on dense clusters, out on sparse
      this.targetZoom = 1.1 + Math.random() * 0.7; // 1.1 – 1.8

    } else if (roll < 0.85) {
      // ── Zoom out for a wide establishing shot ──
      this.targetX    = W / 2 + (Math.random() - 0.5) * W * 0.2;
      this.targetY    = H / 2 + (Math.random() - 0.5) * H * 0.2;
      this.targetZoom = ZOOM_MIN + Math.random() * 0.2; // 0.7 – 0.9

    } else {
      // ── Pick a random interesting entity and zoom in on it ──
      const pick = entities[Math.floor(Math.random() * entities.length)];
      this.targetX    = pick.position.x;
      this.targetY    = pick.position.y;
      this.targetZoom = 1.6 + Math.random() * 0.6; // 1.6 – 2.2
    }

    // Clamp target to world bounds
    this.targetX    = Math.max(0, Math.min(W, this.targetX));
    this.targetY    = Math.max(0, Math.min(H, this.targetY));
    this.targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.targetZoom));

    if (immediate) {
      this.cam.zoom = this.targetZoom;
    }
  }

  // ─── DOM ─────────────────────────────────────────────────────────────────

  private _buildOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'obs-overlay';
    el.innerHTML = `
      <div class="obs-hint">
        <span class="obs-hint-icon">👁</span>
        <span class="obs-hint-text">OBSERVER MODE</span>
        <span class="obs-hint-key">Press <kbd>Esc</kbd> to exit</span>
      </div>
      <div class="obs-label">LIVE</div>
    `;
    return el;
  }
}
