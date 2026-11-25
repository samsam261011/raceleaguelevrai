/**
 * Touches du joueur, modifiables dans les paramètres et gardées dans le navigateur.
 * Chaque action a deux touches. On enregistre la position de la touche (e.code),
 * donc ZQSD sur un clavier AZERTY et WASD sur un QWERTY tombent au même endroit.
 */
export type Action = "throttle" | "brake" | "left" | "right" | "restart";

export const ACTIONS: { id: Action; label: string }[] = [
  { id: "throttle", label: "Accélérer" },
  { id: "brake", label: "Freiner" },
  { id: "left", label: "Tourner à gauche" },
  { id: "right", label: "Tourner à droite" },
  { id: "restart", label: "Recommencer" },
];

export type Bindings = Record<Action, [string, string]>;

export const DEFAULT_BINDINGS: Bindings = {
  throttle: ["ArrowUp", "KeyW"],
  brake: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  restart: ["KeyR", "Enter"],
};

const STORAGE_KEY = "raceleague.keys";

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function clone(b: Bindings): Bindings {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [v[0], v[1]]])) as Bindings;
}

export function loadBindings(store: KeyStore | null = defaultStore()): Bindings {
  const out = clone(DEFAULT_BINDINGS);
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return out;
    const saved = JSON.parse(raw) as Partial<Record<Action, unknown>>;
    for (const { id } of ACTIONS) {
      const v = saved[id];
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string")) out[id] = [v[0], v[1]];
    }
  } catch {
    /* réglages illisibles : on garde les touches par défaut */
  }
  return out;
}

export function saveBindings(b: Bindings, store: KeyStore | null = defaultStore()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* stockage indisponible */
  }
}

/** Attribue une touche à une action. La touche est retirée des autres actions pour éviter les doublons. */
export function assignKey(b: Bindings, action: Action, slot: 0 | 1, code: string): Bindings {
  const next = clone(b);
  for (const { id } of ACTIONS) {
    for (const s of [0, 1] as const) if (next[id][s] === code) next[id][s] = "";
  }
  next[action][slot] = code;
  return next;
}

/** Action déclenchée par une touche, ou null. */
export function actionFor(b: Bindings, code: string): Action | null {
  for (const { id } of ACTIONS) if (b[id][0] === code || b[id][1] === code) return id;
  return null;
}

const NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Espace",
  Enter: "Entrée",
  Backspace: "Retour",
  ShiftLeft: "Maj G",
  ShiftRight: "Maj D",
  ControlLeft: "Ctrl G",
  ControlRight: "Ctrl D",
  AltLeft: "Alt",
  Tab: "Tab",
};

/** Nom lisible d'une touche. Avec la carte du clavier (Chrome), affiche la vraie lettre (Z en AZERTY). */
export function keyLabel(code: string, layout?: Map<string, string> | null): string {
  if (!code) return "—";
  if (NAMES[code]) return NAMES[code]!;
  const fromLayout = layout?.get(code);
  if (fromLayout) return fromLayout.toUpperCase();
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Pavé " + code.slice(6);
  return code;
}

/** Carte du clavier quand le navigateur la donne (sinon null). */
export async function keyboardLayout(): Promise<Map<string, string> | null> {
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    return kb?.getLayoutMap ? await kb.getLayoutMap() : null;
  } catch {
    return null;
  }
}
