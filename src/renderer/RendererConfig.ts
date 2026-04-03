// ─────────────────────────────────────────────
//  Vortexia — Renderer Config
// ─────────────────────────────────────────────
//
//  Single source of truth for all visual constants.
//  Tweak here — nothing else needs to change.
// ─────────────────────────────────────────────

import type { EntityType } from '../engine/types';

// ─── Entity visual palette ────────────────────

export interface EntityVisual {
  /** Core fill color */
  color: string;
  /** Outer glow color (usually same, more transparent) */
  glow: string;
  /** Base radius in world-units */
  radius: number;
  /** Glow blur spread (px) */
  glowBlur: number;
  /** Trail color */
  trailColor: string;
}

export const ENTITY_VISUALS: Record<EntityType, EntityVisual> = {
  agent: {
    color:      '#7DF9FF',
    glow:       'rgba(0, 245, 255, 0.82)',
    radius:     5,
    glowBlur:   13,
    trailColor: 'rgba(0, 245, 255, 0.32)',
  },
  food: {
    color:      '#7CFF5B',
    glow:       'rgba(57, 255, 20, 0.78)',
    radius:     4,
    glowBlur:   12,
    trailColor: 'rgba(57, 255, 20, 0.22)',
  },
  attractor: {
    color:      '#E2B6FF',
    glow:       'rgba(191, 95, 255, 0.92)',
    radius:     7,
    glowBlur:   18,
    trailColor: 'rgba(191, 95, 255, 0.28)',
  },
  obstacle: {
    color:      '#FF6EA6',
    glow:       'rgba(255, 45, 120, 0.78)',
    radius:     6,
    glowBlur:   14,
    trailColor: 'rgba(255, 45, 120, 0.22)',
  },
};

// ─── Connection lines ─────────────────────────

export const CONNECTION_CONFIG = {
  /** Max distance to draw a connection line */
  maxDist:      120,
  /** Base opacity at distance=0 */
  maxAlpha:     0.35,
  /** Line width */
  lineWidth:    0.8,
  /** Color for attraction connections */
  attractColor: 'rgba(0, 245, 255, VAR)',
  /** Color for repulsion connections */
  repelColor:   'rgba(255, 45, 120, VAR)',
};

// ─── Motion trails ────────────────────────────

export const TRAIL_CONFIG = {
  /** How many positions to keep per entity */
  maxLength:    20,
  /** Minimum distance moved before adding a new trail point */
  minDist:      2,
  /** Trail segment line width */
  lineWidth:    2,
};

// ─── Background ───────────────────────────────

export const BG_CONFIG = {
  /** Solid base behind background gradients */
  bgColor:      '#001327',
  /** Reserved — grid overlay removed (was visible as squares / center seam) */
  gridColor:    'rgba(0, 180, 200, 0.06)',
  /** Reserved */
  gridSize:     60,
  /** Ambient particle count */
  particleCount: 140,
  particleColor: 'rgba(0, 245, 255, 0.14)',
};

// ─── Effects ─────────────────────────────────

export const EFFECT_CONFIG = {
  /** How many frames a flash effect lives */
  flashLifetime:  18,
  /** Max radius of a collision flash */
  flashMaxRadius: 28,
  /** Replication burst color */
  replicateColor: '#39FF14',
  /** Collision flash color */
  collisionColor: '#FFFFFF',
  /** Rule-effect burst color */
  ruleColor:      '#BF5FFF',
};

// ─── Performance ─────────────────────────────

export const PERF_CONFIG = {
  /**
   * Max entities before connection lines are skipped.
   * Connections are O(n²) — skip them at high counts.
   */
  connectionCutoff: 200,
  /**
   * Max entities before trails are thinned (every other point skipped).
   */
  trailThinCutoff:  300,
};
