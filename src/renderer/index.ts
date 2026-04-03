// ─────────────────────────────────────────────
//  Vortexia — Renderer Public API
// ─────────────────────────────────────────────

// Main entry point
export { Renderer } from './Renderer';

// Sub-systems (for advanced use / testing)
export { TrailBuffer }  from './TrailBuffer';
export { EffectBus }    from './EffectBus';
export type { VisualEffect, EffectKind } from './EffectBus';
export type { TrailPoint }               from './TrailBuffer';

// Config (for UI sliders / theming)
export {
  ENTITY_VISUALS,
  CONNECTION_CONFIG,
  TRAIL_CONFIG,
  BG_CONFIG,
  EFFECT_CONFIG,
  PERF_CONFIG,
} from './RendererConfig';
export type { EntityVisual } from './RendererConfig';

// Individual layers (for custom rendering pipelines)
export { LayerBackground }  from './layers/LayerBackground';
export { LayerTrails }      from './layers/LayerTrails';
export { LayerConnections } from './layers/LayerConnections';
export { LayerEntities }    from './layers/LayerEntities';
export { LayerEffects }     from './layers/LayerEffects';
