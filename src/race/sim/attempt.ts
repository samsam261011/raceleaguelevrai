import { copyCar, spawnCar, stepCar, type CarState } from "../physics/car";
import { DT } from "../physics/constants";
import type { InputBits } from "../physics/input";
import type { Track } from "../track/types";

export type AttemptStatus = "running" | "finished" | "fell";

export interface CheckpointEvent {
  index: number;
  /** Temps de passage en secondes, à la milliseconde près. */
  time: number;
}

/**
 * Une tentative : la voiture, le chrono, les checkpoints et la liste des entrées.
 * La liste des entrées suffit à rejouer la tentative à l'identique (replay, fantôme, anti-triche).
 */
export class Attempt {
  car: CarState;
  prev: CarState;
  tick = 0;
  status: AttemptStatus = "running";
  readonly inputs: number[] = [];
  readonly splits: number[] = [];
  finishTime: number | null = null;

  constructor(readonly track: Track) {
    this.car = spawnCar(track);
    this.prev = copyCar(this.car);
  }

  /** Avance d'un pas. Retourne le checkpoint franchi pendant ce pas, s'il y en a un. */
  step(input: InputBits): CheckpointEvent | null {
    if (this.status !== "running") return null;
    this.prev = this.car;
    this.inputs.push(input & 0xff);
    const before = this.car.along;
    this.car = stepCar(this.car, input, this.track);
    this.tick++;
    const after = this.car.along;

    if (this.car.fell) {
      this.status = "fell";
      return null;
    }

    let event: CheckpointEvent | null = null;
    const next = this.splits.length;
    const cps = this.track.checkpointDist;
    // On ne valide un checkpoint que sur la piste, dans l'ordre, sans grand saut de progression.
    if (next < cps.length && after >= cps[next]! && before < cps[next]! && after - before < 5) {
      const time = this.interpolate(before, after, cps[next]!);
      this.splits.push(time);
      event = { index: next, time };
    }
    const finishAt = this.track.length - 0.5;
    if (this.splits.length === cps.length && after >= finishAt && before < finishAt && after - before < 5) {
      this.finishTime = this.interpolate(before, after, finishAt);
      this.status = "finished";
    }
    return event;
  }

  /** Temps exact du passage d'une ligne, en interpolant à l'intérieur du pas. */
  private interpolate(before: number, after: number, line: number): number {
    const frac = after > before ? (line - before) / (after - before) : 1;
    const t = (this.tick - 1 + frac) * DT;
    return Math.round(t * 1000) / 1000;
  }

  get time(): number {
    return this.finishTime ?? this.tick * DT;
  }
}

/** Rejoue une tentative à partir de ses entrées et renvoie son temps (ce que fera le serveur pour valider un record). */
export function replayAttempt(track: Track, inputs: ArrayLike<number>): { status: AttemptStatus; time: number | null; splits: number[] } {
  const a = new Attempt(track);
  for (let i = 0; i < inputs.length && a.status === "running"; i++) a.step(inputs[i]!);
  return { status: a.status, time: a.finishTime, splits: a.splits.slice() };
}
