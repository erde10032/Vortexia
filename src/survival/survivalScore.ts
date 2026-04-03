// Persistence for survival best run (localStorage).

export const SURVIVAL_BEST_KEY = 'vortexia_survival_best_v1';
export const SURVIVAL_CLAIMED_MISSIONS_KEY = 'vortexia_survival_challenge_claims_v1';

export interface SurvivalBestRecord {
  /** Victory time / run duration */
  survivedSec: number;
  peakAgents: number;
  /** Missions completed during that run */
  challenges: Array<{ missionId: string; rank: string; score: number }>;
  difficulty: string;
  savedAt: string;
}

function difficultyWeight(diff: string): number {
  if (diff === 'hard') return 3;
  if (diff === 'medium') return 2;
  return 1; // easy/default
}

export function loadSurvivalBest(): SurvivalBestRecord | null {
  try {
    const raw = localStorage.getItem(SURVIVAL_BEST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SurvivalBestRecord;
  } catch {
    return null;
  }
}

export function saveSurvivalBestIfBetter(run: Omit<SurvivalBestRecord, 'savedAt'>): void {
  const prev = loadSurvivalBest();
  if (prev) {
    // Same difficulty: require strictly more amoeba.
    if (prev.difficulty === run.difficulty) {
      if (run.peakAgents <= prev.peakAgents) return;
    } else {
      // Cross-difficulty replacement by weighted amoeba count.
      // easy=1x, medium=2x, hard=3x
      const prevWeighted = prev.peakAgents * difficultyWeight(prev.difficulty);
      const runWeighted = run.peakAgents * difficultyWeight(run.difficulty);
      if (runWeighted < prevWeighted) return;
    }
  }
  const rec: SurvivalBestRecord = { ...run, savedAt: new Date().toISOString() };
  localStorage.setItem(SURVIVAL_BEST_KEY, JSON.stringify(rec));
}

export function loadClaimedMissions(): Set<string> {
  try {
    const raw = localStorage.getItem(SURVIVAL_CLAIMED_MISSIONS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function markMissionClaimed(missionId: string): void {
  const s = loadClaimedMissions();
  s.add(missionId);
  localStorage.setItem(SURVIVAL_CLAIMED_MISSIONS_KEY, JSON.stringify([...s]));
}

export function isMissionClaimed(missionId: string): boolean {
  return loadClaimedMissions().has(missionId);
}

/** Food and agents granted once per mission by rank (survival only). */
export function survivalRewardForRank(rank: string): { agents: number; food: number } {
  switch (rank) {
    case 'S': return { agents: 5, food: 10 };
    case 'A': return { agents: 4, food: 8 };
    case 'B': return { agents: 3, food: 6 };
    default: return { agents: 2, food: 4 };
  }
}
