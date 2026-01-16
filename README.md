# Cadence（Electron）

极简米白风格的 OpenCode AI 助手桌面客户端。

## 开发

```bash
cd cadence
bun install
bun run dev
```

默认会尝试从同级目录 `../opencode` 自动启动本地 `opencode serve`（找不到或启动失败会自动回退为“连接已有服务”）。

可通过环境变量指定 OpenCode 仓库路径：

```bash
set CADENCE_OPENCODE_ROOT=G:\Open-AutoGLM\Cadence\opencode
```

## 连接已有服务（推荐用于打包产物）

1) 先启动 OpenCode 服务（示例）：

```bash
cd ..\opencode\packages\opencode
bun run src/index.ts serve --hostname 127.0.0.1 --port 4096
```

2) Cadence 设置里将“服务端”切换为“连接已有服务”，填入 `http://127.0.0.1:4096`。

## Windows 安装包

当前默认输出 EXE（NSIS）：

```bash
cd cadence
bun run dist:win
```

MSI 需要额外的图标/配置，已预留脚本：

```bash
cd cadence
bun run dist:win:msi
```

## 监控 GitHub Actions

```bash
cd cadence
set CADENCE_REPO=king0929zion/Cadence
set GITHUB_TOKEN=你的token
bun run watch:gha
```

## 构建/打包（Windows）

```bash
cd cadence
bun run build
bun run dist:win
```

如果你在 Windows 上遇到 `Failed to replace old lockfile`，可先用：

```bash
bun install --no-save
```
