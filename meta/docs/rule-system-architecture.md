---
SECTION_ID: docs.rule-system-architecture
TYPE: note
---

# Rule System Architecture

## Overview

The rule system is a **data-driven, handler-based behavior engine**.
Rules are plain data objects. Behavior is pure functions. The engine wires them together.

```
WorldState.rules[]  →  RuleEngine.applyAll()  →  Entity mutations
     (data)                  (dispatch)              (physics)
```

---

## Core Types

```ts
// A rule is pure data — no code, no methods
interface Rule {
  id:       string;       // unique identifier
  type:     RuleType;     // which handler to invoke
  enabled:  boolean;      // global ON/OFF toggle
  strength: number;       // 0.0–2.0 scale applied by handler
  targets:  EntityType[]; // [] = all types, else filter
  params:   Record<string, unknown>; // handler-specific config
}

// A handler is a pure function
type RuleHandler = (entity: Entity, world: WorldState, rule: Rule, dt: number) => void;
```

---

## Implemented Rules

| Rule             | What it does                                              | Key params                              |
|------------------|-----------------------------------------------------------|-----------------------------------------|
| `attraction`     | Pull toward nearby entities of target type (all matches) | `targetType`, `radius`                  |
| `repulsion`      | Push away from nearby entities of target type            | `targetType`, `radius`                  |
| `goal_seek`      | Steer toward single nearest target (arrive behaviour)    | `targetType`, `radius`, `arriveRadius`  |
| `replication`    | Spawn child when energy > threshold (cooldown gated)     | `threshold`, `cooldown`                 |
| `speed_modifier` | Scale or set entity maxSpeed at runtime                  | `mode`, `baseSpeed`, `fixedSpeed`       |
| `mutation`       | Random perturbation of velocity/speed/energy/mass        | `velocityNoise`, `mutateVelocity`, …    |
| `gravity`        | Constant directional force                               | `angle`                                 |
| `flocking`       | Boids: separation + alignment + cohesion                 | `radius`, `separationWeight`, …         |
| `predation`      | Energy transfer on contact (predator eats prey)          | `predatorType`, `preyType`, `contactRadius` |
| `decay`          | Constant energy drain per second                         | `rate`                                  |

---

## Toggle System

### Global toggle (per rule)
```ts
rule.enabled = false;
// WorldState.getActiveRules() filters these out — handler never called
```

### Per-entity suppression
```ts
// Suppress specific rules on a specific entity
entity.meta.disabledRules = new Set(['rule-gravity-1', 'rule-decay-1']);
// RuleEngine checks this set before calling the handler
```

Both mechanisms are checked **before** the handler is invoked — zero cost when disabled.

---

## Hot-Swap API

Replace any handler at runtime without restarting the simulation:

```ts
// Override built-in attraction with custom logic
engine.registerHandler('attraction', (entity, world, rule, dt) => {
  // custom implementation
});

// Remove a handler (rules of this type silently no-op)
engine.unregisterHandler('decay');

// Restore default
import { DEFAULT_HANDLERS } from './rules/handlers';
engine.registerHandler('decay', DEFAULT_HANDLERS.decay!);
```

The new handler takes effect on the **very next tick**.

---

## Adding a New Rule (3 steps)

1. **Add type** — `src/engine/types.ts`:
   ```ts
   export type RuleType = ... | 'my_rule';
   ```

2. **Create handler** — `src/engine/rules/handlers/my_rule.ts`:
   ```ts
   export const myRuleHandler: RuleHandler = (entity, world, rule, dt) => {
     // your logic
   };
   ```

3. **Register** — `src/engine/rules/handlers/index.ts`:
   ```ts
   import { myRuleHandler } from './my_rule';
   export const DEFAULT_HANDLERS = {
     ...existing,
     my_rule: myRuleHandler,
   };
   ```

Zero changes to `RuleEngine.ts` or `SimLoop.ts`.

---

## Execution Order (per tick)

```
SimLoop._tick(dt)
  │
  ├─ ruleEngine.applyAll(world, dt)
  │    └─ for each alive entity:
  │         for each enabled rule:
  │           isTargeted?          → rule.targets check
  │           isEntitySuppressed?  → entity.meta.disabledRules check
  │           handler(entity, world, rule, dt)
  │
  ├─ entity.integrate(dt, damping)   ← velocity clamped to maxSpeed
  ├─ world.applyBoundary(entity)
  ├─ world.purgeDeadEntities()
  └─ world.flushSpawnQueue()         ← replication children appear here
```

---

## File Structure

```
src/engine/rules/
├── RuleEngine.ts              ← dispatcher + hot-swap API
└── handlers/
    ├── index.ts               ← DEFAULT_HANDLERS registry
    ├── attraction.ts
    ├── repulsion.ts
    ├── goal_seek.ts
    ├── replication.ts
    ├── speed_modifier.ts
    └── mutation.ts
```
