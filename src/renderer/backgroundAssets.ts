// ─────────────────────────────────────────────
//  Background image lists — built at compile time.
//  Add/remove any number of .png files under assets/game/{easy,normal,hard}/.
// ─────────────────────────────────────────────

export type BgFolder = 'easy' | 'normal' | 'hard';

/** Any number of images per folder; common raster formats supported. */
const easy = [
  ...Object.values(import.meta.glob('../../assets/game/easy/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/easy/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/easy/*.jpeg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/easy/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
];

const normal = [
  ...Object.values(import.meta.glob('../../assets/game/normal/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/normal/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/normal/*.jpeg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/normal/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
];

const hard = [
  ...Object.values(import.meta.glob('../../assets/game/hard/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/hard/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/hard/*.jpeg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...Object.values(import.meta.glob('../../assets/game/hard/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
];

export const BG_IMAGE_URLS: Record<BgFolder, string[]> = {
  easy,
  normal,
  hard,
};

/** Same logical asset may appear as `/assets/x.png` or full `http://host/assets/x.png` — compare by pathname. */
function normalizeAssetPath(u: string): string {
  try {
    const base =
      typeof globalThis !== 'undefined' &&
      'location' in globalThis &&
      globalThis.location?.href
        ? globalThis.location.href
        : 'http://localhost/';
    return new URL(u, base).pathname;
  } catch {
    return u;
  }
}

let easyPathSet: Set<string> | null = null;

/**
 * True when the active background URL is one of the easy-folder textures
 * (Vite dev/prod may differ in string form; we match on pathname).
 */
export function isUrlFromEasyFolder(url: string | null): boolean {
  if (!url) return false;
  if (!easyPathSet) {
    easyPathSet = new Set(BG_IMAGE_URLS.easy.map(normalizeAssetPath));
  }
  return easyPathSet.has(normalizeAssetPath(url));
}

/** All URLs for preloading (deduped). */
export function allBackgroundImageUrls(): string[] {
  const s = new Set<string>();
  for (const u of easy) s.add(u);
  for (const u of normal) s.add(u);
  for (const u of hard) s.add(u);
  return [...s];
}
