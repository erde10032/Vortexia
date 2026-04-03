// ─────────────────────────────────────────────
//  Vortexia — Effect Bus
// ─────────────────────────────────────────────
//
//  Decoupled queue for visual feedback effects.
//  The simulation engine emits events → EffectBus converts them
//  to visual effects → LayerEffects renders them.
//
//  No canvas code here — pure data management.
// ─────────────────────────────────────────────

import { EFFECT_CONFIG } from './RendererConfig';

// ─── Effect types ─────────────────────────────

export type EffectKind = 'collision' | 'replicate' | 'rule' | 'death' | 'ability';

export interface VisualEffect {
  id:       number;
  kind:     EffectKind;
  x:        number;
  y:        number;
  /** 0 = just born, 1 = fully expired */
  progress: number;
  /** Total lifetime in frames */
  lifetime: number;
  /** Optional tint override */
  color?:   string;
}

// ─── EffectBus ────────────────────────────────

let _nextEffectId = 0;

/**
 * Manages a pool of active visual effects.
 *
 * Usage:
 *   effectBus.spawn('collision', x, y);
 *   effectBus.tick();           // advance all effects by 1 frame
 *   effectBus.getActive();      // read by LayerEffects
 */
export class EffectBus {
  private effects: VisualEffect[] = [];

  // ─── Spawn ────────────────────────────────────

  spawn(kind: EffectKind, x: number, y: number, color?: string): void {
    this.effects.push({
      id:       ++_nextEffectId,
      kind,
      x,
      y,
      progress: 0,
      lifetime: EFFECT_CONFIG.flashLifetime,
      color,
    });
  }

  // ─── Advance ──────────────────────────────────

  /**
   * Advance all effects by one frame.
   * Expired effects are removed.
   * Call once per render frame (not per physics tick).
   */
  tick(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.progress += 1 / e.lifetime;
      if (e.progress >= 1) {
        this.effects.splice(i, 1);
      }
    }
  }

  // ─── Read ─────────────────────────────────────

  getActive(): readonly VisualEffect[] {
    return this.effects;
  }

  get count(): number { return this.effects.length; }

  // ─── Clear ────────────────────────────────────

  clear(): void { this.effects = []; }
}
