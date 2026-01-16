import { spawn } from "node:child_process"
import path from "node:path"

const cwd = path.resolve(import.meta.dirname, "..")

const child = spawn("bunx", ["electron", "dist/main.cjs"], {
  cwd,
  stdio: "inherit",
  env: process.env,
})

child.on("exit", (code) => process.exit(typeof code === "number" ? code : 0))

