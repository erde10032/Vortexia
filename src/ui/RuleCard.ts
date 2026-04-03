// src/ui/RuleCard.ts

// ─────────────────────────────────────────────
//  Vortexia — Rule Card
// ─────────────────────────────────────────────
//
//  Renders a single rule card in the left panel.
//  Handles:
//    - Drag start (HTML5 drag API, sets draggingRuleId in UIState)
//    - Toggle ON/OFF switch (mutates rule.enabled via WorldState)
//    - Strength slider (mutates rule.strength)
//    - Visual feedback: glow on active, dim on disabled
//
//  Each card is a <div class="rule-card"> injected into #rule-list.
// ─────────────────────────────────────────────

import type { Rule, EntityType } from '../engine/types';
import type { WorldState } from '../engine/WorldState';
import { UIState }         from './UIState';
import { entityTypeLabel } from './entityDisplay';

// ─── Color map per rule type ──────────────────

const RULE_COLORS: Record<string, string> = {
  attraction:     '#00F5FF',
  repulsion:      '#FF2D78',
  flocking:       '#BF5FFF',
  replication:    '#39FF14',
  decay:          '#FF8C00',
  goal_seek:      '#00F5FF',
  predation:      '#FF2D78',
  mutation:       '#BF5FFF',
  speed_modifier: '#FFD700',
  gravity:        '#7DF9FF',
  default:        '#888',
};

function ruleColor(type: string): string {
  return RULE_COLORS[type] ?? RULE_COLORS.default;
}

const RULE_ICONS: Record<string, string> = {
  attraction: '🧲',
  repulsion: '⟠',
  flocking: '🫧',
  replication: '🧬',
  decay: '⌛',
  goal_seek: '🎯',
  predation: '☠',
  mutation: '✨',
  speed_modifier: '⚡',
  gravity: '🧭',
  default: '⬡',
};

function ruleIcon(type: string): string {
  return RULE_ICONS[type] ?? RULE_ICONS.default;
}

// ─── Parameter schemas for each rule type ────

interface ParamSchema {
  type: 'number' | 'boolean' | 'select';
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  default: any;
}

const RULE_PARAM_SCHEMAS: Record<string, Record<string, ParamSchema>> = {
  attraction: {
    targetType: {
      type: 'select',
      label: 'Target Type',
      options: [
        { value: 'agent', label: 'amoeba' },
        { value: 'food', label: 'food' },
        { value: 'attractor', label: 'vortex' },
        { value: 'obstacle', label: 'stone' },
      ],
      default: 'food',
    },
    radius: {
      type: 'number',
      label: 'Radius',
      min: 20,
      max: 500,
      step: 5,
      default: 200,
    },
  },
  repulsion: {
    targetType: {
      type: 'select',
      label: 'Target Type',
      options: [
        { value: 'agent', label: 'amoeba' },
        { value: 'food', label: 'food' },
        { value: 'attractor', label: 'vortex' },
        { value: 'obstacle', label: 'stone' },
      ],
      default: 'obstacle',
    },
    radius: {
      type: 'number',
      label: 'Radius',
      min: 20,
      max: 300,
      step: 5,
      default: 80,
    },
  },
  goal_seek: {
    targetType: {
      type: 'select',
      label: 'Target Type',
      options: [
        { value: 'agent', label: 'amoeba' },
        { value: 'food', label: 'food' },
        { value: 'attractor', label: 'vortex' },
        { value: 'obstacle', label: 'stone' },
      ],
      default: 'food',
    },
    radius: {
      type: 'number',
      label: 'Search Radius',
      min: 20,
      max: 500,
      step: 5,
      default: 300,
    },
    arriveRadius: {
      type: 'number',
      label: 'Arrive Radius',
      min: 5,
      max: 100,
      step: 5,
      default: 40,
    },
  },
  replication: {
    threshold: {
      type: 'number',
      label: 'Energy Threshold',
      min: 20,
      max: 300,
      step: 5,
      default: 150,
    },
    cooldown: {
      type: 'number',
      label: 'Cooldown (ticks)',
      min: 10,
      max: 300,
      step: 5,
      default: 60,
    },
  },
  speed_modifier: {
    mode: {
      type: 'select',
      label: 'Mode',
      options: [
        { value: 'scale', label: 'Scale (multiply base speed)' },
        { value: 'set', label: 'Set (fixed speed)' },
      ],
      default: 'scale',
    },
    baseSpeed: {
      type: 'number',
      label: 'Base Speed (scale mode)',
      min: 0,
      max: 400,
      step: 10,
      default: 200,
    },
    fixedSpeed: {
      type: 'number',
      label: 'Fixed Speed (set mode)',
      min: 0,
      max: 400,
      step: 10,
      default: 100,
    },
  },
  mutation: {
    mutateVelocity: {
      type: 'boolean',
      label: 'Mutate Velocity',
      default: true,
    },
    mutateSpeed: {
      type: 'boolean',
      label: 'Mutate MaxSpeed',
      default: false,
    },
    mutateEnergy: {
      type: 'boolean',
      label: 'Mutate Energy',
      default: false,
    },
    mutateMass: {
      type: 'boolean',
      label: 'Mutate Mass',
      default: false,
    },
    velocityNoise: {
      type: 'number',
      label: 'Velocity Noise',
      min: 0,
      max: 100,
      step: 1,
      default: 20,
    },
    speedNoise: {
      type: 'number',
      label: 'MaxSpeed Noise',
      min: 0,
      max: 30,
      step: 1,
      default: 5,
    },
    energyNoise: {
      type: 'number',
      label: 'Energy Noise',
      min: 0,
      max: 20,
      step: 1,
      default: 2,
    },
    massNoise: {
      type: 'number',
      label: 'Mass Noise',
      min: 0,
      max: 5,
      step: 0.1,
      default: 0,
    },
  },
  gravity: {
    angle: {
      type: 'number',
      label: 'Angle (degrees)',
      min: 0,
      max: 360,
      step: 1,
      default: 90,
    },
  },
  flocking: {
    radius: {
      type: 'number',
      label: 'Radius',
      min: 20,
      max: 300,
      step: 5,
      default: 100,
    },
    separationWeight: {
      type: 'number',
      label: 'Separation Weight',
      min: 0,
      max: 3,
      step: 0.1,
      default: 1.5,
    },
    alignmentWeight: {
      type: 'number',
      label: 'Alignment Weight',
      min: 0,
      max: 3,
      step: 0.1,
      default: 1.0,
    },
    cohesionWeight: {
      type: 'number',
      label: 'Cohesion Weight',
      min: 0,
      max: 3,
      step: 0.1,
      default: 1.0,
    },
  },
  predation: {
    predatorType: {
      type: 'select',
      label: 'Predator Type',
      options: [
        { value: 'agent', label: 'amoeba' },
      ],
      default: 'agent',
    },
    preyType: {
      type: 'select',
      label: 'Prey Type',
      options: [
        { value: 'food', label: 'food' },
        { value: 'agent', label: 'amoeba' },
      ],
      default: 'food',
    },
    contactRadius: {
      type: 'number',
      label: 'Contact Radius',
      min: 5,
      max: 50,
      step: 1,
      default: 15,
    },
    energyTransfer: {
      type: 'number',
      label: 'Energy Transfer',
      min: 0,
      max: 100,
      step: 1,
      default: 30,
    },
  },
  decay: {
    rate: {
      type: 'number',
      label: 'Decay Rate (per second)',
      min: 0,
      max: 20,
      step: 0.5,
      default: 5,
    },
  },
};

// ─── RuleCard ────────────────────────────────

export class RuleCard {
  private el:    HTMLElement;
  private rule:  Rule;
  private world: WorldState;

  constructor(rule: Rule, world: WorldState, container: HTMLElement) {
    this.rule  = rule;
    this.world = world;
    this.el    = this._build();
    container.appendChild(this.el);
  }

  // ─── Build DOM ────────────────────────────

  private _build(): HTMLElement {
    const { rule } = this;
    const color    = ruleColor(rule.type);
    const subtitle = (rule.targets.length ? entityTypeLabel(rule.targets[0] as EntityType) : 'all').toUpperCase();

    const card = document.createElement('div');
    card.className   = 'rule-card';
    card.draggable   = true;
    card.dataset.ruleId = rule.id;
    card.dataset.ruleType = rule.type;
    card.style.setProperty('--rule-color', color);

    card.innerHTML = `
      <span class="rule-drag-handle" title="Drag to activate">⠿</span>
      <div class="rule-card-body">
        <div class="rule-card-header">
          <div class="rule-title">
            <span class="rule-title-icon" aria-hidden="true"></span>
            <div class="rule-title-text">
              <span class="rule-name">${rule.type.replace(/_/g, ' ').toUpperCase()}</span>
              <span class="rule-subtitle">${subtitle}</span>
            </div>
          </div>
          <label class="rule-toggle" title="Toggle rule">
            <input type="checkbox" class="rule-toggle-input" ${rule.enabled ? 'checked' : ''}>
            <span class="rule-toggle-track"></span>
          </label>
        </div>
        <div class="rule-targets">
          ${rule.targets.length
            ? rule.targets.map(t => `<span class="rule-tag">${entityTypeLabel(t as EntityType)}</span>`).join('')
            : '<span class="rule-tag rule-tag--all">all</span>'
          }
        </div>
        <div class="rule-strength-row">
          <span class="rule-strength-label">STR</span>
          <input type="range" class="rule-strength-slider"
            min="-1" max="1" step="0.01"
            value="${rule.strength}">
          <span class="rule-strength-val">${rule.strength.toFixed(2)}</span>
        </div>
        <div class="rule-params-container"></div>
      </div>
    `;

    const paramsContainer = card.querySelector('.rule-params-container')!;
    this._renderParams(paramsContainer);

    this._bindEvents(card);
    this._syncEnabled(card);
    return card;
  }

  private _renderParams(container: HTMLElement): void {
    const schema = RULE_PARAM_SCHEMAS[this.rule.type];
    if (!schema) return;

    for (const [paramName, paramDef] of Object.entries(schema)) {
      const currentValue = (this.rule.params as any)[paramName] ?? paramDef.default;
      const control = this._createParamControl(paramName, paramDef, currentValue);
      container.appendChild(control);
    }
  }

  private _createParamControl(
    name: string,
    def: ParamSchema,
    value: any
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'rule-param-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'rule-param-label';
    labelSpan.textContent = def.label;
    row.appendChild(labelSpan);

    if (def.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!value;
      input.classList.add('rule-param-checkbox');
      input.addEventListener('change', () => {
        this._updateParam(name, input.checked);
      });
      row.appendChild(input);
      return row;
    }

    if (def.type === 'select') {
      const select = document.createElement('select');
      select.className = 'rule-param-select';
      for (const opt of def.options!) {
        const option = document.createElement('option');
        option.value = String(opt.value);
        option.textContent = opt.label;
        if (opt.value === value) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        let newValue: string | number = select.value;
        if (!isNaN(Number(newValue))) newValue = Number(newValue);
        this._updateParam(name, newValue);
      });
      row.appendChild(select);
      return row;
    }

    // number type
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(def.min ?? 0);
    slider.max = String(def.max ?? 100);
    slider.step = String(def.step ?? 1);
    slider.value = String(value);
    slider.classList.add('rule-param-slider');

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = String(def.min ?? 0);
    numberInput.max = String(def.max ?? 100);
    numberInput.step = String(def.step ?? 1);
    numberInput.value = String(value);
    numberInput.classList.add('rule-param-number');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'rule-param-value';
    valueSpan.textContent = def.step && def.step < 0.1 ? value.toFixed(1) : value.toFixed(0);

    const updateValue = (val: number) => {
      slider.value = String(val);
      numberInput.value = String(val);
      valueSpan.textContent = def.step && def.step < 0.1 ? val.toFixed(1) : val.toFixed(0);
      this._updateParam(name, val);
    };

    slider.addEventListener('input', () => updateValue(parseFloat(slider.value)));
    numberInput.addEventListener('input', () => updateValue(parseFloat(numberInput.value)));

    row.appendChild(slider);
    row.appendChild(numberInput);
    row.appendChild(valueSpan);
    return row;
  }

  private _updateParam(paramName: string, value: any): void {
    const updated: Rule = {
      ...this.rule,
      params: {
        ...this.rule.params,
        [paramName]: value,
      },
    };
    this.world.setRule(updated);
    this.rule = updated;
    // Do NOT call this.update() here to avoid potential recursion loops
  }

  // ─── Events ───────────────────────────────

  private _bindEvents(card: HTMLElement): void {
    const { rule, world } = this;

    // ── Drag start ──
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer!.effectAllowed = 'copy';
      e.dataTransfer!.setData('text/rule-id', rule.id);
      UIState.set('draggingRuleId', rule.id);
      card.classList.add('rule-card--dragging');
      e.dataTransfer!.setDragImage(card, 20, 20);
    });

    card.addEventListener('dragend', () => {
      UIState.set('draggingRuleId', null);
      card.classList.remove('rule-card--dragging');
    });

    // ── Toggle ──
    const checkbox = card.querySelector<HTMLInputElement>('.rule-toggle-input')!;
    checkbox.addEventListener('change', () => {
      const updated: Rule = { ...rule, enabled: checkbox.checked };
      world.setRule(updated);
      this.rule = updated;
      this._syncEnabled(card);
    });

    // ── Strength slider ──
    const slider  = card.querySelector<HTMLInputElement>('.rule-strength-slider')!;
    const valSpan = card.querySelector<HTMLElement>('.rule-strength-val')!;

    slider.addEventListener('input', () => {
      const strength = parseFloat(slider.value);
      valSpan.textContent = strength.toFixed(2);
      const updated: Rule = { ...rule, strength };
      world.setRule(updated);
      this.rule = updated;
    });
  }

  // ─── Sync visual state ────────────────────

  private _syncEnabled(card: HTMLElement): void {
    if (this.rule.enabled) {
      card.classList.remove('rule-card--disabled');
    } else {
      card.classList.add('rule-card--disabled');
    }
  }

  // ─── Public ───────────────────────────────

  /** Update card to reflect latest rule state (e.g. after external change) */
  update(rule: Rule): void {
    this.rule = rule;
    const checkbox = this.el.querySelector<HTMLInputElement>('.rule-toggle-input')!;
    const slider   = this.el.querySelector<HTMLInputElement>('.rule-strength-slider')!;
    const valSpan  = this.el.querySelector<HTMLElement>('.rule-strength-val')!;
    checkbox.checked    = rule.enabled;
    slider.value        = String(rule.strength);
    valSpan.textContent = rule.strength.toFixed(2);
    this._syncEnabled(this.el);

    const container = this.el.querySelector('.rule-params-container')!;
    container.innerHTML = '';
    this._renderParams(container);
  }

  get element(): HTMLElement { return this.el; }
  get ruleId():  string      { return this.rule.id; }

  destroy(): void {
    this.el.remove();
  }
}

// ─── RuleList ────────────────────────────────

export class RuleList {
  private container: HTMLElement;
  private world:     WorldState;
  private cards      = new Map<string, RuleCard>();

  constructor(container: HTMLElement, world: WorldState) {
    this.container = container;
    this.world     = world;
  }

  refresh(): void {
    const rules = this.world.getAllRules();
    const seen  = new Set<string>();

    for (const rule of rules) {
      seen.add(rule.id);
      if (this.cards.has(rule.id)) {
        this.cards.get(rule.id)!.update(rule);
      } else {
        const card = new RuleCard(rule, this.world, this.container);
        this.cards.set(rule.id, card);
      }
    }

    for (const [id, card] of this.cards) {
      if (!seen.has(id)) {
        card.destroy();
        this.cards.delete(id);
      }
    }
  }
}