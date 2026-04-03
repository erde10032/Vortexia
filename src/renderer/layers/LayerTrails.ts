// ─────────────────────────────────────────────
//  Layer: Motion Trails
// ─────────────────────────────────────────────
//
//  Draws fading polyline trails behind each entity.
//  Opacity fades from 0 (oldest) → trailColor alpha (newest).
//  Line width tapers from thin (oldest) → full (newest).
//
//  Performance:
//    - Skips entities with < 2 trail points
//    - At high entity counts (> trailThinCutoff), draws every other segment
//    - Uses ctx.save/restore only once per entity (not per segment)
// ─────────────────────────────────────────────

import type { Entity } from '../../engine/Entity';
import { TrailBuffer } from '../TrailBuffer';
import { ENTITY_VISUALS, TRAIL_CONFIG, PERF_CONFIG } from '../RendererConfig';

export class LayerTrails {
  draw(
    ctx:      CanvasRenderingContext2D,
    entities: Entity[],
    trails:   TrailBuffer,
    scaleX:   number,
    scaleY:   number,
  ): void {
    const thin = entities.length > PERF_CONFIG.trailThinCutoff;

    ctx.save();
    // Additive blending makes trails feel like light streaks (kept subtle for clarity)
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.75;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const entity of entities) {
      const points = trails.get(entity.id);
      if (points.length < 2) continue;

      const visual = ENTITY_VISUALS[entity.type];
      const dashUntil = entity.meta.survivalDashUntilReal as number | undefined;
      const dashOn = entity.meta.playerControlled === true && dashUntil !== undefined && performance.now() < dashUntil;
      const step   = thin ? 2 : 1;

      for (let i = step; i < points.length; i += step) {
        const prev = points[i - step];
        const curr = points[i];

        // t: 0 at oldest end, 1 at newest end
        const t     = i / (points.length - 1);
        const alpha = t * 0.55; // reduce global noise
        const lw    = TRAIL_CONFIG.lineWidth * (0.3 + t * 0.7);

        ctx.beginPath();
        ctx.moveTo(prev.x * scaleX, prev.y * scaleY);
        ctx.lineTo(curr.x * scaleX, curr.y * scaleY);
        // trailColor is already rgba(...) with a fixed alpha — we override it
        ctx.strokeStyle = dashOn
          ? `rgba(255, 45, 120, ${alpha.toFixed(3)})`
          : visual.trailColor.replace(/[\d.]+\)$/, `${alpha.toFixed(3)})`);

        ctx.lineWidth   = lw;
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
