# dsh-mcp-bridge

![dsh-mcp-bridge](https://raw.githubusercontent.com/Edge-Echo/dsh-mcp-bridge/main/banner.svg)

> Part of the **dsh-toolkit family**: [dsh-mcp-bridge](https://github.com/Edge-Echo/dsh-mcp-bridge) · [dsh-win-toolkit](https://github.com/Edge-Echo/dsh-win-toolkit) · [dsh-netassist](https://github.com/Edge-Echo/dsh-netassist) · [dsh-driftwatch](https://github.com/Edge-Echo/dsh-driftwatch)

[![npm version](https://img.shields.io/npm/v/dsh-mcp-bridge?color=4d6bfe&logo=npm)](https://www.npmjs.com/package/dsh-mcp-bridge)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mcp-bridge?color=22d3ee)](https://www.npmjs.com/package/dsh-mcp-bridge)
[![license](https://img.shields.io/npm/l/dsh-mcp-bridge?color=4d6bfe)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Edge-Echo/dsh-mcp-bridge?color=22d3ee)](https://github.com/Edge-Echo/dsh-mcp-bridge)

**面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的精选、验证过的 MCP 全家桶插件。**

一条命令装上经过实战检验的 MCP server 集合——而不是让你自己去琢磨一份 YAML。每个精选 server 在 `servers/` 里有机器可读定义，`scripts/verify-servers.mjs` 会逐个检查连通性，所以「已验证」是 CI 保证的事实，不是宣传话术。

模型看到的工具名为 `mcp__<serverName>__<toolName>`（与 Claude Code / Codex 的服务器限定命名一致）。桥接层是 DSH 内置的 [`@deepseek-ai/dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness)：支持 stdio / streamable-http、自动重连、HMR 热替换。

> English docs: [README.md](README.md).

## 交互式安装器

```sh
npx dsh-mcp-bridge init          # 交互式选择服务器
npx dsh-mcp-bridge list          # 查看目录 + 验证状态
npx dsh-mcp-bridge validate      # 列出 profile 里已配置的 MCP 条目
```

`init` 会把真正的 `insert:` 条目写进 profile 的**用户 patch 层**
（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）——所以你选的服务器能跨插件升级保留，
并和你自己的 patch 共存。需要环境变量或占位路径的服务器会给出警告。

## 快速开始

前置条件：`dsh` 与 `pnpm` 在 PATH 上（`dsh plugin` 内部转发 pnpm；未装可 `npm i -g pnpm`）。

```sh
dsh plugin --profile web add dsh-mcp-bridge
# 本地开发：  dsh plugin --profile web add ./dsh-mcp-bridge
dsh web        # 重启 profile
```

默认启用 MCP 官方 `everything` 演示 server（无 API key，纯本地 npx）。重启后让模型「调用 everything 服务器的 echo 工具，传 hello」，它应该会用 `mcp__everything__echo`。

> 首次运行会通过 `npx` 下载 server 包，之后有缓存。

## 精选目录

| Server | 能干什么 | 需要的配置 | 验证状态 |
|---|---|---|---|
| `everything` | 演示工具：echo、add、长任务、小图片 | 无（默认开启） | ✅ 13 个工具 |
| `memory` | 会话内知识图谱（实体/关系） | 无 | ✅ 9 个工具 |
| `filesystem` | 文件读写/搜索，**仅限显式授权的根目录** | 改 root 目录（args） | ✅ 14 个工具（给定真实目录时） |
| `github` | 仓库 / issue / PR | `GITHUB_TOKEN` | ⏸ 需配置 |
| `playwright` | 浏览器自动化（导航/点击/截图） | 首次需下载浏览器 | ⏸ 较重，CI 跳过 |
| `remote-http` | 自建 / 托管的 HTTP MCP server | URL（可选 token） | ⏸ 需配置 |

启用某个注释预设：在 profile 的 `cordis.patch.yml` 里取消对应注释块（HMR 热替换，无需重启），或直接改本包的 `cordis.patch.yml`。

## 自己验证目录

```sh
npm install          # 会带入 @deepseek-ai/dsh-mcp-client → MCP SDK
npm run verify       # 或：node scripts/verify-servers.mjs
```

逐个打印 `PASS` / `SKIP` / `FAIL`，有失败时退出码非 0。`VERIFY_TIMEOUT_MS=15000` 可调单 server 超时。单 server 排障：`node scripts/probe-server.mjs npx -y your-mcp-server`。

## 添加自己的 MCP server

每个 server 就是一条 `@deepseek-ai/dsh-mcp-client` 条目。推荐加到 profile 的用户 patch 层（HMR 即时生效）：

```yaml
# $DSH_HOME/profiles/<name>/cordis.patch.yml
- id: mcp-myserver
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: myserver          # 命名空间，进程内唯一（[A-Za-z0-9_-]{1,32}）
    transport: stdio              # 或 streamable-http
    command: npx
    args: ['-y', 'your-mcp-server']
    env:
      YOUR_TOKEN: !!js process.env.YOUR_TOKEN
```

或者：把定义放进 `servers/`（这样 `verify` 会覆盖它），并在本包 `cordis.patch.yml` 里加对应条目。

### 配置字段速查（来自 dsh-mcp-client）

| 字段 | 传输 | 必填 | 说明 |
|---|---|---|---|
| `transport` | 两者 | 是 | `"stdio"` 或 `"streamable-http"` |
| `serverName` | 两者 | 是 | 工具命名空间，存活实例内唯一 |
| `command` / `args` / `env` / `cwd` | stdio | command 必填 | 子进程规范 |
| `url` / `headers` | http | url 必填 | 端点 + 认证头 |
| `toolCallTimeoutMs` | 两者 | 否 | 单次调用超时，默认 60000 |
| `failOnStartupError` | 两者 | 否 | 连接失败时拒绝激活（默认 `false`） |
| `reconnect.*` | 两者 | 否 | 自动重连退避（默认开启） |

## 与 Reasonix / CodeWhale 联动

三者都是 agent harness——**MCP 就是共同语言**。你给 Reasonix / CodeWhale 配的任何 server 都能加到这里；自建的 `streamable-http` server 可以让 DSH、Reasonix、CodeWhale 共用一个进程。见 `servers/remote-http.json`。

## 排错（Windows）

- **headless 验证挂起**（`dsh --profile <name> "任务"`）：profile 需要在 `dsh.profile.bundles` 里手动加 `@deepseek-ai/dsh-headless`（`dsh plugin add @deepseek-ai/dsh-headless` 会因其未发布依赖 404 失败）。缺它时树能激活但没有 agent 消费任务。
- **Windows 下 `npx` 正常可用**：MCP SDK 使用 `cross-spawn`，能解析 `.cmd` shim，不需要 `npx.exe`。
- **server 连上了但没有工具**：看 profile 日志；`failOnStartupError: false` 时失败条目会静默激活但不注册工具。

## 发布（npm）

1. `npm version patch`（或手动改 `package.json`），提交，打 tag `vX.Y.Z`。
2. `git push origin main --tags`。
3. GitHub Actions（`publish.yml`）自动发布到 npm——需要 npm **trusted publisher**（OIDC）关联仓库。设置：npm → Access Tokens → Generate new token → *Publish with GitHub Actions*。

给仓库打上 GitHub topic **`dsh-plugin`**，这样会出现在社区列表里（[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)、[WhaleHub](https://github.com/vvlife/whalehub-dsh)）。

## License

MIT — 见 [LICENSE](LICENSE)。
