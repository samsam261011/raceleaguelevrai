import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deux pages : le menu (index.html) et la course (race.html).
// base "./" pour que le build marche aussi bien sur Poki, CrazyGames ou un simple hébergement statique.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        menu: fileURLToPath(new URL("./index.html", import.meta.url)),
        race: fileURLToPath(new URL("./race.html", import.meta.url)),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
