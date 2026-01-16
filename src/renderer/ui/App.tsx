import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

type ModelRef = { providerID: string; modelID: string }
type SessionInfo = { id: string; title: string; time?: { updated: number } }

type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  always: string[]
}

export function App() {
  const [ready, setReady] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  const [settings, setSettings] = createSignal<{
    directory: string
    model?: ModelRef
    agent?: string
    serverMode: "auto" | "attach"
    serverUrl: string
    uiMode: "cadence" | "opencode"
    autoLaunch: boolean
    hotkey: string
  }>({
    directory: "",
    serverMode: "auto",
    serverUrl: "http://127.0.0.1:4096",
    uiMode: "cadence",
    autoLaunch: false,
    hotkey: "Control+Alt+Space",
  })

  const [draftSettings, setDraftSettings] = createSignal(settings())
  const [showSettings, setShowSettings] = createSignal(false)

  const [sessions, setSessions] = createSignal<SessionInfo[]>([])
  const [query, setQuery] = createSignal("")
  const [activeSessionID, setActiveSessionID] = createSignal<string | undefined>()
  const [messages, setMessages] = createSignal<Array<{ info: any; parts: any[] }>>([])

  const [input, setInput] = createSignal("")
  const [agents, setAgents] = createSignal<any[]>([])
  const [providers, setProviders] = createSignal<any[]>([])
  const [permissionReq, setPermissionReq] = createSignal<PermissionRequest | undefined>()
  const [installing, setInstalling] = createSignal(false)

  const filteredSessions = createMemo(() => {
    const q = query().trim().toLowerCase()
    const list = sessions()
    if (!q) return list
    return list.filter((s) => (s.title ?? "").toLowerCase().includes(q))
  })

  async function refreshSessions() {
    const list = (await window.cadence.sessions.list()) as any[]
    setSessions(list as any)
  }

  async function loadSession(sessionID: string) {
    setActiveSessionID(sessionID)
    const list = await window.cadence.sessions.messages(sessionID, 200)
    setMessages(list)
  }

  async function createSession() {
    const created = await window.cadence.sessions.create("新对话")
    await refreshSessions()
    if (created?.id) await loadSession(created.id)
  }

  function ensureLocalAssistantMessage(messageID: string, sessionID: string) {
    setMessages((prev) => {
      if (prev.some((m) => m.info?.id === messageID)) return prev
      return [
        ...prev,
        {
          info: { id: messageID, sessionID, role: "assistant", time: { created: Date.now() } },
          parts: [],
        },
      ]
    })
  }

  function upsertPart(messageID: string, part: any, delta?: string) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.info?.id !== messageID) return m
        const idx = m.parts.findIndex((p: any) => p.id === part.id)
        if (idx === -1) return { ...m, parts: [...m.parts, part] }
        const nextParts = m.parts.slice()
        if (part.type === "text" && typeof delta === "string") {
          nextParts[idx] = { ...nextParts[idx], text: String(nextParts[idx].text ?? "") + delta }
        } else {
          nextParts[idx] = part
        }
        return { ...m, parts: nextParts }
      }),
    )
  }

  function appendLocalUserMessage(text: string) {
    const sessionID = activeSessionID()
    if (!sessionID) return
    const id = "local-user-" + Date.now()
    setMessages((prev) => [
      ...prev,
      {
        info: { id, sessionID, role: "user", time: { created: Date.now() } },
        parts: [{ id: "p-" + id, sessionID, messageID: id, type: "text", text }],
      },
    ])
  }

  async function exportActiveSession(toFilePath?: string) {
    const sid = activeSessionID()
    if (!sid) return

    const filePath =
      toFilePath?.trim() ||
      (await (async () => {
        const r = await window.cadence.dialog.save({
          title: "导出对话",
          defaultPath: "cadence-export.md",
          filters: [{ name: "Markdown", extensions: ["md"] }],
        })
        return r.canceled ? undefined : r.filePath
      })())

    if (!filePath) return
    await window.cadence.sessions.export(sid, filePath)
  }

  async function handleSlashCommand(text: string) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/)
    if (cmd === "new") {
      await createSession()
      return true
    }
    if (cmd === "clear") {
      setMessages([])
      return true
    }
    if (cmd === "help") {
      setMessages((prev) => [
        ...prev,
        {
          info: { id: "local-help-" + Date.now(), sessionID: activeSessionID(), role: "assistant" },
          parts: [
            {
              id: "p-help-" + Date.now(),
              sessionID: activeSessionID(),
              messageID: "local-help",
              type: "text",
              text: "快捷指令：\n/help\n/new\n/clear\n/compact\n/export [路径]\n",
            },
          ],
        },
      ])
      return true
    }
    if (cmd === "compact") {
      const sid = activeSessionID()
      if (sid) await window.cadence.sessions.summarize(sid)
      return true
    }
    if (cmd === "export") {
      await exportActiveSession(rest.join(" "))
      return true
    }
    return false
  }

  async function handleSend() {
    const text = input().trim()
    if (!text) return

    setInput("")

    if (text.startsWith("/")) {
      const handled = await handleSlashCommand(text)
      if (handled) return
    }

    let sid = activeSessionID()
    if (!sid) {
      await createSession()
      sid = activeSessionID()
    }
    if (!sid) return

    appendLocalUserMessage(text)
    await window.cadence.prompt({
      sessionID: sid,
      text,
      model: settings().model,
      agent: settings().agent,
    })
  }

  onMount(async () => {
    const offErr = window.cadence.onError((e) => setError(e.message))
    onCleanup(offErr)

    try {
      await window.cadence.ready()
      const s = await window.cadence.settings.get()
      setSettings(s)
      setDraftSettings(s)
      setReady(true)

      await refreshSessions()
      const list = sessions()
      if (list[0]?.id) await loadSession(list[0].id)
      else await createSession()

      setAgents(await window.cadence.agents.list())
      setProviders(await window.cadence.providers.list())

      const off = window.cadence.onEvent((event) => {
        if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
          refreshSessions()
        }

        if (event.type === "permission.asked") {
          setPermissionReq(event.properties as PermissionRequest)
        }

        if (event.type === "message.part.updated") {
          const part = event.properties.part
          const delta = event.properties.delta
          if (!part?.sessionID || !part?.messageID) return
          if (part.sessionID !== activeSessionID()) return
          ensureLocalAssistantMessage(part.messageID, part.sessionID)
          upsertPart(part.messageID, part, delta)
        }
      })
      onCleanup(off)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  })

  createEffect(() => {
    if (!showSettings()) return
    setDraftSettings(settings())
  })

  async function saveSettings() {
    const next = await window.cadence.settings.set(draftSettings())
    setSettings(next)
    setShowSettings(false)

    if (draftSettings().uiMode === "opencode") {
      void window.cadence.ui.openOpencode()
    }
  }

  async function respondPermission(response: "once" | "always" | "reject") {
    const req = permissionReq()
    if (!req) return
    setPermissionReq(undefined)
    await window.cadence.permission.respond({ sessionID: req.sessionID, permissionID: req.id, response })
  }

  const providerModels = createMemo(() => {
    const list = providers()
    const out: Array<{ value: string; label: string; ref: ModelRef }> = []
    for (const p of list) {
      const pid = p.id ?? p.providerID ?? p.name ?? "provider"
      const models = Array.isArray(p.models) ? p.models : []
      for (const m of models) {
        const mid = m.id ?? m.modelID ?? m.name
        if (!mid) continue
        out.push({
          value: `${pid}/${mid}`,
          label: `${pid}/${mid}`,
          ref: { providerID: String(pid), modelID: String(mid) },
        })
      }
    }
    return out
  })

  return (
    <div class="app">
      <div class="sidebar">
        <div class="brand">
          <div class="title">Cadence</div>
          <button class="btn" onClick={() => createSession()}>
            新建
          </button>
          <button class="btn ghost" onClick={() => setShowSettings(true)}>
            设置
          </button>
        </div>

        <input class="search" placeholder="搜索历史…" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />

        <div class="sessions">
          <For each={filteredSessions()}>
            {(s) => (
              <button class={"session" + (s.id === activeSessionID() ? " active" : "")} onClick={() => loadSession(s.id)}>
                <div class="sessionTitle">{s.title}</div>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="main">
        <div class="messages">
          <Show when={error()}>
            {(m) => <div class="banner error">{m()}</div>}
          </Show>
          <Show when={!ready()}>
            <div class="banner">正在启动 OpenCode 服务…</div>
          </Show>

          <For each={messages()}>
            {(m) => (
              <div class={"msg " + (m.info.role === "user" ? "user" : "assistant")}>
                <div class="bubble">
                  <For each={m.parts.filter((p: any) => p.type === "text")}>{(p) => <div class="text">{p.text}</div>}</For>
                  <For each={m.parts.filter((p: any) => p.type === "tool")}>
                    {(p) => (
                      <div class="tool">
                        <div class="toolHead">tool: {p.tool}</div>
                        <div class="toolBody">{p.state?.title || ""}</div>
                        <Show when={p.state?.output}>
                          <pre class="toolOut">{String(p.state.output)}</pre>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="composer">
          <textarea
            class="input"
            placeholder="输入消息…（支持 /help /new /clear /compact /export）"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
          />
          <button class="btn primary" onClick={() => handleSend()}>
            发送
          </button>
        </div>
      </div>

      <Show when={showSettings()}>
        <div class="modalBackdrop" onClick={() => setShowSettings(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="modalTitle">设置</div>

            <div class="row">
              <div class="label">工作目录</div>
              <input
                class="field"
                value={draftSettings().directory}
                onInput={(e) => setDraftSettings({ ...draftSettings(), directory: e.currentTarget.value })}
              />
            </div>

            <div class="row">
              <div class="label">界面</div>
              <select
                class="field"
                value={draftSettings().uiMode}
                onChange={(e) => setDraftSettings({ ...draftSettings(), uiMode: e.currentTarget.value as any })}
              >
                <option value="cadence">Cadence 极简界面</option>
                <option value="opencode">OpenCode 完整界面（新窗口）</option>
              </select>
            </div>

            <div class="row">
              <div class="label">服务端</div>
              <select
                class="field"
                value={draftSettings().serverMode}
                onChange={(e) => setDraftSettings({ ...draftSettings(), serverMode: e.currentTarget.value as any })}
              >
                <option value="auto">自动启动（同级 opencode）</option>
                <option value="attach">连接已有服务</option>
              </select>
            </div>

            <Show when={draftSettings().serverMode === "attach"}>
              <div class="row">
                <div class="label">服务地址</div>
                <input
                  class="field"
                  value={draftSettings().serverUrl}
                  onInput={(e) => setDraftSettings({ ...draftSettings(), serverUrl: e.currentTarget.value })}
                />
              </div>
              <div class="hint">
                例：`http://127.0.0.1:4096`（先在其它终端运行 `opencode serve --hostname 127.0.0.1 --port 4096`）
              </div>
            </Show>

            <div class="row">
              <div class="label">Agent</div>
              <select
                class="field"
                value={draftSettings().agent ?? ""}
                onChange={(e) => setDraftSettings({ ...draftSettings(), agent: e.currentTarget.value || undefined })}
              >
                <option value="">默认</option>
                <For each={agents()}>{(a) => <option value={a.name}>{a.name}</option>}</For>
              </select>
            </div>

            <div class="row">
              <div class="label">模型</div>
              <select
                class="field"
                value={draftSettings().model ? `${draftSettings().model!.providerID}/${draftSettings().model!.modelID}` : ""}
                onChange={(e) => {
                  const v = e.currentTarget.value
                  if (!v) return setDraftSettings({ ...draftSettings(), model: undefined })
                  const [providerID, modelID] = v.split("/")
                  setDraftSettings({ ...draftSettings(), model: { providerID, modelID } })
                }}
              >
                <option value="">默认</option>
                <For each={providerModels()}>{(m) => <option value={m.value}>{m.label}</option>}</For>
              </select>
            </div>

            <div class="row">
              <div class="label">开机自启</div>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={draftSettings().autoLaunch}
                  onChange={(e) => setDraftSettings({ ...draftSettings(), autoLaunch: e.currentTarget.checked })}
                />
                <span>启用</span>
              </label>
            </div>

            <div class="row">
              <div class="label">全局快捷键</div>
              <input
                class="field"
                value={draftSettings().hotkey}
                onInput={(e) => setDraftSettings({ ...draftSettings(), hotkey: e.currentTarget.value })}
              />
            </div>

            <div class="modalActions">
              <button
                class="btn"
                onClick={() => {
                  void window.cadence.ui.openOpencode()
                }}
              >
                打开 OpenCode 完整界面
              </button>
              <button
                class="btn"
                disabled={installing()}
                onClick={async () => {
                  try {
                    setInstalling(true)
                    const r = await window.cadence.opencode.install()
                    setError(`opencode 已安装：${r.version} (${r.exePath})`)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  } finally {
                    setInstalling(false)
                  }
                }}
              >
                {installing() ? "正在安装 opencode…" : "安装/更新 opencode（Windows）"}
              </button>
              <button class="btn ghost" onClick={() => setShowSettings(false)}>
                取消
              </button>
              <button class="btn primary" onClick={() => saveSettings()}>
                保存
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={permissionReq()}>
        {(req) => (
          <div class="modalBackdrop" onClick={() => respondPermission("reject")}>
            <div class="modal" onClick={(e) => e.stopPropagation()}>
              <div class="modalTitle">需要权限</div>
              <div class="hint">
                {req().permission}（{req().patterns.join(", ")}）
              </div>
              <div class="modalActions">
                <button class="btn" onClick={() => respondPermission("once")}>
                  仅本次允许
                </button>
                <button class="btn primary" onClick={() => respondPermission("always")}>
                  记住并允许
                </button>
                <button class="btn ghost" onClick={() => respondPermission("reject")}>
                  拒绝
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
