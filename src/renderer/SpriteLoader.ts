// src/renderer/SpriteLoader.ts

// ─────────────────────────────────────────────────────────────────────────────
//  SpriteLoader
// ─────────────────────────────────────────────────────────────────────────────
//
//  Preloads all 4 game sprites once and exposes them as HTMLImageElement refs.
//  Rendering should only start after `ready` resolves.
//
//  Usage:
//    const sprites = new SpriteLoader();
//    await sprites.load();
//    // sprites.get('agent') → HTMLImageElement | null
// ─────────────────────────────────────────────────────────────────────────────

import type { EntityType } from '../engine/types';

/** Bundled URLs — same pattern as `backgroundAssets.ts` so `vite build` / preview resolve assets. */
import leafFoodUrl from '../../assets/game/leaf_food.png?url';
import leafFood2Url from '../../assets/game/leaf_food_2.png?url';
import vortexAttractorUrl from '../../assets/game/vortex_attractor.png?url';
import stoneObstacleUrl from '../../assets/game/stone_obstacle.png?url';
import amoebaMaleUrl from '../../assets/game/amoeba_agent.png?url';
import amoebaFemaleUrl from '../../assets/game/amoeba_agent_2.png?url';

const FOOD_PATH_DEFAULT = leafFoodUrl;
/** Used when the active background texture is from `assets/game/easy/`. */
const FOOD_PATH_EASY_BG = leafFood2Url;

/** Non-agent sprites keyed by entity type (food loaded separately — two variants). */
const SPRITE_PATHS: Record<Exclude<EntityType, 'agent' | 'food'>, string> = {
  attractor: vortexAttractorUrl,
  obstacle:  stoneObstacleUrl,
};

const AGENT_SPRITE_BY_GENDER: Record<'male' | 'female', string> = {
  male:   amoebaMaleUrl,
  female: amoebaFemaleUrl,
};

/** Normalized centroid of opaque pixels (0–1). Falls back to (0.5, 0.5) if unreadable. */
function alphaWeightedCentroid(img: HTMLImageElement): { nx: number; ny: number } {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw < 1 || nh < 1) return { nx: 0.5, ny: 0.5 };
  const maxSide = 160;
  const sc = Math.min(1, maxSide / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * sc));
  const h = Math.max(1, Math.round(nh * sc));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) return { nx: 0.5, ny: 0.5 };
  c.drawImage(img, 0, 0, w, h);
  let data: ImageData;
  try {
    data = c.getImageData(0, 0, w, h);
  } catch {
    return { nx: 0.5, ny: 0.5 };
  }
  const d = data.data;
  let sumX = 0;
  let sumY = 0;
  let wsum = 0;
  const step = 2;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = d[(y * w + x) * 4 + 3];
      if (a < 14) continue;
      const wt = a / 255;
      sumX += x * wt;
      sumY += y * wt;
      wsum += wt;
    }
  }
  if (wsum < 1e-6) return { nx: 0.5, ny: 0.5 };
  return { nx: (sumX / wsum) / w, ny: (sumY / wsum) / h };
}

export class SpriteLoader {
  private sprites = new Map<EntityType, HTMLImageElement>();
  private agentSprites = new Map<'male' | 'female', HTMLImageElement>();
  private foodDefault: HTMLImageElement | null = null;
  private foodEasyBg: HTMLImageElement | null = null;
  /** When true and `foodEasyBg` loaded, draw food from `leaf_food_2.png`. */
  private foodUseEasyBg = false;
  /** Food texture visual center (normalized); aligns bitmap with entity (cx,cy). */
  private foodPivot = { nx: 0.5, ny: 0.5 };
  private _ready  = false;
  private _loadPromise: Promise<void> | null = null;

  /** True once all images have loaded (or failed with fallback). */
  get ready(): boolean { return this._ready; }

  /**
   * Kick off loading all sprites.
   * Resolves when every image either loaded or errored (never rejects).
   */
  async load(): Promise<void> {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._doLoad();
    return this._loadPromise;
  }

  private loadFoodVariant(src: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`SpriteLoader: failed to load "${src}"`);
        resolve(null);
      };
      img.src = src;
    });
  }

  private applyFoodSpriteSelection(): void {
    const easyReady = Boolean(this.foodEasyBg);
    const useEasy = this.foodUseEasyBg && easyReady;
    // Non-easy background must never fall back to leaf_food_2 (otherwise a failed
    // leaf_food.png load would always show leaf_food_2).
    const img: HTMLImageElement | null = useEasy
      ? (this.foodEasyBg ?? this.foodDefault)
      : this.foodDefault;
    if (img) {
      this.sprites.set('food', img);
      this.foodPivot = alphaWeightedCentroid(img);
    } else {
      this.sprites.delete('food');
    }
  }

  /**
   * Call after background selection: food matches easy-folder art when that folder is in use.
   */
  setFoodFromEasyBackground(fromEasyFolder: boolean): void {
    this.foodUseEasyBg = fromEasyFolder;
    if (this._ready) this.applyFoodSpriteSelection();
  }

  /** True while the active background texture is from `assets/game/easy/` (extra food styling). */
  usesEasyFolderBackgroundFood(): boolean {
    return this.foodUseEasyBg;
  }

  private async _doLoad(): Promise<void> {
    const loadOne = (type: EntityType, src: string): Promise<void> =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => {
          this.sprites.set(type, img);
          resolve();
        };
        img.onerror = () => {
          console.warn(`SpriteLoader: failed to load "${src}"`);
          resolve();
        };
        img.src = src;
      });

    const loadAgentGender = (gender: 'male' | 'female', src: string): Promise<void> =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => {
          this.agentSprites.set(gender, img);
          resolve();
        };
        img.onerror = () => {
          console.warn(`SpriteLoader: failed to load agent sprite "${src}"`);
          resolve();
        };
        img.src = src;
      });

    const tasks: Promise<void>[] = [
      ...(Object.entries(SPRITE_PATHS) as [Exclude<EntityType, 'agent' | 'food'>, string][]).map(
        ([type, src]) => loadOne(type, src),
      ),
      ...(['male', 'female'] as const).map(g => loadAgentGender(g, AGENT_SPRITE_BY_GENDER[g])),
    ];

    await Promise.all(tasks);

    const [fd, fe] = await Promise.all([
      this.loadFoodVariant(FOOD_PATH_DEFAULT),
      this.loadFoodVariant(FOOD_PATH_EASY_BG),
    ]);
    this.foodDefault = fd;
    this.foodEasyBg = fe;
    this.applyFoodSpriteSelection();

    // `get('agent')` returns male sprite if present (legacy / fallback).
    const male = this.agentSprites.get('male');
    if (male) this.sprites.set('agent', male);

    this._ready = true;
  }

  /** Returns the loaded image for a given entity type, or null if unavailable. */
  get(type: EntityType): HTMLImageElement | null {
    return this.sprites.get(type) ?? null;
  }

  /** Agent texture by gender; falls back to the other gender, then null. */
  getAgent(gender: 'male' | 'female'): HTMLImageElement | null {
    const primary = this.agentSprites.get(gender) ?? null;
    if (primary) return primary;
    const fallback = this.agentSprites.get(gender === 'male' ? 'female' : 'male') ?? null;
    return fallback;
  }

  /** Normalized pivot for food sprite so visible mass sits on entity (cx,cy). */
  getFoodPivot(): { nx: number; ny: number } {
    return this.foodPivot;
  }
}

/** Singleton shared across the renderer — load once, reuse everywhere. */
export const spriteLoader = new SpriteLoader();
