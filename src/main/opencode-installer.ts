import path from "node:path"
import fs from "node:fs/promises"
import fssync from "node:fs"
import { spawn } from "node:child_process"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"

export type OpencodeInstallResult = {
  version: string
  exePath: string
}

type GithubRelease = {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

function isWindows() {
  return process.platform === "win32"
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": "cadence-opencode-installer",
    Accept: "application/vnd.github+json",
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`GitHub API ${res.status}: ${text || res.statusText}`)
  }
  return (await res.json()) as T
}

async function downloadFile(url: string, destPath: string) {
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "")
    throw new Error(`下载失败 ${res.status}: ${text || res.statusText}`)
  }

  const body = Readable.fromWeb(res.body as any)
  const out = fssync.createWriteStream(destPath)
  await pipeline(body, out)
}

async function expandZip(zipPath: string, outDir: string) {
  if (!isWindows()) throw new Error("当前仅支持 Windows 自动安装 opencode")

  await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(outDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const ps = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${outDir}" -Force`,
      ],
      { stdio: "ignore" },
    )
    ps.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Expand-Archive 失败（code=${code}）`))
    })
    ps.on("error", (e) => reject(e))
  })
}

async function findOpencodeExe(root: string): Promise<string | undefined> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(root, e.name)
    if (e.isFile() && e.name.toLowerCase() === "opencode.exe") return full
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const found = await findOpencodeExe(path.join(root, e.name)).catch(() => undefined)
    if (found) return found
  }
  return undefined
}

export async function ensureOpencodeInstalled(storageDir: string): Promise<OpencodeInstallResult> {
  const release = await fetchJson<GithubRelease>("https://api.github.com/repos/anomalyco/opencode/releases/latest")

  const asset = release.assets.find((a) => a.name === "opencode-windows-x64.zip")
  if (!asset) throw new Error("未找到 opencode-windows-x64.zip 发行包")

  const version = release.tag_name
  const installRoot = path.join(storageDir, "opencode", version)
  const exePath = path.join(installRoot, "opencode.exe")
  if (fssync.existsSync(exePath)) return { version, exePath }

  const zipPath = path.join(storageDir, "opencode", `${version}.zip`)
  const extractDir = path.join(storageDir, "opencode", `${version}-extract`)

  await downloadFile(asset.browser_download_url, zipPath)
  await expandZip(zipPath, extractDir)

  const foundExe = await findOpencodeExe(extractDir)
  if (!foundExe) throw new Error("解压完成但未找到 opencode.exe")

  await fs.mkdir(installRoot, { recursive: true })
  await fs.copyFile(foundExe, exePath)

  return { version, exePath }
}

