import { join } from 'node:path'

export const SOURCE_NAMES = Object.freeze(['codex', 'claude', 'workbuddy'])
export const TOOL_CATEGORIES = Object.freeze([
  'shell', 'files', 'search', 'web', 'mcp', 'lsp', 'delegation', 'workflow', 'other',
])

/** Resolve documented product roots, placing explicit environment overrides first. */
export function sourceDefaultRoots(environment = process.env) {
  const codexHome = environment.CODEX_HOME || '~/.codex'
  const claudeHome = environment.CLAUDE_CONFIG_DIR || '~/.claude'
  const codebuddyHome = environment.CODEBUDDY_CONFIG_DIR || '~/.codebuddy'
  const workbuddyHomes = environment.WORKBUDDY_CONFIG_DIR
    ? [environment.WORKBUDDY_CONFIG_DIR]
    : ['~/.workbuddy', '~/.workbuddy-ai', '~/WorkBuddy', '~/CodeBuddy']
  return {
    codexRoots: [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')],
    claudeRoots: [join(claudeHome, 'projects')],
    claudeTranscriptRoots: [],
    claudeWorkflowRoots: [join(claudeHome, 'workflows')],
    workbuddyRoots: [...new Set([codebuddyHome, ...workbuddyHomes])],
  }
}

export const PRIVACY_DECLARATION = Object.freeze({
  version: 1,
  summary: 'Stores aggregate metadata only; never stores prompts, responses, commands, tool arguments, raw events, absolute paths, usernames, secrets, or WorkBuddy/CodeBuddy file content.',
  persistedFields: [
    'source and keyed project identifiers',
    'categorized tool counts',
    'session, workflow, and metadata counts',
    'day-level observation dates and bounded recommendations',
  ],
  contentRetention: false,
  automaticMutation: false,
  llmUsed: false,
})

export const REPORT_VERSION = 1
export const REPORT_FILENAME = 'report.json'
export const IDENTITY_FILENAME = 'identity.key'
const roots = sourceDefaultRoots()
export const DEFAULTS = Object.freeze({
  scanOnStart: true,
  intervalMinutes: 360,
  maxFilesPerSource: 500,
  maxBytesPerFile: 1024 * 1024,
  recentDays: 90,
  stateDirectory: '',
  ...roots,
})
