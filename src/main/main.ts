import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, globalShortcut, nativeImage, dialog } from "electron"
import path from "node:path"
import fs from "node:fs"
import fsp from "node:fs/promises"
import { OpencodeServerManager } from "./opencode-server"
import { OpencodeHttpClient } from "./opencode-http"
import { createRendererServer } from "./renderer-server"

type ModelRef = { providerID: string; modelID: string }

type Settings = {
  directory: string
  model?: ModelRef
  agent?: string
  serverMode: "auto" | "attach"
  serverUrl: string
  uiMode: "cadence" | "opencode"
  autoLaunch: boolean
  hotkey: string
  permissionMemory: Record<string, string[]>
}

const DEFAULT_SETTINGS: Settings = {
  directory: process.cwd(),
  serverMode: "auto",
  serverUrl: "http://127.0.0.1:4096",
  uiMode: "cadence",
  autoLaunch: false,
  hotkey: "Control+Alt+Space",
  permissionMemory: {},
}

const userData = app.getPath("userData")
const settingsPath = path.join(userData, "cadence.settings.json")

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fsp.readFile(settingsPath, "utf8")
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed, permissionMemory: parsed.permissionMemory ?? {} }
  } catch {
    return DEFAULT_SETTINGS
  }
}

async function writeSettings(next: Settings) {
  await fsp.mkdir(userData, { recursive: true })
  await fsp.writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8")
}

function createTrayIcon() {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAO0lEQVR4AWP4z8Dwn4GBgYHh////h4GBgYHBgYGB4T8DAwMDA8N/GBgYGBgYAAApPwpb1mGkVQAAAABJRU5ErkJggg=="
  return nativeImage.createFromBuffer(Buffer.from(pngBase64, "base64"))
}

function resolveOpencodeRoot(): string {
  const fromEnv = process.env.CADENCE_OPENCODE_ROOT
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv

  const candidates = [
    path.resolve(process.cwd(), "..", "opencode"),
    path.resolve(app.getAppPath(), "..", "..", "opencode"),
    path.resolve(app.getAppPath(), "..", "opencode"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "packages", "opencode", "src", "index.ts"))) return c
  }
  throw new Error("未找到同级 opencode 目录，请设置 CADENCE_OPENCODE_ROOT")
}

let win: BrowserWindow | undefined
let tray: Tray | undefined
let settings: Settings

let client: OpencodeHttpClient | undefined
let server: OpencodeServerManager | undefined
let eventsAbort: AbortController | undefined
let rendererServer: Awaited<ReturnType<typeof createRendererServer>> | undefined

const pendingPermissions = new Map<string, { permission: string; always: string[] }>()
let opencodeSessionHooked = false
let opencodeDirectoryHeader = ""

function getClient(): OpencodeHttpClient {
  if (!client) throw new Error("OpenCode 服务未就绪")
  return client
}

async function ensureServerReady() {
  if (settings.serverMode === "attach") {
    const baseUrl = settings.serverUrl.replace(/\/+$/, "")
    if (!client) client = new OpencodeHttpClient(baseUrl, settings.directory)
    else client.setBaseUrl(baseUrl)
    client.setDirectory(settings.directory)
    return { baseUrl, opencodeCwd: "" }
  }

  try {
    if (!server) server = new OpencodeServerManager(resolveOpencodeRoot())
    const info = await server.start()
    if (!client) client = new OpencodeHttpClient(info.baseUrl, settings.directory)
    else client.setBaseUrl(info.baseUrl)
    client.setDirectory(settings.directory)
    return info
  } catch (e) {
    // 打包产物里通常不会带 opencode；自动模式失败时自动回退到 attach
    const baseUrl = settings.serverUrl.replace(/\/+$/, "")
    if (!client) client = new OpencodeHttpClient(baseUrl, settings.directory)
    else client.setBaseUrl(baseUrl)
    client.setDirectory(settings.directory)
    win?.webContents.send("cadence:error", {
      message:
        "自动启动 opencode 失败，已回退为“连接已有服务”。原因：" + (e instanceof Error ? e.message : String(e)),
    })
    return { baseUrl, opencodeCwd: "" }
  }
}

async function maybeAutoApprovePermission(req: any) {
  const memory = settings.permissionMemory[req.permission] ?? []
  const always = Array.isArray(req.always) ? req.always : []
  if (always.length === 0) return false
  const ok = always.every((p: string) => memory.includes(p))
  if (!ok) return false
  await getClient().replyPermission(req.id, "always")
  return true
}

async function restartEventStream() {
  eventsAbort?.abort()
  eventsAbort = new AbortController()
  const abortSignal = eventsAbort.signal

  ;(async () => {
    for await (const event of getClient().subscribeEvents(abortSignal)) {
      if (abortSignal.aborted) break

      if (event.type === "permission.asked") {
        pendingPermissions.set(event.properties.id, {
          permission: event.properties.permission,
          always: event.properties.always ?? [],
        })
        const auto = await maybeAutoApprovePermission(event.properties).catch(() => false)
        if (auto) continue
      }

      win?.webContents.send("cadence:event", event)

      if (event.type === "session.idle") {
        if (Notification.isSupported()) {
          const isFocused = win?.isFocused() ?? false
          if (!isFocused) new Notification({ title: "Cadence", body: "任务已完成" }).show()
        }
      }
    }
  })().catch((e) => {
    win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) })
  })
}

function findRendererRoot(): string {
  const candidates = [
    // dev/prod (when main.cjs lives in dist/)
    path.join(__dirname, "renderer"),
    // when __dirname is app root
    path.join(__dirname, "dist", "renderer"),
    // packaged: app.asar is app path
    path.join(app.getAppPath(), "dist", "renderer"),
    path.join(app.getAppPath(), "renderer"),
    // packaged: explicit app.asar in resources
    path.join(process.resourcesPath, "app.asar", "dist", "renderer"),
    path.join(process.resourcesPath, "app.asar", "renderer"),
  ]

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir
    } catch {
      // ignore
    }
  }

  throw new Error(
    [
      "未找到 renderer 产物（index.html）。",
      `__dirname=${__dirname}`,
      `app.getAppPath()=${app.getAppPath()}`,
      `process.resourcesPath=${process.resourcesPath}`,
      "已尝试：",
      ...candidates.map((c) => `- ${c}`),
    ].join("\n"),
  )
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: "#f5f1e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  })

  // 默认先加载 Cadence 壳（便于展示错误/设置）；随后可切到 OpenCode 完整 UI
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else {
    const rendererRoot = findRendererRoot()
    createRendererServer(rendererRoot)
      .then((srv) => {
        rendererServer = srv
        return win!.loadURL(srv.url)
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        // 兜底：显示错误页（比 Not Found/空白更可定位）
        const html = `<!doctype html><meta charset="utf-8"><title>Cadence 启动失败</title>
<body style="font-family:ui-sans-serif,system-ui; padding:16px; white-space:pre-wrap; background:#f5f1e8; color:#1f1f1f">
<h2>Cadence 渲染层加载失败</h2>
<p>请将以下内容发给开发者：</p>
<pre>${msg.replace(/</g, "&lt;")}</pre>
<p>你也可以设置环境变量 <code>CADENCE_DEBUG=1</code> 再启动以自动打开 DevTools。</p>
</body>`
        win?.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))

        // 兜底：即使 Cadence 壳失败，也尽量提供 OpenCode 完整 GUI
        openOpencodeUIInNewWindow().catch(() => {})
      })
  }

  win.on("close", (e) => {
    if (tray && !(app as any).isQuiting) {
      e.preventDefault()
      win?.hide()
    }
  })

  win.webContents.on("did-fail-load", (_event, code, desc, validatedURL) => {
    win?.webContents.send("cadence:error", { message: `页面加载失败(${code}): ${desc} (${validatedURL})` })
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    win?.webContents.send("cadence:error", { message: `渲染进程崩溃: ${details.reason}` })
  })
  if (process.env.CADENCE_DEBUG === "1") win.webContents.openDevTools({ mode: "detach" })
}

function ensureOpencodeHeaderHook(session: Electron.Session, baseUrl: string) {
  if (opencodeSessionHooked) return
  opencodeSessionHooked = true

  const origin = new URL(baseUrl).origin
  session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    if (opencodeDirectoryHeader) {
      details.requestHeaders["x-opencode-directory"] = opencodeDirectoryHeader
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

async function openOpencodeUIInNewWindow() {
  const info = await ensureServerReady()
  const baseUrl = info.baseUrl.replace(/\/+$/, "")

  const dir = settings.directory
  const isNonASCII = /[^\x00-\x7F]/.test(dir)
  opencodeDirectoryHeader = isNonASCII ? encodeURIComponent(dir) : dir

  const opWin = new BrowserWindow({
    width: 1200,
    height: 780,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 使用独立 partition，避免和 Cadence 设置页互相影响
      partition: "persist:opencode",
    },
  })

  ensureOpencodeHeaderHook(opWin.webContents.session, baseUrl)
  await opWin.loadURL(baseUrl + "/")
  opWin.show()
  opWin.focus()
}

function ensureTray() {
  if (tray) return
  tray = new Tray(createTrayIcon())
  const menu = Menu.buildFromTemplate([
    {
      label: "显示/隐藏",
      click: () => {
        if (!win) return
        if (win.isVisible()) win.hide()
        else {
          win.show()
          win.focus()
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        ;(app as any).isQuiting = true
        app.quit()
      },
    },
  ])
  tray.setToolTip("Cadence")
  tray.setContextMenu(menu)
  tray.on("double-click", () => {
    win?.show()
    win?.focus()
  })
}

function applyAutoLaunch(enabled: boolean) {
  if (process.platform !== "win32") return
  app.setLoginItemSettings({ openAtLogin: enabled })
}

function applyHotkey(hotkey: string) {
  globalShortcut.unregisterAll()
  if (!hotkey) return
  try {
    globalShortcut.register(hotkey, () => {
      if (!win) return
      if (win.isVisible()) win.hide()
      else {
        win.show()
        win.focus()
      }
    })
  } catch {
    // ignore invalid hotkey
  }
}

async function exportSessionMarkdown(sessionID: string, filePath: string) {
  const data = (await getClient().getSessionMessages(sessionID)) as Array<{ info: any; parts: any[] }>

  let out = `# Cadence 导出\n\n- Session: ${sessionID}\n- 时间: ${new Date().toLocaleString()}\n\n---\n\n`
  for (const msg of data) {
    const role = msg.info.role
    out += role === "user" ? "## 用户\n\n" : "## 助手\n\n"
    const text = msg.parts.filter((p) => p.type === "text").map((p) => p.text).join("")
    if (text.trim()) out += text.trim() + "\n\n"

    const tools = msg.parts.filter((p) => p.type === "tool")
    for (const t of tools) {
      out += `\n\`\`\`\ntool: ${t.tool}\n${t.state?.title ?? ""}\n\`\`\`\n`
      const o = t.state?.output
      if (typeof o === "string" && o.trim()) out += `\n\`\`\`\n${o.trim()}\n\`\`\`\n`
    }

    out += "\n---\n\n"
  }
  await fsp.writeFile(filePath, out, "utf8")
}

app.whenReady().then(async () => {
  app.setAppUserModelId("ai.opencode.cadence")

  settings = await readSettings()

  ensureTray()
  applyAutoLaunch(settings.autoLaunch)
  applyHotkey(settings.hotkey)

  createWindow()

  try {
    await ensureServerReady()
    await restartEventStream()
  } catch (e) {
    win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) })
  }

  if (settings.uiMode === "opencode") {
    openOpencodeUIInNewWindow().catch((e) => {
      win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) })
    })
  }

  ipcMain.handle("cadence:ready", async () => {
    const info = await ensureServerReady()
    await restartEventStream()
    return { ...info, directory: settings.directory }
  })

  ipcMain.handle("cadence:settings:get", async () => {
    const { permissionMemory: _pm, ...publicSettings } = settings
    return publicSettings
  })

  ipcMain.handle("cadence:settings:set", async (_e, partial: Partial<Settings>) => {
    const prevMode = settings.serverMode
    const prevUrl = settings.serverUrl
    settings = { ...settings, ...partial, permissionMemory: settings.permissionMemory }
    await writeSettings(settings)

    applyAutoLaunch(settings.autoLaunch)
    applyHotkey(settings.hotkey)

    try {
      const modeChanged = prevMode !== settings.serverMode
      const urlChanged = prevUrl !== settings.serverUrl
      if (modeChanged || urlChanged) {
        eventsAbort?.abort()
        if (prevMode === "auto" && settings.serverMode === "attach") {
          await server?.stop().catch(() => {})
          server = undefined
        }
      }

      await ensureServerReady()
      await restartEventStream()
    } catch (e) {
      win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) })
    }

    const { permissionMemory: _pm, ...publicSettings } = settings
    return publicSettings
  })

  ipcMain.handle("cadence:ui:open-opencode", async () => {
    await openOpencodeUIInNewWindow()
    return true
  })

  ipcMain.handle("cadence:sessions:list", async () => {
    return await getClient().listSessions({ limit: 200, roots: false })
  })

  ipcMain.handle("cadence:sessions:create", async (_e, title?: string) => {
    const permission = [
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "webfetch", pattern: "*", action: "ask" },
      { permission: "websearch", pattern: "*", action: "ask" },
      { permission: "question", pattern: "*", action: "allow" }
    ]
    return await getClient().createSession({ title: title || "新对话", permission })
  })

  ipcMain.handle("cadence:sessions:messages", async (_e, sessionID: string, limit?: number) => {
    return await getClient().getSessionMessages(sessionID, limit)
  })

  ipcMain.handle("cadence:agents:list", async () => {
    return await getClient().listAgents()
  })

  ipcMain.handle("cadence:providers:list", async () => {
    const raw = await getClient().listProviders()
    const all = Array.isArray(raw?.all) ? raw.all : []
    return all.map((p: any) => {
      const id = p.id ?? p.providerID ?? p.name
      const modelsObj = p.models ?? {}
      const models = Array.isArray(modelsObj) ? modelsObj : Object.values(modelsObj)
      return { id, models: models.map((m: any) => ({ id: m.id ?? m.modelID ?? m.name })).filter((m: any) => m.id) }
    })
  })

  ipcMain.handle(
    "cadence:prompt",
    async (_e, input: { sessionID: string; text: string; model?: ModelRef; agent?: string; variant?: string }) => {
      await getClient().prompt(input.sessionID, {
        model: input.model,
        agent: input.agent,
        variant: input.variant,
        parts: [{ type: "text", text: input.text }],
      })
      return true
    },
  )

  ipcMain.handle(
    "cadence:permission:respond",
    async (_e, input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
      if (input.response === "always") {
        const pending = pendingPermissions.get(input.permissionID)
        if (pending) {
          const existing = settings.permissionMemory[pending.permission] ?? []
          const next = Array.from(new Set([...existing, ...(pending.always ?? [])]))
          settings.permissionMemory[pending.permission] = next
          await writeSettings(settings)
        }
      }
      pendingPermissions.delete(input.permissionID)
      await getClient().replyPermission(input.permissionID, input.response)
      return true
    },
  )

  ipcMain.handle("cadence:session:summarize", async (_e, sessionID: string) => {
    const model = await (async (): Promise<ModelRef> => {
      if (settings.model) return settings.model
      const cfg = await getClient().getConfig().catch(() => undefined)
      const m = cfg?.model
      if (typeof m === "string" && m.includes("/")) {
        const [providerID, modelID] = m.split("/")
        if (providerID && modelID) return { providerID, modelID }
      }
      const providers = await getClient().listProviders().catch(() => undefined)
      const defaults = providers?.default
      const firstProviderID = defaults ? Object.keys(defaults)[0] : undefined
      const firstModelID = firstProviderID ? defaults[firstProviderID] : undefined
      if (firstProviderID && firstModelID) return { providerID: firstProviderID, modelID: firstModelID }
      throw new Error("无法解析用于 compact 的默认模型，请在设置里选择模型")
    })()

    return await getClient().summarize(sessionID, { providerID: model.providerID, modelID: model.modelID, auto: false })
  })

  ipcMain.handle("cadence:session:export", async (_e, input: { sessionID: string; filePath: string }) => {
    await exportSessionMarkdown(input.sessionID, input.filePath)
    return true
  })

  ipcMain.handle(
    "cadence:dialog:save",
    async (
      _e,
      input: { title: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> },
    ) => {
      const result = await dialog.showSaveDialog(win!, {
        title: input.title,
        defaultPath: input.defaultPath,
        filters: input.filters,
      })
      return { canceled: result.canceled, filePath: result.filePath }
    },
  )
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return
  app.quit()
})

app.on("before-quit", async () => {
  eventsAbort?.abort()
  await server?.stop()
  await rendererServer?.close().catch(() => {})
})
