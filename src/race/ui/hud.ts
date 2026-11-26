import { formatDelta, formatTime, type Medal } from "../session/session";

const MEDAL_LABEL: Record<Exclude<Medal, null>, string> = { auteur: "Auteur", or: "Or", argent: "Argent", bronze: "Bronze" };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Tout l'affichage par-dessus la course : chrono, essais, écarts aux checkpoints, résultats. */
export class Hud {
  private readonly timer = $("timer");
  private readonly attempt = $("attempt");
  private readonly best = $("best");
  private readonly bestMedal = $("bestMedal");
  private readonly speed = $("speed");
  private readonly center = $("center");
  private readonly split = $("split");
  private readonly results = $("results");
  private centerTO = 0;
  private splitTO = 0;

  setTime(t: number): void {
    this.timer.textContent = formatTime(t);
  }

  /** En solo (essais illimités), seul le numéro de l'essai s'affiche. */
  setAttempt(n: number, total: number): void {
    this.attempt.textContent = Number.isFinite(total) ? `Essai ${n}/${total}` : `Essai ${n}`;
  }

  setBest(t: number | null, medal: Medal): void {
    this.best.textContent = formatTime(t);
    this.bestMedal.className = "medal " + (medal ?? "none");
    this.bestMedal.textContent = medal === "auteur" ? "★" : medal ? MEDAL_LABEL[medal][0]! : "";
    this.bestMedal.title = medal ? MEDAL_LABEL[medal] : "";
  }

  setSpeed(ms: number): void {
    this.speed.textContent = String(Math.round(Math.abs(ms) * 3.6));
  }

  /** Grand message au centre : compte à rebours, arrivée, chute. */
  flash(html: string, ms = 1200, cls = ""): void {
    clearTimeout(this.centerTO);
    this.center.className = "center show " + cls;
    this.center.innerHTML = html;
    if (ms > 0) this.centerTO = window.setTimeout(() => (this.center.className = "center"), ms);
  }

  clearFlash(): void {
    clearTimeout(this.centerTO);
    this.center.className = "center";
  }

  /** Écart au checkpoint par rapport à ton meilleur essai. */
  showSplit(index: number, time: number, delta: number | null): void {
    clearTimeout(this.splitTO);
    const cls = delta === null ? "neutral" : delta <= 0 ? "ahead" : "behind";
    this.split.className = "split show " + cls;
    this.split.innerHTML = `<span class="cp">CP ${index + 1}</span><b>${delta === null ? formatTime(time) : formatDelta(delta)}</b>`;
    this.splitTO = window.setTimeout(() => (this.split.className = "split"), 1600);
  }

  showResults(times: (number | null)[], best: number | null, medal: Medal, onReplay: () => void, onMenu: () => void): void {
    const bestIdx = best === null ? -1 : times.indexOf(best);
    this.results.innerHTML = `
      <div class="res-card" role="dialog" aria-modal="true" aria-labelledby="resTitle">
        <h2 id="resTitle">Fin des ${times.length} essais</h2>
        <div class="res-best">
          <span class="medal big ${medal ?? "none"}">${medal === "auteur" ? "★" : medal ? MEDAL_LABEL[medal][0] : ""}</span>
          <div><span class="lbl">Meilleur temps</span><b>${formatTime(best)}</b>${medal ? `<span class="lbl">Médaille ${MEDAL_LABEL[medal]}</span>` : ""}</div>
        </div>
        <ol class="res-list">${times
          .map((t, i) => `<li class="${i === bestIdx ? "is-best" : t === null ? "dnf" : ""}"><span>Essai ${i + 1}</span><b>${t === null ? "—" : formatTime(t)}</b></li>`)
          .join("")}</ol>
        <div class="res-actions">
          <button class="btn" id="resMenu">Menu</button>
          <button class="btn primary" id="resReplay">Rejouer</button>
        </div>
      </div>`;
    this.results.hidden = false;
    $("resReplay").addEventListener("click", onReplay);
    $("resMenu").addEventListener("click", onMenu);
    $("resReplay").focus();
  }

  hideResults(): void {
    this.results.hidden = true;
    this.results.innerHTML = "";
  }
}
