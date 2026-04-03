// src/ui/autoDifficulty.ts
// Presets for auto mode: spawn counts, age bands, food spread rate.

import { WorldState, Entity, vec2 } from '../engine/index';

export type AutoDifficulty = 'easy' | 'medium' | 'hard';

export interface AutoDifficultyConfig {
  males: number;
  females: number;
  ageMin: number;
  ageMax: number;
  attractor: number;
  obstacle: number;
  food: number;
  foodSpreadChance: number;
}

export const AUTO_DIFFICULTY_PRESETS: Record<AutoDifficulty, AutoDifficultyConfig> = {
  easy: {
    males: 5,
    females: 5,
    ageMin: 18,
    ageMax: 30,
    attractor: 1,
    obstacle: 3,
    food: 30,
    foodSpreadChance: 0.000055,
  },
  medium: {
    males: 2,
    females: 2,
    ageMin: 18,
    ageMax: 45,
    attractor: 2,
    obstacle: 7,
    food: 15,
    foodSpreadChance: 0.000055,
  },
  hard: {
    males: 1,
    females: 1,
    ageMin: 18,
    ageMax: 55,
    attractor: 4,
    obstacle: 15,
    food: 5,
    foodSpreadChance: 0.000027,
  },
};

/** Spawn agents with explicit gender split and age range (auto mode only). */
export function spawnAutoAgents(world: WorldState, cfg: AutoDifficultyConfig): void {
  const { width: W, height: H } = world.config;
  const randAge = () => cfg.ageMin + Math.random() * (cfg.ageMax - cfg.ageMin);
  const pos = () => vec2(Math.random() * W, Math.random() * H);
  const vel = () => vec2((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);

  for (let i = 0; i < cfg.males; i++) {
    world.addEntity(
      new Entity({
        type: 'agent',
        position: pos(),
        velocity: vel(),
        energy: 130 + Math.random() * 50,
        hunger: 110 + Math.random() * 60,
        gender: 'male',
        ageYears: randAge(),
        frailty: 0.8 + Math.random() * 0.4,
      }),
    );
  }
  for (let i = 0; i < cfg.females; i++) {
    world.addEntity(
      new Entity({
        type: 'agent',
        position: pos(),
        velocity: vel(),
        energy: 130 + Math.random() * 50,
        hunger: 110 + Math.random() * 60,
        gender: 'female',
        ageYears: randAge(),
        frailty: 0.8 + Math.random() * 0.4,
      }),
    );
  }
}
