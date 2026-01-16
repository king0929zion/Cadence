export type OpencodeEvent = any

function withDirectory(url: string, directory: string) {
  const u = new URL(url)
  u.searchParams.set("directory", directory)
  return u.toString()
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`)
  }
  return (await res.json()) as T
}

export class OpencodeHttpClient {
  private baseUrl: string
  private directory: string

  constructor(baseUrl: string, directory: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.directory = directory
  }

  getBaseUrl() {
    return this.baseUrl
  }

  setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  setDirectory(directory: string) {
    this.directory = directory
  }

  async getConfig(): Promise<any> {
    const res = await fetch(withDirectory(`${this.baseUrl}/config`, this.directory))
    return readJson(res)
  }

  async listSessions(input?: { search?: string; limit?: number; roots?: boolean }): Promise<any[]> {
    const u = new URL(withDirectory(`${this.baseUrl}/session`, this.directory))
    if (input?.search) u.searchParams.set("search", input.search)
    if (input?.limit !== undefined) u.searchParams.set("limit", String(input.limit))
    if (input?.roots !== undefined) u.searchParams.set("roots", String(input.roots))
    const res = await fetch(u.toString())
    return readJson(res)
  }

  async createSession(body: any): Promise<any> {
    const res = await fetch(withDirectory(`${this.baseUrl}/session`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
    return readJson(res)
  }

  async getSessionMessages(sessionID: string, limit?: number): Promise<any[]> {
    const u = new URL(withDirectory(`${this.baseUrl}/session/${encodeURIComponent(sessionID)}/message`, this.directory))
    if (limit !== undefined) u.searchParams.set("limit", String(limit))
    const res = await fetch(u.toString())
    return readJson(res)
  }

  async prompt(sessionID: string, body: any): Promise<any> {
    const res = await fetch(withDirectory(`${this.baseUrl}/session/${encodeURIComponent(sessionID)}/message`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return readJson(res)
  }

  async summarize(sessionID: string, body: { providerID: string; modelID: string; auto?: boolean }): Promise<boolean> {
    const res = await fetch(
      withDirectory(`${this.baseUrl}/session/${encodeURIComponent(sessionID)}/summarize`, this.directory),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    return readJson(res)
  }

  async listAgents(): Promise<any[]> {
    const res = await fetch(withDirectory(`${this.baseUrl}/agent`, this.directory))
    return readJson(res)
  }

  async listProviders(): Promise<any> {
    const res = await fetch(withDirectory(`${this.baseUrl}/provider`, this.directory))
    return readJson(res)
  }

  async replyPermission(requestID: string, reply: "once" | "always" | "reject", message?: string): Promise<boolean> {
    const res = await fetch(withDirectory(`${this.baseUrl}/permission/${encodeURIComponent(requestID)}/reply`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply, message }),
    })
    return readJson(res)
  }

  async *subscribeEvents(signal: AbortSignal): AsyncGenerator<OpencodeEvent, void, unknown> {
    const res = await fetch(withDirectory(`${this.baseUrl}/event`, this.directory), {
      headers: { Accept: "text/event-stream" },
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`订阅事件失败：HTTP ${res.status}: ${text || res.statusText}`)
    }
    if (!res.body) throw new Error("订阅事件失败：响应体为空")

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      for (;;) {
        const idx = buf.indexOf("\n\n")
        if (idx === -1) break
        const raw = buf.slice(0, idx)
        buf = buf.slice(idx + 2)

        const lines = raw.split("\n")
        const dataLines = lines
          .map((l) => l.trimEnd())
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice("data:".length).trimStart())
        if (dataLines.length === 0) continue

        const data = dataLines.join("\n")
        try {
          yield JSON.parse(data)
        } catch {
          // ignore malformed events
        }
      }
    }
  }
}
