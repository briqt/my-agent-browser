# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) 的生产级包装。chrome-devtools-mcp 提供了浏览器 MCP 工具，但 Chrome 进程管理、多 session 共享、故障恢复全部留给用户自己处理。本项目补上这些运维层，让 AI Agent 真正可靠地使用浏览器。

**[English](README.md)**

## 相对于直接用 chrome-devtools-mcp，本项目多了什么

### Chrome 生命周期管理

- 自动查找 Chrome（macOS/Linux/Windows 各搜索 10+ 路径，含 Edge/Brave/Arc/Chromium）
- Lazy start — Chrome 在第一次 `tools/call` 时才启动，不在 Agent 启动时浪费资源
- 多 Agent session 共享同一 Chrome 实例，通过 `browser.lock` 引用计数
- 最后一个 session 退出时自动关闭 Chrome
- Agent 崩溃后不留孤儿：父进程心跳检测 + 启动时清理残留进程
- WSL/无头 Linux 自动检测并配置 DISPLAY（WSLg、Wayland、X11）

### 故障自愈

- Chrome 崩溃检测通过 CDP 端口探测——不盲信错误文本
- 确认崩溃后自动重启 Chrome，重写 MCP 响应告知 Agent 重新导航
- MCP 进程状态过期（如引用了已关闭的 tab）时，只重启 MCP 子进程，Chrome 保持
- Profile 锁残留（强杀后 SingletonLock）自动清理，不阻塞下次启动

### 配置驱动 + 反爬支持

- headless 模式、proxy 代理、viewport 尺寸、自定义启动参数——所有 Chrome 启动参数均可配置
- `evaluate_script` 的调用栈自动去除 `pptr:` 标记和 MCP 安装路径（该路径通常含系统用户名）——用站点自有脚本设陷阱实测验证，见 [anti-detection.md](skills/my-agent-browser/references/anti-detection.md)
- 启动参数推荐基于单因素实测，而非以讹传讹
- 直连已有 Chrome 实例（`browserUrl` 模式，适合已登录的长期会话）
- 可选后台新建 tab：`mcp.backgroundNewPages` 默认 `false`，尊重每次调用的显式参数

### Agent 使用指导（SKILL.md）

- 重页面：文件快照避免 DOM 溢出崩溃
- 错误恢复：UID 过期、超时、Chrome 重启后的正确应对
- 多 tab 管理：打开/提取/关闭模式，tab 间 UID 隔离
- 抓取模式：URL 分页、懒加载触发、JS 提取
- 登录流程：持久 profile、自动填充、连接已有会话

## 安装

```bash
npx skills add briqt/my-agent-browser -g -y
npm install -g chrome-devtools-mcp@1.11.0
mkdir -p ~/.config/agent-skills/my-agent-browser
cp ~/.agents/skills/my-agent-browser/config.example.json ~/.config/agent-skills/my-agent-browser/config.json
```

然后在你的 Agent 中注册 MCP 服务器：

### Claude Code

```bash
claude mcp add browser -s user -- node ~/.agents/skills/my-agent-browser/scripts/start-mcp.js
```

或在项目 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]
    }
  }
}
```

### Codex

```bash
codex mcp add browser -- node ~/.agents/skills/my-agent-browser/scripts/start-mcp.js
```

或在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.browser]
command = "node"
args = ["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]
enabled = true
```

### 其他 MCP Agent（Cursor、Kiro 等）

按你的 Agent 文档添加 MCP 服务器配置：
- Command: `node`
- Args: `["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]`

## 工作原理

```
Agent (Claude Code / Codex / Cursor / Kiro / etc.)
  ↓ MCP tool calls（原生工具调用）
start-mcp.js
  ↓ 读取配置，通过 browser.lock 管理 Chrome 生命周期
  ↓ 启动 Chrome（detached）并设置 --remote-debugging-port
  ↓ 启动 chrome-devtools-mcp 并通过 --browserUrl 连接
chrome-devtools-mcp
  ↓ 通过 CDP 协议控制 Chrome
Chrome（多 session 共享实例）
```

- Chrome 作为独立进程运行，多个 MCP session 共享同一实例
- `browser.lock` 跟踪活跃客户端数量；最后一个退出时自动关闭 Chrome
- 所有浏览器配置在 `~/.config/agent-skills/my-agent-browser/config.json`
- 配置修改后须重启 MCP session

## 后台新建 tab（v1.3.0）

MCP 依赖仍为 **chrome-devtools-mcp 1.11.0**。
`~/.config/agent-skills/my-agent-browser/config.json` 中的默认配置：

```json
{ "mcp": { "backgroundNewPages": false } }
```

需要启用时改为：

```json
{ "mcp": { "backgroundNewPages": true } }
```

将该字段合并到已有配置，随后重启 MCP session。
`mcp.backgroundNewPages` 是 wrapper 的布尔配置，不是上游 CLI flag，不要放入
`mcp.flags`。缺省或 `false` 完全保留上游 `new_page` 行为；仅严格为布尔 `true`
且调用未提供 `background` 时，才补入 `background: true`。调用显式传入的
`background: true` 或 `false` 始终优先。lazy、eager 和 direct（`browserUrl`）
模式共用此行为，不受 stealth 开关影响。

这不是全局焦点保证：不保证 Chrome 首次 GUI 启动、网站 `window.open` 弹窗或
`select_page { pageId, bringToFront: true }` 的焦点行为。`select_page` 只有在
`bringToFront: true` 时才主动置前；逻辑选中不等于 OS 前台。页面工具直接传入
`pageId` 即可，无需先 `select_page`。详见[配置说明](skills/my-agent-browser/references/setup.md)
和[多 tab 工作流](skills/my-agent-browser/references/multi-tab-workflow.md)。

## SKILL.md 教 Agent 什么

内置的 SKILL.md 提供工作流指导，帮助 Agent 避免常见问题：

- **重页面** — 文件快照防止 DOM 溢出崩溃
- **抓取模式** — URL 分页、懒加载触发、JS 提取
- **多 tab** — 打开/提取/关闭模式，tab 间 UID 隔离
- **错误恢复** — UID 过期、超时、Chrome 重启
- **登录流程** — 持久 profile、自动填充凭证、连接已有会话

## 更新

```bash
npx skills update my-agent-browser -g -y
npm install -g chrome-devtools-mcp@1.11.0
```

从 v1.0.x 升级时，把配置迁移到 v1.1 的参数推荐（先看 diff，再 `--apply`）：

```bash
node ~/.claude/skills/my-agent-browser/scripts/migrate-config.js
node ~/.claude/skills/my-agent-browser/scripts/migrate-config.js --apply
```

脚本会先备份配置，移除三个实测得不偿失的 flag，并开启调用栈隐藏。改完需重启 agent 会话。

## 社区

分享于 [LINUX DO](https://linux.do/t/topic/2451355)
