// ─────────────────────────────────────────────
//  Vortexia — Renderer
// ─────────────────────────────────────────────
//
//  Orchestrates all rendering layers in the correct draw order:
//
//    1. LayerBackground  — dark fill + grid + ambient particles
//    2. LayerTrails      — motion trails (behind entities)
//    3. LayerConnections — interaction lines between entities
//    4. LayerEntities    — glowing entity circles
//    5. LayerEffects     — collision/rule/death flash effects
//
//  Integration with SimLoop:
//    loop.onRender = (world, alpha) => renderer.draw(world, alpha);
//
//  Integration with WorldState events:
//    renderer.connectEvents(world.events);
//    → subscribes to entity:death, entity:replicate, collision:enter
//    → spawns VisualEffects on the EffectBus
//
//  Canvas sizing:
//    The canvas is sized to its CSS display size (devicePixelRatio aware).
//    World coordinates are scaled to canvas pixels via scaleX/scaleY.
//    Call renderer.resize() on window resize.
//
//  Performance summary:
//    - Connections: O(n²), skipped above 200 entities
//    - Trails: thinned above 300 entities
//    - Glow (shadowBlur): skipped above 500 entities
//    - Energy ring: skipped above 400 entities
//    - Velocity vector: skipped above 300 entities
// ─────────────────────────────────────────────

import type { WorldState } from '../engine/WorldState';
import { EventBus }        from '../engine/WorldState';
import type { SimEvent }   from '../engine/types';
import type { CameraState } from '../ui/ObserverMode';

import { TrailBuffer }       from './TrailBuffer';
import { EffectBus }         from './EffectBus';
import { spriteLoader }      from './SpriteLoader';
import { LayerBackground }   from './layers/LayerBackground';
import { LayerTrails }       from './layers/LayerTrails';
import { LayerConnections }  from './layers/LayerConnections';
import { LayerEntities }     from './layers/LayerEntities';
import { LayerEffects }      from './layers/LayerEffects';

// ─── Renderer ────────────────────────────────

export class Renderer {
  private canvas:  HTMLCanvasElement;
  private ctx:     CanvasRenderingContext2D;
  private dpr:     number;

  // ── World dimensions (logical) ──
  private worldW = 1200;
  private worldH = 800;

  // ── Scale: world-units → canvas pixels ──
  private scaleX = 1;
  private scaleY = 1;

  /** User pan/zoom when not in observer mode (wheel adjusts zoom toward cursor) */
  private viewCX = 600;
  private viewCY = 400;
  private viewZoom = 1;

  /** Last camera passed to draw — for screen→world hit testing */
  private _lastDrawCamera: CameraState | null = null;

  /** LMB pan: keep pointer id for drag */
  private _panPointer: { id: number; lastX: number; lastY: number } | null = null;
  /** One-shot: skip next canvas click after a pan gesture */
  private _suppressClick = false;

  // ── Sub-systems ──
  private trails  = new TrailBuffer();
  private effects = new EffectBus();

  // ── Layers ──
  private layerBg      = new LayerBackground();
  private layerTrails  = new LayerTrails();
  private layerConns   = new LayerConnections();
  private layerEntities = new LayerEntities();
  private layerEffects = new LayerEffects();

  /** Survival rockfall / shadow overlay */
  private survivalOverlay: ((ctx: CanvasRenderingContext2D, sx: number, sy: number) => void) | null = null;

  // ── Event cleanup ──
  private _unsubscribers: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Renderer: could not get 2D context');
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
  }

  // ─── Setup ────────────────────────────────────

  /**
   * Initialize renderer with world dimensions.
   * Call once after construction, before the first draw.
   */
  init(worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
    this.viewCX = worldW / 2;
    this.viewCY = worldH / 2;
    this.viewZoom = 1;
    this.resize();
    this.layerBg.init(worldW, worldH);
    // Kick off sprite preloading — rendering falls back to circles until ready
    void spriteLoader.load().then(() => this.syncFoodSpriteWithBackground());
  }

  /**
   * Resize canvas to match its CSS display size.
   * Call on window resize.
   */
  resize(): void {
    const dpr = this.dpr;
    const rect = this.canvas.getBoundingClientRect();
    // Must match draw() / clientToWorld / wheel clamp — use client* first (inner layout size).
    const w = Math.max(1, this.canvas.clientWidth || Math.round(rect.width));
    const h = Math.max(1, this.canvas.clientHeight || Math.round(rect.height));

    this.canvas.width  = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    // Transform (incl. DPR) is applied each frame in draw(); avoid stacking scale here.

    this.scaleX = w / this.worldW;
    this.scaleY = h / this.worldH;
    this.clampViewToWorld();
  }

  // ─── Event wiring ─────────────────────────────

  /**
   * Subscribe to WorldState events to spawn visual effects.
   * Call once after world is created.
   * Automatically cleans up on renderer.destroy().
   */
  connectEvents(events: EventBus, world?: WorldState): void {
    // ── Collision → white ring ──
    const onCollision = (e: SimEvent<{ x?: number; y?: number }>) => {
      if (e.data.x !== undefined && e.data.y !== undefined) {
        this.effects.spawn('collision', e.data.x, e.data.y);
      }
    };

    // ── Replication → green burst at parent position + entity flash ──
    const onReplicate = (e: SimEvent<{ parentId: string; childId: string }>) => {
      if (!world) return;
      const parent = world.getEntity(e.data.parentId);
      if (parent) {
        this.effects.spawn('replicate', parent.position.x, parent.position.y);
      }
      // Trigger white flash on both parent and child entities
      this.layerEntities.markReplication(e.data.parentId, e.data.childId);
    };

    // ── Entity death → red shrink at entity's last position ──
    // (entity is already removed from world by the time event fires,
    //  so we can't look it up — skip positional effect for death)

    events.on('collision:enter', onCollision as (e: SimEvent<unknown>) => void);
    events.on('entity:replicate', onReplicate as (e: SimEvent<unknown>) => void);

    // ── Survival abilities → tinted pulse around player ──
    const onAbility = (e: SimEvent<{ kind: string; entityId: string }>) => {
      if (!world) return;
      const ent = world.getEntity(e.data.entityId);
      if (!ent) return;
      const kind = e.data.kind;
      const color =
        kind === 'shield'
          ? 'rgba(0, 245, 255, 1)'
          : kind === 'dash'
            ? 'rgba(255, 45, 120, 1)'
            : 'rgba(57, 255, 20, 1)';
      this.effects.spawn('ability', ent.position.x, ent.position.y, color);
    };

    events.on('survival:ability', onAbility as (e: SimEvent<unknown>) => void);

    this._unsubscribers.push(
      () => events.off('collision:enter', onCollision as (e: SimEvent<unknown>) => void),
      () => events.off('entity:replicate', onReplicate as (e: SimEvent<unknown>) => void),
      () => events.off('survival:ability', onAbility as (e: SimEvent<unknown>) => void),
    );
  }

  // ─── Main draw ────────────────────────────────

  /**
   * Draw one frame. Called by SimLoop.onRender.
   *
   * @param world   Current world state
   * @param alpha   Interpolation alpha (0–1) between last two physics ticks
   * @param camera  Optional camera state from ObserverMode (pan + zoom)
   */
  draw(world: WorldState, alpha: number, camera?: CameraState): void {
    this._lastDrawCamera = camera ?? null;

    const entities = world.getAlive();

    // ── Update trail buffer ──
    this.trails.update(entities);

    // ── Prune dead trails ──
    const aliveIds = new Set(entities.map(e => e.id));
    this.trails.prune(aliveIds);

    // ── Advance effects ──
    this.effects.tick();

    // ── Update background particles ──
    this.layerBg.update();

    // ── Draw layers in order ──
    const ctx = this.ctx;

    // Reset transform to identity before each frame
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cw = Math.max(1, this.canvas.clientWidth);
    const ch = Math.max(1, this.canvas.clientHeight);
    // Recompute every frame so layer math matches camera tx/ty (same source as wheel / hit tests).
    const scaleX = cw / this.worldW;
    const scaleY = ch / this.worldH;
    this.scaleX = scaleX;
    this.scaleY = scaleY;

    // ── Apply cinematic camera transform (observer mode) ──
    // We translate so the camera target is at the canvas center, then scale.
    if (camera?.active) {
      const z  = camera.zoom;
      const tx = cw / 2 - camera.x * scaleX * z;
      const ty = ch / 2 - camera.y * scaleY * z;
      ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, tx * this.dpr, ty * this.dpr);
    } else {
      // User viewport zoom/pan (same layout math as observer, separate state)
      const z = this.viewZoom;
      const tx = cw / 2 - this.viewCX * scaleX * z;
      const ty = ch / 2 - this.viewCY * scaleY * z;
      ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, tx * this.dpr, ty * this.dpr);
    }

    // Resolve camera center for parallax (world-units)
    const bgCamX = camera?.active ? camera.x : this.viewCX;
    const bgCamY = camera?.active ? camera.y : this.viewCY;
    this.layerBg.draw(ctx, scaleX, scaleY, bgCamX, bgCamY);
    this.layerTrails.draw(ctx, entities, this.trails, scaleX, scaleY);
    this.layerConns.draw(ctx, entities, scaleX, scaleY);
    this.layerEntities.draw(ctx, entities, scaleX, scaleY, alpha);
    this.layerEffects.draw(ctx, this.effects, scaleX, scaleY);
    if (this.survivalOverlay) {
      this.survivalOverlay(ctx, scaleX, scaleY);
    }
  }

  // ─── Cleanup ──────────────────────────────────

  /** Spawn a manual effect (e.g. from UI interaction) */
  spawnEffect(kind: Parameters<EffectBus['spawn']>[0], x: number, y: number): void {
    this.effects.spawn(kind, x, y);
  }

  /**
   * Select the background texture set based on game mode and difficulty.
   *
   * @param difficulty  'easy' | 'medium' | 'hard'
   * @param isStandard  true = STANDARD/manual mode → random pick each call
   */
  setBackground(difficulty: 'easy' | 'medium' | 'hard', isStandard = false): void {
    this.layerBg.setBackground(difficulty, isStandard);
    this.syncFoodSpriteWithBackground();
  }

  /** Food sprite matches easy-folder backgrounds (`leaf_food_2.png` vs default). */
  private syncFoodSpriteWithBackground(): void {
    const apply = () => spriteLoader.setFoodFromEasyBackground(this.layerBg.isActiveImageFromEasyFolder());
    if (spriteLoader.ready) apply();
    else void spriteLoader.load().then(apply);
  }

  getBackgroundDifficulty(): 'easy' | 'medium' | 'hard' {
    return this.layerBg.getActiveDifficulty();
  }

  /** Clear all trails and effects (e.g. on world reset) */
  reset(): void {
    this.trails.clear();
    this.effects.clear();
    this.viewCX = this.worldW / 2;
    this.viewCY = this.worldH / 2;
    this.viewZoom = 1;
  }

  /** UI-only: tell renderer which entity is selected for highlight */
  setSelectedEntity(id: string | null): void {
    this.layerEntities.setSelected(id);
  }

  /** Pass survival visuals (shadows / falling rocks); null disables. */
  setSurvivalOverlay(fn: ((ctx: CanvasRenderingContext2D, sx: number, sy: number) => void) | null): void {
    this.survivalOverlay = fn;
  }

  /**
   * Zoom toward cursor; keeps world point under mouse fixed.
   * Only updates user view — observer mode uses its own camera.
   * Min zoom (z=1) = entire field fits the canvas; cannot zoom out further.
   */
  applyWheel(e: WheelEvent): void {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw < 2 || ch < 2) return;

    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scaleX = cw / this.worldW;
    const scaleY = ch / this.worldH;
    const z0 = this.viewZoom;
    const Z_MIN = 1;
    const Z_MAX = 4.5;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const z1 = Math.max(Z_MIN, Math.min(Z_MAX, z0 * factor));
    if (Math.abs(z1 - z0) < 1e-9) return;

    const wx = this.viewCX + (mx - cw / 2) / (scaleX * z0);
    const wy = this.viewCY + (my - ch / 2) / (scaleY * z0);
    this.viewCX = wx - (mx - cw / 2) / (scaleX * z1);
    this.viewCY = wy - (my - ch / 2) / (scaleY * z1);
    this.viewZoom = z1;
    this.clampViewToWorld();
  }

  /**
   * Keep zoom within [1, max] and pan center so the viewport stays inside world bounds.
   * z=1 is the most zoomed-out: field edges match the canvas (no extra empty margin).
   */
  private clampViewToWorld(): void {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw < 2 || ch < 2) return;
    const scaleX = cw / this.worldW;
    const scaleY = ch / this.worldH;
    const Z_MIN = 1;
    const Z_MAX = 4.5;
    this.viewZoom = Math.max(Z_MIN, Math.min(Z_MAX, this.viewZoom));
    const z = this.viewZoom;
    const halfW = cw / (2 * scaleX * z);
    const halfH = ch / (2 * scaleY * z);
    this.viewCX = Math.max(halfW, Math.min(this.worldW - halfW, this.viewCX));
    this.viewCY = Math.max(halfH, Math.min(this.worldH - halfH, this.viewCY));
  }

  /** If true, clears the flag — use to ignore click after LMB pan */
  consumeSuppressClick(): boolean {
    if (!this._suppressClick) return false;
    this._suppressClick = false;
    return true;
  }

  /**
   * Drag with primary button to pan when not in observer mode.
   */
  attachViewportPointerPan(canvas: HTMLCanvasElement, isObserverActive: () => boolean): void {
    const PAN_SUPPRESS_PX = 6;

    const onPointerDown = (e: PointerEvent) => {
      if (isObserverActive()) return;
      if (e.button !== 0) return;
      this._suppressClick = false;
      this._panPointer = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this._panPointer || e.pointerId !== this._panPointer.id) return;
      const dx = e.clientX - this._panPointer.lastX;
      const dy = e.clientY - this._panPointer.lastY;
      this._panPointer.lastX = e.clientX;
      this._panPointer.lastY = e.clientY;
      if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const scaleX = cw / this.worldW;
      const scaleY = ch / this.worldH;
      const z = this.viewZoom;
      this.viewCX -= dx / (scaleX * z);
      this.viewCY -= dy / (scaleY * z);
      this.clampViewToWorld();
      if (Math.hypot(dx, dy) > PAN_SUPPRESS_PX) this._suppressClick = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this._panPointer || e.pointerId !== this._panPointer.id) return;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      this._panPointer = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    this._unsubscribers.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    });
  }

  /** Canvas client coordinates → world space (matches last draw transform) */
  clientToWorld(clientX: number, clientY: number): { wx: number; wy: number } {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const scaleX = cw / this.worldW;
    const scaleY = ch / this.worldH;
    let cx: number;
    let cy: number;
    let z: number;
    if (this._lastDrawCamera?.active) {
      cx = this._lastDrawCamera.x;
      cy = this._lastDrawCamera.y;
      z = this._lastDrawCamera.zoom;
    } else {
      cx = this.viewCX;
      cy = this.viewCY;
      z = this.viewZoom;
    }
    return {
      wx: cx + (mx - cw / 2) / (scaleX * z),
      wy: cy + (my - ch / 2) / (scaleY * z),
    };
  }

  /** World space → canvas-local CSS pixels (inverse of clientToWorld; same camera state) */
  worldToCss(wx: number, wy: number): { mx: number; my: number } {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const scaleX = cw / this.worldW;
    const scaleY = ch / this.worldH;
    let cx: number;
    let cy: number;
    let z: number;
    if (this._lastDrawCamera?.active) {
      cx = this._lastDrawCamera.x;
      cy = this._lastDrawCamera.y;
      z = this._lastDrawCamera.zoom;
    } else {
      cx = this.viewCX;
      cy = this.viewCY;
      z = this.viewZoom;
    }
    return {
      mx: cw / 2 + (wx - cx) * scaleX * z,
      my: ch / 2 + (wy - cy) * scaleY * z,
    };
  }

  /** Unsubscribe all event listeners */
  destroy(): void {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }
}
