// Survival mode: score and manual overlays (same shell classes as challenge panel).

import { loadSurvivalBest } from '../survival/survivalScore';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s (${sec.toFixed(1)} s total)`;
}

export function openSurvivalScoreModal(): void {
  const best = loadSurvivalBest();
  const el = document.createElement('div');
  el.className = 'challenge-panel';

  const bestHtml = best
    ? `
      <div class="cpanel-card" style="--card-color:#39FF14">
        <p class="cpanel-card-desc"><strong>Victory time:</strong> ${formatDuration(best.survivedSec)}</p>
        <p class="cpanel-card-desc"><strong>Peak amoeba count:</strong> ${best.peakAgents}</p>
        <p class="cpanel-card-desc"><strong>Difficulty:</strong> ${best.difficulty}</p>
        <p class="cpanel-card-desc"><strong>Challenges:</strong><br/>${
          best.challenges.length ? best.challenges.map(c => `· ${c.missionId} — ${c.score.toLocaleString()} pts (rank ${c.rank})`).join('<br/>') : '—'
        }</p>
      </div>`
    : `<p class="cpanel-card-desc" style="padding:1rem">No survival victory recorded yet.</p>`;

  el.innerHTML = `
    <div class="cpanel-backdrop"></div>
    <div class="cpanel-inner">
      <div class="cpanel-header">
        <span class="cpanel-header-icon">📊</span>
        <h2 class="cpanel-title">SURVIVAL — BEST RUN</h2>
        <p class="cpanel-subtitle">Top result stored on this browser</p>
        <button type="button" class="cpanel-close" id="surv-score-x" title="Close">✕</button>
      </div>
      <div class="cpanel-cards" style="display:block;max-width:520px;margin:0 auto">
        ${bestHtml}
      </div>
    </div>`;

  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onEsc);
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onEsc);
  el.querySelector('.cpanel-backdrop')?.addEventListener('click', close);
  el.querySelector('#surv-score-x')?.addEventListener('click', close);
  document.body.appendChild(el);
}

export function openSurvivalManualModal(): void {
  const el = document.createElement('div');
  el.className = 'challenge-panel';
  el.innerHTML = `
    <div class="cpanel-backdrop"></div>
    <div class="cpanel-inner">
      <div class="cpanel-header">
        <span class="cpanel-header-icon">📜</span>
        <h2 class="cpanel-title">SURVIVAL MANUAL</h2>
        <p class="cpanel-subtitle">Controls, health, events, and abilities</p>
        <button type="button" class="cpanel-close" id="surv-man-x" title="Close">✕</button>
      </div>
      <div class="cpanel-cards" style="display:block;max-width:560px;margin:0 auto;text-align:left">
        <div class="cpanel-card" style="--card-color:#00F5FF">
          <p class="cpanel-card-desc">
            <strong>Movement:</strong> select an amoeba, press <em>Play as this amoeba</em>, then use <kbd>W A S D</kbd>.
            Other amoeba use the same AI as Auto mode.
          </p>
          <p class="cpanel-card-desc">
            <strong>Health (0–100):</strong> at 0 hunger you lose health quickly; at 0 health you die. Health regenerates when fed; harder difficulty = slower regen and slower healing from food.
            You may eat food any time; NPCs follow normal hunger rules.
          </p>
          <p class="cpanel-card-desc">
            <strong>Vortex:</strong> inside the pull radius you lose health (faster near the center). Higher difficulty increases damage.
          </p>
          <p class="cpanel-card-desc">
            <strong>Stones:</strong> hitting a rock destroys it and hurts the amoeba (50 / 70 / 80 by difficulty).
          </p>
          <p class="cpanel-card-desc">
            <strong>Random events:</strong> rockfall (warning shadow, then rocks), stronger vortex pull for a while, or plague that mutates a portion of NPCs (not your amoeba). Infected cannot be played.
          </p>
          <p class="cpanel-card-desc">
            <strong>Challenges:</strong> each mission grants a <em>one-time</em> reward of food and amoeba (rank S → 5 amoeba + 10 food).
          </p>
          <p class="cpanel-card-desc">
            <strong>Abilities (your amoeba):</strong> Shield — ~5s invuln or until a rock breaks it; ~2 min CD (real). Dash — 2× speed, no stamina cost; ~1 min CD (real). Stimulation of reproduction — clears reproduction cooldown for <em>all</em> amoeba; 6 game years (~6 min real) global CD.
          </p>
        </div>
      </div>
    </div>`;
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onEsc);
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onEsc);
  el.querySelector('.cpanel-backdrop')?.addEventListener('click', close);
  el.querySelector('#surv-man-x')?.addEventListener('click', close);
  document.body.appendChild(el);
}

export function openSurvivalVictoryModal(
  agents: number,
  onContinue?: () => void,
  onPlayAgain?: () => void,
): void {
  const el = document.createElement('div');
  el.className = 'challenge-panel';
  el.innerHTML = `
    <div class="cpanel-backdrop"></div>
    <div class="cpanel-inner">
      <div class="cpanel-header">
        <span class="cpanel-header-icon">🏁</span>
        <h2 class="cpanel-title">VICTORY</h2>
        <p class="cpanel-subtitle">Population goal reached</p>
        <button type="button" class="cpanel-close" id="surv-win-x" title="Close">✕</button>
      </div>
      <div class="cpanel-cards" style="display:block;max-width:560px;margin:0 auto;text-align:left">
        <div class="cpanel-card" style="--card-color:#FFD700">
          <p class="cpanel-card-desc">
            <strong>Congratulations.</strong> Your amoeba population reached <strong>${agents}</strong>.
          </p>
          <p class="cpanel-card-desc">
            You can keep playing, or switch mode with <kbd>Z</kbd>.
          </p>
          <div class="setup-actions" style="margin-top:12px">
            <button type="button" class="btn setup-btn-close" id="surv-win-continue">Continue</button>
            <button type="button" class="btn setup-btn-apply" id="surv-win-again">Play Again</button>
          </div>
        </div>
      </div>
    </div>`;

  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onEsc);
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onEsc);
  el.querySelector('.cpanel-backdrop')?.addEventListener('click', close);
  el.querySelector('#surv-win-x')?.addEventListener('click', close);
  el.querySelector('#surv-win-continue')?.addEventListener('click', () => {
    close();
    onContinue?.();
  });
  el.querySelector('#surv-win-again')?.addEventListener('click', () => {
    close();
    onPlayAgain?.();
  });
  document.body.appendChild(el);
}
