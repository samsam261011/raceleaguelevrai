import { actionFor, loadBindings, type Action, type Bindings } from "../../shared/keybindings";
import { IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../physics/input";

const FLAG: Partial<Record<Action, number>> = {
  throttle: IN_THROTTLE,
  brake: IN_BRAKE,
  left: IN_LEFT,
  right: IN_RIGHT,
};

export interface ControlEvents {
  onRestart: () => void;
  onMenu: () => void;
}

/** Clavier (touches personnalisables) et boutons tactiles → entrée du joueur, un octet par pas de physique. */
export class Controls {
  private keys = 0;
  private touch = 0;
  private bindings: Bindings = loadBindings();
  private readonly held = new Map<number, number>();
  /** Désactive le clavier (par exemple pendant qu'on change ses touches). */
  paused = false;

  constructor(private readonly events: ControlEvents) {
    window.addEventListener("keydown", (e) => {
      if (this.paused) return;
      const action = actionFor(this.bindings, e.code);
      const flag = action ? FLAG[action] : undefined;
      if (flag) {
        this.keys |= flag;
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (action === "restart") {
        e.preventDefault();
        this.events.onRestart();
      } else if (e.code === "Escape") {
        this.events.onMenu();
      }
    });
    window.addEventListener("keyup", (e) => {
      const action = actionFor(this.bindings, e.code);
      const flag = action ? FLAG[action] : undefined;
      if (flag) this.keys &= ~flag;
    });
    window.addEventListener("blur", () => this.release());
  }

  setBindings(b: Bindings): void {
    this.bindings = b;
    this.release();
  }

  release(): void {
    this.keys = 0;
    this.touch = 0;
    this.held.clear();
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
