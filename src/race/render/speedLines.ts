/**
 * Traits de vitesse dessinés par-dessus la scène, depuis les bords de l'écran.
 * Purement visuel : ils apparaissent à haute vitesse et s'intensifient sur un booster.
 */
export class SpeedLines {
  private readonly g: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private readonly lines: { a: number; r: number; len: number; v: number }[] = [];
  private level = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
    for (let i = 0; i < 70; i++) this.lines.push(this.fresh(true));
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private fresh(any = false) {
    return { a: Math.random() * Math.PI * 2, r: any ? 0.35 + Math.random() * 0.8 : 0.35 + Math.random() * 0.15, len: 0.06 + Math.random() * 0.12, v: 0.8 + Math.random() * 1.2 };
  }

  /** k : vitesse / vitesse max (0 à 1,3). */
  draw(k: number, boost: boolean, dt: number): void {
    const target = Math.max(0, (k - 0.55) / 0.45) * 0.55 + (boost ? 0.45 : 0);
    this.level += (target - this.level) * (1 - Math.exp(-dt * 6));
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    if (this.level < 0.02) return;
    const cx = this.w / 2;
    const cy = this.h * 0.45;
    const R = Math.hypot(this.w, this.h) / 2;
    g.lineCap = "round";
    for (const l of this.lines) {
      l.r += l.v * dt * (1.2 + k);
      if (l.r > 1.15) Object.assign(l, this.fresh());
      const r0 = l.r * R;
      const r1 = (l.r + l.len) * R;
      const ca = Math.cos(l.a);
      const sa = Math.sin(l.a);
      g.strokeStyle = boost ? `rgba(150,240,255,${0.55 * this.level})` : `rgba(255,255,255,${0.45 * this.level})`;
      g.lineWidth = 1.5 + l.len * 14;
      g.beginPath();
      g.moveTo(cx + ca * r0, cy + sa * r0 * 0.75);
      g.lineTo(cx + ca * r1, cy + sa * r1 * 0.75);
      g.stroke();
    }
  }
}
