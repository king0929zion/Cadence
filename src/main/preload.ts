import { contextBridge, ipcRenderer } from "electron"

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
}

contextBridge.exposeInMainWorld("cadence", {
  ready: () => ipcRenderer.invoke("cadence:ready"),
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke("cadence:settings:get"),
    set: (partial: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke("cadence:settings:set", partial),
  },
  sessions: {
    list: () => ipcRenderer.invoke("cadence:sessions:list"),
    create: (title?: string) => ipcRenderer.invoke("cadence:sessions:create", title),
    messages: (sessionID: string, limit?: number) => ipcRenderer.invoke("cadence:sessions:messages", sessionID, limit),
    summarize: (sessionID: string) => ipcRenderer.invoke("cadence:session:summarize", sessionID),
    export: (sessionID: string, filePath: string) =>
      ipcRenderer.invoke("cadence:session:export", { sessionID, filePath }),
  },
  agents: {
    list: () => ipcRenderer.invoke("cadence:agents:list"),
  },
  providers: {
    list: () => ipcRenderer.invoke("cadence:providers:list"),
  },
  prompt: (input: { sessionID: string; text: string; model?: ModelRef; agent?: string; variant?: string }) =>
    ipcRenderer.invoke("cadence:prompt", input),
  permission: {
    respond: (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) =>
      ipcRenderer.invoke("cadence:permission:respond", input),
  },
  dialog: {
    save: (input: { title: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
      ipcRenderer.invoke("cadence:dialog:save", input),
  },
  ui: {
    openOpencode: () => ipcRenderer.invoke("cadence:ui:open-opencode"),
  },
  onEvent: (cb: (event: any) => void) => {
    const handler = (_: any, event: any) => cb(event)
    ipcRenderer.on("cadence:event", handler)
    return () => ipcRenderer.off("cadence:event", handler)
  },
  onError: (cb: (err: { message: string }) => void) => {
    const handler = (_: any, err: any) => cb(err)
    ipcRenderer.on("cadence:error", handler)
    return () => ipcRenderer.off("cadence:error", handler)
  },
})
