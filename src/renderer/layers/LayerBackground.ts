// ─────────────────────────────────────────────────────────────────────────────
//  Layer: Background
// ─────────────────────────────────────────────────────────────────────────────
//
//  Draws:
//    1. Stylized atmospheric gradient environment (deep blue → teal)
//    2. Volumetric light rays (soft, slow drift)
//    3. Fog / depth layers (subtle, non-photoreal)
//    4. Vignette to focus attention toward center
//    5. Ambient drifting particles (pre-seeded, no per-frame alloc)
//
//  Background fill strategy:
//    - One stretched draw of the texture to the full device-pixel buffer — no
//      repeated stamp loop, so there are no tile boundaries / black seam grids.
//    - Slight zoom + translation gives parallax without re-tiling.
//    - Drawn in device-pixel space (identity transform) before entity layers.
//
//  Particles are pre-allocated at init — zero GC per frame.
// ─────────────────────────────────────────────────────────────────────────────

import { BG_CONFIG } from '../RendererConfig';
import { BG_IMAGE_URLS, allBackgroundImageUrls, isUrlFromEasyFolder, type BgFolder } from '../backgroundAssets';

/** Background scrolls at this fraction of camera movement (0=static, 1=world-locked) */
const PARALLAX_FACTOR = 0.2;

// ─── Background "difficulty" retained for compatibility ──────────────────────
type BgDifficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: BgDifficulty[] = ['easy', 'medium', 'hard'];

function pickRandomUrl(folder: BgFolder): string | null {
  const primary = BG_IMAGE_URLS[folder];
  if (primary.length > 0) {
    return primary[Math.floor(Math.random() * primary.length)];
  }
  const pool = allBackgroundImageUrls();
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Particle type ───────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseAlpha: number;
  alpha: number;
  /** Twinkle phase offset (0–2π) */
  phase: number;
  /** Twinkle speed (radians/frame) */
  phaseSpeed: number;
  /** Hue shift: 0=cyan, 1=purple, 2=white */
  hue: number;
}

// ─── LayerBackground ─────────────────────────────────────────────────────────

export class LayerBackground {
  private particles: Particle[] = [];
  private w = 0;
  private h = 0;
  /** Global frame counter for animated effects */
  private frame = 0;

  /** Currently active difficulty (kept for external API compatibility) */
  private _activeDifficulty: BgDifficulty = 'easy';
  /** Random image selected for current difficulty (resolved URL from Vite glob) */
  private _activeImagePath: string | null = pickRandomUrl('easy');
  private _imageCache = new Map<string, HTMLImageElement>();

  /** Dynamic quality: how many particles to update/draw this frame */
  private particleActiveCount = 0;
  /** FPS estimator (EMA) for auto quality */
  private fpsEma = 60;
  private lastT = 0;

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Select which background texture to display.
   *
   * @param difficulty  'easy' | 'medium' | 'hard'
   * @param isStandard  When true (STANDARD/manual mode), pick a random difficulty
   *                    instead of using the supplied one.
   */
  setBackground(difficulty: BgDifficulty, isStandard = false): void {
    if (isStandard) {
      // STANDARD mode: random pick on every call (i.e. each game start/restart)
      const idx = Math.floor(Math.random() * DIFFICULTIES.length);
      this._activeDifficulty = DIFFICULTIES[idx];
    } else {
      this._activeDifficulty = difficulty;
    }

    const folder: BgFolder = this._activeDifficulty === 'medium' ? 'normal' : this._activeDifficulty;
    this._activeImagePath = pickRandomUrl(folder);
    if (this._activeImagePath) this._ensureImage(this._activeImagePath);
  }

  /** Which texture set is currently active (after setBackground). */
  getActiveDifficulty(): BgDifficulty {
    return this._activeDifficulty;
  }

  /**
   * True when the displayed background file comes from `assets/game/easy/`
   * (random from that folder, not the cross-folder fallback).
   */
  isActiveImageFromEasyFolder(): boolean {
    return isUrlFromEasyFolder(this._activeImagePath);
  }

  init(worldW: number, worldH: number): void {
    this.w = worldW;
    this.h = worldH;
    this.particles = [];
    this.particleActiveCount = BG_CONFIG.particleCount;
    this.fpsEma = 60;
    this.lastT = 0;

    for (let i = 0; i < BG_CONFIG.particleCount; i++) {
      const baseAlpha = Math.random() * 0.18 + 0.04;
      this.particles.push({
        x:          Math.random() * worldW,
        y:          Math.random() * worldH,
        vx:         (Math.random() - 0.5) * 6,
        vy:         (Math.random() - 0.5) * 6,
        r:          Math.random() * 2.0 + 0.4,
        baseAlpha,
        alpha:      baseAlpha,
        phase:      Math.random() * Math.PI * 2,
        phaseSpeed: 0.01 + Math.random() * 0.03,
        hue:        Math.floor(Math.random() * 3),
      });
    }

    // Preload every discovered background texture (any count per folder).
    for (const path of allBackgroundImageUrls()) this._ensureImage(path);
  }

  /** Advance particle positions and twinkle (call once per render frame) */
  update(): void {
    this.frame++;

    // Dynamic particle quality based on FPS (very lightweight)
    const now = performance.now();
    if (this.lastT > 0) {
      const dt = Math.max(1, now - this.lastT);
      const fps = 1000 / dt;
      this.fpsEma = this.fpsEma * 0.92 + fps * 0.08;
      const target =
        this.fpsEma < 42 ? Math.floor(BG_CONFIG.particleCount * 0.45) :
        this.fpsEma < 52 ? Math.floor(BG_CONFIG.particleCount * 0.65) :
        this.fpsEma < 58 ? Math.floor(BG_CONFIG.particleCount * 0.80) :
        BG_CONFIG.particleCount;
      this.particleActiveCount = Math.max(30, Math.min(BG_CONFIG.particleCount, target));
    }
    this.lastT = now;

    const max = Math.min(this.particles.length, this.particleActiveCount);
    for (let i = 0; i < max; i++) {
      const p = this.particles[i];
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      if (p.x < 0)       p.x += this.w;
      if (p.x > this.w)  p.x -= this.w;
      if (p.y < 0)       p.y += this.h;
      if (p.y > this.h)  p.y -= this.h;

      p.phase += p.phaseSpeed;
      p.alpha = p.baseAlpha * (0.5 + 0.5 * Math.sin(p.phase));
    }
  }

  /**
   * Draw the background layer.
   *
   * @param ctx     Canvas 2D context (camera transform already applied by Renderer)
   * @param scaleX  World→canvas X scale
   * @param scaleY  World→canvas Y scale
   * @param camX    Camera center X in world-units (for parallax offset)
   * @param camY    Camera center Y in world-units (for parallax offset)
   */
  draw(
    ctx:    CanvasRenderingContext2D,
    scaleX: number,
    scaleY: number,
    camX    = 0,
    camY    = 0,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const cw  = ctx.canvas.width  / dpr;
    const ch  = ctx.canvas.height / dpr;

    // ── 1) Main-menu style underwater atmosphere (device-pixel space) ───────
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bufW = ctx.canvas.width;
    const bufH = ctx.canvas.height;
    ctx.fillStyle = BG_CONFIG.bgColor;
    ctx.fillRect(0, 0, bufW, bufH);

    // Parallax drift (subtle): the gradient "leans" with camera movement
    const shiftX = (camX * scaleX * PARALLAX_FACTOR) * dpr;
    const shiftY = (camY * scaleY * PARALLAX_FACTOR) * dpr;

    // Difficulty-driven background image (random from easy/normal/hard folders).
    const bgImg = this._activeImagePath ? this._imageCache.get(this._activeImagePath) : undefined;
    if (bgImg) {
      const zoom = 1.07;
      const destW = bufW * zoom;
      const destH = bufH * zoom;
      const dx = (bufW - destW) * 0.5 - shiftX * 0.20;
      const dy = (bufH - destH) * 0.5 - shiftY * 0.16;
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bgImg, dx, dy, destW, destH);
      ctx.globalAlpha = 1;
    }

    // Depth tone varies slightly by difficulty — light overlay so art stays vivid
    const diffTint = this._activeDifficulty === 'hard'
      ? [0, 80, 140]
      : this._activeDifficulty === 'medium'
        ? [0, 95, 155]
        : [0, 110, 170];

    // Deep blue base + subtle center lift (same family as menu)
    const g = ctx.createRadialGradient(
      bufW * 0.50 + shiftX * 0.05,
      bufH * 0.42 + shiftY * 0.04,
      bufH * 0.08,
      bufW * 0.50,
      bufH * 0.55,
      bufH * 1.15,
    );
    g.addColorStop(0.00, `rgba(${diffTint[0]}, ${diffTint[1]}, ${diffTint[2]}, 0.14)`);
    g.addColorStop(0.30, 'rgba(0, 44, 88, 0.18)');
    g.addColorStop(0.62, 'rgba(0, 28, 62, 0.38)');
    g.addColorStop(1.00, 'rgba(0, 12, 32, 0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, bufW, bufH);

    // Soft volumetric center glow
    ctx.globalCompositeOperation = 'screen';
    const centerGlow = ctx.createRadialGradient(
      bufW * 0.50 + Math.sin(this.frame * 0.002) * bufW * 0.015,
      bufH * 0.36,
      bufH * 0.05,
      bufW * 0.50,
      bufH * 0.36,
      bufH * 0.75,
    );
    centerGlow.addColorStop(0, 'rgba(125, 249, 255, 0.08)');
    centerGlow.addColorStop(0.5, 'rgba(0, 200, 255, 0.03)');
    centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, bufW, bufH);

    // Floating blurred bokeh blobs (menu-like depth forms)
    const blobs = [
      { x: 0.18, y: 0.36, r: 0.16, a: 0.11, c: '0, 200, 255', sx: 0.004, sy: 0.003 },
      { x: 0.34, y: 0.62, r: 0.14, a: 0.08, c: '110, 210, 255', sx: 0.003, sy: 0.002 },
      { x: 0.66, y: 0.28, r: 0.13, a: 0.10, c: '130, 230, 255', sx: 0.005, sy: 0.002 },
      { x: 0.82, y: 0.58, r: 0.18, a: 0.09, c: '191, 95, 255', sx: 0.004, sy: 0.003 },
    ];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const bx = bufW * b.x + Math.sin(this.frame * b.sx + i) * bufW * 0.012;
      const by = bufH * b.y + Math.cos(this.frame * b.sy + i * 0.7) * bufH * 0.010;
      const br = bufH * b.r;
      const blob = ctx.createRadialGradient(bx, by, br * 0.08, bx, by, br);
      blob.addColorStop(0, `rgba(${b.c}, ${b.a.toFixed(3)})`);
      blob.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = blob;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // ── 2) Very soft vignette (menu-like) ────────────────────────────────────
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vg = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.34, cw / 2, ch / 2, ch * 1.04);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    // ── 3) Ambient particles (plankton/dust, world-space) ────────────────────
    const COLORS = [
      [0, 245, 255],   // cyan
      [191, 95, 255],  // purple
      [220, 240, 255], // white-blue
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const max = Math.min(this.particles.length, this.particleActiveCount);
    for (let i = 0; i < max; i++) {
      const p = this.particles[i];
      if (p.alpha < 0.005) continue;
      const [r, g, b] = COLORS[p.hue];
      const px = p.x * scaleX;
      const py = p.y * scaleY;
      // Slight vertical streak for depth
      const streak = 1 + (p.r * 0.9) * (0.45 + 0.55 * Math.sin(p.phase * 0.7));
      ctx.beginPath();
      ctx.ellipse(px, py, p.r, p.r * streak, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(p.alpha * 0.55).toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();

  }

  private _ensureImage(path: string): void {
    if (this._imageCache.has(path)) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = path;
    img.onload = () => this._imageCache.set(path, img);
    img.onerror = () => {
      console.warn(`[LayerBackground] Failed to load image: ${path}`);
    };
  }

}
