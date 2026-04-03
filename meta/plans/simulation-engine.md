---
SECTION_ID: plans.simulation-engine
TYPE: plan
---

# Simulation Engine Implementation

GOAL: Build modular, extendable simulation engine for Reality Composer
TIMELINE: 1 session

## Task Checklist

### Phase 1: Types & Interfaces
- [x] Define Vec2, EntityType, EntityState, RuleType interfaces in types.ts

### Phase 2: Entity Class
- [*] Entity class with position, velocity, type, state, energy, age

### Phase 3: World State Manager
- [ ] WorldState: entity registry, add/remove/query, bounds config

### Phase 4: Rule Engine
- [ ] RuleEngine: apply rules per tick (gravity, flocking, predation, replication, decay)

### Phase 5: Simulation Loop
- [ ] SimLoop: fixed-step RAF loop, tick(), pause/resume/reset

### Phase 6: Barrel Export
- [ ] src/engine/index.ts clean exports

## Success Criteria
- [ ] All modules compile cleanly (TypeScript)
- [ ] SimLoop runs at 60fps fixed-step
- [ ] Rules hot-reload without stopping sim
- [ ] Fully extendable: new rule = new file, no core changes
