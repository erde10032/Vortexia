// ─────────────────────────────────────────────
//  Vortexia — Active Rule Slot / Drop Zone
// ─────────────────────────────────────────────
//
//  The center panel "active area" where users drop rule cards.
//  Each dropped rule gets a compact ActiveSlot chip.
//
//  Handles:
//    - dragover / drop → enable rule in WorldState
//    - Remove button on chip → disable rule
//    - Visual: glowing border on dragover, chips per rule type
// ─────────────────────────────────────────────

import type { Rule }       from '../engine/types';
import type { WorldState } from '../engine/WorldState';
import { UIState }         from './UIState';

// ─── ActiveRuleZone ───────────────────────────

export class ActiveRuleZone {
  private el:    HTMLElement;
  private world: WorldState;
  private chips  = new Map<string, HTMLElement>();

  constructor(el: HTMLElement, world: WorldState) {
    this.el    = el;
    this.world = world;
    this._bindDrop();
    this._bindWorldEvents();
  }

  // ─── Drop zone wiring ─────────────────────

  private _bindDrop(): void {
    const { el } = this;

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      el.classList.add('active-zone--over');
    });

    el.addEventListener('dragleave', (e) => {
      // Only remove if leaving the zone itself (not a child)
      if (!el.contains(e.relatedTarget as Node)) {
        el.classList.remove('active-zone--over');
      }
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('active-zone--over');

      const ruleId = e.dataTransfer!.getData('text/rule-id');
      if (!ruleId) return;

      const rule = this.world.getRule(ruleId);
      if (!rule) return;

      // Enable the rule in world
      const updated: Rule = { ...rule, enabled: true };
      this.world.setRule(updated);

      // Track in UIState
      const activeIds = UIState.get('activeRuleIds');
      activeIds.add(ruleId);
      UIState.set('activeRuleIds', activeIds);

      this._addChip(updated);
    });
  }

  // ─── World event sync ─────────────────────

  private _bindWorldEvents(): void {
    // When a rule is toggled off externally, remove its chip
    this.world.events.on('rule:changed', (e) => {
      const { ruleId, newVal } = e.data as { ruleId: string; newVal: Rule };
      if (newVal && !newVal.enabled && this.chips.has(ruleId)) {
        this._removeChip(ruleId);
      }
    });
  }

  // ─── Chip management ─────────────────────

  private _addChip(rule: Rule): void {
    if (this.chips.has(rule.id)) return; // already present

    const chip = document.createElement('div');
    chip.className = 'active-chip';
    chip.dataset.ruleId = rule.id;
    chip.innerHTML = `
      <span class="active-chip-name">${rule.type.replace(/_/g, ' ')}</span>
      <button class="active-chip-remove" title="Remove rule" aria-label="Remove">✕</button>
    `;

    chip.querySelector('.active-chip-remove')!.addEventListener('click', () => {
      this._removeChip(rule.id);
      // Disable in world
      const r = this.world.getRule(rule.id);
      if (r) this.world.setRule({ ...r, enabled: false });
      // Remove from UIState
      const activeIds = UIState.get('activeRuleIds');
      activeIds.delete(rule.id);
      UIState.set('activeRuleIds', activeIds);
    });

    // Animate in
    chip.style.opacity = '0';
    chip.style.transform = 'scale(0.8)';
    this.el.appendChild(chip);
    requestAnimationFrame(() => {
      chip.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      chip.style.opacity    = '1';
      chip.style.transform  = 'scale(1)';
    });

    this.chips.set(rule.id, chip);
    this._updateEmptyState();
  }

  private _removeChip(ruleId: string): void {
    const chip = this.chips.get(ruleId);
    if (!chip) return;

    chip.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
    chip.style.opacity    = '0';
    chip.style.transform  = 'scale(0.8)';
    setTimeout(() => chip.remove(), 160);
    this.chips.delete(ruleId);
    this._updateEmptyState();
  }

  private _updateEmptyState(): void {
    const hint = this.el.querySelector('.active-zone-hint');
    if (hint) {
      (hint as HTMLElement).style.display = this.chips.size === 0 ? '' : 'none';
    }
  }

  /** Clear all chips (on world reset) */
  clear(): void {
    for (const [id] of this.chips) this._removeChip(id);
    UIState.set('activeRuleIds', new Set());
  }

  private _clearChipsImmediate(): void {
    for (const chip of this.chips.values()) {
      chip.remove();
    }
    this.chips.clear();
    UIState.set('activeRuleIds', new Set());
    this._updateEmptyState();
  }

  /** Rebuild drop-zone chips after load (rules already restored on world). */
  restoreActiveRules(ruleIds: string[]): void {
    this._clearChipsImmediate();
    for (const id of ruleIds) {
      const rule = this.world.getRule(id);
      if (!rule) continue;
      const updated: Rule = { ...rule, enabled: true };
      this.world.setRule(updated);
      const activeIds = UIState.get('activeRuleIds');
      activeIds.add(id);
      UIState.set('activeRuleIds', activeIds);
      this._addChip(updated);
    }
  }
}
