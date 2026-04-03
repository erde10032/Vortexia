// Preload all runtime game assets (sprites, backgrounds, music) before bootstrap.
// Mirrors URLs used by SpriteLoader, backgroundAssets, and MusicManager.

import { allBackgroundImageUrls } from '../renderer/backgroundAssets';

import leafFoodUrl from '../../assets/game/leaf_food.png?url';
import leafFood2Url from '../../assets/game/leaf_food_2.png?url';
import vortexAttractorUrl from '../../assets/game/vortex_attractor.png?url';
import stoneObstacleUrl from '../../assets/game/stone_obstacle.png?url';
import amoebaMaleUrl from '../../assets/game/amoeba_agent.png?url';
import amoebaFemaleUrl from '../../assets/game/amoeba_agent_2.png?url';

import bgMusic1 from '../../assets/audio/bg_music_1.mp3?url';
import bgMusic2 from '../../assets/audio/bg_music_2.mp3?url';
import bgMusic3 from '../../assets/audio/bg_music_3.mp3?url';

function collectAssetUrls(): string[] {
  const spriteUrls = [
    leafFoodUrl,
    leafFood2Url,
    vortexAttractorUrl,
    stoneObstacleUrl,
    amoebaMaleUrl,
    amoebaFemaleUrl,
  ];
  const musicUrls = [bgMusic1, bgMusic2, bgMusic3];
  const set = new Set<string>();
  for (const u of spriteUrls) set.add(u);
  for (const u of allBackgroundImageUrls()) set.add(u);
  for (const u of musicUrls) set.add(u);
  return [...set];
}

function preloadImage(url: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** Warm HTTP cache for audio (same-origin); MusicManager will reuse cached bytes. */
function preloadAudio(url: string): Promise<void> {
  return fetch(url, { mode: 'cors', credentials: 'same-origin' })
    .then(() => undefined)
    .catch(() => undefined);
}

function preloadOne(url: string): Promise<void> {
  if (/\.(mp3|ogg|wav|m4a)(\?|#|$)/i.test(url)) return preloadAudio(url);
  return preloadImage(url);
}

/**
 * Load every bundled asset URL. Invokes onProgress with 0–100.
 * Never rejects; failed assets still bump progress.
 */
export async function preloadGameAssets(onProgress: (percent: number) => void): Promise<void> {
  const urls = collectAssetUrls();
  const n = urls.length;
  if (n === 0) {
    onProgress(100);
    return;
  }
  let done = 0;
  const bump = (): void => {
    done++;
    onProgress(Math.min(100, Math.round((done / n) * 100)));
  };
  await Promise.all(urls.map(u => preloadOne(u).finally(bump)));
  onProgress(100);
}
