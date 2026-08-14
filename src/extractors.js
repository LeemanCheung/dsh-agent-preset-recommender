import { emptyToolCounts } from './utils.js'

const EXACT_TOOL_CATEGORIES = new Map([
  ['task', 'delegation'],
  ['agent', 'delegation'],
  ['spawn_agent', 'delegation'],
  ['agent_spawn', 'delegation'],
  ['spawnagent', 'delegation'],
])
const CODEX_SESSION_TYPES = new Set(['session_meta', 'response_item', 'turn_context', 'event_msg', 'message', 'tool_call'])
const CLAUDE_SESSION_TYPES = new Set(['user', 'assistant', 'system', 'summary', 'progress', 'result', 'tool_use'])
const WORKBUDDY_SESSION_TYPES = new Set(['message', 'reasoning', 'function_call', 'function_call_result', 'tool_call', 'tool_use'])
const CATEGORY_PATTERNS = [
  ['delegation', /subagent|delegate|agent[_-]?(run|spawn|fork)|claude.?code|codex/i],
  ['workflow', /workflow|plan|todo|task(?:$|[_-]?(?:create|update|list|get|run|dag))/i],
  ['mcp', /(^|[_-])mcp([_-]|$)|context.?protocol/i],
  ['lsp', /(^|[_-])lsp([_-]|$)|language.?server|diagnostic|definition|references/i],
  ['web', /web|browser|fetch|http|search.?online/i],
  ['shell', /shell|bash|pwsh|powershell|terminal|command|exec/i],
  ['search', /grep|glob|search|find|ripgrep/i],
  ['files', /file|read|write|edit|patch|apply.?diff/i],
]

export function categorizeTool(name) {
  const value = typeof name === 'string' ? name.slice(0, 160) : ''
  const exact = EXACT_TOOL_CATEGORIES.get(value.toLowerCase())
  if (exact) return exact
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(value)) return category
  }
  return 'other'
}

function addTool(result, name) {
  if (typeof name !== 'string' || name.length === 0) return
  result.toolCounts[categorizeTool(name)] += 1
}

function selectedPath(record) {
  const candidates = [
    record?.cwd,
    record?.project_path,
    record?.projectPath,
    record?.workspace?.path,
    record?.payload?.cwd,
    record?.payload?.project_path,
  ]
  return candidates.find((value) => typeof value === 'string' && value.length > 0)
}

export function extractCodexRecord(record, result) {
  result.projectPath ||= selectedPath(record)
  if (CODEX_SESSION_TYPES.has(record?.type)) result.recognizedSession = true
  if (record?.type === 'session_meta') result.projectPath ||= selectedPath(record?.payload || {})
  const payload = record?.payload
  if (payload?.type === 'function_call' || payload?.type === 'custom_tool_call') {
    result.recognizedSession = true
    addTool(result, payload.name)
  }
  if (record?.type === 'tool_call') addTool(result, record.tool_name || record.name)
}

export function extractClaudeRecord(record, result) {
  result.projectPath ||= selectedPath(record)
  if (CLAUDE_SESSION_TYPES.has(record?.type)) result.recognizedSession = true
  if (record?.type === 'tool_use') addTool(result, record.name)
  const content = record?.message?.content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === 'tool_use') {
        result.recognizedSession = true
        addTool(result, item.name)
      }
    }
  }
  if (typeof record?.tool_name === 'string') {
    result.recognizedSession = true
    addTool(result, record.tool_name)
  }
}

export function extractWorkBuddyRecord(record, result) {
  result.projectPath ||= selectedPath(record)
  if (WORKBUDDY_SESSION_TYPES.has(record?.type)) result.recognizedSession = true
  if (record?.type === 'tool_call' || record?.type === 'tool_use' || record?.type === 'function_call') {
    addTool(result, record.name || record.tool_name)
  }
  if (typeof record?.tool === 'string') {
    result.recognizedSession = true
    addTool(result, record.tool)
  }
  if (Array.isArray(record?.tools)) {
    result.recognizedSession = true
    for (const item of record.tools) addTool(result, typeof item === 'string' ? item : item?.name)
  }
}

export function extractRecords(source, records, envelope) {
  const result = { projectPath: null, toolCounts: emptyToolCounts(), recordsSeen: 0, recognizedSession: false }
  const extractor = source === 'codex' ? extractCodexRecord : source === 'claude' ? extractClaudeRecord : extractWorkBuddyRecord
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) extractor(envelope, result)
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    result.recordsSeen += 1
    extractor(record, result)
  }
  return result
}
