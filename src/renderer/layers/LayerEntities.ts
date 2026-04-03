// src/renderer/layers/LayerEntities.ts

// ─────────────────────────────────────────────────────────────────────────────
//  Layer: Entities  (sprite-based rendering)
// ─────────────────────────────────────────────────────────────────────────────
//
//  Each entity is drawn as a centered, scaled sprite image.
//  Falls back to the original glowing-circle if the sprite isn't loaded yet.
//
//  Per-type animation:
//    agent     — rotates toward velocity direction + sin-wave scale wobble
//    attractor — constant slow clockwise rotation
//    food      — no rotation (rings share the same center as the sprite; random spin broke alignment)
//    obstacle  — no rotation, fully static
//
//  Overlaid on top of every sprite (same as before):
//    • Replication flash  (white halo)
//    • Energy ring        (arc, skipped above ENERGY_RING_MAX entities)
//    • Hunger ring        (arc, agents only)
//    • Velocity vector    (short neon line, skipped above VELOCITY_MAX)
// ─────────────────────────────────────────────────────────────────────────────

import type { Entity }     from '../../engine/Entity';
import { ENTITY_VISUALS } from '../RendererConfig';
import { spriteLoader }    from '../SpriteLoader';

// ─── Tuning constants ────────────────────────────────────────────────────────

const VELOCITY_SCALE   = 0.12;
const ENERGY_RING_MAX  = 400;
const VELOCITY_MAX     = 300;
const GLOW_CUTOFF      = 500;

/**
 * Ring / hitbox visual radius uses this multiplier on `r` only.
 * Agent `r` also includes age; extra sprite-only zoom does not move rings.
 */
const SPRITE_SCALE_DEFAULT = 2.6;
/** Sprite draw size only (amoeba): multiply default scale by this — rings unchanged. */
const SPRITE_DRAW_BOOST_AGENT = 1.3;
/** Sprite draw size only (food): rings stay at SPRITE_SCALE_DEFAULT. */
const SPRITE_DRAW_BOOST_FOOD = 4.2;
/**
 * `leaf_food_2.png` (easy-folder background only): half default scale, −10%, then −20%.
 */
const SPRITE_DRAW_BOOST_FOOD_LEAF2 = 2.1 * 0.9 * 0.8;

/** Age 0 → 1/1.5 of standard radius; age 80+ → 1.5×; linear in between. */
const AGENT_AGE_FULL = 80;

function agentBodyScaleFromAge(ageYears: number): number {
  const t = Math.max(0, Math.min(1, ageYears / AGENT_AGE_FULL));
  const minS = 1 / 1.5;
  const maxS = 1.5;
  return minS + (maxS - minS) * t;
}

/** Replication flash: bright white burst that fades over ~20 frames */
const REP_FLASH_FRAMES = 20;

/** Attractor rotation speed (radians per frame) */
const ATTRACTOR_ROT_SPEED = 0.012;

// ─── LayerEntities ───────────────────────────────────────────────────────────

export class LayerEntities {
  /** Frame counter for time-based animations */
  private frame = 0;

  /** Selected entity id (gets premium highlight) */
  private selectedId: string | null = null;

  /** Map of entityId → frames-since-replication (for flash effect) */
  private repFlash = new Map<string, number>();

  /** Accumulated attractor rotation angle (shared, looks fine) */
  private attractorAngle = 0;

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Call when entity:replicate fires — both parent and child flash */
  markReplication(parentId: string, childId: string): void {
    this.repFlash.set(parentId, 0);
    this.repFlash.set(childId, 0);
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  draw(
    ctx:      CanvasRenderingContext2D,
    entities: Entity[],
    scaleX:   number,
    scaleY:   number,
    _alpha:   number,
  ): void {
    this.frame++;
    this.attractorAngle += ATTRACTOR_ROT_SPEED;

    const count        = entities.length;
    const showGlow     = count < GLOW_CUTOFF;
    const showRing     = count < ENERGY_RING_MAX;
    const showVelocity = count < VELOCITY_MAX;
    const spritesReady = spriteLoader.ready;

    const cssH = ctx.canvas.clientHeight || (ctx.canvas.height / (window.devicePixelRatio || 1));
    const worldH = Math.max(1, cssH / Math.max(1e-6, scaleY));

    const idPhase = (id: string): number => {
      // tiny hash → stable phase in [0, 2π)
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      const u = (h >>> 0) / 0xffffffff;
      return u * Math.PI * 2;
    };

    // ── Advance + prune rep-flash map ──────────────────────────────────────
    const aliveIds = new Set(entities.map(e => e.id));
    for (const [id, age] of this.repFlash) {
      if (!aliveIds.has(id) || age > REP_FLASH_FRAMES) {
        this.repFlash.delete(id);
      } else {
        this.repFlash.set(id, age + 1);
      }
    }

    // ── Draw each entity ───────────────────────────────────────────────────
    for (const entity of entities) {
      const visual = ENTITY_VISUALS[entity.type];
      const cx = entity.position.x * scaleX;
      const cy = entity.position.y * scaleY;
      const depth = Math.max(0, Math.min(1, entity.position.y / worldH)); // 0 far/top → 1 near/bottom
      const isSelected = this.selectedId === entity.id;
      const isPlayerControlled = entity.type === 'agent' && entity.meta.playerControlled === true;
      const isInfected = entity.type === 'agent' && entity.meta.survivalPlague === true;
      const foodEasyBgStyle = entity.type === 'food' && spriteLoader.usesEasyFolderBackgroundFood();

      // Single scale for radius so sprites stay circular (no non-uniform stretch on bitmaps).
      const avgScale = (scaleX + scaleY) / 2;
      let r = visual.radius * avgScale;
      if (entity.type === 'agent') {
        r *= agentBodyScaleFromAge(entity.ageYears ?? 0);
      }

      // Living pulse: slower + two blended sines (obstacles/stones stay static — no pulse)
      if (entity.type !== 'obstacle') {
        const ph = idPhase(entity.id);
        const t = this.frame * 0.021 + ph;
        const amp = entity.type === 'attractor' ? 0.055 : 0.034;
        const breath =
          0.82 * Math.sin(t) + 0.18 * Math.sin(t * 1.73 + ph * 0.91);
        const pulse = 1 + amp * breath;
        r *= pulse;
      }

      // Larger on-screen sprite for agents/food only; indicator arcs use SPRITE_SCALE_DEFAULT below.
      let spriteDrawScale = SPRITE_SCALE_DEFAULT;
      if (entity.type === 'agent') {
        spriteDrawScale = SPRITE_SCALE_DEFAULT * SPRITE_DRAW_BOOST_AGENT;
      } else if (entity.type === 'food') {
        const boost = foodEasyBgStyle ? SPRITE_DRAW_BOOST_FOOD_LEAF2 : SPRITE_DRAW_BOOST_FOOD;
        spriteDrawScale = SPRITE_SCALE_DEFAULT * boost;
      }

      ctx.save();

      // Depth layering: far entities dim + slightly blur; near entities sharper + brighter
      // Avoid heavy blur filters (perf): use alpha + reduced glow as LOD.
      const lod = depth < 0.38 ? 'far' : depth < 0.62 ? 'mid' : 'near';
      ctx.globalAlpha = (lod === 'far' ? 0.58 : lod === 'mid' ? 0.74 : 0.92);
      if (isSelected) ctx.globalAlpha = 1;

      // ── Replication flash: bright white halo ─────────────────────────────
      const repAge = this.repFlash.get(entity.id);
      if (repAge !== undefined) {
        const t = 1 - repAge / REP_FLASH_FRAMES;
        ctx.shadowColor = `rgba(255, 255, 255, ${(t * 0.9).toFixed(3)})`;
        ctx.shadowBlur  = 30 * t;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1 + t * 1.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${(t * 0.3).toFixed(3)})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── Shield bubble (survival player) ───────────────────────────────────
      const shieldUntil = entity.meta.survivalShieldUntilReal as number | undefined;
      if (entity.type === 'agent' && entity.meta.playerControlled === true && shieldUntil !== undefined) {
        const t = Math.max(0, Math.min(1, (shieldUntil - performance.now()) / 5000));
        if (t > 0) {
          const br = r * (2.35 + (1 - t) * 0.45);
          ctx.beginPath();
          ctx.arc(cx, cy, br, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 245, 255, ${(0.9 * t).toFixed(3)})`;
          ctx.lineWidth = 3.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, br * 0.92, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(125, 249, 255, ${(0.5 * t).toFixed(3)})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // ── Player marker: always-visible cyan pulse + beacon ────────────────
      if (isPlayerControlled) {
        const pulse = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(this.frame * 0.12));
        const mr = r * (2.7 + pulse * 0.28);
        ctx.beginPath();
        ctx.arc(cx, cy, mr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 245, 255, ${(0.75 * pulse).toFixed(3)})`;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx, cy - mr - 10);
        ctx.lineTo(cx, cy - mr - 4);
        ctx.strokeStyle = `rgba(125, 249, 255, ${(0.85 * pulse).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy - mr - 12, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125, 249, 255, ${(0.9 * pulse).toFixed(3)})`;
        ctx.fill();
      }

      // ── Plague marker: rotating biohazard aura (high-visibility) ─────────
      if (isInfected) {
        const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(this.frame * 0.2 + 1.1));
        const auraR = r * (2.3 + pulse * 0.35);
        const spinA = this.frame * 0.07;

        // Outer rotating ring
        ctx.beginPath();
        ctx.arc(cx, cy, auraR, spinA, spinA + Math.PI * 1.7);
        ctx.strokeStyle = `rgba(255, 45, 120, ${(0.9 * pulse).toFixed(3)})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner counter-rotating ring
        ctx.beginPath();
        ctx.arc(cx, cy, auraR * 0.78, -spinA * 1.25, -spinA * 1.25 + Math.PI * 1.6);
        ctx.strokeStyle = `rgba(191, 95, 255, ${(0.78 * pulse).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Radial spikes (biohazard-like vibe)
        const spikes = 6;
        for (let i = 0; i < spikes; i++) {
          const a = spinA + (i / spikes) * Math.PI * 2;
          const sx = cx + Math.cos(a) * (auraR * 0.88);
          const sy = cy + Math.sin(a) * (auraR * 0.88);
          const ex = cx + Math.cos(a) * (auraR * 1.15);
          const ey = cy + Math.sin(a) * (auraR * 1.15);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = `rgba(255, 120, 180, ${(0.72 * pulse).toFixed(3)})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }

        // Core glow
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2.4, r * 0.32), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 70, 145, ${(0.65 * pulse).toFixed(3)})`;
        ctx.fill();
      }

      // Glow blur for circle fallback only — shadow on bitmap + gradient skews vs vector rings.
      let circleGlowBlur = 0;
      if (showGlow) {
        const lodGlow = lod === 'near' ? 1 : lod === 'mid' ? 0.65 : 0.0;
        const glowMult = entity.type === 'attractor'
          ? 1.15 + 0.45 * Math.sin(this.frame * 0.04)
          : 0.9;
        const selBoost = isSelected ? 1.55 : 1.0;
        circleGlowBlur = (visual.glowBlur * glowMult) * lodGlow * selBoost;
      }

      ctx.shadowBlur    = 0;
      ctx.shadowColor   = 'transparent';
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // ── Soft aura (fake bloom) — no shadowBlur
      if (lod !== 'far' || isSelected || entity.type === 'attractor' || foodEasyBgStyle) {
        ctx.globalCompositeOperation = 'screen';
        const auraScale = isSelected ? 1.35 : 1.0;
        const auraBaseR = entity.type === 'attractor'
          ? 3.6
          : foodEasyBgStyle
            ? 4.8
            : 2.6;
        const auraR = r * auraBaseR * auraScale;
        const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraR);
        const a0 = isSelected
          ? 0.16
          : entity.type === 'attractor'
            ? 0.13
            : foodEasyBgStyle
              ? 0.32
              : 0.08;
        aura.addColorStop(0, visual.glow.replace(/[\d.]+\)$/, `${a0.toFixed(3)})`));
        aura.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
        ctx.fill();
        // Second, wider bloom so easy-folder food stays readable on busy art.
        if (foodEasyBgStyle) {
          const outerR = r * 6.2 * auraScale;
          const g2 = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, outerR);
          g2.addColorStop(0, 'rgba(140, 255, 170, 0.42)');
          g2.addColorStop(0.38, 'rgba(90, 240, 130, 0.22)');
          g2.addColorStop(0.72, 'rgba(40, 200, 90, 0.08)');
          g2.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // ── Sprite or circle ─────────────────────────────────────────────────
      const img = spritesReady
        ? (entity.type === 'agent'
            ? spriteLoader.getAgent(entity.gender)
            : spriteLoader.get(entity.type))
        : null;

      if (img) {
        const pivot = entity.type === 'food' ? spriteLoader.getFoodPivot() : null;
        this._drawSprite(ctx, entity, img, cx, cy, r, spriteDrawScale, pivot);
      } else {
        ctx.shadowColor   = visual.glow;
        ctx.shadowBlur    = circleGlowBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        this._drawCircle(ctx, visual, cx, cy, r);
        ctx.shadowBlur    = 0;
        ctx.shadowColor   = 'transparent';
      }

      ctx.shadowBlur    = 0;
      ctx.shadowColor   = 'transparent';
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha = 1;

      ctx.restore();

      const spriteHalf = img ? r * SPRITE_SCALE_DEFAULT : r;

      // ── Per-type indicators ───────────────────────────────────────────────
      // Explicit per-type rendering — no shared logic bleeds across types.
      // attractor / obstacle: no indicators at all.

      if (showRing && entity.type === 'agent') {
        const fatigueR = spriteHalf * 0.9;
        const hungerR  = spriteHalf * 1.2;

        // ── Fatigue (energy) ring ───────────────────────────────────────────
        const energyFraction = Math.max(0, Math.min(1, entity.energy / 100));
        const eStart = -Math.PI / 2 + this.frame * 0.01;
        const eEnd   = eStart + energyFraction * Math.PI * 2;

        const fatigueColor = energyFraction > 0.5
          ? `rgba(57, 255, 20, 0.75)`
          : energyFraction > 0.25
            ? `rgba(255, 200, 0, 0.75)`
            : `rgba(255, 45, 120, 0.75)`;

        ctx.beginPath();
        ctx.arc(cx, cy, fatigueR, eStart, eEnd);
        ctx.strokeStyle = fatigueColor;
        ctx.lineWidth   = 1.4;
        ctx.stroke();

        if (energyFraction < 0.2) {
          const flicker = 0.4 + 0.6 * Math.abs(Math.sin(this.frame * 0.2));
          ctx.globalAlpha = flicker;
          ctx.beginPath();
          ctx.arc(cx, cy, fatigueR + 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 45, 120, 0.5)';
          ctx.lineWidth   = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // ── Hunger ring ─────────────────────────────────────────────────────
        const hungerFraction = Math.max(0, Math.min(1, entity.hunger / 200));
        const hStart = -Math.PI / 2 + this.frame * 0.01;
        const hEnd   = hStart + hungerFraction * Math.PI * 2;

        const hungerColor = hungerFraction > 0.66
          ? `rgba(57, 255, 20, 0.7)`
          : hungerFraction > 0.33
            ? `rgba(255, 200, 0, 0.7)`
            : `rgba(255, 45, 120, 0.7)`;

        ctx.beginPath();
        ctx.arc(cx, cy, hungerR, hStart, hEnd);
        ctx.strokeStyle = hungerColor;
        ctx.lineWidth   = 1.4;
        ctx.stroke();

        if (hungerFraction < 0.2) {
          const flicker = 0.4 + 0.6 * Math.abs(Math.sin(this.frame * 0.2));
          ctx.globalAlpha = flicker;
          ctx.beginPath();
          ctx.arc(cx, cy, hungerR + 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 45, 120, 0.5)';
          ctx.lineWidth   = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      if (showRing && entity.type === 'food') {
        // Tighter than 0.9 so the “bites left” arc hugs the leaf frame
        const energyR    = spriteHalf * 0.82;
        const energyFrac = Math.max(0, Math.min(1, entity.energy / 100));
        const eStart     = -Math.PI / 2;
        const eEnd       = eStart + energyFrac * Math.PI * 2;

        const energyColor = energyFrac > 0.5
          ? `rgba(57, 255, 20, 0.75)`
          : energyFrac > 0.25
            ? `rgba(255, 200, 0, 0.75)`
            : `rgba(255, 45, 120, 0.75)`;

        ctx.beginPath();
        ctx.arc(cx, cy, energyR, eStart, eEnd);
        ctx.strokeStyle = energyColor;
        ctx.lineWidth   = 1.4;
        ctx.stroke();
      }

      // ── Velocity vector ───────────────────────────────────────────────────
      if (showVelocity) {
        const vx = entity.velocity.x;
        const vy = entity.velocity.y;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > 10) {
          const nx  = vx / speed;
          const ny  = vy / speed;
          const len = Math.min(speed * VELOCITY_SCALE, 20);

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + nx * len * scaleX, cy + ny * len * scaleY);
          ctx.strokeStyle = visual.color;
          ctx.lineWidth   = 0.8;
          ctx.globalAlpha = 0.45;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // ctx.restore() already called above — do NOT call again here
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Bitmap at (cx, cy). Optional `pivot` (normalized 0–1): maps that texture point to the entity center
   * instead of the image center — fixes off-center art (food uses SpriteLoader alpha centroid).
   */
  private _drawSprite(
    ctx:            CanvasRenderingContext2D,
    entity:         Entity,
    img:            HTMLImageElement,
    cx:             number,
    cy:             number,
    r:              number,
    spriteDrawScale: number,
    pivot:          { nx: number; ny: number } | null,
  ): void {
    const size = Math.max(1, Math.round(r * spriteDrawScale * 2));
    const half = size * 0.5;
    const px = pivot?.nx ?? 0.5;
    const py = pivot?.ny ?? 0.5;
    const dx = -half + (0.5 - px) * size;
    const dy = -half + (0.5 - py) * size;

    ctx.save();
    ctx.shadowBlur    = 0;
    ctx.shadowColor   = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.translate(cx, cy);
    ctx.rotate(this._rotationFor(entity));
    const easyFoodGlow =
      entity.type === 'food' && spriteLoader.usesEasyFolderBackgroundFood();
    if (easyFoodGlow) {
      ctx.shadowColor = 'rgba(130, 255, 170, 0.95)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.drawImage(img, dx, dy, size, size);
    if (easyFoodGlow) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
    ctx.restore();
  }

  /** Circle fallback when sprites are not loaded yet. */
  private _drawCircle(
    ctx:    CanvasRenderingContext2D,
    visual: typeof ENTITY_VISUALS[keyof typeof ENTITY_VISUALS],
    cx:     number,
    cy:     number,
    r:      number,
  ): void {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = visual.color;
    ctx.fill();
  }

  /**
   * Returns the current rotation angle (radians) for a given entity.
   *
   *  agent     → atan2(vy, vx)  + sin-wave wobble on scale (handled in draw)
   *  attractor → shared accumulating angle (slow spin)
   *  food      → 0 (sprite art is not centered in the texture; random rotation made rings look offset)
   *  obstacle  → 0 (static)
   */
  private _rotationFor(entity: Entity): number {
    switch (entity.type) {
      case 'agent': {
        const vx = entity.velocity.x;
        const vy = entity.velocity.y;
        const speed = Math.sqrt(vx * vx + vy * vy);
        // Only rotate when actually moving; freeze direction when stalled
        return speed > 1 ? Math.atan2(vy, vx) + Math.PI / 2 : 0;
      }

      case 'attractor':
        return this.attractorAngle;

      case 'food':
        // Energy ring is drawn axis-aligned at (cx,cy). Rotating the bitmap would move any
        // off-center highlight in the PNG around that point — different angle per id → rings looked "wrong".
        return 0;

      case 'obstacle':
      default:
        return 0;
    }
  }
}
