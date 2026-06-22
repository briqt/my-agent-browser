# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

AI Agent 浏览器自动化 skill，基于 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)。

让你的 AI Agent 原生控制浏览器——导航页面、填写表单、点击按钮、抓取数据、运行 Lighthouse 审计——通过 MCP 工具调用。一键安装，零自定义运行时代码。

**[English](README.md)**

## 特性

- **原生 MCP 浏览器工具** — `navigate_page`、`take_snapshot`、`click`、`fill`、`evaluate_script` 等 20+ 工具
- **Chrome 生命周期管理** — 多 session 共享实例、引用计数、自动清理
- **内置 SKILL.md** — 教 Agent 正确的使用模式（重页面处理、错误恢复、多 tab 管理）
- **一键安装** — 支持 Claude Code、Codex、Cursor、Kiro 及任何 MCP Agent
- **崩溃恢复** — 先探测 CDP 端口确认 Chrome 状态，避免误报崩溃
- **跨平台** — macOS、Linux、Windows

## 安装

```bash
npx skills add briqt/my-agent-browser -g
npm install -g chrome-devtools-mcp@^1.3.0
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
- 配置修改在下次 Agent session 生效

## SKILL.md 教 Agent 什么

内置的 SKILL.md 提供工作流指导，帮助 Agent 避免常见问题：

- **重页面** — 文件快照防止 DOM 溢出崩溃
- **抓取模式** — URL 分页、懒加载触发、JS 提取
- **多 tab** — 打开/提取/关闭模式，tab 间 UID 隔离
- **错误恢复** — UID 过期、超时、Chrome 重启
- **登录流程** — 持久 profile、自动填充凭证、连接已有会话

## 更新

```bash
npx skills update my-agent-browser -g
npm install -g chrome-devtools-mcp@^1.3.0
```

## 社区

分享于 [LINUX DO](https://linux.do/)
