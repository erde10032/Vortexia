// ─────────────────────────────────────────────
//  Vortexia — Engine Public API
// ─────────────────────────────────────────────
//
//  Import everything from here:
//    import { SimLoop, WorldState, Entity } from './engine'
// ─────────────────────────────────────────────

// Core types
export type {
  Vec2,
  EntityType,
  EntityState,
  RuleType,
  BoundaryMode,
  Rule,
  WorldConfig,
  SimStats,
  SimEventType,
  SimEvent,
  EventHandler,
} from './types';

// Entity + Vec2 math utilities
export {
  Entity,
  AGENT_ENERGY_MAX,
  AGENT_ENERGY_REST_CAP,
  AGENT_ENERGY_RECOVERY_PER_SEC,
  vec2,
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Len,
  vec2Norm,
  vec2Dist,
  vec2Clamp,
} from './Entity';
export type { EntityOptions } from './Entity';

// World state + event bus
export { WorldState, EventBus, DEFAULT_WORLD_CONFIG } from './WorldState';

// Rule engine
export { RuleEngine } from './rules/RuleEngine';
export type { RuleHandler } from './rules/RuleEngine';
export { DEFAULT_HANDLERS } from './rules/handlers/index';

// Simulation loop
export { SimLoop } from './SimLoop';
export type { OnTickCallback, OnRenderCallback } from './SimLoop';
