# dsh-agent-preset-recommender

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re) [![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![CI](https://github.com/LeemanCheung/dsh-agent-preset-recommender/actions/workflows/ci.yml/badge.svg)](https://github.com/LeemanCheung/dsh-agent-preset-recommender/actions/workflows/ci.yml)

[English](README.md) | 中文

一个持久化、Host 侧的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle：以隐私安全方式汇总本地 Codex、Claude Code、WorkBuddy/CodeBuddy 活动，并推荐 DSH 内置 Agent preset。它只提供建议：不调用 LLM、不安装能力、不修改 preset、不发起网络请求。

## 安装

```sh
dsh plugin --profile web add github:LeemanCheung/dsh-agent-preset-recommender
```

安装后重启所选 DSH profile。软件包通过 `dsh.bundle.patch` 挂载一个 Host 插件。

## 推荐内容

聚合行为会映射到：

- 内置 preset：`minimal`、`code`、`standard`；
- 可选能力：Codex 委派、Claude Code 委派、workflows、web、MCP、LSP。

每条建议都包含置信度与证据计数。规则完全确定且仅在本地运行，不会自动更改 DSH。

## 架构

```text
cordis.patch.yml → src/index.js（Cordis 生命周期 + 原始模型工具）
                    ├─ scanner.js（有界遍历与聚合）
                    ├─ extractors.js（仅选取 JSON/JSONL 元数据字段）
                    ├─ recommender.js（确定性规则）
                    ├─ store.js（原子写入私有报告）
                    └─ render.js（有界、可读的工具输出）
```

运行时代码为 Node.js 20+ 的纯 ESM JavaScript；除 Node 内置模块外，仅使用 `@deepseek-ai/schemastery` 验证配置。工具以原始 ToolDefinition 直接调用 `ctx.tools.register`，不依赖未发布的 DSH tools 运行时导入。

## 隐私

持久化内容仅包括：

- 数据源与本机密钥派生的项目 ID；
- 分类工具计数；
- session、workflow 与项目元数据数量；
- 首次/最后观测时间；
- 推荐、置信度与证据计数；
- 明确、机器可读的隐私声明。

插件**绝不持久化** prompt、response、命令、工具参数、原始事件、绝对路径、用户名、secret 或文件正文。项目 ID 使用随机、本机私有的 HMAC 密钥派生，因此缺少私钥时无法通过猜测路径匹配报告 ID。WorkBuddy/CodeBuddy 的 memory 元数据只根据文件存在与 mtime 计数；workflow/plan 文件同样绝不打开。不联网，也不执行扫描到的命令。

自动跳过缓存、依赖、构建产物、输出、coverage、虚拟环境与 `.git` 目录，且不跟随符号链接。

默认报告位置：

```text
$DSH_HOME/state/agent-preset-recommender/report.json
```

若未设置 `DSH_HOME`，则使用 `~/.dsh`。目录还会保存仅用于派生项目 ID 的私有随机 `identity.key`。报告通过同目录临时文件加原子 rename 写入；平台允许时采用限制性权限。

## 支持位置与格式

| 来源 | 默认位置 | 读取方式 |
| --- | --- | --- |
| Codex | `~/.codex/sessions`、`~/.codex/archived_sessions` | 有界 `.jsonl`/`.json`；只读 session/project 与工具名称字段 |
| Claude Code | `~/.claude/projects` | 有界 `.jsonl`/`.json`；只读 project 与 `tool_use` 名称字段 |
| Claude transcripts | 默认关闭 | 仅显式配置 `claudeTranscriptRoots` 后扫描 |
| WorkBuddy/CodeBuddy sessions | `~/WorkBuddy`、`~/CodeBuddy`、`~/.codebuddy` | 仅扫描项目 `.workbuddy/*` 或 `.codebuddy/*` session 目录下的有界 `.jsonl`/`.json` |
| WorkBuddy/CodeBuddy 项目元数据 | 配置根下 `.workbuddy` 或 `.codebuddy` 的 `memory`、`workflows`、`plans` | 仅计数与 mtime；不读正文；memory 不会成为 workflow 证据 |

不同产品版本的格式可能变化。未知字段会被忽略；畸形记录跳过，畸形文件计入错误但不会终止扫描。

## 配置

在 DSH patch 中配置 `agent-preset-recommender` 行：

```yaml
- id: agent-preset-recommender
  config:
    scanOnStart: true
    intervalMinutes: 360      # 0 关闭定时扫描
    maxFilesPerSource: 500
    maxBytesPerFile: 1048576
    recentDays: 90
    stateDirectory: ''        # 空值 = $DSH_HOME/state/agent-preset-recommender
    codexRoots:
      - ~/.codex/sessions
      - ~/.codex/archived_sessions
    claudeRoots:
      - ~/.claude/projects
    claudeTranscriptRoots: [] # 必须显式选择加入
    workbuddyRoots:
      - ~/WorkBuddy
      - ~/CodeBuddy
      - ~/.codebuddy
```

文件数、单文件字节数、最近天数与间隔均受验证和限制。不存在或不可访问的根目录会跳过。启动、定时及工具触发扫描共用串行队列，并在插件卸载时取消。

## 模型工具

### `scan_agent_projects`

执行并持久化一次新扫描；可以只刷新指定来源：

```json
{ "sources": ["codex", "claude"] }
```

未选择来源会保留上一版聚合结果。

### `get_agent_preset_recommendations`

不扫描，直接读取持久化报告：

```json
{}
```

也可按密钥派生的项目 ID 查询：

```json
{ "project_id": "codex-0123456789abcdef" }
```

两个工具都返回有界的可读文本字符串。

## 限制

- 元数据 schema 有意保持保守；未知工具事件可能少计。
- 私有状态目录存在时，同一来源/路径的密钥派生 ID 保持稳定；删除 `identity.key` 会主动生成一组新的 ID。
- 推荐反映本地使用频率，不代表任务质量或组织策略。
- 插件不会验证可选产品/能力是否已安装或已认证。
- JSONL 超出字节上限的后续数据、过大的 JSON 文件、过旧文件，以及超出每来源数量限制的较旧文件会主动忽略。

## 开发

```sh
npm install
npm test
```

测试使用 Node 内置 `node:test` 与临时合成 fixture，不读取本机产品数据。安全问题的私密报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
