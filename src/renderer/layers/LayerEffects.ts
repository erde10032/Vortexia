// ─────────────────────────────────────────────
//  Layer: Effects
// ─────────────────────────────────────────────
//
//  Renders visual feedback for simulation events:
//
//  collision  → white expanding ring + brief flash
//  replicate  → green burst (expanding filled circle, fades out)
//  rule       → violet ring pulse
//  death      → red shrinking cross-fade
//
//  Each effect is driven by VisualEffect.progress (0→1).
//  Easing functions make them feel snappy and alive.
// ─────────────────────────────────────────────

import type { EffectBus } from '../EffectBus';
import { EFFECT_CONFIG } from '../RendererConfig';

/** Ease out cubic — fast start, slow end */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease in cubic — slow start, fast end */
function easeIn(t: number): number {
  return t * t * t;
}

export class LayerEffects {
  draw(
    ctx:      CanvasRenderingContext2D,
    effects:  EffectBus,
    scaleX:   number,
    scaleY:   number,
  ): void {
    const active = effects.getActive();
    if (active.length === 0) return;

    ctx.save();

    for (const fx of active) {
      const cx = fx.x * scaleX;
      const cy = fx.y * scaleY;
      const t  = fx.progress; // 0 → 1

      switch (fx.kind) {

        // ── Collision: white expanding ring ──
        case 'collision': {
          const r     = easeOut(t) * EFFECT_CONFIG.flashMaxRadius;
          const alpha = 1 - easeIn(t);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
          ctx.lineWidth   = 2 * (1 - t);
          ctx.stroke();

          // Inner flash
          if (t < 0.3) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${(0.3 - t).toFixed(3)})`;
            ctx.fill();
          }
          break;
        }

        // ── Replicate: green burst ──
        case 'replicate': {
          const r     = easeOut(t) * 22;
          const alpha = (1 - t) * 0.8;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(57, 255, 20, ${alpha.toFixed(3)})`;
          ctx.fill();

          // Outer ring
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(57, 255, 20, ${(alpha * 0.5).toFixed(3)})`;
          ctx.lineWidth   = 1;
          ctx.stroke();
          break;
        }

        // ── Rule effect: violet ring pulse ──
        case 'rule': {
          const r     = easeOut(t) * EFFECT_CONFIG.flashMaxRadius * 1.2;
          const alpha = (1 - t) * 0.6;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(191, 95, 255, ${alpha.toFixed(3)})`;
          ctx.lineWidth   = 1.5;
          ctx.stroke();
          break;
        }

        // ── Death: red shrinking fade ──
        case 'death': {
          const r     = (1 - easeOut(t)) * 12;
          const alpha = (1 - t) * 0.7;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 45, 120, ${alpha.toFixed(3)})`;
          ctx.fill();
          break;
        }

        // ── Ability: tinted pulse ──
        case 'ability': {
          const r = easeOut(t) * 42;
          const alpha = (1 - t) * 1.0;
          const c = fx.color ?? 'rgba(57, 255, 20, 1)';
          // Expect either rgba(...) or hex; only alpha is overridden by globalAlpha
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = c;
          ctx.lineWidth = 4.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
          ctx.fillStyle = c;
          ctx.globalAlpha = alpha * 0.32;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
          ctx.strokeStyle = c;
          ctx.globalAlpha = alpha * 0.55;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          break;
        }
      }
    }

    ctx.restore();
  }
}
