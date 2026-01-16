import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import path from "node:path"

export type OpencodeServerInfo = {
  baseUrl: string
  opencodeCwd: string
}

export class OpencodeServerManager {
  #child: ChildProcessWithoutNullStreams | undefined
  #info: OpencodeServerInfo | undefined
  #starting: Promise<OpencodeServerInfo> | undefined

  constructor(private readonly opencodeRoot: string) {}

  get info() {
    return this.#info
  }

  async start(): Promise<OpencodeServerInfo> {
    if (this.#info) return this.#info
    if (this.#starting) return this.#starting

    const opencodeCwd = path.join(this.opencodeRoot, "packages", "opencode")

    this.#starting = new Promise<OpencodeServerInfo>((resolve, reject) => {
      const child = spawn(
        process.env.BUN || "bun",
        ["run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", "0"],
        {
          cwd: opencodeCwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        },
      )

      this.#child = child

      let settled = false
      const fail = (err: unknown) => {
        if (settled) return
        settled = true
        reject(err instanceof Error ? err : new Error(String(err)))
      }

      const tryParse = (chunk: Buffer) => {
        const text = chunk.toString("utf8")
        const match = text.match(/opencode server listening on (http:\/\/[^\s]+)/i)
        if (!match) return

        const baseUrl = match[1]
        const info: OpencodeServerInfo = { baseUrl, opencodeCwd }
        this.#info = info
        if (!settled) {
          settled = true
          resolve(info)
        }
      }

      child.stdout.on("data", tryParse)
      child.stderr.on("data", (d) => {
        process.stderr.write(d)
      })

      child.on("error", fail)
      child.on("exit", (code) => {
        if (!settled) fail(new Error(`opencode serve 已退出（code=${code}）`))
      })

      setTimeout(() => {
        if (!settled) fail(new Error("启动 opencode serve 超时（10s），请确认已安装 bun 且 opencode 依赖已安装"))
      }, 10_000)
    }).finally(() => {
      this.#starting = undefined
    })

    return this.#starting
  }

  async stop() {
    const child = this.#child
    this.#child = undefined
    this.#info = undefined
    this.#starting = undefined

    if (!child) return
    if (child.killed) return
    child.kill()
  }
}
