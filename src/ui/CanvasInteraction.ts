// ─────────────────────────────────────────────
//  Vortexia — Canvas Interaction
// ─────────────────────────────────────────────
//
//  Pointer handling on the simulation canvas:
//    - click → pick nearest entity within radius (or deselect empty space)
//    - hover → crosshair when over an entity
//
//  Picking uses CSS pixels when a camera is supplied (matches Renderer zoom/pan
//  and avoids skew when scaleX ≠ scaleY). Without a camera, hit radius is in
//  world units from a simple rect scale.
// ─────────────────────────────────────────────

import type { Entity }     from '../engine/Entity';
import type { WorldState } from '../engine/WorldState';
import { UIState }         from './UIState';

const HIT_RADIUS_PX = 24;

/** Same transform as Renderer — both hooks required for picking. */
export interface CanvasHitCamera {
  clientToWorld: (clientX: number, clientY: number) => { wx: number; wy: number };
  worldToCss:    (wx: number, wy: number) => { mx: number; my: number };
}

export class CanvasInteraction {
  private canvas:  HTMLCanvasElement;
  private world:   WorldState;
  private worldW:  number;
  private worldH:  number;
  private camera?: CanvasHitCamera;
  private shouldSuppressClick?: () => boolean;

  constructor(
    canvas: HTMLCanvasElement,
    world: WorldState,
    worldW: number,
    worldH: number,
    camera?: CanvasHitCamera,
    shouldSuppressClick?: () => boolean,
  ) {
    this.canvas = canvas;
    this.world  = world;
    this.worldW = worldW;
    this.worldH = worldH;
    this.camera = camera;
    this.shouldSuppressClick = shouldSuppressClick;
    this._bind();
  }

  private _hitTest(clientX: number, clientY: number): Entity | null {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    if (this.camera) {
      const r2 = HIT_RADIUS_PX * HIT_RADIUS_PX;
      let closest: Entity | null = null;
      let best = Infinity;
      for (const entity of this.world.getAlive()) {
        const { mx: ex, my: ey } = this.camera.worldToCss(entity.position.x, entity.position.y);
        const dx = ex - mx;
        const dy = ey - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2 && d2 < best) {
          closest = entity;
          best = d2;
        }
      }
      return closest;
    }

    const wx = mx * (this.worldW / rect.width);
    const wy = my * (this.worldH / rect.height);
    const wuPerPx = this.worldW / rect.width;
    const hitWU = HIT_RADIUS_PX * wuPerPx;
    const hitWU2 = hitWU * hitWU;

    let closest: Entity | null = null;
    let best = Infinity;
    for (const entity of this.world.getAlive()) {
      const dx = entity.position.x - wx;
      const dy = entity.position.y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < hitWU2 && d2 < best) {
        closest = entity;
        best = d2;
      }
    }
    return closest;
  }

  private _bind(): void {
    const { canvas } = this;

    canvas.addEventListener('click', (e) => {
      if (this.shouldSuppressClick?.()) return;
      const hit = this._hitTest(e.clientX, e.clientY);
      UIState.set('selectedEntity', hit ?? null);
    });

    canvas.addEventListener('mousemove', (e) => {
      canvas.style.cursor = this._hitTest(e.clientX, e.clientY) ? 'crosshair' : 'default';
    });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      if (!touch) return;
      const hit = this._hitTest(touch.clientX, touch.clientY);
      UIState.set('selectedEntity', hit ?? null);
    }, { passive: false });
  }

  resize(worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
  }
}
