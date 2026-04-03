// src/persistence/saveGame.ts
//
// Three localStorage slots for full game state (entities, rules, mode settings).

import type { Rule } from '../engine/types';
import type { WorldState } from '../engine/WorldState';
import { Entity } from '../engine/Entity';
import type { AutoDifficulty } from '../ui/autoDifficulty';
import type { SurvivalRuntimeSaveState } from '../survival/SurvivalRuntime';

const STORAGE_PREFIX = 'vortexia_save_';
const SLOT_COUNT = 3;

export type SimMode = 'manual' | 'auto' | 'survival';

export interface GameSnapshotV1 {
  version: 1;
  entities: ReturnType<Entity['toJSON']>[];
  rules: Rule[];
  tick: number;
  mode: SimMode;
  autoDifficulty: AutoDifficulty;
  foodSpread: { enabled: boolean; chancePerFoodPerTick: number };
  manualSpawn: { agent: number; food: number; attractor: number; obstacle: number };
  activeRuleIds: string[];
  bgDifficulty: 'easy' | 'medium' | 'hard';
  survivalState?: SurvivalRuntimeSaveState;
}

export interface SlotEnvelopeV1 {
  version: 1;
  savedAt: string;
  meta: {
    mode: SimMode;
    autoDifficulty?: AutoDifficulty;
    liveAmoeba: number;
  };
  snapshot: GameSnapshotV1;
}

export interface SlotListItem {
  slot: 1 | 2 | 3;
  empty: boolean;
  savedAt: string | null;
  meta: SlotEnvelopeV1['meta'] | null;
}

function keyForSlot(slot: 1 | 2 | 3): string {
  return `${STORAGE_PREFIX}${slot}`;
}

export function listSlots(): SlotListItem[] {
  const out: SlotListItem[] = [];
  for (let s = 1; s <= SLOT_COUNT; s++) {
    const slot = s as 1 | 2 | 3;
    const raw = localStorage.getItem(keyForSlot(slot));
    if (!raw) {
      out.push({ slot, empty: true, savedAt: null, meta: null });
      continue;
    }
    try {
      const data = JSON.parse(raw) as SlotEnvelopeV1;
      out.push({
        slot,
        empty: false,
        savedAt: data.savedAt ?? null,
        meta:    data.meta ?? null,
      });
    } catch {
      out.push({ slot, empty: true, savedAt: null, meta: null });
    }
  }
  return out;
}

export function readSlot(slot: 1 | 2 | 3): SlotEnvelopeV1 | null {
  const raw = localStorage.getItem(keyForSlot(slot));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SlotEnvelopeV1;
  } catch {
    return null;
  }
}

export function writeSlot(slot: 1 | 2 | 3, envelope: SlotEnvelopeV1): void {
  localStorage.setItem(keyForSlot(slot), JSON.stringify(envelope));
}

export function clearSlot(slot: 1 | 2 | 3): void {
  localStorage.removeItem(keyForSlot(slot));
}

function liveAmoebaCount(world: WorldState): number {
  return world.getByType('agent').length;
}

export function buildSnapshot(
  world: WorldState,
  mode: SimMode,
  autoDifficulty: AutoDifficulty,
  foodSpread: { enabled: boolean; chancePerFoodPerTick: number },
  manualSpawn: { agent: number; food: number; attractor: number; obstacle: number },
  activeRuleIds: string[],
  bgDifficulty: 'easy' | 'medium' | 'hard',
  survivalState?: SurvivalRuntimeSaveState,
): GameSnapshotV1 {
  const entities = world.getAlive().map(e => e.toJSON());
  return {
    version: 1,
    entities,
    rules: world.getAllRules(),
    tick: world.tick,
    mode,
    autoDifficulty,
    foodSpread: { ...foodSpread },
    manualSpawn: { ...manualSpawn },
    activeRuleIds: [...activeRuleIds],
    bgDifficulty,
    survivalState,
  };
}

export function applySnapshotToWorld(world: WorldState, snap: GameSnapshotV1): Entity[] {
  const entities = snap.entities.map(raw => Entity.fromSavedRecord(raw as Record<string, unknown>));
  world.restoreFromSnapshot(entities, snap.rules, snap.tick);
  return entities;
}
