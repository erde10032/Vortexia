// ─────────────────────────────────────────────
//  Vortexia — UI State
// ─────────────────────────────────────────────
//
//  Single source of truth for all UI state.
//  Uses a tiny pub/sub so any module can react to changes
//  without direct coupling.
//
//  Pattern: Observable store — subscribe(key, cb) → unsubscribe fn
// ─────────────────────────────────────────────

import type { Entity } from '../engine/Entity';
import type { Rule }   from '../engine/types';

// ─── State shape ─────────────────────────────

export interface UIStateShape {
  /** Is the simulation currently running (not paused) */
  simRunning:      boolean;
  /** Currently selected entity for inspector panel */
  selectedEntity:  Entity | null;
  /** Entity being dragged from rule list (rule id) */
  draggingRuleId:  string | null;
  /** Rules currently in the active drop zone */
  activeRuleIds:   Set<string>;
  /** Sim stats for top bar display */
  tick:            number;
  entityCount:     number;
}

type StateKey = keyof UIStateShape;
type Listener<K extends StateKey> = (value: UIStateShape[K]) => void;

// ─── UIState ─────────────────────────────────

class UIStateStore {
  private state: UIStateShape = {
    simRunning:     false,
    selectedEntity: null,
    draggingRuleId: null,
    activeRuleIds:  new Set(),
    tick:           0,
    entityCount:    0,
  };

  private listeners = new Map<StateKey, Set<Listener<StateKey>>>();

  // ─── Read ──────────────────────────────────

  get<K extends StateKey>(key: K): UIStateShape[K] {
    return this.state[key];
  }

  // ─── Write ─────────────────────────────────

  set<K extends StateKey>(key: K, value: UIStateShape[K]): void {
    this.state[key] = value;
    this.notify(key);
  }

  // ─── Subscribe ─────────────────────────────

  /** Subscribe to a specific key. Returns unsubscribe fn. */
  on<K extends StateKey>(key: K, cb: Listener<K>): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(cb as Listener<StateKey>);
    return () => this.listeners.get(key)?.delete(cb as Listener<StateKey>);
  }

  private notify(key: StateKey): void {
    this.listeners.get(key)?.forEach(cb => cb(this.state[key]));
  }
}

// Singleton — import this everywhere
export const UIState = new UIStateStore();
