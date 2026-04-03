---
SECTION_ID: plans.rule-behavior-system
TYPE: plan
---

# Rule-Based Behavior System Extension

GOAL: Implement all 6 required rules + architecture docs + per-entity toggle system
TIMELINE: 1 session

## What already exists
- [x] attraction, repulsion, goal_seek, replication, decay, flocking, predation, gravity
- [x] Rule interface: { id, type, enabled, strength, targets[], params }
- [x] WorldState.getActiveRules() filters by enabled flag
- [x] RuleEngine.applyAll() iterates entities × rules, checks targets[]

## Task Checklist

### Phase 1: Types
- [*] Add 'speed_modifier' to RuleType union in types.ts

### Phase 2: Split rules into individual handler files
- [ ] handlers/attraction.ts
- [ ] handlers/repulsion.ts
- [ ] handlers/goal_seek.ts
- [ ] handlers/replication.ts
- [ ] handlers/speed_modifier.ts  (NEW)
- [ ] handlers/mutation.ts        (NEW)
- [ ] handlers/index.ts           (registry)

### Phase 3: Per-entity rule toggle via entity.meta.disabledRules
- [ ] RuleEngine checks entity.meta.disabledRules before applying

### Phase 4: Refactor RuleEngine
- [ ] registerHandler() for hot-swap at runtime
- [ ] applyAll() respects per-entity overrides

### Phase 5: Architecture doc
- [ ] meta/docs/rule-system-architecture.md

## Success Criteria
- [ ] All 6 required rules implemented
- [ ] Rules toggle ON/OFF via rule.enabled
- [ ] Per-entity rule suppression via entity.meta.disabledRules
- [ ] Hot-swap: registerHandler() replaces rule at runtime
