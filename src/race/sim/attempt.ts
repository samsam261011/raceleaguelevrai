import { CarSim, copyCar, type CarState } from "../physics/car";
import { DT } from "../physics/constants";
import type { InputBits } from "../physics/input";
import { HALF } from "../world/pieces";
import type { World } from "../world/world";

export type AttemptStatus = "running" | "finished" | "fell";

export interface CheckpointEvent {
  index: number;
  /** Temps de passage en secondes, à la milliseconde près. */
  time: number;
}

/**
 * Une tentative : la voiture, le chrono, les checkpoints et la liste des entrées.
 * La liste des entrées suffit à rejouer la tentative à l'identique (replay, fantôme, anti-triche).
 * Les checkpoints se prennent dans n'importe quel ordre ; l'arrivée ne compte qu'une fois tous passés.
 */
export class Attempt {
  car: CarState;
  prev: CarState;
  tick = 0;
  status: AttemptStatus = "running";
  readonly inputs: number[] = [];
  readonly splits: number[] = [];
  private readonly passed = new Set<number>();
  finishTime: number | null = null;
  private readonly sim: CarSim;

  /** Le moteur physique doit être chargé avant (voir initPhysics). */
  constructor(readonly world: World) {
    this.sim = new CarSim(world);
    this.car = this.sim.state;
    this.prev = copyCar(this.car);
  }

  /** Libère le monde physique de la tentative. */
  dispose(): void {
    this.sim.dispose();
  }

  /** Avance d'un pas. Retourne le checkpoint franchi pendant ce pas, s'il y en a un. */
  step(input: InputBits): CheckpointEvent | null {
    if (this.status !== "running") return null;
    this.prev = this.car;
    this.inputs.push(input & 0xff);
    const a = this.car;
    const b = this.sim.step(input);
    this.car = b;
    this.tick++;

    if (b.fell) {
      this.status = "fell";
      return null;
    }

    let event: CheckpointEvent | null = null;
    for (const g of this.world.gates) {
      if (g.kind === "start") continue;
      const s0 = (a.x - g.x) * g.dx + (a.z - g.z) * g.dz;
      const s1 = (b.x - g.x) * g.dx + (b.z - g.z) * g.dz;
      if ((s0 < 0 && s1 < 0) || (s0 > 0 && s1 > 0) || s0 === s1) continue;
      // Dans le portique : sur la largeur de la route et pas trop haut ni trop bas
      const lat = (b.x - g.x) * -g.dz + (b.z - g.z) * g.dx;
      if (lat > HALF + 0.5 || lat < -HALF - 0.5 || b.y < g.y - 2 || b.y > g.y + 9) continue;
      const time = Math.round((this.tick - 1 + s0 / (s0 - s1)) * DT * 1000) / 1000;
      if (g.kind === "checkpoint" && !this.passed.has(g.block)) {
        this.passed.add(g.block);
        this.splits.push(time);
        event = { index: this.splits.length - 1, time };
      } else if (g.kind === "finish" && this.passed.size === this.world.checkpointCount) {
        this.finishTime = time;
        this.status = "finished";
        break;
      }
    }
    return event;
  }

  get checkpointsLeft(): number {
    return this.world.checkpointCount - this.passed.size;
  }

  get time(): number {
    return this.finishTime ?? this.tick * DT;
  }
}

/** Rejoue une tentative à partir de ses entrées et renvoie son temps (ce que fera le serveur pour valider un record). */
export function replayAttempt(world: World, inputs: ArrayLike<number>): { status: AttemptStatus; time: number | null; splits: number[] } {
  const a = new Attempt(world);
  for (let i = 0; i < inputs.length && a.status === "running"; i++) a.step(inputs[i]!);
  a.dispose();
  return { status: a.status, time: a.finishTime, splits: a.splits.slice() };
}
