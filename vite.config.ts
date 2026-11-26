import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Trois pages : le menu (index.html), la course (race.html) et l'éditeur de circuits (editor.html).
// base "./" pour que le build marche aussi bien sur Poki, CrazyGames ou un simple hébergement statique.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    // Le moteur physique (WebAssembly inclus) pèse à lui seul environ 1,7 Mo compressé
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      input: {
        menu: fileURLToPath(new URL("./index.html", import.meta.url)),
        race: fileURLToPath(new URL("./race.html", import.meta.url)),
        editor: fileURLToPath(new URL("./editor.html", import.meta.url)),
      },
      // Three.js et le moteur physique dans leurs propres fichiers, mis en cache entre les mises à jour du jeu.
      output: { manualChunks: { three: ["three"], physique: ["@dimforge/rapier3d-deterministic-compat"] } },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
