import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import path from "node:path"

export default defineConfig({
  plugins: [solid()],
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
})

