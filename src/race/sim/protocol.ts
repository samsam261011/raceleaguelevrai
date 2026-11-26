import type { MapDefinition } from "../world/world";
import type { AttemptStatus, CheckpointEvent } from "./attempt";

/**
 * Messages entre l'affichage (fil principal) et la simulation (Web Worker).
 *
 * Le Worker possède tout l'état physique : la voiture, le fantôme, le chrono. Il avance à pas fixe
 * (1/120 s). À chaque image, l'affichage lui envoie les touches et le nombre de pas à jouer ;
 * il répond avec un instantané (voiture et fantôme, avant et après le dernier pas) que l'affichage
 * interpole. Les touches de chaque pas sont enregistrées dans le Worker : c'est le replay.
 */
export type ToSim =
  | { type: "init"; map: MapDefinition; autopilot: boolean }
  /** Nouvel essai ; `ghost` = entrées du meilleur essai à rejouer en fantôme. */
  | { type: "begin"; id: number; ghost: number[] | null }
  /** Joue `ticks` pas avec ces touches (le pilote automatique de dev les remplace si demandé). */
  | { type: "step"; id: number; ticks: number; bits: number };

export type FromSim =
  | { type: "ready" }
  | {
      type: "state";
      /** Essai auquel répond ce message (les réponses d'un essai précédent sont ignorées). */
      id: number;
      tick: number;
      status: AttemptStatus;
      time: number;
      /** Voiture avant/après le dernier pas, puis fantôme avant/après (si `ghost`). Voir snapshot.ts. */
      cars: Float64Array;
      ghost: boolean;
      events: CheckpointEvent[];
      /** À la fin de l'essai seulement : temps, temps intermédiaires et entrées (le replay). */
      end?: { time: number | null; splits: number[]; inputs: Uint8Array };
    };
