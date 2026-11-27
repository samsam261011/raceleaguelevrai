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
    // Le modèle 3D de la voiture est intégré au code (data URL) : un fichier de moins, et certains hébergeurs ne servent pas les .glb
    assetsInlineLimit: (file) => (file.endsWith(".glb") ? true : undefined),
    rollupOptions: {
      input: {
        menu: fileURLToPath(new URL("./index.html", import.meta.url)),
        race: fileURLToPath(new URL("./race.html", import.meta.url)),
        editor: fileURLToPath(new URL("./editor.html", import.meta.url)),
      },
      // Three.js dans son propre fichier, mis en cache entre les mises à jour du jeu.
      // Le moteur physique est dans le fichier du Worker de simulation.
      output: { manualChunks: { three: ["three"] } },
    },
  },
  // La simulation tourne dans un Web Worker (module ES, pour garder le moteur physique dans son fichier)
  worker: { format: "es" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
