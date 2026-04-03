// src/renderer/layers/LayerConnections.ts

// ─────────────────────────────────────────────
//  Layer: Connections
// ─────────────────────────────────────────────
//
//  Draws interaction lines between nearby entities.
//  Two visual modes:
//    - Attraction: cyan lines (entities of same type close together)
//    - Repulsion:  pink lines (obstacle near agents)
//
//  Performance:
//    - Skipped entirely when entity count > connectionCutoff (O(n²) cost)
//    - Uses a single beginPath() per color batch (not per line)
//    - Alpha fades with distance: full at 0, zero at maxDist
// ─────────────────────────────────────────────

import type { Entity } from '../../engine/Entity';
import { CONNECTION_CONFIG, PERF_CONFIG } from '../RendererConfig';

export class LayerConnections {
  draw(
    ctx:      CanvasRenderingContext2D,
    entities: Entity[],
    scaleX:   number,
    scaleY:   number,
  ): void {
    // ── Performance gate ──
    if (entities.length > PERF_CONFIG.connectionCutoff) return;

    const maxDist  = CONNECTION_CONFIG.maxDist;
    const maxDist2 = maxDist * maxDist;
    const maxAlpha = CONNECTION_CONFIG.maxAlpha;
    const lw       = CONNECTION_CONFIG.lineWidth;

    // ── Batch lines by color ──
    const attractLines: [number, number, number, number, number][] = [];
    const repelLines:   [number, number, number, number, number][] = [];

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      const ax = a.position.x;
      const ay = a.position.y;

      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j];
        const dx = b.position.x - ax;
        const dy = b.position.y - ay;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDist2) continue;

        const dist  = Math.sqrt(d2);
        const alpha = maxAlpha * (1 - dist / maxDist);

        // Half-pixel snap — must match LayerEntities so link endpoints meet sprite/ring center.
        const x1 = Math.round(ax * scaleX * 2) / 2;
        const y1 = Math.round(ay * scaleY * 2) / 2;
        const x2 = Math.round(b.position.x * scaleX * 2) / 2;
        const y2 = Math.round(b.position.y * scaleY * 2) / 2;

        // Same type → attraction (cyan)
        if (a.type === b.type) {
          attractLines.push([x1, y1, x2, y2, alpha]);
        }
        // Different type: obstacle triggers repulsion (pink)
        else if (a.type === 'obstacle' || b.type === 'obstacle') {
          repelLines.push([x1, y1, x2, y2, alpha]);
        }
      }
    }

    ctx.save();
    ctx.lineWidth = lw;

    // ── Draw attraction lines (cyan) ──
    for (const [x1, y1, x2, y2, alpha] of attractLines) {
      ctx.strokeStyle = `rgba(0, 245, 255, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // ── Draw repulsion lines (pink) ──
    for (const [x1, y1, x2, y2, alpha] of repelLines) {
      ctx.strokeStyle = `rgba(255, 45, 120, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  }
}