import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const cwd = path.resolve(import.meta.dirname, "..")

function spawnInherit(cmd: string, args: string[], extraEnv?: Record<string, string>) {
  return spawn(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...(extraEnv ?? {}) },
  })
}

const vite = spawnInherit("bunx", ["vite", "--port", "5173"])
const buildMain = spawnInherit("bun", [
  "build",
  "src/main/main.ts",
  "--outfile",
  "dist/main.cjs",
  "--format=cjs",
  "--target=node",
  "--sourcemap=inline",
  "--external",
  "electron",
  "--watch",
])
const buildPreload = spawnInherit("bun", [
  "build",
  "src/main/preload.ts",
  "--outfile",
  "dist/preload.cjs",
  "--format=cjs",
  "--target=node",
  "--sourcemap=inline",
  "--external",
  "electron",
  "--watch",
])

let electron: ReturnType<typeof spawn> | undefined
const startElectron = () => {
  electron?.kill()
  electron = spawnInherit("bunx", ["electron", "dist/main.cjs"], { VITE_DEV_SERVER_URL: "http://localhost:5173" })
}

setTimeout(startElectron, 1200)

fs.mkdirSync(path.join(cwd, "dist"), { recursive: true })
fs.watch(path.join(cwd, "dist"), (_event, filename) => {
  if (filename && filename.toString().includes("main.cjs")) startElectron()
})

const shutdown = () => {
  electron?.kill()
  vite.kill()
  buildMain.kill()
  buildPreload.kill()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
