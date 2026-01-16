import { spawn } from "node:child_process"
import path from "node:path"

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env })
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(" ")} 退出码 ${code}`))
    })
  })
}

const cwd = path.resolve(import.meta.dirname, "..")

await run("bunx", ["vite", "build"], cwd)

await run(
  "bun",
  [
    "build",
    "src/main/main.ts",
    "--outfile",
    "dist/main.cjs",
    "--format=cjs",
    "--target=node",
    "--sourcemap=inline",
    "--external",
    "electron",
  ],
  cwd,
)

await run(
  "bun",
  [
    "build",
    "src/main/preload.ts",
    "--outfile",
    "dist/preload.cjs",
    "--format=cjs",
    "--target=node",
    "--sourcemap=inline",
    "--external",
    "electron",
  ],
  cwd,
)
