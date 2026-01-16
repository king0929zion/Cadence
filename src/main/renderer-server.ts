import http from "node:http"
import path from "node:path"
import fs from "node:fs/promises"

function contentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8"
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".svg":
      return "image/svg+xml"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".ico":
      return "image/x-icon"
    case ".map":
      return "application/json; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}

export async function createRendererServer(rendererRoot: string) {
  const root = path.resolve(rendererRoot)

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const pathname = decodeURIComponent(url.pathname)
      const rel = pathname === "/" ? "/index.html" : pathname

      const resolved = path.resolve(path.join(root, "." + rel))
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        res.writeHead(403)
        res.end("Forbidden")
        return
      }

      const read = async (filePath: string) => {
        const data = await fs.readFile(filePath)
        res.setHeader("Content-Type", contentType(filePath))
        res.setHeader("Cache-Control", "no-store")
        res.writeHead(200)
        res.end(data)
      }

      // 资源文件优先按路径命中；否则回退到 SPA 的 index.html
      await read(resolved).catch(async () => {
        await read(path.join(root, "index.html"))
      })
    } catch {
      res.writeHead(404)
      res.end("Not Found")
    }
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
