export const SOURCE_NAMES = Object.freeze(['codex', 'claude', 'workbuddy'])
export const TOOL_CATEGORIES = Object.freeze([
  'shell', 'files', 'search', 'web', 'mcp', 'lsp', 'delegation', 'workflow', 'other',
])

export const PRIVACY_DECLARATION = Object.freeze({
  version: 1,
  summary: 'Stores aggregate metadata only; never stores prompts, responses, commands, tool arguments, raw events, absolute paths, usernames, secrets, or WorkBuddy/CodeBuddy file content.',
  persistedFields: [
    'source and keyed project identifiers',
    'categorized tool counts',
    'session, workflow, and metadata counts',
    'timestamps and bounded recommendations',
  ],
  contentRetention: false,
  automaticMutation: false,
  llmUsed: false,
})

export const REPORT_VERSION = 1
export const REPORT_FILENAME = 'report.json'
export const IDENTITY_FILENAME = 'identity.key'
export const DEFAULTS = Object.freeze({
  scanOnStart: true,
  intervalMinutes: 360,
  maxFilesPerSource: 500,
  maxBytesPerFile: 1024 * 1024,
  recentDays: 90,
  stateDirectory: '',
  codexRoots: ['~/.codex/sessions', '~/.codex/archived_sessions'],
  claudeRoots: ['~/.claude/projects'],
  claudeTranscriptRoots: [],
  workbuddyRoots: ['~/WorkBuddy', '~/CodeBuddy', '~/.codebuddy'],
})
