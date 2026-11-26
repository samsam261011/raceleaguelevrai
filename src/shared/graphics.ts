/**
 * Qualité graphique, réglée dans les paramètres et gardée d'une partie à l'autre.
 * « fluide » (par défaut) : image en résolution normale (pas de rendu en double densité sur les écrans Retina),
 * ombres simples limitées à la piste et à la voiture, et résolution qui baisse toute seule si l'ordinateur peine.
 * « detaille » : rendu complet (double densité, ombres douces sur tout le décor).
 */
export type Graphics = "fluide" | "detaille";

const KEY = "raceleague.graphismes";

export function loadGraphics(): Graphics {
  try {
    return localStorage.getItem(KEY) === "detaille" ? "detaille" : "fluide";
  } catch {
    return "fluide";
  }
}

export function saveGraphics(g: Graphics): void {
  try {
    localStorage.setItem(KEY, g);
  } catch {
    /* stockage bloqué : le réglage vaut pour cette page seulement */
  }
}

/** Densité de pixels de départ pour un réglage donné. */
export function pixelRatioFor(g: Graphics): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return g === "detaille" ? Math.min(dpr, 2) : Math.min(dpr, 1);
}

/**
 * Résolution adaptative : si les images mettent trop longtemps à venir pendant un moment,
 * on baisse la densité de pixels par paliers (jamais en dessous de `min`). On ne remonte pas en cours de partie,
 * pour éviter de faire des allers-retours visibles.
 */
export class AdaptiveResolution {
  private sum = 0;
  private count = 0;
  constructor(
    private ratio: number,
    private readonly apply: (ratio: number) => void,
    private readonly min = 0.6,
  ) {}

  /** À appeler à chaque image avec sa durée (s). */
  frame(dt: number): void {
    // Onglet caché ou gros à-coup isolé : on ne compte pas
    if (dt > 0.25) return;
    this.sum += dt;
    this.count++;
    if (this.count < 90) return;
    const avg = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    // Moins de 45 images par seconde en moyenne : un palier plus bas
    if (avg > 1 / 45 && this.ratio > this.min) {
      this.ratio = Math.max(this.min, Math.round((this.ratio - 0.15) * 100) / 100);
      this.apply(this.ratio);
    }
  }

  reset(ratio: number): void {
    this.ratio = ratio;
    this.sum = 0;
    this.count = 0;
    this.apply(ratio);
  }
}
