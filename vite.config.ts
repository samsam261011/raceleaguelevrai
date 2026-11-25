import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Trois pages : le menu (index.html), la course (race.html) et l'éditeur de circuits (editor.html).
// base "./" pour que le build marche aussi bien sur Poki, CrazyGames ou un simple hébergement statique.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        menu: fileURLToPath(new URL("./index.html", import.meta.url)),
        race: fileURLToPath(new URL("./race.html", import.meta.url)),
        editor: fileURLToPath(new URL("./editor.html", import.meta.url)),
      },
      // Three.js dans son propre fichier, partagé par les deux pages et mis en cache.
      output: { manualChunks: { three: ["three"] } },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
