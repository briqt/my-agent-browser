# 一次调用执行多个浏览器动作：调研与建议

调研日期：2026-11-05。读取了官方文档、源码和测试，未运行竞品、未测量 token
或延迟收益。以下 main 分支证据已固定到 commit，不意味着对应能力都进入了稳定版。
初轮调研没有增加批处理工具；后续实施决策与验证记录见文末。

## 已有实现

| 实现 | 机制 | 对本项目的启发 |
|---|---|---|
| agent-browser | CLI `batch` / MCP `agent_browser_batch({commands: string[][], bail?, omitCommand?})`，顺序执行，默认继续，`bail: true` 首错停止。 | 最接近现有代理架构；复用已有工具即可。但浏览器依赖链更适合默认首错停止，结果默认不回显敏感参数。 |
| Playwright MCP v0.0.84 | `browser_run_code_unsafe({code})` 执行 `async (page) => {...}`，支持运行时 locator、输入、点击和读取。 | 能表达复杂链，但官方明确其为宿主任意代码执行，扩大了能力与维护范围。 |
| browser-use | 模型一次返回 action 数组，默认最多 5 个；`multi_act()` 在导航、URL/焦点变化、终止动作或错误时截断。 | 批量的是已知步骤；界面变化后回到观察。不能仅凭 URL 不变认定 DOM 不变。 |
| Stagehand 当前 main | `experimentalBatch(callback,input,{timeout})` 可使用 page、act、observe、extract。 | 客户端超时不证明服务器已停止；内部 AI 操作仍可能调用模型，外层一次调用不等于只推理一次。 |

一手资料：

- [agent-browser batch 文档](https://github.com/vercel-labs/agent-browser/blob/1f66e398d8ae31f2601fe142af0c84852b2fa896/docs/content/docs/commands.mdx#batch-execution)、[MCP 定义](https://github.com/vercel-labs/agent-browser/blob/1f66e398d8ae31f2601fe142af0c84852b2fa896/cli/src/mcp.rs#L1773)、[测试](https://github.com/vercel-labs/agent-browser/blob/1f66e398d8ae31f2601fe142af0c84852b2fa896/cli/tests/batch_cli.rs)。
- [Playwright MCP v0.0.84](https://github.com/microsoft/playwright-mcp/blob/v0.0.84/README.md#browser_run_code_unsafe)。
- [browser-use multi_act](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/agent/service.py#L2755)、[默认动作数](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/agent/views.py#L71)。
- [Stagehand 示例](https://github.com/browserbase/stagehand/blob/ce298c60bd7e617e38d67db8db7d34de9d37cd18/packages/sdk-ts/examples/batch.ts)、[类型与超时语义](https://github.com/browserbase/stagehand/blob/ce298c60bd7e617e38d67db8db7d34de9d37cd18/packages/sdk-ts/src/batch.ts)。

## 对当前项目的建议

先利用已有 `fill_form` 合并稳定表单操作。宿主支持工具编排时，可在一次宿主调用中
顺序执行多个现有 MCP 工具，减少外层推理往返；这依赖宿主，不能作为跨 Agent 的统一能力。

需要可移植接口时，建议在 wrapper 层提供声明式 `run_actions`，而不是开放宿主代码。
示意接口如下，尚未实现：

```json
{
  "pageId": 3,
  "actions": [
    {"tool": "fill_form", "arguments": {"elements": [{"uid": "observed-input", "value": "example"}]}},
    {"tool": "click", "arguments": {"uid": "observed-submit"}}
  ],
  "snapshot": "final"
}
```

初版只覆盖已观察页面、目标已知且不依赖中间新信息的步骤。填表如果触发重渲染，提交
按钮的旧 UID 也可能失效，应停止并重新观察。导航、切页、出现新界面后不继续使用旧 UID。
若要可靠跨越复杂页面变化，需要运行时 locator 重解析和断言，已接近新增自动化控制层。

现有 `McpSession` 只转发逐行 JSON-RPC；不能把请求数组直接传给上游了事。实现还需：

1. 注入工具定义，分配内部请求 ID，顺序派发并聚合结果，与普通请求协调并发。
2. 默认首错停止，返回每步索引与 `completed / failed / not_run / unknown`、停止原因及必要的最终快照。
3. 总超时、取消、子进程恢复都不触发动作重放。超时不证明动作未发生；当前项可能是 unknown，剩余项 not_run。批处理不是事务，不承诺回滚。
4. 默认不回显输入值；限制动作数、总时间与结果大小，禁止嵌套 batch。
5. 同步调整使用指南：已知稳定段可批量，遇到新决策点再观察。单独加工具而保留“一动作一快照”的绝对规则，很可能得不到收益。

现有 `evaluate_script` 在页面上下文运行；通过 DOM `.click()` 或直接写 value 不等同于
上游原生输入行为。上游 slim 是减少工具数量，不是一个可编程 Puppeteer 批处理器。

## 如何验证收益

比较稳定表单、点击后导航、异步校验重建 DOM、中途失败、MCP 重启和超时后动作已发生
这些场景。记录推理轮数、输入输出 token、总时延、成功率、状态未知比例和重复副作用。

合并 k 个确定步骤理论上可减少 k−1 次外层推理往返，但不减少必要的浏览器等待，且额外
快照、失败重试或内部模型调用可能抵消收益。下一步应先选一个本地稳定表单原型验证，再
决定是否承担跨页面、运行时 locator 或可编程执行器的复杂度。

## 后续实施：1.5.0

采用同页声明式串行方案，初版只允许 fill、fill_form、hover，click/press_key 只能最后。
没有引入宿主 JS、脚本执行器、跨页链、任意工具批量调用或新的模型依赖。每批检查实际
上游工具集合，先校验所有支持的参数形状；运行时元素状态仍交给上游检查。

补读上游 v1.12.0 源码后修正了三个判断：

- [TextSnapshot](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.12.0/src/TextSnapshot.ts#L82)
  用 loaderId/backendNodeId 复用未变节点的 UID，不能说每次快照都让所有旧 UID 失效。
- [input 工具](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.12.0/src/tools/input.ts)
  中 fill_form 遇到 dialog 可返回普通成功结果，但剩余字段未填；必须检查边界信号。
- [ToolHandler](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.12.0/src/ToolHandler.ts)
  默认会丢弃 structuredContent。真实浏览器测试重现了漏判，修复为启用批处理时强制
  `--experimentalStructuredContent=true`，信号缺失则停止继续派发。这个 flag 是当前
  实测版本的实验能力，因此对其它版本不自动启用 wrapper 批处理。

独立审阅还发现并修复了：进程退出抢在异步批处理部分结果之前；正常末尾导航被误判成
失败并跳过快照。最终区分成功导航与 dialog/部分填表，超时后保留当前调用的会话占用，
不认为客户端超时就代表浏览器动作已停止。

验证采用本地页面：稳定表单、后续参数无效时零执行、填表重建 DOM、部分填表弹窗、
末尾点击导航。稳定表单的 3 个动作和最终快照可在 1 个外层调用完成；这是调用数验证，
不是 token/延迟基准，不报告未测量的推理成本降幅。更多超时、取消、晚到响应、重启与
进程退出边界由确定性单元/进程测试覆盖。对外契约见
[batch-actions.md](../skills/my-agent-browser/references/batch-actions.md)。
