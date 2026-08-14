import { emptyToolCounts } from './utils.js'

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
  if (record?.type === 'session_meta') result.projectPath ||= selectedPath(record?.payload || {})
  const payload = record?.payload
  if (payload?.type === 'function_call' || payload?.type === 'custom_tool_call') addTool(result, payload.name)
  if (record?.type === 'tool_call') addTool(result, record.tool_name || record.name)
}

export function extractClaudeRecord(record, result) {
  result.projectPath ||= selectedPath(record)
  if (record?.type === 'tool_use') addTool(result, record.name)
  const content = record?.message?.content
  if (Array.isArray(content)) {
    for (const item of content) if (item?.type === 'tool_use') addTool(result, item.name)
  }
  if (typeof record?.tool_name === 'string') addTool(result, record.tool_name)
}

export function extractWorkBuddyRecord(record, result) {
  result.projectPath ||= selectedPath(record)
  if (record?.type === 'tool_call' || record?.type === 'tool_use' || record?.type === 'function_call') {
    addTool(result, record.name || record.tool_name)
  }
  if (typeof record?.tool === 'string') addTool(result, record.tool)
  if (Array.isArray(record?.tools)) {
    for (const item of record.tools) addTool(result, typeof item === 'string' ? item : item?.name)
  }
}

export function extractRecords(source, records) {
  const result = { projectPath: null, toolCounts: emptyToolCounts(), recordsSeen: 0 }
  const extractor = source === 'codex' ? extractCodexRecord : source === 'claude' ? extractClaudeRecord : extractWorkBuddyRecord
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    result.recordsSeen += 1
    extractor(record, result)
  }
  return result
}
