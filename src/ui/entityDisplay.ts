// Human-readable labels for entity types (UI only; engine keeps agent / food / …).

import type { EntityType } from '../engine/types';

const LABELS: Record<EntityType, string> = {
  agent:     'amoeba',
  food:      'food',
  attractor: 'vortex',
  obstacle:  'stone',
};

export function entityTypeLabel(t: EntityType): string {
  return LABELS[t] ?? t;
}
