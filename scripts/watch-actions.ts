type Run = {
  id: number
  name: string
  status: "queued" | "in_progress" | "completed"
  conclusion: string | null
  html_url: string
  run_number: number
  created_at: string
  updated_at: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function pickArg(name: string) {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

const repo = pickArg("repo") || process.env.CADENCE_REPO || "king0929zion/Cadence"
const intervalMs = Number(pickArg("interval") || process.env.CADENCE_GHA_INTERVAL_MS || "10000")
const branch = pickArg("branch") || process.env.CADENCE_GHA_BRANCH

const token = process.env.GITHUB_TOKEN
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "cadence-gha-watch",
}
if (token) headers.Authorization = `Bearer ${token}`

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`GitHub API ${res.status}: ${text || res.statusText}`)
  }
  return (await res.json()) as T
}

async function latestRun(): Promise<Run | undefined> {
  const u = new URL(`https://api.github.com/repos/${repo}/actions/runs`)
  u.searchParams.set("per_page", "1")
  if (branch) u.searchParams.set("branch", branch)
  const data = await fetchJson<{ workflow_runs: Run[] }>(u.toString())
  return data.workflow_runs?.[0]
}

console.log(`Watching GitHub Actions: ${repo}${branch ? ` (branch=${branch})` : ""}`)
console.log(`Poll interval: ${intervalMs}ms`)

let last: { id: number; status: string; conclusion: string | null; updated_at: string } | undefined

for (;;) {
  try {
    const run = await latestRun()
    if (!run) {
      console.log("No workflow runs found yet.")
      await sleep(intervalMs)
      continue
    }

    const cur = { id: run.id, status: run.status, conclusion: run.conclusion, updated_at: run.updated_at }
    const changed =
      !last ||
      last.id !== cur.id ||
      last.status !== cur.status ||
      last.conclusion !== cur.conclusion ||
      last.updated_at !== cur.updated_at

    if (changed) {
      console.log(
        `[${new Date().toLocaleTimeString()}] #${run.run_number} ${run.name} status=${run.status} conclusion=${run.conclusion ?? "null"}`,
      )
      console.log(run.html_url)
      last = cur
    }

    if (run.status === "completed") {
      process.exit(run.conclusion === "success" ? 0 : 1)
    }
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] ${e instanceof Error ? e.message : String(e)}`)
  }

  await sleep(intervalMs)
}

