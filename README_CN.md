# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

面向 AI Agent 的隐身、受管 Chrome DevTools **独立 CLI + Skill**（内置绑定实测 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) **1.13.0**）。

**[English](README.md)**

## 为什么 v2.0 去掉 MCP 全面转向 CLI

- **零上下文污染**：MCP 模式下 33+ 个浏览器工具的 JSON Schema 在每轮对话起步就白占 1.5万～3万+ tokens。CLI + Skill 模式平时仅约 100 tokens，真正用浏览器时才按需加载指导。
- **零客户端配置**：不再需要给 Claude Code、Codex、Cursor、Antigravity 等逐个配 JSON/TOML；修改 `config.json` 后执行 `my-agent-browser restart` 即可热生效，无需重启当前 Agent 对话。
- **与会话进程解耦 + Unix 组合能力**：支持 `eval --raw | jq`、重页面快照落盘配合 `grep`/`tail` 局部读取，多个并发 Agent 可安全共享同一个已登录的 Chrome 实例。

## 相比直接裸用官方 CLI 多了什么

### 1. 实测级反爬隐身 + 免下载系统浏览器自适应
- 自动发现本机已安装的 Chrome / Edge / Brave / Chromium / Arc，**脱离 Puppeteer 直接干净启动**（天然不带 `--enable-automation`，`navigator.webdriver === false`，无需额外下载几百 MB 的 Chrome for Testing）。
- 自动改写内联 `eval`（`evaluate_script`）调用栈，抹除 `pptr:` 标记与通常包含系统用户名的安装路径——经站点侧 getter 陷阱实测验证，详见 [anti-detection.md](skills/my-agent-browser/references/anti-detection.md)。
- 默认启动参数全部经单因素指纹实测（保留真 GPU WebGL 与原生滚动条宽度，剔除弄巧成拙的伪反爬参数）。

### 2. 多 Agent `owner` 协同保护 + 可配置空闲自动关闭
- **标签页 `owner` 归属锁**（`--owner <name>` 或环境变量 `MY_AGENT_BROWSER_OWNER`）：支持按归属锁定标签页；任何 Agent 都可通过 `pages` 和 `status`（`canStopSafely`）主动查看还有谁在用浏览器、能不能安全关闭；未加 `--force` 时自动拦截跨 Agent 误改他人标签页或强关共享浏览器。
- **空闲自动回收**（`browser.idleTimeout`）：默认 `"30m"` 无操作自动关闭受管 Chrome 与后台守护进程；也支持设为 `"never"`（或 `0`）**永不自动关闭**。直连外部浏览器（`browserUrl`）模式下绝不关闭用户的外部浏览器。
- **故障自愈**：通过 CDP `/json/version` 端口探测确认崩溃后自动拉起 Chrome、清理残留 `SingletonLock`、子进程状态过期热替换且**绝不静默重放副作用动作**。

### 3. 顺手的高频短命令 + 100% 保留原生 DevTools 上限
- 高频操作极简统一：`open`、`pages`、`goto`、`snap`、`shot`、`click`、`fill`、`fill-form`、`wait-for`、`eval --raw`、`batch`。
- 补齐上游官方 CLI 缺失与痛点：补回官方 CLI 漏掉的 `fill-form` 与 `wait-for`、统一 `eval <pageId> <fn>` 参数顺序、支持 `logpoints <pageId> --clear` 清空断点日志、`shot` 自动存盘绝不向终端倾倒数 MB base64。
- **原生上限零折损**：全部 33+ 个 `chrome-devtools-mcp` 原生工具（`lighthouse_audit`、`set_logpoints`、`performance_start_trace`、`take_heapsnapshot`、`mock_network`、`configure_webauthn`、`emulate` 等）均可直接 `my-agent-browser <tool>` 调用，随时 `my-agent-browser <tool> --help` 查看实时 Schema。

## 安装（两条命令，自动包含上游依赖）

无需再单独安装 `chrome-devtools-mcp`，CLI 包已自动锁定并内聚管理 `1.13.0`：

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

首次使用可初始化配置文件并做离线体检：

```bash
my-agent-browser config init
my-agent-browser doctor --json
```

### 从 v1.x（MCP 版）升级说明

1. 执行上方两条安装/更新命令。
2. 用你所在 Agent 自身的 MCP 配置管理方式，移除旧的 `browser` MCP 服务项（指向 `start-mcp.js` 的配置）。
   - *防崩兜底：在移除前，`skills/my-agent-browser/scripts/start-mcp.js` 已替换为极轻量的兼容提示桩（仅暴露单个 `my_agent_browser_mcp_deprecated` 提示工具），不会让已配 MCP 的 Agent 报错崩溃，并会引导卸载旧 MCP。*
3. 原有的 `~/.config/agent-skills/my-agent-browser/config.json` 与 `user-data/` 登录态完全兼容保留；若以前为 v1 全局装过 `chrome-devtools-mcp`，可按需执行 `npm uninstall -g chrome-devtools-mcp`。

## 快速上手

```bash
my-agent-browser open "https://example.com" --owner agent-1
my-agent-browser pages
my-agent-browser snap 1
my-agent-browser eval 1 "() => document.title" --raw
my-agent-browser shot 1 /tmp/example.png
my-agent-browser status
my-agent-browser close-page 1 --owner agent-1
```

## 核心配置项

编辑 `~/.config/agent-skills/my-agent-browser/config.json`（改完执行 `my-agent-browser restart` 即刻生效）：

```json
{
  "browser": {
    "headless": true,
    "idleTimeout": "30m",
    "proxy": "",
    "viewport": "1280x720"
  },
  "mcp": {
    "backgroundNewPages": false,
    "batchActions": true,
    "flags": []
  },
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  }
}
```

- **空闲关闭控制**：`browser.idleTimeout` 默认 `"30m"`（支持 `ms`/`s`/`m`/`h` 单位）；设为 `"never"` 或 `0` 则**永不自动关闭**。也可启动时传 `my-agent-browser start --idle-timeout never`。
- **后台新建标签页**：`mcp.backgroundNewPages` 设为 `true` 时，未显式指定前后台的 `open` 默认后台打开（`--foreground` / `--background` 显式参数始终优先）。
- **开启高阶工具组**：在 `mcp.flags` 中加入 `"--categoryNetworkMocks"`（页级网络 Mock）或 `"--memoryDebugging"`（13 个堆快照深度分析工具）。

详见 [配置说明](skills/my-agent-browser/references/setup.md)、[多标签与多 Agent 协同](skills/my-agent-browser/references/multi-tab-workflow.md)、[有界批处理](skills/my-agent-browser/references/batch-actions.md) 与 [更新机制](skills/my-agent-browser/references/update-checks.md)。

## 更新

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

## 社区

分享于 [LINUX DO](https://linux.do/t/topic/2451355)
