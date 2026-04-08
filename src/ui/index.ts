// src/ui/index.ts

// ─────────────────────────────────────────────
//  Vortexia — UI Public API
// ─────────────────────────────────────────────

export { UIState }           from './UIState';
export { RuleCard, RuleList } from './RuleCard';
export { ActiveRuleZone }    from './ActiveRuleSlot';
export { EntityInspector }   from './EntityInspector';
export { SimControls }       from './SimControls';
export { CanvasInteraction } from './CanvasInteraction';

// ─── Bootstrap ───────────────────────────────

import { WorldState, SimLoop, RuleEngine, Entity, vec2 } from '../engine/index';
import type { Rule, SimEvent } from '../engine/types';
import { Renderer }          from '../renderer/index';
import { RuleList }          from './RuleCard';
import { ActiveRuleZone }    from './ActiveRuleSlot';
import { EntityInspector }   from './EntityInspector';
import { SimControls }       from './SimControls';
import { CanvasInteraction } from './CanvasInteraction';
import { UIState }           from './UIState';
import { ChallengeEngine }   from '../challenge/ChallengeEngine';
import { ChallengeHUD }      from './ChallengeHUD';
import { ChallengePanel, saveScore } from './ChallengePanel';
import { SurvivalRuntime } from '../survival/SurvivalRuntime';
import {
  survivalRewardForRank,
  saveSurvivalBestIfBetter,
} from '../survival/survivalScore';
import {
  openSurvivalDefeatModal,
  openSurvivalManualModal,
  openSurvivalScoreModal,
  openSurvivalVictoryModal,
} from './survivalDialogs';
import { SURVIVAL_CHALLENGE_MIN_AMOEBA } from '../survival/survivalConstants';
import { ALL_MISSIONS }      from '../challenge/missions';
import type { ScoreBreakdown } from '../challenge/ChallengeTypes';
import { ObserverMode }      from './ObserverMode';
import {
  type AutoDifficulty,
  AUTO_DIFFICULTY_PRESETS,
  spawnAutoAgents,
} from './autoDifficulty';
import { MusicManager } from '../audio/MusicManager';
import {
  buildSnapshot,
  applySnapshotToWorld,
  listSlots,
  readSlot,
  writeSlot,
  type GameSnapshotV1,
  type SlotEnvelopeV1,
  type SimMode,
} from '../persistence/saveGame';

const WORLD_W = 1200;
const WORLD_H = 800;
const FOOD_SPREAD_RADIUS = 80;
const FOOD_SPREAD_MIN_DISTANCE = 18;
/** Hard cap on food entities in the world (spread + manual adds + seed). */
const MAX_FOOD_ENTITIES = 250;
const ONBOARDING_SEEN_KEY = 'vortexia:onboarding:seen:v1';
const TRAINING_DONE_KEY = 'vortexia:training:completed:v1';

/** Set after first startSimulation — applies Auto preset from difficulty modal while in-game. */
let applyStandardDifficultyPick: (() => void) | null = null;
let applyStandardSurvivalPick: (() => void) | null = null;
let launchTutorialFromOnboarding: (() => void) | null = null;
let runTutorialInCurrentSession: ((mode: SimMode) => void) | null = null;

function loadTrainingDone(): Record<SimMode, boolean> {
  try {
    const raw = window.localStorage.getItem(TRAINING_DONE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<Record<SimMode, boolean>> : {};
    return {
      manual: !!parsed.manual,
      auto: !!parsed.auto,
      survival: !!parsed.survival,
    };
  } catch {
    return { manual: false, auto: false, survival: false };
  }
}

function markTrainingDone(mode: SimMode): void {
  try {
    const cur = loadTrainingDone();
    cur[mode] = true;
    window.localStorage.setItem(TRAINING_DONE_KEY, JSON.stringify(cur));
  } catch {
    // ignore storage failures
  }
}

interface TutorialStep {
  title: string;
  body: string;
  anchorSelector?: string;
  allowNext?: boolean;
  allowedSelectors?: string[];
  allowedKeys?: string[];
  onEnter?: () => void;
  isComplete: () => boolean;
}

interface TutorialRuntime {
  enabled: boolean;
  mode: SimMode;
  panel: HTMLDivElement;
  steps: TutorialStep[];
  idx: number;
  stepEnteredAtReal: number;
  timer: number | null;
  allowedSelectors: string[];
  allowedKeys: Set<string>;
  stop: () => void;
}

let tutorialRuntime: TutorialRuntime | null = null;

function openOnboardingModal(contextMode: SimMode | null, onClose?: () => void): void {
  const existing = document.getElementById('onboarding-modal');
  if (existing) existing.remove();

  const steps: Array<{ title: string; body: string }> = [
    {
      title: 'Welcome to Vortexia',
      body: 'Grow and stabilize your amoeba ecosystem. Keep the population alive, adapt to conditions, and experiment with different modes.',
    },
    {
      title: 'Basic Controls',
      body:
        'Toolbar buttons: Start/Pause, Reset, Challenge, Observer, Survival Manual, Score, Speed, Mode, Difficulty, Setup, Save, Load. Keyboard: Space (Start/Pause), Shift+R (Reset), S (Speed), C (Challenge), O (Observer in non-survival), Z (Mode), F (Setup in Sandbox), Esc (close dialogs), and in Survival: W/A/S/D movement plus 1/2/3 abilities.',
    },
    contextMode === 'manual'
      ? {
          title: 'Sandbox Workflow',
          body: 'Drag rules from the Rule Library into the Active Zone, then tune behavior in Inspector. Use Setup to add entities and tune food spread.',
        }
      : contextMode === 'survival'
        ? {
            title: 'Survival Goals',
            body: 'Pick one amoeba in Inspector and control it with WASD. Keep population above collapse, react to events, and use abilities when cooldowns are ready.',
          }
        : contextMode === 'auto'
          ? {
            title: 'Auto Mode Tips',
            body: 'Choose a difficulty preset, watch ecosystem behavior, then open Difficulty anytime to rebalance food and terrain pressure.',
          }
          : {
            title: 'Pick a Mode',
            body: 'Survival: direct control + hazards. Auto: watch AI ecosystem with presets. Sandbox: drag rules and build behavior manually.',
          },
    {
      title: 'What To Do First',
      body: 'Choose a mode first, then press Start. Observe population and hunger in Inspector/Stats, then adjust mode settings if growth stalls.',
    },
  ];

  let idx = 0;
  const modal = document.createElement('div');
  modal.id = 'onboarding-modal';
  modal.className = 'challenge-panel';
  modal.style.zIndex = '1202';

  const close = () => {
    modal.remove();
    document.removeEventListener('keydown', onEsc);
    try {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    } catch {
      // Ignore storage access errors.
    }
    onClose?.();
  };

  const onEsc = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    close();
  };

  const render = () => {
    const step = steps[idx];
    const isFirst = idx === 0;
    const isLast = idx === steps.length - 1;
    modal.innerHTML = `
      <div class="cpanel-backdrop"></div>
      <div class="cpanel-inner" style="max-width:640px">
        <div class="cpanel-header">
          <span class="cpanel-header-icon">🧭</span>
          <h2 class="cpanel-title">GETTING STARTED</h2>
          <p class="cpanel-subtitle">Step ${idx + 1} of ${steps.length}</p>
          <button type="button" class="cpanel-close" id="onboarding-close" title="Close">✕</button>
        </div>
        <div class="cpanel-cards" style="display:block;max-width:560px;margin:0 auto;text-align:left">
          <div class="cpanel-card" style="--card-color:#00F5FF">
            <p class="cpanel-card-desc"><strong>${step.title}</strong></p>
            <p class="cpanel-card-desc" style="margin-top:10px">${step.body}</p>
            <div class="setup-actions" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center">
              <button type="button" class="btn setup-btn-apply" id="onboarding-training">Take Tutorial</button>
              <button type="button" class="btn setup-btn-close" id="onboarding-skip">Skip</button>
              <button type="button" class="btn setup-btn-close" id="onboarding-prev" ${isFirst ? 'disabled' : ''}>Back</button>
              <button type="button" class="btn setup-btn-apply" id="onboarding-next">${isLast ? 'Start Playing' : 'Next'}</button>
            </div>
          </div>
        </div>
      </div>`;

    modal.querySelector('.cpanel-backdrop')?.addEventListener('click', close);
    modal.querySelector('#onboarding-close')?.addEventListener('click', close);
    modal.querySelector('#onboarding-training')?.addEventListener('click', () => {
      close();
      launchTutorialFromOnboarding?.();
    });
    modal.querySelector('#onboarding-skip')?.addEventListener('click', close);
    modal.querySelector('#onboarding-prev')?.addEventListener('click', () => {
      if (idx === 0) return;
      idx -= 1;
      render();
    });
    modal.querySelector('#onboarding-next')?.addEventListener('click', () => {
      if (idx >= steps.length - 1) {
        close();
        return;
      }
      idx += 1;
      render();
    });
  };

  render();
  document.body.appendChild(modal);
  document.addEventListener('keydown', onEsc);
}

function maybeOpenOnboardingOnce(onClose?: () => void): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(ONBOARDING_SEEN_KEY) === '1') return false;
  } catch {
    // Ignore storage access errors and still show onboarding.
  }
  openOnboardingModal(null, onClose);
  return true;
}

function openTutorialModePicker(onPick: (mode: SimMode) => void): void {
  const done = loadTrainingDone();
  const badge = (m: SimMode) => done[m] ? ' <span style="color:#39FF14">✓ completed</span>' : '';
  const el = document.createElement('div');
  el.className = 'challenge-panel';
  el.style.zIndex = '1203';
  el.innerHTML = `
    <div class="cpanel-backdrop"></div>
    <div class="cpanel-inner" style="max-width:640px">
      <div class="cpanel-header">
        <span class="cpanel-header-icon">🎓</span>
        <h2 class="cpanel-title">TRAINING MODE</h2>
        <p class="cpanel-subtitle">Step 1: choose a mode to learn</p>
        <button type="button" class="cpanel-close" id="tutorial-picker-close" title="Close">✕</button>
      </div>
      <div class="cpanel-cards">
        <div class="cpanel-card" style="--card-color:#39FF14">
          <p class="cpanel-card-desc"><strong>Survival training</strong>${badge('survival')}<br/>Control one amoeba, use abilities, and complete a guided flow.</p>
          <div class="cpanel-card-footer"><button type="button" class="cpanel-start-btn" data-tutorial-mode="survival">Start Survival Training</button></div>
        </div>
        <div class="cpanel-card" style="--card-color:#00F5FF">
          <p class="cpanel-card-desc"><strong>Auto training</strong>${badge('auto')}<br/>Understand passive simulation and what to watch.</p>
          <div class="cpanel-card-footer"><button type="button" class="cpanel-start-btn" data-tutorial-mode="auto">Start Auto Training</button></div>
        </div>
        <div class="cpanel-card" style="--card-color:#BF5FFF">
          <p class="cpanel-card-desc"><strong>Sandbox training</strong>${badge('manual')}<br/>Try rules and setup tuning in a guided sequence.</p>
          <div class="cpanel-card-footer"><button type="button" class="cpanel-start-btn" data-tutorial-mode="manual">Start Sandbox Training</button></div>
        </div>
      </div>
    </div>`;
  const close = () => el.remove();
  el.querySelector('.cpanel-backdrop')?.addEventListener('click', close);
  el.querySelector('#tutorial-picker-close')?.addEventListener('click', close);
  el.querySelectorAll<HTMLButtonElement>('[data-tutorial-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.tutorialMode as SimMode | undefined;
      if (!mode) return;
      close();
      onPick(mode);
    });
  });
  document.body.appendChild(el);
}

function tagSurvivalAgents(world: WorldState): void {
  for (const a of world.getByType('agent')) {
    a.meta.survival = true;
    a.health = 100;
  }
}

function grantSurvivalRewards(world: WorldState, agents: number, food: number): void {
  const { width: W, height: H } = world.config;
  for (let i = 0; i < agents; i++) {
    world.addEntity(
      new Entity({
        type: 'agent',
        position: vec2(Math.random() * W, Math.random() * H),
        velocity: vec2((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80),
        energy: 120 + Math.random() * 40,
        hunger: 110 + Math.random() * 50,
        health: 100,
        gender: Math.random() < 0.5 ? 'male' : 'female',
        ageYears: 18 + Math.random() * 22,
        frailty: 0.8 + Math.random() * 0.4,
        meta: { survival: true },
      }),
    );
  }
  let n = food;
  while (n-- > 0) {
    if (world.getByType('food').length >= MAX_FOOD_ENTITIES) break;
    world.addEntity(
      new Entity({
        type: 'food',
        position: vec2(Math.random() * W, Math.random() * H),
        velocity: vec2(0, 0),
        energy: 100,
        mass: 2,
      }),
    );
  }
}

interface SpawnConfig {
  agent: number;
  food: number;
  attractor: number;
  obstacle: number;
}

/**
 * Full app bootstrap.
 * Call once after DOM is ready.
 */
export function bootstrap(): void {
  document.body.classList.remove('app-booting');

  const modeModal = document.getElementById('mode-modal')!;
  modeModal.classList.add('hidden');
  const autoDifficultyModal = document.getElementById('auto-difficulty-modal')!;
  const survivalDifficultyModal = document.getElementById('survival-difficulty-modal')!;
  const adiffClose = document.getElementById('adiff-close');
  const sdiffClose = document.getElementById('sdiff-close');
  const manualBtn = document.getElementById('mode-manual')!;
  const autoBtn   = document.getElementById('mode-auto')!;
  const survivalBtn = document.getElementById('mode-survival')!;
  const onboardingBtn = document.getElementById('mode-onboarding');
  const btnMode   = document.getElementById('btn-mode') as HTMLButtonElement | null;
  const btnSetup  = document.getElementById('btn-setup') as HTMLButtonElement | null;

  let mode: SimMode | null = null;
  let hasStarted = false;
  let autoDifficultyLevel: AutoDifficulty = 'medium';
  const manualInitialConfig: SpawnConfig = { agent: 40, food: 15, attractor: 5, obstacle: 5 };
  const foodSpreadConfig = { enabled: true, chancePerFoodPerTick: 0.00008 };
  launchTutorialFromOnboarding = () => {
    openTutorialModePicker((pickedMode) => {
      modeModal.classList.add('hidden');
      if (!hasStarted) {
        hasStarted = true;
        startSimulation(pickedMode, 'easy', true);
        return;
      }
      runTutorialInCurrentSession?.(pickedMode);
    });
  };
  const openedOnboardingNow = maybeOpenOnboardingOnce(() => {
    if (!hasStarted) modeModal.classList.remove('hidden');
  });
  if (!openedOnboardingNow) modeModal.classList.remove('hidden');
  onboardingBtn?.addEventListener('click', () => openOnboardingModal(mode));

  function closeAutoDifficultyModal(): void {
    autoDifficultyModal.classList.add('challenge-panel--hidden');
    if (!hasStarted) modeModal.classList.remove('hidden');
  }

  function closeSurvivalDifficultyModal(): void {
    survivalDifficultyModal.classList.add('challenge-panel--hidden');
    if (!hasStarted) modeModal.classList.remove('hidden');
  }

  function startSimulation(
    selectedMode: SimMode,
    autoDifficultyPick?: AutoDifficulty,
    tutorialMode = false,
  ) {
    if (tutorialMode) {
      autoDifficultyLevel = 'easy';
      manualInitialConfig.agent = 18;
      manualInitialConfig.food = 28;
      manualInitialConfig.attractor = 2;
      manualInitialConfig.obstacle = 2;
      foodSpreadConfig.enabled = true;
      foodSpreadConfig.chancePerFoodPerTick = 0.00012;
    }
    if ((selectedMode === 'auto' || selectedMode === 'survival') && autoDifficultyPick) {
      autoDifficultyLevel = autoDifficultyPick;
    }
    mode = selectedMode;
    modeModal.classList.add('hidden');
    if (btnSetup) btnSetup.style.display = selectedMode === 'manual' ? '' : 'none';

    // ── Music ─────────────────────────────────────────────────────────────────
    // Constructed here so all 3 tracks start preloading immediately.
    // start() is called right away — the mode-select click counts as a user
    // gesture, so browsers allow autoplay without deferral in most cases.
    const music = new MusicManager();
    music.start();

    const world  = new WorldState({ width: WORLD_W, height: WORLD_H });
    world.config.survivalDifficulty =
      selectedMode === 'survival' ? autoDifficultyLevel : undefined;
    const engine = new RuleEngine();
    const loop   = new SimLoop(world, engine);
    let survivalRt: SurvivalRuntime | null =
      selectedMode === 'survival'
        ? new SurvivalRuntime(world, autoDifficultyLevel, WORLD_W, WORLD_H)
        : null;
    const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    renderer.init(WORLD_W, WORLD_H);
    if (survivalRt) {
      loop.beforeIntegrate = (_w, dt) => survivalRt!.beforeIntegrate(dt);
      loop.beforePurge = (_w, dt) => {
        world.config.simSpeed = loop.speed;
        survivalRt!.beforePurge(dt);
      };
      renderer.setSurvivalOverlay((ctx, sx, sy) => survivalRt!.drawOverlay(ctx, sx, sy));
    } else {
      loop.beforeIntegrate = null;
      loop.beforePurge = null;
      renderer.setSurvivalOverlay(null);
    }
    renderer.connectEvents(world.events, world);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => renderer.resize());
      ro.observe(canvas);
    }

    const challengeEngine = new ChallengeEngine(world);
    const centerEl        = document.getElementById('panel-center')!;
    const challengeHUD    = new ChallengeHUD(centerEl, world);
    const challengePanel = new ChallengePanel(
      document.body,
      world,
      selectedMode === 'survival' ? 'survival' : 'standard',
    );

    const btnChallenge = document.getElementById('btn-challenge') as HTMLButtonElement;
    const challengeSlot = document.getElementById('toolbar-challenge-slot');

    function countSurvivalAmoeba(): number {
      return world.getAlive().filter(e => e.type === 'agent' && e.meta.survival === true).length;
    }

    function syncSurvivalChallengeChrome(): void {
      if (!btnChallenge) return;
      if (mode !== 'survival') {
        challengeSlot?.classList.remove('toolbar-challenge-slot--locked');
        btnChallenge.disabled = false;
        return;
      }
      const ok = countSurvivalAmoeba() >= SURVIVAL_CHALLENGE_MIN_AMOEBA;
      btnChallenge.disabled = !ok;
      if (!ok) challengeSlot?.classList.add('toolbar-challenge-slot--locked');
      else challengeSlot?.classList.remove('toolbar-challenge-slot--locked');
    }

    if (btnChallenge) {
      btnChallenge.addEventListener('click', () => {
        if (mode === 'survival' && countSurvivalAmoeba() < SURVIVAL_CHALLENGE_MIN_AMOEBA) return;
        challengePanel.setStyle(mode === 'survival' ? 'survival' : 'standard');
        challengePanel.show();
      });
    }

    world.events.on('challenge:select', ((e: SimEvent<{ missionId: string }>) => {
      const mission = ALL_MISSIONS.find(m => m.id === e.data.missionId);
      if (!mission) return;
      if (!loop.running) loop.start();
      challengeEngine.start(mission);
    }) as (e: SimEvent<unknown>) => void);

    world.events.on('survival:victory', ((e: SimEvent<{ agents: number }>) => {
      if (mode !== 'survival') return;
      if (survivalRt) {
        const rec = survivalRt.buildBestRecordCandidate(e.data.agents);
        if (rec) saveSurvivalBestIfBetter(rec);
      }
      // Freeze the run so the victory dialog isn't missed.
      loop.pause();
      UIState.set('simRunning', false);
      openSurvivalVictoryModal(
        e.data.agents,
        () => {
          loop.resume();
          UIState.set('simRunning', true);
        },
        () => {
          (document.getElementById('btn-reset') as HTMLButtonElement | null)?.click();
        },
      );
    }) as (e: SimEvent<unknown>) => void);

    world.events.on('survival:defeat', ((e: SimEvent<{ agents: number }>) => {
      if (mode !== 'survival') return;
      if (survivalRt) {
        const rec = survivalRt.buildBestRecordCandidate(world.getByType('agent').length);
        if (rec) saveSurvivalBestIfBetter(rec);
      }
      loop.pause();
      UIState.set('simRunning', false);
      openSurvivalDefeatModal(
        e.data.agents,
        () => {
          survivalDifficultyModal.classList.remove('challenge-panel--hidden');
        },
        () => {
          (document.getElementById('btn-reset') as HTMLButtonElement | null)?.click();
        },
      );
    }) as (e: SimEvent<unknown>) => void);

    // Top-of-screen survival event banner (rockfall/vortex/plague)
    const banner = document.createElement('div');
    banner.id = 'survival-event-banner';
    banner.style.position = 'fixed';
    banner.style.top = '62px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%) translateY(-10px) scale(0.98)';
    banner.style.padding = '11px 18px';
    banner.style.borderRadius = '999px';
    banner.style.background =
      'linear-gradient(135deg, rgba(8,16,34,0.92) 0%, rgba(13,28,58,0.88) 52%, rgba(8,18,40,0.92) 100%)';
    banner.style.border = '1px solid rgba(125, 249, 255, 0.45)';
    banner.style.boxShadow =
      '0 0 0 1px rgba(90, 220, 255, 0.2) inset, 0 8px 26px rgba(0, 0, 0, 0.45), 0 0 26px rgba(60, 220, 255, 0.3)';
    banner.style.color = 'rgba(236, 251, 255, 0.98)';
    banner.style.font = '600 12px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial';
    banner.style.letterSpacing = '0.16em';
    banner.style.textTransform = 'uppercase';
    banner.style.backdropFilter = 'blur(6px)';
    banner.style.zIndex = '9999';
    banner.style.pointerEvents = 'none';
    banner.style.opacity = '0';
    banner.style.display = 'block';
    banner.style.transition =
      'opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.75, 0.2, 1), box-shadow 220ms ease';
    document.body.appendChild(banner);

    let bannerTimer: number | null = null;
    const showBanner = (text: string) => {
      banner.textContent = `EVENT: ${text}`;
      banner.style.opacity = '1';
      banner.style.transform = 'translateX(-50%) translateY(0) scale(1)';
      banner.style.boxShadow =
        '0 0 0 1px rgba(125, 249, 255, 0.35) inset, 0 12px 30px rgba(0, 0, 0, 0.5), 0 0 34px rgba(80, 238, 255, 0.38)';
      if (bannerTimer) window.clearTimeout(bannerTimer);
      const sp = Math.max(0.1, loop.speed);
      bannerTimer = window.setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transform = 'translateX(-50%) translateY(-10px) scale(0.98)';
      }, Math.max(350, 2200 / sp));
    };

    world.events.on('survival:event', ((e: SimEvent<{ name: string }>) => {
      if (mode !== 'survival') return;
      showBanner(e.data.name);
    }) as (e: SimEvent<unknown>) => void);
    world.events.on('challenge:abort', (() => challengeEngine.abort()) as (e: SimEvent<unknown>) => void);
    world.events.on('challenge:success', ((e: SimEvent<{ missionId: string; score: ScoreBreakdown; rank: string }>) => {
      saveScore(e.data.missionId, e.data.score.total, e.data.rank);
      if (mode === 'survival' && survivalRt) {
        const mid = e.data.missionId;
        if (!survivalRt.hasMissionReward(mid)) {
          survivalRt.markMissionReward(mid);
          const { agents: na, food: nf } = survivalRewardForRank(e.data.rank);
          grantSurvivalRewards(world, na, nf);
        }
        survivalRt.recordChallenge(e.data.rank, mid, e.data.score.total);
      }
    }) as (e: SimEvent<unknown>) => void);

    const observer = new ObserverMode(world, loop, canvas);
    const ruleListEl   = document.getElementById('rule-list')!;
    const activeZoneEl = document.getElementById('active-zone')!;
    const inspectorEl  = document.getElementById('inspector-panel')!;
    const toolbarEl    = document.getElementById('toolbar')!;
    const appEl        = document.getElementById('app')!;
    const leftPanel    = document.getElementById('panel-left')!;
    const activeZone   = document.getElementById('active-zone')!;
    const btnStandardDiff = document.getElementById('btn-standard-diff') as HTMLButtonElement | null;

    let ruleList: RuleList | null = null;
    let activeZoneUI: ActiveRuleZone | null = null;

    function clearRules(): void {
      for (const existing of world.getAllRules()) world.removeRule(existing.id);
    }

    function applyModeRules(selected: SimMode): void {
      clearRules();
      if (selected === 'manual') {
        const defaultRules: Rule[] = [
          { id: 'r-attraction',     type: 'attraction',     enabled: false, strength: 0.5,  targets: [],        params: { targetType: 'food', radius: 200 } },
          { id: 'r-repulsion',      type: 'repulsion',      enabled: false, strength: 0.6,  targets: [],        params: { targetType: 'obstacle', radius: 80 } },
          { id: 'r-flocking',       type: 'flocking',       enabled: false, strength: 0.4,  targets: ['agent'], params: { radius: 100, separationWeight: 1.5, alignmentWeight: 1.0, cohesionWeight: 1.0 } },
          { id: 'r-replication',    type: 'replication',    enabled: false, strength: 0.3,  targets: ['agent'], params: { threshold: 80, cooldown: 60 } },
          { id: 'r-decay',          type: 'decay',          enabled: false, strength: 0.2,  targets: [],        params: { rate: 5 } },
          { id: 'r-goal-seek',      type: 'goal_seek',      enabled: false, strength: 0.5,  targets: ['agent'], params: { targetType: 'food', radius: 300, arriveRadius: 40 } },
          { id: 'r-predation',      type: 'predation',      enabled: false, strength: 0.7,  targets: ['agent'], params: { predatorType: 'agent', preyType: 'food', contactRadius: 15, energyTransfer: 30 } },
          { id: 'r-speed-modifier', type: 'speed_modifier', enabled: false, strength: 1.0,  targets: [],        params: { mode: 'scale', baseSpeed: 200, fixedSpeed: 100 } },
          { id: 'r-mutation',       type: 'mutation',       enabled: false, strength: 0.1,  targets: ['agent'], params: { mutateVelocity: true, mutateSpeed: false, mutateEnergy: false, mutateMass: false, velocityNoise: 20, speedNoise: 5, energyNoise: 2, massNoise: 0 } },
          { id: 'r-gravity',        type: 'gravity',        enabled: false, strength: 0.5,  targets: [],        params: { angle: 90 } },
        ];
        defaultRules.forEach(r => world.setRule(r));
      } else if (selected === 'auto' || selected === 'survival') {
        const autoRules: Rule[] = [
          { id: 'auto-flocking', type: 'flocking', enabled: true, strength: 1.0, targets: ['agent'], params: { radius: 100, separationWeight: 1.55, alignmentWeight: 1.0, cohesionWeight: 1.1 } },
          { id: 'auto-repulsion', type: 'repulsion', enabled: true, strength: 0.8, targets: ['agent'], params: { targetType: 'obstacle', radius: 120 } },
          { id: 'auto-attraction', type: 'goal_seek', enabled: true, strength: 0.5, targets: ['agent'], params: { targetType: 'attractor', radius: 170, arriveRadius: 42 } },
          { id: 'auto-hunger-seek', type: 'hunger_seek', enabled: true, strength: 1.15, targets: ['agent'], params: { hungerThreshold: 50, radius: 320 } },
          { id: 'auto-replication', type: 'replication', enabled: true, strength: 1.0, targets: ['agent'], params: { contactRadius: 25, cooldown: 120, mateSearchRadius: 250 } },
          { id: 'auto-predation', type: 'predation', enabled: true, strength: 0.8, targets: ['agent'], params: {
            predatorType: 'agent',
            preyType: 'food',
            contactRadius: 15,
            energyTransfer: 30,
            ...(selected === 'survival' ? { eatCooldownMs: 3000, playerOnlyCooldown: true } : {}),
          } },
        ];
        autoRules.forEach(r => world.setRule(r));
      }
    }

    function seedCurrentMode(): void {
      if (mode === 'manual') {
        _seedEntities(world, manualInitialConfig);
      } else {
        const cfg = AUTO_DIFFICULTY_PRESETS[autoDifficultyLevel];
        foodSpreadConfig.chancePerFoodPerTick = cfg.foodSpreadChance;
        foodSpreadConfig.enabled = true;
        _seedEntities(world, {
          agent: 0,
          food: cfg.food,
          attractor: cfg.attractor,
          obstacle: cfg.obstacle,
        });
        spawnAutoAgents(world, cfg);
        if (mode === 'survival') {
          tagSurvivalAgents(world);
        }
      }
    }

    // ── Background selection ──────────────────────────────────────────────────
    // Standard mode: difficulty maps directly to background set.
    // Sandbox: random background on each start/restart.
    function applyBackground(): void {
      if (mode === 'auto' || mode === 'survival') {
        renderer.setBackground(autoDifficultyLevel, false);
      } else {
        renderer.setBackground('easy', true); // 'easy' is ignored — isStandard=true triggers random
      }
    }
    applyBackground();

    applyModeRules(mode);
    // Always build rule library + drop zone so switching Auto → Manual still has a populated list
    ruleList = new RuleList(ruleListEl, world);
    activeZoneUI = new ActiveRuleZone(activeZoneEl, world);
    ruleList.refresh();

    const btnObserver   = document.getElementById('btn-observer') as HTMLButtonElement | null;
    btnObserver?.addEventListener('click', () => observer.toggle());
    const btnSpeedT     = document.getElementById('btn-speed') as HTMLButtonElement | null;
    const btnScore      = document.getElementById('btn-survival-score') as HTMLButtonElement | null;
    const btnSurvManual = document.getElementById('btn-survival-manual') as HTMLButtonElement | null;
    const kbdHint       = document.querySelector('.kbd-hint') as HTMLElement | null;

    const inspectorCtx = {
      appMode: mode ?? 'manual',
      survival: null as SurvivalRuntime | null,
    };

    const controls = new SimControls(toolbarEl, loop, world);
    const forceBtnDisplay = (btn: HTMLButtonElement | null, visible: boolean) => {
      if (!btn) return;
      btn.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
      btn.hidden = !visible;
    };

    function syncModeChrome(m: SimMode): void {
      appEl.classList.toggle('app--standard', m === 'auto' || m === 'survival');
      inspectorCtx.appMode = m;
      inspectorCtx.survival = m === 'survival' ? survivalRt : null;
      if (btnSetup) btnSetup.hidden = m !== 'manual';

      if (m === 'manual') {
        leftPanel.style.display = '';
        activeZone.style.display = '';
        activeZone.classList.remove('active-zone--standard');
        if (btnSetup) btnSetup.style.display = '';
        if (btnObserver) btnObserver.style.display = '';
        if (btnSpeedT) btnSpeedT.style.display = '';
        forceBtnDisplay(btnStandardDiff, false);
        forceBtnDisplay(btnScore, false);
        forceBtnDisplay(btnSurvManual, false);
        controls.setSpeedVisible(true);
        if (kbdHint) kbdHint.style.display = '';
      } else if (m === 'auto') {
        leftPanel.style.display = 'none';
        activeZone.style.display = '';
        activeZone.classList.add('active-zone--standard');
        if (btnSetup) btnSetup.style.display = 'none';
        if (btnObserver) btnObserver.style.display = '';
        if (btnSpeedT) btnSpeedT.style.display = '';
        forceBtnDisplay(btnStandardDiff, true);
        forceBtnDisplay(btnScore, false);
        forceBtnDisplay(btnSurvManual, false);
        controls.setSpeedVisible(true);
        if (kbdHint) kbdHint.style.display = '';
        const setupModalEl = document.getElementById('setup-modal');
        setupModalEl?.classList.add('hidden');
      } else {
        /* survival */
        leftPanel.style.display = 'none';
        activeZone.style.display = '';
        activeZone.classList.add('active-zone--standard');
        if (btnSetup) btnSetup.style.display = 'none';
        if (btnObserver) btnObserver.style.display = 'none';
        if (btnSpeedT) btnSpeedT.style.display = '';
        forceBtnDisplay(btnStandardDiff, true);
        forceBtnDisplay(btnScore, true);
        forceBtnDisplay(btnSurvManual, true);
        controls.setSpeedVisible(true);
        if (kbdHint) kbdHint.style.display = 'none';
        const setupModalEl = document.getElementById('setup-modal');
        setupModalEl?.classList.add('hidden');
      }
      requestAnimationFrame(() => renderer.resize());
    }
    syncModeChrome(mode);

    function stopTutorialRuntime(showCongrats = false, completedMode?: SimMode): void {
      if (!tutorialRuntime) return;
      if (tutorialRuntime.timer) window.clearInterval(tutorialRuntime.timer);
      tutorialRuntime.panel.remove();
      tutorialRuntime.stop();
      tutorialRuntime = null;
      if (completedMode) markTrainingDone(completedMode);
      modeModal.classList.remove('hidden');
      if (showCongrats) {
        const done = document.createElement('div');
        done.className = 'challenge-panel';
        done.style.zIndex = '1204';
        done.innerHTML = `
          <div class="cpanel-backdrop"></div>
          <div class="cpanel-inner" style="max-width:620px">
            <div class="cpanel-header">
              <span class="cpanel-header-icon">✅</span>
              <h2 class="cpanel-title">TRAINING COMPLETE</h2>
              <p class="cpanel-subtitle">Congratulations, you successfully completed the tutorial!</p>
            </div>
            <div class="cpanel-cards" style="display:block;max-width:520px;margin:0 auto;text-align:center">
              <div class="cpanel-card" style="--card-color:#39FF14">
                <div class="setup-actions" style="justify-content:center">
                  <button type="button" class="btn setup-btn-apply" id="tutorial-finish-ok">Continue</button>
                </div>
              </div>
            </div>
          </div>`;
        done.querySelector('#tutorial-finish-ok')?.addEventListener('click', () => {
          done.remove();
        });
        document.body.appendChild(done);
      }
    }

    function startTutorialRuntime(m: SimMode): void {
      stopTutorialRuntime(false);
      if (m === 'auto' || m === 'manual' || m === 'survival') {
        loop.resume();
        UIState.set('simRunning', true);
      }
      if (m === 'survival' && survivalRt) {
        (survivalRt as any).nextRandomEventGameYear = Number.POSITIVE_INFINITY;
      }
      const panel = document.createElement('div');
      panel.className = 'challenge-panel';
      panel.style.zIndex = '1203';
      panel.style.pointerEvents = 'none';
      document.body.appendChild(panel);

      let sawMovement = new Set<string>();
      let sawAbilities = new Set<string>();
      let shieldArmed = false;
      let shieldBlockedByStone = false;
      let dashArmedAt = 0;
      let dashMovedSince = 0;
      let reproArmed = false;
      let playerReplicated = false;
      let demoEventsDone = false;
      let plagueDemoUntilReal = 0;
      let challengeOpened = false;
      let challengeClosed = false;
      let tutorialMissionSucceeded = false;
      let tutorialMissionContinueAck = false;
      let tutorialMissionRank: string = 'A';
      let tutorialChallengeTrackedAgents = new Set<string>();
      let tutorialChallengeKills = 0;
      let setupApplied = false;
      let selectedManualRuleIds: string[] = [];
      let stoneDamageDone = false;
      let vortexDamageSince = 0;
      const initialStrength = new Map<string, number>();
      for (const r of world.getAllRules()) initialStrength.set(r.id, r.strength);
      const baseHealth = () => {
        const id = survivalRt?.playerAgentId;
        if (!id) return null;
        return world.getEntity(id)?.health ?? null;
      };
      let hpAtDamageStep = 0;

      const keyHandler = (e: KeyboardEvent) => {
        const rt = tutorialRuntime;
        if (!rt) return;
        const stepTitle = rt.steps[rt.idx]?.title ?? '';
        if (rt.mode === 'survival' && (stepTitle === 'Tutorial challenge' || stepTitle === 'Complete the mission') && e.code === 'KeyC') {
          // Prevent the normal challenge panel hotkey during tutorial.
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const allowed = rt.allowedKeys;
        if (allowed.size > 0 && !allowed.has(e.code)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (m === 'survival' && (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD')) {
          sawMovement.add(e.code);
          if (dashArmedAt > 0) dashMovedSince = performance.now();
        }
      };
      document.addEventListener('keydown', keyHandler, true);

      const clickGuard = (e: MouseEvent) => {
        const rt = tutorialRuntime;
        if (!rt || rt.allowedSelectors.length === 0) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('#tutorial-coach')) return;
        const ok = rt.allowedSelectors.some((sel) => target.closest(sel));
        if (!ok) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener('click', clickGuard, true);

      // Special tutorial challenge: open via Challenge button, but show tutorial mission panel instead.
      const tutorialMissionKill2 = {
        id: 'tutorial_kill2',
        title: 'TRAINING',
        subtitle: 'Eliminate 2 amoeba',
        description: 'Tutorial mission. Eliminate 2 amoeba to learn how challenges work.',
        objective: 'Eliminate 2 amoeba',
        icon: '🎯',
        color: '#FFD700',
        timeLimitSec: 9999,
        holdSec: 0,
        maxScore: 1000,
        requiredRules: [],
        condition: (_w: WorldState, ctx: any) => Math.min(1, ((ctx.data.killed as number) ?? 0) / 2),
        success: (_w: WorldState, ctx: any) => (((ctx.data.killed as number) ?? 0) >= 2),
        failure: (_w: WorldState, _ctx: any) => false,
        score: (_ctx: any) => ({ base: 1000, timeBonus: 0, efficiency: 0, total: 1000 }),
        onStart: (_w: WorldState, ctx: any) => {
          ctx.data.killed = 0;
          ctx.data.baseAgents = world.getAlive().filter(e => e.type === 'agent').length;
        },
      };

      const showTutorialChallengePanel = () => {
        const existing = document.getElementById('tutorial-special-challenge');
        existing?.remove();
        const el = document.createElement('div');
        el.id = 'tutorial-special-challenge';
        el.className = 'challenge-panel';
        el.style.zIndex = '1302';
        el.innerHTML = `
          <div class="cpanel-backdrop"></div>
          <div class="cpanel-inner" style="max-width:520px">
            <div class="cpanel-header">
              <span class="cpanel-header-icon">🎯</span>
              <h2 class="cpanel-title">TUTORIAL CHALLENGE</h2>
              <p class="cpanel-subtitle">Eliminate 2 amoeba</p>
              <button type="button" class="cpanel-close" id="tut-chal-x" title="Close">✕</button>
            </div>
            <div class="cpanel-cards" style="display:block;max-width:460px;margin:0 auto">
              <div class="cpanel-card" style="--card-color:#FFD700">
                <p class="cpanel-card-desc">
                  <strong>Goal:</strong> two amoeba must die during this mission.
                  <br/><span style="opacity:.85">Complete it to receive the usual mission rewards.</span>
                </p>
                <div class="setup-actions" style="justify-content:center">
                  <button type="button" class="btn setup-btn-apply" id="tutorial-challenge-start">Accept mission</button>
                </div>
              </div>
            </div>
          </div>`;
        const close = () => el.remove();
        el.querySelector('.cpanel-backdrop')?.addEventListener('click', close);
        el.querySelector('#tut-chal-x')?.addEventListener('click', close);
        el.querySelector('#tutorial-challenge-start')?.addEventListener('click', () => {
          close();
          challengeOpened = true;
          // keep counts updated in ctx via world state
          const unsub = world.events.on('entity:death', ((evt: SimEvent<unknown>) => {
            const payload = (evt.data ?? {}) as { entityId?: string };
            const deadId = payload.entityId;
            if (!deadId || !tutorialChallengeTrackedAgents.has(deadId)) return;
            tutorialChallengeTrackedAgents.delete(deadId);
            tutorialChallengeKills += 1;
            if (challengeEngine.currentCtx) {
              challengeEngine.currentCtx.data.killed = tutorialChallengeKills;
            }
          }) as (e: SimEvent<unknown>) => void);
          // Start mission (engine/HUD progress)
          challengeEngine.start(tutorialMissionKill2 as any);
          // Auto-clean when mission resolves
          const offSuccess = world.events.on('challenge:success', (() => { world.events.off('entity:death', unsub as any); }) as any);
          const offFail = world.events.on('challenge:failed', (() => { world.events.off('entity:death', unsub as any); }) as any);
          // prevent leaks (best effort)
          void offSuccess; void offFail;
        });
        document.body.appendChild(el);
      };

      // Shield completion is polled via SurvivalRuntime state (collision event is not reliable here).
      const shieldWatch: (() => void) | null = null;

      const interceptChallengeClick = (e: MouseEvent) => {
        if (!tutorialRuntime) return;
        const step = tutorialRuntime.steps[tutorialRuntime.idx];
        if (tutorialRuntime.mode !== 'survival') return;
        if (step.title !== 'Tutorial challenge' && step.title !== 'Complete the mission') return;
        const t = e.target as HTMLElement | null;
        if (!t || !t.closest('#btn-challenge')) return;
        e.preventDefault();
        e.stopPropagation();
        if (step.title === 'Tutorial challenge') {
          showTutorialChallengePanel();
        }
      };
      document.addEventListener('click', interceptChallengeClick, true);

      const offAbility = world.events.on('survival:ability', ((e: SimEvent<{ kind: string }>) => {
        sawAbilities.add(e.data.kind);
        if (tutorialRuntime?.mode !== 'survival') return;
        if (e.data.kind === 'shield') {
          shieldArmed = true;
          // Tutorial: shield lasts until you collide with a stone (collision cancels shield).
          const rt = survivalRt as any;
          if (rt) rt.shieldEndReal = performance.now() + 1e9;
        }
        if (e.data.kind === 'dash') {
          dashArmedAt = performance.now();
          dashMovedSince = performance.now();
        }
        if (e.data.kind === 'reproduction') {
          reproArmed = true;
        }
      }) as (e: SimEvent<unknown>) => void);
      const offRep = world.events.on('entity:replicate', ((e: SimEvent<{ parentId: string; childId: string }>) => {
        const pid = survivalRt?.playerAgentId;
        if (!pid) return;
        if (e.data.parentId === pid) playerReplicated = true;
      }) as (e: SimEvent<unknown>) => void);
      const offDeath = world.events.on('entity:death', (() => {
        // no-op: kept to allow future expansion and centralized cleanup
      }) as (e: SimEvent<unknown>) => void);
      const offShieldBlock = world.events.on('survival:shield-block', (() => {
        if (!tutorialRuntime || tutorialRuntime.mode !== 'survival') return;
        shieldBlockedByStone = true;
      }) as (e: SimEvent<unknown>) => void);
      const offTutorialMissionSuccess = world.events.on('challenge:success', ((e: SimEvent<{ missionId: string; rank: string }>) => {
        if (e.data.missionId !== 'tutorial_kill2') return;
        tutorialMissionSucceeded = true;
        tutorialMissionRank = e.data.rank ?? 'A';
      }) as (e: SimEvent<unknown>) => void);
      const offChallengeClose = world.events.on('challenge:close', (() => {
        if (tutorialMissionSucceeded) tutorialMissionContinueAck = true;
      }) as (e: SimEvent<unknown>) => void);

      if (btnChallenge) {
        btnChallenge.addEventListener('click', () => { challengeOpened = true; });
      }
      document.getElementById('setup-apply')?.addEventListener('click', () => { setupApplied = true; });

      const steps: TutorialStep[] = m === 'survival' ? [
        {
          title: 'Select a player amoeba',
          body: 'Click an amoeba, then press "Play as this amoeba" in Inspector.',
          anchorSelector: '#inspector-panel',
          isComplete: () => !!survivalRt?.playerAgentId,
        },
        {
          title: 'Move your amoeba',
          body: 'Use WASD to move. Press at least two movement keys.',
          anchorSelector: '#inspector-panel',
          allowedKeys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
          isComplete: () => sawMovement.size >= 2,
        },
        {
          title: 'Shield (1)',
          body: 'Activate Shield, then collide with a stone. In training, the shield lasts until the first impact and prevents that damage.',
          anchorSelector: '#inspector-panel',
          allowedSelectors: ['#ins-ab-shield'],
          allowedKeys: ['Digit1', 'KeyW', 'KeyA', 'KeyS', 'KeyD'],
          onEnter: () => {
            shieldArmed = false;
            shieldBlockedByStone = false;
            const pid = survivalRt?.playerAgentId;
            const p = pid ? world.getEntity(pid) : null;
            if (!pid || !p) return;
            // Training: ensure plenty of stones exist.
            const existing = world.getByType('obstacle').length;
            for (let i = existing; i < 20; i++) {
              world.addEntity(new Entity({
                type: 'obstacle',
                position: vec2(60 + Math.random() * (WORLD_W - 120), 60 + Math.random() * (WORLD_H - 120)),
                velocity: vec2(0, 0),
                energy: 100,
                mass: 10,
                maxSpeed: 0,
              }));
            }
            // Spawn a stone in front of the player.
            world.addEntity(new Entity({
              type: 'obstacle',
              position: vec2(Math.min(WORLD_W - 10, p.position.x + 50), p.position.y),
              velocity: vec2(0, 0),
              energy: 100,
              mass: 10,
              maxSpeed: 0,
            }));
          },
          isComplete: () => shieldArmed && shieldBlockedByStone,
        },
        {
          title: 'Dash (2)',
          body: 'Activate Dash, then keep moving for 5 seconds. Dash boosts speed and helps escape hazards.',
          anchorSelector: '#inspector-panel',
          allowedSelectors: ['#ins-ab-dash'],
          allowedKeys: ['Digit2', 'KeyW', 'KeyA', 'KeyS', 'KeyD'],
          onEnter: () => {
            dashArmedAt = 0;
            dashMovedSince = 0;
          },
          isComplete: () => {
            if (!survivalRt) return false;
            if (dashArmedAt <= 0) return false;
            return performance.now() > (survivalRt.dashEndReal ?? 0) && (survivalRt.dashEndReal ?? 0) > dashArmedAt;
          },
        },
        {
          title: 'Reproduction (3)',
          body: 'Press Reproduction (3). In this training step, pressing the ability is enough.',
          anchorSelector: '#inspector-panel',
          allowedSelectors: ['#ins-ab-rep'],
          allowedKeys: ['Digit3'],
          onEnter: () => {
            reproArmed = false;
            playerReplicated = false;
          },
          isComplete: () => reproArmed,
        },
        {
          title: 'Event demo: Rockfall',
          body: 'Rockfall starts automatically. During rockfall, additional stones appear on the field and make movement riskier. Wait until the event fully ends.',
          anchorSelector: '#survival-event-banner',
          onEnter: () => {
            demoEventsDone = false;
            const rt = survivalRt as any;
            if (rt) {
              rt.nextRandomEventGameYear = Number.POSITIVE_INFINITY;
              rt.startRockfall?.(false);
            }
          },
          isComplete: () => {
            const rt = survivalRt as any;
            if (!rt) return false;
            return Array.isArray(rt.shadows) && Array.isArray(rt.falling) && rt.shadows.length === 0 && rt.falling.length === 0;
          },
        },
        {
          title: 'Event demo: Vortex Surge',
          body: 'Vortex Surge starts automatically. Vortex pull gets much stronger for a short time, so nearby amoeba lose health faster. Wait until it ends.',
          anchorSelector: '#survival-event-banner',
          onEnter: () => {
            const rt = survivalRt as any;
            if (rt) {
              rt.nextRandomEventGameYear = Number.POSITIVE_INFINITY;
              rt.startVortex?.(false);
              rt.vortexEventUntilReal = performance.now() + 5000;
            }
          },
          isComplete: () => {
            const rt = survivalRt as any;
            if (!rt) return false;
            return performance.now() > (rt.vortexEventUntilReal ?? 0);
          },
        },
        {
          title: 'Event demo: Plague',
          body: 'Plague starts automatically. Affected NPC amoeba get mutated behavior. In tutorial this stage is short and ends quickly.',
          anchorSelector: '#survival-event-banner',
          onEnter: () => {
            const rt = survivalRt as any;
            if (rt) {
              rt.nextRandomEventGameYear = Number.POSITIVE_INFINITY;
              rt.startPlague?.(false);
              rt.plagueEndGameYear = rt.gameYear + (5 / 60);
            } else {
              plagueDemoUntilReal = performance.now() + 5000;
            }
          },
          isComplete: () => {
            const rt = survivalRt as any;
            const ok = rt ? rt.gameYear >= (rt.plagueEndGameYear ?? Number.POSITIVE_INFINITY) : performance.now() >= plagueDemoUntilReal;
            demoEventsDone = ok;
            return ok;
          },
        },
        {
          title: 'Tutorial challenge',
          body: 'Click Challenge, then accept the tutorial mission. Goal: eliminate 2 amoeba.',
          anchorSelector: '#btn-challenge',
          allowedSelectors: ['#btn-challenge', '#tutorial-challenge-start'],
          onEnter: () => {
            challengeOpened = false;
            challengeClosed = false;
            tutorialMissionSucceeded = false;
            tutorialMissionContinueAck = false;
            tutorialMissionRank = 'A';
            const rt = survivalRt as any;
            if (rt) {
              for (const a of world.getByType('agent')) {
                const baseMax = a.meta.survivalPlagueBaseMaxSpeed as number | undefined;
                const baseMass = a.meta.survivalPlagueBaseMass as number | undefined;
                const baseEnergy = a.meta.survivalPlagueBaseEnergy as number | undefined;
                if (baseMax !== undefined) a.maxSpeed = baseMax;
                if (baseMass !== undefined) a.mass = baseMass;
                if (baseEnergy !== undefined) a.energy = baseEnergy;
                delete a.meta.survivalPlagueBaseMaxSpeed;
                delete a.meta.survivalPlagueBaseMass;
                delete a.meta.survivalPlagueBaseEnergy;
                delete a.meta.survivalPlague;
              }
              rt.plagueEndGameYear = 0;
            }
            tutorialChallengeKills = 0;
            tutorialChallengeTrackedAgents = new Set(
              world.getAlive().filter(e => e.type === 'agent').map(e => e.id),
            );
          },
          isComplete: () => challengeOpened,
        },
        {
          title: 'Complete the mission',
          body: 'Eliminate 2 amoeba. After success, press Continue in the mission result window.',
          anchorSelector: '#challenge-hud',
          isComplete: () => {
            if (!challengeOpened) return false;
            const aliveIds = new Set(world.getAlive().filter(e => e.type === 'agent').map(e => e.id));
            for (const id of Array.from(tutorialChallengeTrackedAgents)) {
              if (!aliveIds.has(id)) {
                tutorialChallengeTrackedAgents.delete(id);
                tutorialChallengeKills += 1;
              }
            }
            if (tutorialChallengeKills < 2) return false;
            if (!tutorialMissionContinueAck) return false;
            if (!challengeClosed) {
              const { agents, food } = survivalRewardForRank(tutorialMissionRank);
              grantSurvivalRewards(world, agents, food);
              challengeClosed = true;
            }
            return challengeClosed;
          },
        },
        {
          title: 'Challenge rewards',
          body: 'Challenge rewards grant bonus amoeba and food. In normal runs, each mission reward is one-time per mission.',
          anchorSelector: '#btn-challenge',
          allowNext: true,
          allowedSelectors: ['#tutorial-next-step'],
          isComplete: () => false,
        },
        {
          title: 'Tutorial complete',
          body: 'You now know the full Survival training flow.',
          anchorSelector: '#toolbar',
          allowNext: true,
          allowedSelectors: ['#tutorial-next-step'],
          isComplete: () => false,
        },
      ] : m === 'manual' ? [
        {
          title: 'Activate rules',
          body: 'Drag any two rules from Rule Library into Active Zone.',
          anchorSelector: '#rule-list',
          isComplete: () => {
            const ok = world.getActiveRules().length >= 2;
            if (ok && selectedManualRuleIds.length === 0) {
              selectedManualRuleIds = world.getActiveRules().slice(0, 2).map(r => r.id);
            }
            return ok;
          },
        },
        {
          title: 'Tune a rule',
          body: 'Change settings of one of the rules you selected, then select that same rule again.',
          anchorSelector: '#active-zone',
          isComplete: () => {
            for (const r of world.getActiveRules()) {
              if (!selectedManualRuleIds.includes(r.id)) continue;
              const prev = initialStrength.get(r.id);
              if (prev !== undefined && Math.abs(prev - r.strength) > 0.001) return true;
            }
            return false;
          },
        },
        {
          title: 'Setup and apply',
          body: 'Open Setup and press Apply. Training will auto-fill the setup values for you.',
          anchorSelector: '#btn-setup',
          allowedSelectors: ['#btn-setup', '#setup-apply'],
          onEnter: () => {
            setupApplied = false;
            // Open setup and prefill training values.
            (document.getElementById('btn-setup') as HTMLButtonElement | null)?.click();
            const inA = document.getElementById('setup-initial-agent') as HTMLInputElement | null;
            const inF = document.getElementById('setup-initial-food') as HTMLInputElement | null;
            const inV = document.getElementById('setup-initial-attractor') as HTMLInputElement | null;
            const inS = document.getElementById('setup-initial-obstacle') as HTMLInputElement | null;
            if (inA) inA.value = '0';
            if (inF) inF.value = '10';
            if (inV) inV.value = '20';
            if (inS) inS.value = '30';
          },
          isComplete: () => setupApplied,
        },
        {
          title: 'Sandbox ready',
          body: 'Setup applied. Spawned: 0 amoeba, 10 food, 20 vortex, 30 stones. Press Final to end training.',
          anchorSelector: '#setup-modal',
          allowNext: true,
          allowedSelectors: ['#tutorial-next-step'],
          isComplete: () => false,
        },
      ] : [
        {
          title: 'Auto mode basics',
          body: 'This mode runs itself. Observe ecosystem changes and use Difficulty/Speed to tune pacing.',
          anchorSelector: '#toolbar',
          allowNext: true,
          allowedSelectors: ['#tutorial-next-step'],
          isComplete: () => false,
        },
      ];

      let highlightedEl: HTMLElement | null = null;
      const clearHighlight = () => {
        if (!highlightedEl) return;
        highlightedEl.style.outline = '';
        highlightedEl.style.outlineOffset = '';
        highlightedEl.style.boxShadow = '';
        highlightedEl.style.position = '';
        highlightedEl.style.zIndex = '';
        highlightedEl = null;
      };
      const highlightTarget = (el: HTMLElement | null) => {
        clearHighlight();
        if (!el) return;
        highlightedEl = el;
        highlightedEl.style.outline = '2px solid rgba(0,245,255,0.9)';
        highlightedEl.style.outlineOffset = '2px';
        highlightedEl.style.boxShadow = '0 0 0 4px rgba(0,245,255,0.25)';
        const cs = window.getComputedStyle(highlightedEl);
        if (cs.position === 'static') {
          highlightedEl.style.position = 'relative';
        }
        highlightedEl.style.zIndex = '1300';
      };

      const positionCoach = () => {
        if (!tutorialRuntime) return;
        const step = tutorialRuntime.steps[tutorialRuntime.idx];
        const coach = panel.querySelector<HTMLElement>('#tutorial-coach');
        if (!coach) return;
        const rawAnchor = step.anchorSelector
          ? (document.querySelector(step.anchorSelector) as HTMLElement | null)
          : null;
        const anchorRect = rawAnchor?.getBoundingClientRect();
        const anchor =
          rawAnchor &&
          anchorRect &&
          anchorRect.width > 4 &&
          anchorRect.height > 4 &&
          window.getComputedStyle(rawAnchor).display !== 'none'
            ? rawAnchor
            : null;
        highlightTarget(anchor);
        // Keep coachmark near top-left brand, but avoid overlap with challenge HUD.
        const isMissionRunStep = step.title === 'Complete the mission';
        const missionTop = Math.max(152, Math.min(228, Math.floor(window.innerHeight * 0.24)));
        coach.style.left = '12px';
        coach.style.top = isMissionRunStep ? `${missionTop}px` : '58px';
        coach.style.transform = 'none';
      };

      const renderStep = () => {
        if (!tutorialRuntime) return;
        const step = tutorialRuntime.steps[tutorialRuntime.idx];
        const done = tutorialRuntime.idx === tutorialRuntime.steps.length - 1;
        tutorialRuntime.allowedSelectors = step.allowedSelectors ?? [];
        tutorialRuntime.allowedKeys = new Set(step.allowedKeys ?? []);
        panel.innerHTML = `
          <div style="position:fixed;inset:0;background:rgba(0,16,32,0.08);pointer-events:none;z-index:1200"></div>
          <div id="tutorial-coach" class="cpanel-card" style="--card-color:#00F5FF;position:fixed;z-index:2147483001;pointer-events:auto;width:min(360px,calc(100vw - 20px));max-height:calc(100vh - 24px);overflow:auto;padding:12px 14px;border-radius:12px">
            <p class="cpanel-card-desc" style="margin:0 0 4px"><strong>Step ${tutorialRuntime.idx + 1}/${tutorialRuntime.steps.length}: ${step.title}</strong></p>
            <p class="cpanel-card-desc" style="margin:0">${step.body}</p>
            <div class="setup-actions" style="margin-top:10px;justify-content:flex-end">
              ${m === 'auto' || (step.allowNext && done) ? '' : '<button type="button" class="btn setup-btn-close" id="tutorial-cancel">Exit</button>'}
              ${step.allowNext ? `<button type="button" class="btn setup-btn-apply" id="tutorial-next-step">${done ? 'Final' : 'Next'}</button>` : ''}
            </div>
          </div>`;
        panel.querySelector('#tutorial-cancel')?.addEventListener('click', () => stopTutorialRuntime(false));
        panel.querySelector('#tutorial-next-step')?.addEventListener('click', () => {
          if (!tutorialRuntime) return;
          if (tutorialRuntime.idx >= tutorialRuntime.steps.length - 1) {
            stopTutorialRuntime(true, m);
            return;
          }
          tutorialRuntime.idx += 1;
          tutorialRuntime.stepEnteredAtReal = performance.now();
          const nextStep = tutorialRuntime.steps[tutorialRuntime.idx];
          nextStep.onEnter?.();
          renderStep();
        });
        requestAnimationFrame(positionCoach);
      };

      tutorialRuntime = {
        enabled: true,
        mode: m,
        panel,
        steps,
        idx: 0,
        stepEnteredAtReal: performance.now(),
        timer: null,
        allowedSelectors: steps[0].allowedSelectors ?? [],
        allowedKeys: new Set(steps[0].allowedKeys ?? []),
        stop: () => {
          document.removeEventListener('keydown', keyHandler, true);
          document.removeEventListener('click', clickGuard, true);
          document.removeEventListener('click', interceptChallengeClick, true);
          offAbility?.();
          offRep?.();
          shieldWatch?.();
          offShieldBlock?.();
          offTutorialMissionSuccess?.();
          offChallengeClose?.();
          offDeath?.();
          (document.getElementById('tutorial-demo-events'))?.remove();
          (document.getElementById('tutorial-special-challenge'))?.remove();
          clearHighlight();
        },
      };
      steps[0].onEnter?.();
      renderStep();
      tutorialRuntime.timer = window.setInterval(() => {
        if (!tutorialRuntime) return;
        positionCoach();
        // Training: keep player-controlled amoeba immortal until the kill-2 mission starts.
        if (tutorialRuntime.mode === 'survival' && survivalRt?.playerAgentId) {
          const stepTitle = tutorialRuntime.steps[tutorialRuntime.idx]?.title ?? '';
          if (stepTitle !== 'Tutorial challenge' && stepTitle !== 'Complete the mission') {
            const p = world.getEntity(survivalRt.playerAgentId);
            if (p && p.type === 'agent') p.health = Math.max(1, p.health);
          }
        }
        const cur = tutorialRuntime.steps[tutorialRuntime.idx];
        if (performance.now() - tutorialRuntime.stepEnteredAtReal < 700) return;
        if (!cur.isComplete()) return;
        if (tutorialRuntime.idx >= tutorialRuntime.steps.length - 1) {
          stopTutorialRuntime(true, m);
          return;
        }
        tutorialRuntime.idx += 1;
        tutorialRuntime.stepEnteredAtReal = performance.now();
        tutorialRuntime.steps[tutorialRuntime.idx].onEnter?.();
        renderStep();
      }, 220);
    }

    const inspector = new EntityInspector(inspectorEl, inspectorCtx);
    const canvasHit = new CanvasInteraction(
      canvas,
      world,
      WORLD_W,
      WORLD_H,
      {
        clientToWorld: (cx, cy) => renderer.clientToWorld(cx, cy),
        worldToCss:    (wx, wy) => renderer.worldToCss(wx, wy),
      },
      () => renderer.consumeSuppressClick(),
    );

    renderer.attachViewportPointerPan(canvas, () => observer.active);

    canvas.addEventListener('wheel', (e) => {
      if (observer.active) return;
      e.preventDefault();
      renderer.applyWheel(e);
    }, { passive: false });

    function spreadFoodTick(): void {
      if (!foodSpreadConfig.enabled) return;
      let foodCount = world.getByType('food').length;
      if (foodCount >= MAX_FOOD_ENTITIES) return;
      const foods = world.getByType('food');
      for (const food of foods) {
        if (foodCount >= MAX_FOOD_ENTITIES) return;
        if (Math.random() > foodSpreadConfig.chancePerFoodPerTick) continue;
        const angle = Math.random() * Math.PI * 2;
        const dist = FOOD_SPREAD_MIN_DISTANCE + Math.random() * (FOOD_SPREAD_RADIUS - FOOD_SPREAD_MIN_DISTANCE);
        const nx = food.position.x + Math.cos(angle) * dist;
        const ny = food.position.y + Math.sin(angle) * dist;
        if (nx < 0 || nx > WORLD_W || ny < 0 || ny > WORLD_H) continue;
        const overlaps = world.getNearby(nx, ny, FOOD_SPREAD_MIN_DISTANCE).some(e => e.type === 'food');
        if (overlaps) continue;
        world.addEntity(new Entity({ type: 'food', position: vec2(nx, ny), velocity: vec2(0, 0), energy: 100, mass: 2 }));
        foodCount++;
      }
    }

    loop.onTick = () => {
      challengeEngine.tick();
      spreadFoodTick();
      syncSurvivalChallengeChrome();
    };
    loop.onRender = (w, alpha) => renderer.draw(w, alpha, observer.tick());

    controls.setOnReset(() => {
      if (mode === 'survival' && survivalRt) {
        const rec = survivalRt.buildBestRecordCandidate(world.getByType('agent').length);
        if (rec) saveSurvivalBestIfBetter(rec);
      }
      renderer.reset();
      applyBackground(); // re-pick background on every restart
      if (activeZoneUI) activeZoneUI.clear();
      UIState.set('selectedEntity', null);
      if (mode === 'survival' && survivalRt) survivalRt.resetSession();
      seedCurrentMode();
      if (ruleList) ruleList.refresh();
    });
    seedCurrentMode();
    syncSurvivalChallengeChrome();
    if (tutorialMode) {
      startTutorialRuntime(selectedMode);
    }

    function openModeModal(): void {
      autoDifficultyModal.classList.add('challenge-panel--hidden');
      survivalDifficultyModal.classList.add('challenge-panel--hidden');
      modeModal.classList.remove('hidden');
    }

    function switchMode(nextMode: SimMode, diffPick?: AutoDifficulty): void {
      if ((nextMode === 'auto' || nextMode === 'survival') && diffPick) {
        autoDifficultyLevel = diffPick;
      }
      mode = nextMode;
      world.config.survivalDifficulty = nextMode === 'survival' ? autoDifficultyLevel : undefined;
      if (nextMode === 'survival') {
        survivalRt = new SurvivalRuntime(world, autoDifficultyLevel, WORLD_W, WORLD_H);
        loop.beforeIntegrate = (_w, dt) => survivalRt!.beforeIntegrate(dt);
        loop.beforePurge = (_w, dt) => {
        world.config.simSpeed = loop.speed;
        survivalRt!.beforePurge(dt);
      };
        renderer.setSurvivalOverlay((ctx, sx, sy) => survivalRt!.drawOverlay(ctx, sx, sy));
      } else {
        survivalRt = null;
        loop.beforeIntegrate = null;
        loop.beforePurge = null;
        renderer.setSurvivalOverlay(null);
      }
      syncModeChrome(nextMode);
      loop.pause();
      applyModeRules(nextMode);
      applyBackground(); // update background for new mode
      renderer.reset();
      world.resetEntities();
      UIState.set('selectedEntity', null);
      seedCurrentMode();
      if (activeZoneUI) activeZoneUI.clear();
      if (ruleList) ruleList.refresh();
      UIState.set('simRunning', false);
    }

    runTutorialInCurrentSession = (pickedMode: SimMode) => {
      autoDifficultyLevel = 'easy';
      if (pickedMode === 'manual') {
        manualInitialConfig.agent = 18;
        manualInitialConfig.food = 28;
        manualInitialConfig.attractor = 2;
        manualInitialConfig.obstacle = 2;
        foodSpreadConfig.enabled = true;
        foodSpreadConfig.chancePerFoodPerTick = 0.00012;
      }
      if (mode !== pickedMode) switchMode(pickedMode, 'easy');
      else (document.getElementById('btn-reset') as HTMLButtonElement | null)?.click();
      loop.resume();
      UIState.set('simRunning', true);
      startTutorialRuntime(pickedMode);
    };

    applyStandardDifficultyPick = () => { switchMode('auto'); };
    applyStandardSurvivalPick = () => { switchMode('survival'); };

    manualBtn.onclick = () => { modeModal.classList.add('hidden'); if (mode !== 'manual') switchMode('manual'); };
    autoBtn.onclick = () => {
      modeModal.classList.add('hidden');
      autoDifficultyModal.classList.remove('challenge-panel--hidden');
    };
    btnMode?.addEventListener('click', () => openModeModal());
    btnStandardDiff?.addEventListener('click', () => {
      if (mode === 'auto') autoDifficultyModal.classList.remove('challenge-panel--hidden');
      else if (mode === 'survival') survivalDifficultyModal.classList.remove('challenge-panel--hidden');
    });

    btnScore?.addEventListener('click', () => openSurvivalScoreModal());
    btnSurvManual?.addEventListener('click', () => openSurvivalManualModal());

    const setupModal = document.getElementById('setup-modal');
    const setupClose = document.getElementById('setup-close');
    const setupApply = document.getElementById('setup-apply');
    const setupAddAgent = document.getElementById('setup-add-agent');
    const setupAddFood = document.getElementById('setup-add-food');
    const setupAddAttractor = document.getElementById('setup-add-attractor');
    const setupAddObstacle = document.getElementById('setup-add-obstacle');
    const inAgent = document.getElementById('setup-initial-agent') as HTMLInputElement | null;
    const inFood = document.getElementById('setup-initial-food') as HTMLInputElement | null;
    const inAttractor = document.getElementById('setup-initial-attractor') as HTMLInputElement | null;
    const inObstacle = document.getElementById('setup-initial-obstacle') as HTMLInputElement | null;
    const inSpreadEnabled = document.getElementById('setup-food-spread-enabled') as HTMLInputElement | null;
    const inSpreadSpeed = document.getElementById('setup-food-spread-speed') as HTMLInputElement | null;

    function spawnOne(type: 'agent' | 'food' | 'attractor' | 'obstacle'): void {
      if (type === 'food' && world.getByType('food').length >= MAX_FOOD_ENTITIES) return;
      world.addEntity(new Entity({
        type,
        position: vec2(Math.random() * WORLD_W, Math.random() * WORLD_H),
        velocity: type === 'agent' ? vec2((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80) : vec2(0, 0),
        energy: 100,
        hunger: type === 'agent' ? 100 + Math.random() * 100 : 100,
        gender: Math.random() < 0.5 ? 'male' : 'female',
        ageYears: type === 'agent' ? Math.random() * 60 : 0,
        frailty: type === 'agent' ? 0.8 + Math.random() * 0.4 : 1,
        mass: type === 'food' ? 2 : type === 'attractor' ? 5 : type === 'obstacle' ? 10 : 1,
        maxSpeed: type === 'obstacle' ? 0 : 200,
      }));
    }

    function openSetupModal(): void {
      if (!setupModal || mode !== 'manual') return;
      if (inAgent) inAgent.value = String(manualInitialConfig.agent);
      if (inFood) inFood.value = String(manualInitialConfig.food);
      if (inAttractor) inAttractor.value = String(manualInitialConfig.attractor);
      if (inObstacle) inObstacle.value = String(manualInitialConfig.obstacle);
      if (inSpreadEnabled) inSpreadEnabled.checked = foodSpreadConfig.enabled;
      if (inSpreadSpeed) inSpreadSpeed.value = String(Math.round(foodSpreadConfig.chancePerFoodPerTick * 1000000));
      setupModal.classList.remove('hidden');
    }

    btnSetup?.addEventListener('click', () => openSetupModal());
    setupClose?.addEventListener('click', () => {
      const lockSetup =
        tutorialRuntime?.mode === 'manual' &&
        (tutorialRuntime.steps[tutorialRuntime.idx]?.title === 'Open Sandbox setup'
          || tutorialRuntime.steps[tutorialRuntime.idx]?.title === 'Configure exact setup values');
      if (lockSetup) return;
      setupModal?.classList.add('hidden');
    });
    setupModal?.addEventListener('click', (e) => {
      const lockSetup =
        tutorialRuntime?.mode === 'manual' &&
        (tutorialRuntime.steps[tutorialRuntime.idx]?.title === 'Open Sandbox setup'
          || tutorialRuntime.steps[tutorialRuntime.idx]?.title === 'Configure exact setup values');
      if (lockSetup) return;
      if (e.target === setupModal) setupModal.classList.add('hidden');
    });
    setupAddAgent?.addEventListener('click', () => spawnOne('agent'));
    setupAddFood?.addEventListener('click', () => spawnOne('food'));
    setupAddAttractor?.addEventListener('click', () => spawnOne('attractor'));
    setupAddObstacle?.addEventListener('click', () => spawnOne('obstacle'));
    setupApply?.addEventListener('click', () => {
      if (!inAgent || !inFood || !inAttractor || !inObstacle || !inSpreadEnabled || !inSpreadSpeed) return;
      manualInitialConfig.agent = Math.max(0, Number(inAgent.value) || 0);
      manualInitialConfig.food = Math.min(MAX_FOOD_ENTITIES, Math.max(0, Number(inFood.value) || 0));
      manualInitialConfig.attractor = Math.max(0, Number(inAttractor.value) || 0);
      manualInitialConfig.obstacle = Math.max(0, Number(inObstacle.value) || 0);
      foodSpreadConfig.enabled = inSpreadEnabled.checked;
      foodSpreadConfig.chancePerFoodPerTick = Math.max(0, (Number(inSpreadSpeed.value) || 0) / 1000000);
      setupModal.classList.add('hidden');
      if (mode === 'manual') {
        world.resetEntities();
        UIState.set('selectedEntity', null);
        seedCurrentMode();
      }
    });

    const slotModal = document.getElementById('game-slot-modal');
    const slotModalClose = document.getElementById('slot-modal-close');
    const slotModalList = document.getElementById('slot-modal-list');
    const slotModalTitle = document.getElementById('slot-modal-title');
    const btnSave = document.getElementById('btn-save');
    const btnLoad = document.getElementById('btn-load');
    let slotModalAction: 'save' | 'load' = 'save';

    function formatMetaLine(meta: NonNullable<SlotEnvelopeV1['meta']>): string {
      const modeLabel =
        meta.mode === 'manual' ? 'Sandbox' : meta.mode === 'survival' ? 'Survival' : 'Auto';
      const diff =
        (meta.mode === 'auto' || meta.mode === 'survival') && meta.autoDifficulty
          ? ` · ${meta.autoDifficulty}`
          : '';
      return `${modeLabel}${diff} · ${meta.liveAmoeba} live amoeba`;
    }

    function performLoad(snap: GameSnapshotV1): void {
      challengeEngine.abort();
      renderer.reset();
      applySnapshotToWorld(world, snap);
      mode = snap.mode;
      autoDifficultyLevel = snap.autoDifficulty;
      const loadedSurvDiff = snap.autoDifficulty ?? 'medium';
      world.config.survivalDifficulty = snap.mode === 'survival' ? loadedSurvDiff : undefined;
      if (snap.mode === 'survival') {
        const sd = loadedSurvDiff;
        survivalRt = new SurvivalRuntime(world, sd, WORLD_W, WORLD_H);
        if (snap.survivalState) {
          survivalRt.applySaveState(snap.survivalState);
        }
        loop.beforeIntegrate = (_w, dt) => survivalRt!.beforeIntegrate(dt);
        loop.beforePurge = (_w, dt) => {
        world.config.simSpeed = loop.speed;
        survivalRt!.beforePurge(dt);
      };
        renderer.setSurvivalOverlay((ctx, sx, sy) => survivalRt!.drawOverlay(ctx, sx, sy));
      } else {
        survivalRt = null;
        loop.beforeIntegrate = null;
        loop.beforePurge = null;
        renderer.setSurvivalOverlay(null);
      }
      manualInitialConfig.agent = snap.manualSpawn.agent;
      manualInitialConfig.food = snap.manualSpawn.food;
      manualInitialConfig.attractor = snap.manualSpawn.attractor;
      manualInitialConfig.obstacle = snap.manualSpawn.obstacle;
      foodSpreadConfig.enabled = snap.foodSpread.enabled;
      foodSpreadConfig.chancePerFoodPerTick = snap.foodSpread.chancePerFoodPerTick;
      renderer.setBackground(snap.bgDifficulty, false);
      syncModeChrome(snap.mode);
      if (activeZoneUI) {
        if (snap.mode === 'manual') activeZoneUI.restoreActiveRules(snap.activeRuleIds);
        else activeZoneUI.clear();
      }
      UIState.set('selectedEntity', null);
      if (ruleList) ruleList.refresh();
      loop.pause();
      UIState.set('simRunning', false);
    }

    function renderSlotModal(): void {
      if (!slotModalList || !slotModalTitle) return;
      const sub = document.getElementById('slot-modal-sub');
      slotModalTitle.textContent = slotModalAction === 'save' ? 'Save game' : 'Load game';
      if (sub) sub.textContent = slotModalAction === 'save' ? 'Pick a slot to write' : 'Pick a save to restore';

      const rows = listSlots();
      slotModalList.innerHTML = rows
        .map((row) => {
          const slotLabel = `save ${row.slot}`;
          const dateStr = row.empty ? '—' : new Date(row.savedAt!).toLocaleString();
          const metaLine =
            row.empty || !row.meta ? 'Empty slot' : formatMetaLine(row.meta);
          const btnLabel = slotModalAction === 'save' ? 'Save' : 'Load';
          const disabled = slotModalAction === 'load' && row.empty;
          return `
            <div class="slot-row" data-slot="${row.slot}">
              <div class="slot-row-head">
                <span class="slot-row-title">${slotLabel}</span>
                <span class="slot-row-date">${dateStr}</span>
              </div>
              <div class="slot-row-meta">${metaLine}</div>
              <button type="button" class="btn slot-row-btn" ${disabled ? 'disabled' : ''} data-slot="${row.slot}">${btnLabel}</button>
            </div>
          `;
        })
        .join('');

      slotModalList.querySelectorAll<HTMLButtonElement>('.slot-row-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const s = Number(btn.dataset.slot) as 1 | 2 | 3;
          if (slotModalAction === 'save') {
            const envelope: SlotEnvelopeV1 = {
              version: 1,
              savedAt: new Date().toISOString(),
              meta: {
                mode: mode!,
                autoDifficulty:
                  mode === 'auto' || mode === 'survival' ? autoDifficultyLevel : undefined,
                liveAmoeba: world.getByType('agent').length,
              },
              snapshot: buildSnapshot(
                world,
                mode!,
                autoDifficultyLevel,
                foodSpreadConfig,
                manualInitialConfig,
                Array.from(UIState.get('activeRuleIds')),
                renderer.getBackgroundDifficulty(),
                mode === 'survival' ? survivalRt?.buildSaveState() : undefined,
              ),
            };
            writeSlot(s, envelope);
          } else {
            const data = readSlot(s);
            if (!data) return;
            performLoad(data.snapshot);
          }
          slotModal?.classList.add('challenge-panel--hidden');
        });
      });
    }

    function openSaveModal(): void {
      slotModalAction = 'save';
      renderSlotModal();
      slotModal?.classList.remove('challenge-panel--hidden');
    }

    function openLoadModal(): void {
      slotModalAction = 'load';
      renderSlotModal();
      slotModal?.classList.remove('challenge-panel--hidden');
    }

    btnSave?.addEventListener('click', () => openSaveModal());
    btnLoad?.addEventListener('click', () => openLoadModal());
    slotModalClose?.addEventListener('click', () => slotModal?.classList.add('challenge-panel--hidden'));
    slotModal?.querySelector('.cpanel-backdrop')?.addEventListener('click', () => slotModal?.classList.add('challenge-panel--hidden'));

    let lastCount   = -1;
    const activeZoneEl2 = document.getElementById('active-zone')!;
    const statCount     = document.getElementById('stat-count') as HTMLElement | null;

    function uiLoop(): void {
      (window as any).__vortexiaBlockSpeedShortcut =
        mode === 'survival' && !!survivalRt?.playerAgentId;
      if (mode === 'manual') {
        const hasRules = world.getActiveRules().length > 0;
        activeZoneEl2.classList.toggle('has-rules', hasRules);
      }
      if (statCount) {
        const count = world.entityCount;
        if (count !== lastCount) {
          lastCount = count;
          statCount.classList.remove('stat-value--flash');
          void statCount.offsetWidth;
          statCount.classList.add('stat-value--flash');
        }
      }
      if (btnObserver) btnObserver.classList.toggle('obs-btn--active', observer.active);
      inspector.tick();
      controls.tick();
      requestAnimationFrame(uiLoop);
    }
    requestAnimationFrame(uiLoop);

    // Selected entity highlight (visual-only)
    UIState.on('selectedEntity', (entity) => {
      const id = (entity as any)?.id ?? null;
      renderer.setSelectedEntity(id);
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Escape') {
        if (slotModal && !slotModal.classList.contains('challenge-panel--hidden')) {
          e.preventDefault();
          slotModal.classList.add('challenge-panel--hidden');
          return;
        }
        if (!autoDifficultyModal.classList.contains('challenge-panel--hidden')) {
          e.preventDefault();
          closeAutoDifficultyModal();
          return;
        }
        if (!survivalDifficultyModal.classList.contains('challenge-panel--hidden')) {
          e.preventDefault();
          closeSurvivalDifficultyModal();
          return;
        }
        if (challengePanel.isVisible) {
          e.preventDefault();
          e.stopPropagation();
          challengePanel.hide();
        }
        return;
      }
      if (mode !== 'survival' && e.code === 'KeyO' && !observer.active) {
        e.preventDefault();
        observer.enter();
      }
      if (e.code === 'KeyC' && !challengePanel.isVisible) {
        if (mode === 'survival' && countSurvivalAmoeba() < SURVIVAL_CHALLENGE_MIN_AMOEBA) return;
        e.preventDefault();
        challengePanel.setStyle(mode === 'survival' ? 'survival' : 'standard');
        challengePanel.show();
      }

      if (mode === 'survival' && survivalRt) {
        if (survivalRt.playerAgentId) {
          if (e.code === 'KeyW') survivalRt.keys.w = true;
          if (e.code === 'KeyA') survivalRt.keys.a = true;
          if (e.code === 'KeyS') survivalRt.keys.s = true;
          if (e.code === 'KeyD') survivalRt.keys.d = true;
          if (e.code === 'Digit1') {
            e.preventDefault();
            survivalRt.tryShield();
          }
          if (e.code === 'Digit2') {
            e.preventDefault();
            survivalRt.tryDash();
          }
          if (e.code === 'Digit3') {
            e.preventDefault();
            survivalRt.tryReproductionAbility();
          }
        }
      }
      if (e.code === 'KeyZ') { e.preventDefault(); openModeModal(); }
      if (e.code === 'KeyF' && mode === 'manual') { e.preventDefault(); openSetupModal(); }
    });

    document.addEventListener('keyup', (e: KeyboardEvent) => {
      if (mode !== 'survival' || !survivalRt || !survivalRt.playerAgentId) return;
      if (e.code === 'KeyW') survivalRt.keys.w = false;
      if (e.code === 'KeyA') survivalRt.keys.a = false;
      if (e.code === 'KeyS') survivalRt.keys.s = false;
      if (e.code === 'KeyD') survivalRt.keys.d = false;
    });

    window.addEventListener('resize', () => renderer.resize());
    (window as any).__rc = { world, loop, engine, renderer, challengeEngine, observer, challengeHUD, canvasHit, music };
  }

  manualBtn.addEventListener('click', () => {
    if (hasStarted) return;
    hasStarted = true;
    startSimulation('manual');
  });
  autoBtn.addEventListener('click', () => {
    if (hasStarted) return;
    modeModal.classList.add('hidden');
    autoDifficultyModal.classList.remove('challenge-panel--hidden');
  });
  survivalBtn.addEventListener('click', () => {
    modeModal.classList.add('hidden');
    if (!hasStarted) {
      survivalDifficultyModal.classList.remove('challenge-panel--hidden');
      return;
    }
    if (mode !== 'survival') {
      applyStandardSurvivalPick?.();
      return;
    }
    survivalDifficultyModal.classList.remove('challenge-panel--hidden');
  });
  adiffClose?.addEventListener('click', closeAutoDifficultyModal);
  sdiffClose?.addEventListener('click', closeSurvivalDifficultyModal);
  survivalDifficultyModal.querySelector('.cpanel-backdrop')?.addEventListener('click', closeSurvivalDifficultyModal);
  survivalDifficultyModal.querySelectorAll<HTMLButtonElement>('[data-auto-difficulty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.autoDifficulty as AutoDifficulty | undefined;
      if (!d || !AUTO_DIFFICULTY_PRESETS[d]) return;
      autoDifficultyLevel = d;
      survivalDifficultyModal.classList.add('challenge-panel--hidden');
      if (!hasStarted) {
        hasStarted = true;
        startSimulation('survival', d);
        return;
      }
      applyStandardSurvivalPick?.();
    });
  });
  autoDifficultyModal.querySelector('.cpanel-backdrop')?.addEventListener('click', closeAutoDifficultyModal);
  autoDifficultyModal.querySelectorAll<HTMLButtonElement>('[data-auto-difficulty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.autoDifficulty as AutoDifficulty | undefined;
      if (!d || !AUTO_DIFFICULTY_PRESETS[d]) return;
      autoDifficultyLevel = d;
      autoDifficultyModal.classList.add('challenge-panel--hidden');
      if (!hasStarted) {
        hasStarted = true;
        startSimulation('auto', d);
        return;
      }
      applyStandardDifficultyPick?.();
    });
  });
}

// ─── Seed helpers ─────────────────────────────

function _seedEntities(world: WorldState, counts: SpawnConfig): void {
  const { width: W, height: H } = world.config;

  // 40 agents
  for (let i = 0; i < counts.agent; i++) {
    world.addEntity(new Entity({
      type:     'agent',
      position: vec2(Math.random() * W, Math.random() * H),
      velocity: vec2((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80),
      energy:   100 + Math.random() * 100,
      hunger:   100 + Math.random() * 100,
      gender:   Math.random() < 0.5 ? 'male' : 'female',
      ageYears: Math.random() * 60,
      frailty:  0.8 + Math.random() * 0.4,
    }));
  }

  const foodToSpawn = Math.min(counts.food, MAX_FOOD_ENTITIES);
  for (let i = 0; i < foodToSpawn; i++) {
    world.addEntity(new Entity({
      type:     'food',
      position: vec2(Math.random() * W, Math.random() * H),
      velocity: vec2(0, 0),
      energy:   100,
      mass:     2,
    }));
  }

  // 5 attractors
  for (let i = 0; i < counts.attractor; i++) {
    world.addEntity(new Entity({
      type:     'attractor',
      position: vec2(Math.random() * W, Math.random() * H),
      velocity: vec2(0, 0),
      energy:   100,
      mass:     5,
    }));
  }

  // 5 obstacles
  for (let i = 0; i < counts.obstacle; i++) {
    world.addEntity(new Entity({
      type:     'obstacle',
      position: vec2(Math.random() * W, Math.random() * H),
      velocity: vec2(0, 0),
      energy:   100,
      mass:     10,
      maxSpeed: 0,
    }));
  }
}