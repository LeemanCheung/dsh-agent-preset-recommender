const MAX_OUTPUT_CHARS = 12_000

function bounded(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  return `${text.slice(0, MAX_OUTPUT_CHARS - 80)}\n… output truncated; query one project id for detail.`
}

function renderRecommendation(recommendation) {
  const caps = recommendation.capabilities.length ? recommendation.capabilities.join(', ') : 'none'
  return `Preset: ${recommendation.preset} | confidence: ${recommendation.confidence} | optional: ${caps}`
}

export function renderReport(report, projectId) {
  if (!report || !Array.isArray(report.projects) || !Array.isArray(report.sources)
    || !report.recommendation || !report.privacy) {
    return 'No persisted report is available. Run scan_agent_projects first.'
  }
  if (projectId) {
    const project = report.projects.find((entry) => entry.id === projectId)
    if (!project) return 'No project found for that identifier.'
    return bounded([
      `Agent preset recommendation for ${project.id}`,
      `Source: ${project.source}`,
      `Sessions: ${project.sessionCount}; workflows: ${project.workflowCount}; metadata files: ${project.metadataCount || 0}`,
      `Tool counts: ${JSON.stringify(project.toolCounts)}`,
      renderRecommendation(project.recommendation),
      `Observed: ${project.firstObservedAt || 'unknown'} — ${project.lastObservedAt || 'unknown'}`,
      'Privacy: aggregate metadata only; no content, commands, arguments, paths, usernames, or secrets are stored.',
    ].join('\n'))
  }

  const sourceLines = report.sources.map((source) => `${source.name}: ${source.sessionCount} sessions, ${source.workflowCount} workflows, ${source.metadataCount || 0} metadata files, ${source.projectCount} projects`)
  const projectLines = report.projects.slice(0, 50).map((project) => `- ${project.id} (${project.source}): ${renderRecommendation(project.recommendation)}`)
  return bounded([
    `Agent preset recommender report (${report.generatedAt})`,
    renderRecommendation(report.recommendation),
    ...sourceLines,
    ...projectLines,
    report.projects.length > 50 ? `… ${report.projects.length - 50} additional projects omitted.` : '',
    'Advisory only: no LLM call, install, configuration change, or preset mutation is performed.',
    `Privacy: ${report.privacy.summary}`,
  ].filter(Boolean).join('\n'))
}
