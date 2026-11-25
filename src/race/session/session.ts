/** Une série de 10 tentatives sur une map : le cœur d'un match RaceLeague. */
export const ATTEMPTS_PER_MATCH = 10;

export interface AttemptResult {
  /** null si la voiture est tombée ou si le joueur a recommencé avant l'arrivée. */
  time: number | null;
  splits: number[];
  inputs: number[];
}

export type Medal = "auteur" | "or" | "argent" | "bronze" | null;

export class Session {
  readonly results: AttemptResult[] = [];

  constructor(readonly attempts = ATTEMPTS_PER_MATCH) {}

  get used(): number {
    return this.results.length;
  }

  get remaining(): number {
    return this.attempts - this.results.length;
  }

  get done(): boolean {
    return this.remaining <= 0;
  }

  /** Numéro de la tentative en cours (1 à 10). */
  get current(): number {
    return Math.min(this.attempts, this.results.length + 1);
  }

  record(result: AttemptResult): { isBest: boolean; previousBest: number | null } {
    if (this.done) throw new Error("Plus de tentative disponible");
    const previousBest = this.bestTime;
    this.results.push(result);
    const isBest = result.time !== null && (previousBest === null || result.time < previousBest);
    return { isBest, previousBest };
  }

  get best(): AttemptResult | null {
    let best: AttemptResult | null = null;
    for (const r of this.results) if (r.time !== null && (best === null || r.time < best.time!)) best = r;
    return best;
  }

  get bestTime(): number | null {
    return this.best?.time ?? null;
  }
}

export function medalFor(time: number | null, medals: { auteur: number; or: number; argent: number; bronze: number }): Medal {
  if (time === null) return null;
  if (time <= medals.auteur) return "auteur";
  if (time <= medals.or) return "or";
  if (time <= medals.argent) return "argent";
  if (time <= medals.bronze) return "bronze";
  return null;
}

/** 34.218 → "0:34,218" */
export function formatTime(t: number | null): string {
  if (t === null) return "--:--,---";
  const ms = Math.round(t * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

/** Écart signé : -0.084 → "-0,084" */
export function formatDelta(d: number): string {
  const ms = Math.round(Math.abs(d) * 1000);
  const s = Math.floor(ms / 1000);
  const r = ms % 1000;
  return `${d < 0 ? "-" : "+"}${s},${String(r).padStart(3, "0")}`;
}
