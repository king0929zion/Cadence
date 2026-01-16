/// <reference types="vite/client" />

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

declare global {
  interface Window {
    cadence: {
      ready(): Promise<{ baseUrl: string; opencodeCwd: string; directory: string }>
      settings: {
        get(): Promise<Settings>
        set(partial: Partial<Settings>): Promise<Settings>
      }
      sessions: {
        list(): Promise<any[]>
        create(title?: string): Promise<any>
        messages(sessionID: string, limit?: number): Promise<Array<{ info: any; parts: any[] }>>
        summarize(sessionID: string): Promise<boolean>
        export(sessionID: string, filePath: string): Promise<boolean>
      }
      agents: { list(): Promise<any[]> }
      providers: { list(): Promise<any[]> }
      prompt(input: { sessionID: string; text: string; model?: ModelRef; agent?: string; variant?: string }): Promise<boolean>
      permission: {
        respond(input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }): Promise<boolean>
      }
      dialog: {
        save(input: {
          title: string
          defaultPath?: string
          filters?: Array<{ name: string; extensions: string[] }>
        }): Promise<{ canceled: boolean; filePath?: string }>
      }
      ui: {
        openOpencode(): Promise<boolean>
      }
      onEvent(cb: (event: any) => void): () => void
      onError(cb: (err: { message: string }) => void): () => void
    }
  }
}

export {}
