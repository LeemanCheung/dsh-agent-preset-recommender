# dsh-agent-preset-recommender

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re) [![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![CI](https://github.com/LeemanCheung/dsh-agent-preset-recommender/actions/workflows/ci.yml/badge.svg)](https://github.com/LeemanCheung/dsh-agent-preset-recommender/actions/workflows/ci.yml)

[English](README.md) | 中文

一个持久化、Host 侧的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle：以隐私安全方式汇总本地 Codex、Claude Code、WorkBuddy/CodeBuddy 活动，并推荐 DSH 内置 Agent preset。它只提供建议：不调用 LLM、不安装能力、不修改 preset、不发起网络请求。

## 功能总览

| 领域 | 插件实际能力 | 有意的边界 |
| --- | --- | --- |
| 本地清点 | 有界扫描 Codex、Claude Code、CodeBuddy 与 WorkBuddy 支持的会话、项目和工作流元数据。 | 跳过缓存、构建产物、`.git`、符号链接、不可访问根目录和未知正文。 |
| 隐私安全证据 | 用本机 HMAC 派生的项目 ID 聚合工具、会话、工作流和天级活动。 | 绝不持久化 prompt、回复、命令、参数、原始事件、路径、用户名、secret 或文件正文。 |
| 确定性建议 | 将观察证据映射为 `minimal`/`standard` 能力 preset，以及可选的委派、workflow、web、MCP 与 LSP 能力。 | 不推断 `code` 展示变体、不评价任务质量，也不改写 preset。 |
| Agent 可调用入口 | `scan_agent_projects` 执行一次新的有界扫描；`get_agent_preset_recommendations` 读取已保存报告。 | 两个工具只返回有界文本；不会安装、启用或认证任何能力。 |
| 持久化本地运行 | 原子保存私有报告，支持启动和定时扫描，并将所有扫描触发串行化。 | 不调用 LLM、不联网、不执行发现到的命令；插件卸载后不保留后台任务。 |

## 安装

```sh
dsh plugin --profile web add github:LeemanCheung/dsh-agent-preset-recommender
```

安装后重启所选 DSH profile。软件包通过 `dsh.bundle.patch` 挂载一个 Host 插件。

## 推荐内容

聚合行为会映射到：

- 能力 preset：`minimal` 或 `standard`。

`code` 是 `standard` 的 Code Mode 展示变体；扫描器不会根据本地活动量推断它，也不会把它作为能力等级自动推荐。
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
- 首次/最后观测日期（精度为天）；
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
| Codex | `$CODEX_HOME/sessions`、`$CODEX_HOME/archived_sessions`，或 `~/.codex/*` | 有界 `.jsonl`/`.json`；只读 session/project 与工具名称字段 |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` 或 `~/.claude/projects` | 有界 `.jsonl`/`.json`；只读 project 与 `tool_use` 名称字段；排除 workflow sidecar、journal、task/session/plan 存储与全局 history |
| Claude 个人工作流 | `$CLAUDE_CONFIG_DIR/workflows` 或 `~/.claude/workflows` | 仅记录 `.js` 文件存在与日期，绝不打开脚本；如需项目内 `<repo>/.claude/workflows`，显式加入 `claudeWorkflowRoots` |
| Claude transcripts | 默认关闭 | 仅显式配置 `claudeTranscriptRoots` 后扫描 |
| CodeBuddy CLI | `$CODEBUDDY_CONFIG_DIR/projects` 或 `~/.codebuddy/projects` | 读取有界、规范项目 `.jsonl` 记录；`~/.codebuddy/workflows/*.js` 与项目内 workflow 脚本仅清点存在。跳过全局进程映射、tool-result/blob 目录与 workflow runtime sidecar |
| WorkBuddy | `$WORKBUDDY_CONFIG_DIR/projects` 或 `~/.workbuddy/projects`、`~/.workbuddy-ai/projects` | 启发式、版本敏感的项目 `.jsonl` 清单；原生 session 布局不是厂商契约，绝不据此推断与 CodeBuddy session 等价 |
| 项目内 CodeBuddy/WorkBuddy 元数据 | `<project>/.codebuddy` 或 `<project>/.workbuddy` 的 `memory`、`workflows`、`plans`、`automations` | 只计数与日期（含 workflow `.js`）；不读正文；memory 不会成为 workflow 证据 |

不同产品版本的格式可能变化。CodeBuddy 路径/workflow 脚本有官方文档，WorkBuddy session 文件识别仅为观测性启发式。未知字段会被忽略；畸形记录跳过，畸形文件计入错误但不会终止扫描。

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
    claudeWorkflowRoots:
      - ~/.claude/workflows   # 只做清单，绝不读取脚本正文
    workbuddyRoots:
      - ~/.codebuddy
      - ~/.workbuddy
      - ~/.workbuddy-ai
      - ~/WorkBuddy
      - ~/CodeBuddy
```

DSH 启动时默认会读取 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`CODEBUDDY_CONFIG_DIR`、`WORKBUDDY_CONFIG_DIR`。在插件配置中显式设置根目录列表会优先于这些默认值。

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
- 超过字节上限的 JSONL 会在字节/记录边界内以前缀方式采样；其余后续数据、过大的 JSON 文件、过旧文件，以及超出每来源数量限制的较旧文件会主动忽略。0.1.6 不读取压缩的 Codex `.jsonl.zst` rollout；Claude workflow 脚本与动态 workflow sidecar 也会有意跳过。

## 开发

```sh
npm install
npm test
```

测试使用 Node 内置 `node:test` 与临时合成 fixture，不读取本机产品数据。安全问题的私密报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
