# dsh-agent-preset-recommender

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re) [![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![CI](https://github.com/LeemanCheung/dsh-agent-preset-recommender/actions/workflows/ci.yml/badge.svg)](https://github.com/LeemanCheung/dsh-agent-preset-recommender/actions/workflows/ci.yml)

English | [中文](README.zh.md)

A persistent, host-side [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that privately summarizes local Codex, Claude Code, and WorkBuddy/CodeBuddy activity and recommends a built-in DSH agent preset. It is advisory only: there is no LLM call, installation, preset mutation, or network request.

## Capability map

| Area | What the plugin does | Deliberate boundary |
| --- | --- | --- |
| Local inventory | Boundedly scans supported session, project, and workflow metadata from Codex, Claude Code, CodeBuddy, and WorkBuddy. | Skips caches, builds, `.git`, symlinks, inaccessible roots, and unknown content. |
| Privacy-preserving evidence | Aggregates tool, session, workflow, and day-level activity under installation-local HMAC project IDs. | Never persists prompts, replies, commands, arguments, raw events, paths, usernames, secrets, or file bodies. |
| Deterministic advice | Maps observed evidence to `minimal`/`standard` capability presets plus optional delegation, workflow, web, MCP, and LSP capabilities. | Does not infer the `code` presentation variant, judge task quality, or alter a preset. |
| Agent-facing access | Provides `scan_agent_projects` for a fresh bounded scan and `get_agent_preset_recommendations` for the saved report. | Both tools return bounded readable text; neither installs, enables, or authenticates anything. |
| Durable local operation | Atomically persists a private report, supports startup and scheduled scans, and serializes all scan triggers. | No LLM call, network request, discovered-command execution, or background work survives plugin disposal. |

## Install

```sh
dsh plugin --profile web add github:LeemanCheung/dsh-agent-preset-recommender
```

Restart the selected DSH profile after installation. The package declares `dsh.bundle.patch` and mounts one host plugin.

## What it recommends

Observed aggregate behavior is mapped to:

- capability presets: `minimal` or `standard`.

`code` is a Code Mode presentation variant of `standard`, so this scanner never infers it from local activity volume or silently recommends it as a capability tier.
- optional capabilities: Codex delegation, Claude Code delegation, workflows, web, MCP, and LSP.

Every recommendation includes confidence and numerical evidence. Thresholds are deterministic and local; results never automatically change DSH.

## Architecture

```text
cordis.patch.yml → src/index.js (Cordis lifecycle + raw model tools)
                    ├─ scanner.js (bounded traversal and aggregation)
                    ├─ extractors.js (selected JSON/JSONL metadata fields)
                    ├─ recommender.js (deterministic rules)
                    ├─ store.js (atomic private report file)
                    └─ render.js (bounded readable tool output)
```

Runtime code is plain ESM JavaScript for Node.js 20+. It uses Node built-ins plus `@deepseek-ai/schemastery` for plugin configuration validation. Tool definitions are registered directly through `ctx.tools.register` and do not import unpublished DSH tool runtime helpers.

## Privacy

The scanner persists aggregate metadata only:

- source and installation-keyed project identifier;
- categorized tool counts;
- session, workflow, and project-metadata counts;
- first/last observation dates (day-level);
- recommendation, confidence, and evidence counts;
- an explicit machine-readable privacy declaration.

It **never persists** prompts, responses, commands, tool arguments, raw events, absolute paths, usernames, secrets, or file contents. Project identifiers are derived with a random installation-local HMAC key, so report IDs cannot be dictionary-matched without the private key. WorkBuddy/CodeBuddy memory metadata is counted from file presence and modification time only; workflow/plan files are likewise never opened. The scanner makes no network requests and runs no discovered command.

Cache, dependency, build, output, coverage, virtual-environment, and `.git` directories are skipped. Symbolic links are not followed.

The default report is:

```text
$DSH_HOME/state/agent-preset-recommender/report.json
```

If `DSH_HOME` is unset, `~/.dsh` is used. The directory also holds a private random `identity.key` used only to derive project IDs. Report writes use a same-directory temporary file and atomic rename; restrictive permissions are requested where the platform supports them.

## Supported locations and formats

| Source | Defaults | Read behavior |
| --- | --- | --- |
| Codex | `$CODEX_HOME/sessions`, `$CODEX_HOME/archived_sessions` or `~/.codex/*` | Bounded `.jsonl`/`.json`; selected session/project and tool-name fields |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects` | Bounded `.jsonl`/`.json`; selected project and `tool_use` name fields; workflow sidecars, journals, task/session/plan stores, and global history are excluded |
| Claude personal workflows | `$CLAUDE_CONFIG_DIR/workflows` or `~/.claude/workflows` | `.js` file presence and day only; scripts are never opened. Add project-local `<repo>/.claude/workflows` explicitly to `claudeWorkflowRoots` if desired |
| Claude transcripts | Disabled | Scanned only when `claudeTranscriptRoots` is explicitly configured |
| CodeBuddy CLI | `$CODEBUDDY_CONFIG_DIR/projects` or `~/.codebuddy/projects` | Bounded canonical project `.jsonl` records; `~/.codebuddy/workflows/*.js` and project-local workflow scripts are inventoried by presence only. Process maps, tool-result/blob directories, and workflow runtime sidecars are excluded |
| WorkBuddy | `$WORKBUDDY_CONFIG_DIR/projects` or `~/.workbuddy/projects`, `~/.workbuddy-ai/projects` | Heuristic, version-sensitive project `.jsonl` inventory; native session layout is not vendor-contracted, so it is never treated as proof of CodeBuddy session equivalence |
| Project-local CodeBuddy/WorkBuddy metadata | `<project>/.codebuddy` or `<project>/.workbuddy` `memory`, `workflows`, `plans`, or `automations` | Count and day only, including workflow `.js`; content is not read; memory never becomes workflow evidence |

Formats vary between product releases. CodeBuddy paths/workflow scripts are documented; WorkBuddy session-file detection is an observed heuristic. Unknown fields are ignored, malformed records are skipped, and malformed files are counted as errors without stopping the scan.

## Configuration

Configure the inserted `agent-preset-recommender` row in a DSH patch:

```yaml
- id: agent-preset-recommender
  config:
    scanOnStart: true
    intervalMinutes: 360      # 0 disables scheduled scans
    maxFilesPerSource: 500
    maxBytesPerFile: 1048576
    recentDays: 90
    stateDirectory: ''        # empty = $DSH_HOME/state/agent-preset-recommender
    codexRoots:
      - ~/.codex/sessions
      - ~/.codex/archived_sessions
    claudeRoots:
      - ~/.claude/projects
    claudeTranscriptRoots: [] # opt in explicitly
    claudeWorkflowRoots:
      - ~/.claude/workflows   # inventory only; script content is never read
    workbuddyRoots:
      - ~/.codebuddy
      - ~/.workbuddy
      - ~/.workbuddy-ai
      - ~/WorkBuddy
      - ~/CodeBuddy
```

Defaults honor `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `CODEBUDDY_CONFIG_DIR`, and `WORKBUDDY_CONFIG_DIR` when DSH starts. Supplying an explicit root list in the plugin configuration takes precedence over those defaults.

Bounds are validated: file counts, file bytes, recency, and interval are finite. Missing/inaccessible roots are skipped. Startup, scheduled, and tool-triggered scans share one serialized queue and are aborted on plugin disposal.

## Model tools

### `scan_agent_projects`

Runs and persists a fresh scan. Optionally refresh only selected sources:

```json
{ "sources": ["codex", "claude"] }
```

Unselected source aggregates from the previous report remain intact.

### `get_agent_preset_recommendations`

Reads the persisted report without scanning:

```json
{}
```

Or retrieve one keyed project:

```json
{ "project_id": "codex-0123456789abcdef" }
```

Both tools return bounded readable text strings.

## Limitations

- Metadata schemas are intentionally conservative; unrecognized tool events may be undercounted.
- Keyed IDs are stable only while the private state directory remains available; deleting `identity.key` intentionally creates a new identifier set.
- A recommendation reflects observed local frequency, not task quality or organizational policy.
- The plugin does not verify that optional products or capabilities are installed or authenticated.
- JSONL files above the byte cap are prefix-sampled within the byte/record bounds; their remaining data, oversized JSON files, old files, and older files beyond a source limit are intentionally omitted. Compressed Codex `.jsonl.zst` rollouts are not read in 0.1.6. Claude workflow scripts and dynamic workflow sidecars are deliberately not parsed.

## Development

```sh
npm install
npm test
```

Tests use synthetic temporary fixtures and Node's built-in `node:test`; no local product data is read. See [SECURITY.md](SECURITY.md) for private vulnerability reporting guidance.

## License

[MIT](LICENSE)
