# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

面向 AI Agent 的隐身、受管 Chrome DevTools **独立 CLI + Skill**（内置绑定实测 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) **1.13.0**）。

**[English](README.md)**

## 为什么选择 CLI 而不是 MCP

- **零上下文污染**：MCP 模式在每轮对话起步就白占 1.5万～3万+ tokens。CLI + Skill 模式平时仅约 100 tokens，需要操作浏览器时才按需加载指导。
- **零客户端配置**：无需为 Claude Code、Codex、Cursor、Antigravity 等逐个配 JSON/TOML；修改 `config.json` 后执行 `my-agent-browser restart` 即刻生效。
- **天然 Unix 组合能力**：`ID=$(my-agent-browser open <url> --raw)`、`&&` 串行多步、`eval --raw | jq`、重页面快照落盘配合 `grep`/`tail` 局部读取。

## 相比直接裸用官方 CLI 多了什么

### 1. 实测级反爬隐身 + 免下载系统浏览器
- 自动发现本机 Chrome / Edge / Brave / Chromium / Arc，**脱离 Puppeteer 直接干净启动**（天然不带 `--enable-automation`，`navigator.webdriver === false`，无需额外下载几百 MB Chrome for Testing）。
- 自动改写内联 `eval` 调用栈，抹除 `pptr:` 标记与本地路径 —— 详见 [anti-detection.md](skills/my-agent-browser/references/anti-detection.md)。
- 默认启动参数经单因素指纹实测，保留真 GPU WebGL 与原生滚动条宽度。

### 2. 多 Agent `owner` 协同保护 + 按需启停
- **标签页 `owner` 归属锁**（`--owner <name>` 或 `MY_AGENT_BROWSER_OWNER`）：支持按归属锁定标签页；通过 `pages` / `status`（`canStopSafely`）查看活跃占用者，防止跨 Agent 误改他人标签页或强关共享浏览器。
- **新建标签页一律后台打开**：`open` 始终在后台打开，不抢占桌面窗口焦点。
- **按需启动 + 空闲自动回收**（`browser.idleTimeout`）：不用不启，默认空闲 `"30m"` 自动关闭受管 Chrome 与守护进程（设为 `"never"` 或 `0` 可永不自动关闭）。直连外部浏览器（`browserUrl`，同时支持 `http://` 与 `ws://`）模式下绝不关闭外部浏览器。
- **故障自愈**：崩溃探测重拉 Chrome、清理残留 `SingletonLock`、引擎状态过期热替换且绝不静默重放副作用动作。

### 3. 顺手的高频短命令 + 50 个原生 DevTools 工具开箱即用
- 高频操作极简统一：`open --raw`、`pages`、`goto`、`snap`、`shot --raw`、`click`、`click-at`、`fill`、`fill-form`、`wait-for`、`eval --raw`、`console`、`network`、`logpoints`。
- 补齐官方 CLI 缺口：补回 `fill-form` 与 `wait-for`、统一 `<pageId>` 参数顺序、`shot` 自动存盘不倾倒 base64、离线 `<tool> --help` 秒查参数。
- **50 个原生工具零配置全开**：在 CLI 零上下文开销下，默认直接开放 `mock_network`、`remove_network_mock`、`configure_webauthn`、`click_at`、`lighthouse_audit`、`set_logpoints`、`performance_start_trace`、`emulate`、`screencast_start` 以及 `take_heapsnapshot` + 全部 13 个离线堆快照深度分析工具。

## 安装

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

首次使用可初始化配置并离线体检：

```bash
my-agent-browser config init
my-agent-browser doctor --json
```

### 从 v1.x（MCP 版）升级

1. 执行上方两条安装命令。
2. 在你的 Agent MCP 设置中移除旧的 `start-mcp.js` 服务项（移除前兼容提示桩会防止启动报错）。
3. 原有 `~/.config/agent-skills/my-agent-browser/config.json` 与 `user-data/` 继续兼容（旧的 `mcp.*` 与 `browser.lazyStart` 字段会自动安全忽略）。

## 快速上手

```bash
ID=$(my-agent-browser open "https://example.com" --owner agent-1 --raw)
my-agent-browser pages
my-agent-browser snap "$ID"
my-agent-browser eval "$ID" "() => document.title" --raw
my-agent-browser shot "$ID" /tmp/example.png
my-agent-browser status
my-agent-browser close-page "$ID" --owner agent-1
```

## 核心配置项

编辑 `~/.config/agent-skills/my-agent-browser/config.json`（用 `my-agent-browser config show` 查看生效配置，改完执行 `my-agent-browser restart` 生效）：

```json
{
  "browser": {
    "headless": true,
    "idleTimeout": "30m",
    "proxy": "",
    "viewport": "1280x720",
    "browserUrl": ""
  },
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  },
  "disable_update_check": false
}
```

详见 [配置说明](skills/my-agent-browser/references/setup.md)、[多标签与多 Agent 协同](skills/my-agent-browser/references/multi-tab-workflow.md) 与 [高阶 DevTools 工具](skills/my-agent-browser/references/advanced-tools.md)。

## 更新

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

## 社区

[学 AI，上 Linux DO](https://linux.do/)
