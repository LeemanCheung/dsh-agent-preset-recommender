import { addToolCounts, emptyToolCounts } from './utils.js'

function summarize(projects) {
  const tools = emptyToolCounts()
  let sessions = 0
  let workflows = 0
  let metadata = 0
  const sources = new Set()
  for (const project of projects) {
    addToolCounts(tools, project.toolCounts)
    sessions += project.sessionCount
    workflows += project.workflowCount
    metadata += project.metadataCount || 0
    sources.add(project.source)
  }
  return { tools, sessions, workflows, metadata, sources: [...sources].sort() }
}

export function recommend(projects) {
  const evidence = summarize(projects)
  const toolTotal = Object.values(evidence.tools).reduce((a, b) => a + b, 0)
  const activeCategories = Object.values(evidence.tools).filter((count) => count > 0).length
  let preset = 'minimal'
  if (evidence.sessions >= 10 || toolTotal >= 30 || activeCategories >= 5) preset = 'standard'
  else if (evidence.sessions > 0 || evidence.workflows > 0 || evidence.metadata > 0 || toolTotal > 0) preset = 'code'

  const capabilities = []
  if (projects.some((project) => project.source === 'codex' && project.sessionCount > 0)) capabilities.push('Codex delegation')
  if (projects.some((project) => project.source === 'claude' && project.sessionCount > 0)) capabilities.push('Claude Code delegation')
  if (evidence.workflows > 0 || evidence.tools.workflow > 0) capabilities.push('workflows')
  if (evidence.tools.web > 0) capabilities.push('web')
  if (evidence.tools.mcp > 0) capabilities.push('MCP')
  if (evidence.tools.lsp > 0) capabilities.push('LSP')

  const observations = evidence.sessions + evidence.workflows + toolTotal
  const confidence = observations === 0 ? 0 : Math.min(0.95, Number((0.35 + Math.log10(observations + 1) * 0.2).toFixed(2)))
  return {
    preset,
    capabilities,
    confidence,
    evidence: {
      sessions: evidence.sessions,
      workflows: evidence.workflows,
      metadataFiles: evidence.metadata,
      categorizedToolCalls: toolTotal,
      activeToolCategories: activeCategories,
      sources: evidence.sources,
      toolCounts: evidence.tools,
    },
    advisoryOnly: true,
  }
}
