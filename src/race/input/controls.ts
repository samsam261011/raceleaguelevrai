import { IN_BRAKE, IN_DRIFT, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../physics/input";

/**
 * Clavier et boutons tactiles → entrée du joueur (un octet par pas de physique).
 * On lit les touches par leur position (e.code) : ZQSD en AZERTY et WASD en QWERTY marchent pareil.
 */
const KEYMAP: Record<string, number> = {
  ArrowUp: IN_THROTTLE,
  KeyW: IN_THROTTLE,
  ArrowDown: IN_BRAKE,
  KeyS: IN_BRAKE,
  ArrowLeft: IN_LEFT,
  KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyD: IN_RIGHT,
  Space: IN_DRIFT,
  ShiftLeft: IN_DRIFT,
};

export interface ControlEvents {
  onRestart: () => void;
  onMenu: () => void;
}

export class Controls {
  private keys = 0;
  private touch = 0;
  private readonly held = new Map<number, number>();

  constructor(private readonly events: ControlEvents) {
    window.addEventListener("keydown", (e) => {
      const flag = KEYMAP[e.code];
      if (flag) {
        this.keys |= flag;
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (e.code === "KeyR" || e.code === "Enter" || e.code === "Backspace") {
        e.preventDefault();
        this.events.onRestart();
      } else if (e.code === "Escape") {
        this.events.onMenu();
      }
    });
    window.addEventListener("keyup", (e) => {
      const flag = KEYMAP[e.code];
      if (flag) this.keys &= ~flag;
    });
    window.addEventListener("blur", () => {
      this.keys = 0;
      this.touch = 0;
      this.held.clear();
    });
  }

  /** Branche un bouton tactile : il reste appuyé tant que le doigt est dessus (multi-touch). */
  bindTouchButton(el: HTMLElement, flag: number): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.held.set(e.pointerId, flag);
      el.classList.add("pressed");
      this.recompute();
    };
    const up = (e: PointerEvent) => {
      this.held.delete(e.pointerId);
      el.classList.remove("pressed");
      this.recompute();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private recompute(): void {
    let t = 0;
    for (const f of this.held.values()) t |= f;
    this.touch = t;
  }

  get bits(): number {
    return this.keys | this.touch;
  }
}
