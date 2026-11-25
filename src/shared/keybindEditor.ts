import "./keybindEditor.css";
import { ACTIONS, assignKey, DEFAULT_BINDINGS, keyboardLayout, keyLabel, loadBindings, saveBindings, type Action, type Bindings } from "./keybindings";

/**
 * Liste des commandes modifiables : on clique sur une touche, puis on appuie sur la nouvelle.
 * Échap annule. Utilisé dans les paramètres du menu et de la course.
 */
export function mountKeybindEditor(container: HTMLElement, onChange?: (b: Bindings) => void): () => void {
  let bindings = loadBindings();
  let layout: Map<string, string> | null = null;
  let listening: { action: Action; slot: 0 | 1 } | null = null;

  const render = () => {
    container.innerHTML = "";
    container.classList.add("kb-editor");
    for (const { id, label } of ACTIONS) {
      const row = document.createElement("div");
      row.className = "kb-row";
      const name = document.createElement("span");
      name.className = "kb-name";
      name.textContent = label;
      row.appendChild(name);
      for (const slot of [0, 1] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "kb-key";
        const isListening = listening?.action === id && listening.slot === slot;
        if (isListening) b.classList.add("listening");
        b.textContent = isListening ? "…" : keyLabel(bindings[id][slot], layout);
        b.setAttribute("aria-label", `${label}, touche ${slot + 1} : ${keyLabel(bindings[id][slot], layout)}`);
        b.addEventListener("click", () => {
          listening = { action: id, slot };
          render();
        });
        row.appendChild(b);
      }
      container.appendChild(row);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "kb-reset";
    reset.textContent = "Touches par défaut";
    reset.addEventListener("click", () => {
      bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Bindings;
      listening = null;
      saveBindings(bindings);
      onChange?.(bindings);
      render();
    });
    container.appendChild(reset);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code !== "Escape") {
      bindings = assignKey(bindings, listening.action, listening.slot, e.code);
      saveBindings(bindings);
      onChange?.(bindings);
    }
    listening = null;
    render();
  };
  window.addEventListener("keydown", onKey, true);
  void keyboardLayout().then((l) => {
    layout = l;
    render();
  });
  render();
  return () => window.removeEventListener("keydown", onKey, true);
}
