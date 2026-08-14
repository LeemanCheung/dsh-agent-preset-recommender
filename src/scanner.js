import { open, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { PRIVACY_DECLARATION, REPORT_VERSION, SOURCE_NAMES } from './constants.js'
import { extractRecords } from './extractors.js'
import { recommend } from './recommender.js'
import { addToolCounts, emptyToolCounts, expandHome, iso, pathIdentityKey, projectId, throwIfAborted } from './utils.js'

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', '.cache', 'cache', 'caches', '.plugins', 'plugins',
  'output', 'out', 'dist', 'build', 'coverage', '.venv', 'venv',
  'tool-results', 'blobs', 'file-history',
])
const WORKBUDDY_MEMORY_AREAS = new Set(['memory'])
const WORKBUDDY_WORKFLOW_AREAS = new Set(['workflows', 'plans', 'automations'])
const WORKBUDDY_SESSION_AREAS = new Set(['sessions', 'history', 'tasks'])
const WORKBUDDY_METADATA_EXTENSIONS = new Set(['.md', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.js'])
const RECORD_EXTENSIONS = new Set(['.json', '.jsonl'])
const SENSITIVE_WORKFLOW_RUNTIME_AREAS = new Set(['workflows', 'workflow', 'journal', 'journals', 'results', 'runtime'])
const CLAUDE_EXCLUDED_DIRECTORIES = new Set([
  'workflows', 'tool-results', 'file-history', 'tasks', 'sessions', 'plans', 'teams', 'blobs',
])

function rootsFor(source, config) {
  if (source === 'codex') return config.codexRoots
  if (source === 'claude') return [
    ...(config.claudeRoots || []),
    ...(config.claudeTranscriptRoots || []),
    ...(config.claudeWorkflowRoots || []),
  ]
  return config.workbuddyRoots
}

function recordsFromJson(value) {
  if (Array.isArray(value)) return { records: value.slice(0, 10_000), envelope: null }
  if (!value || typeof value !== 'object') return { records: [], envelope: null }
  for (const key of ['events', 'messages', 'records', 'entries']) {
    if (Array.isArray(value[key])) return { records: value[key].slice(0, 10_000), envelope: value }
  }
  return { records: [value], envelope: null }
}

async function readBounded(path, maxBytes, signal) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    let offset = 0
    while (offset < buffer.length) {
      throwIfAborted(signal)
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buffer.toString('utf8', 0, offset)
  } finally {
    await handle.close()
  }
}

function parseRecords(text, extension, truncated) {
  if (extension !== '.jsonl') {
    const parsed = recordsFromJson(JSON.parse(text))
    return { ...parsed, malformed: false }
  }

  const records = []
  let malformed = false
  const lines = text.split(/\r?\n/, 10_001)
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      const expectedTrailingFragment = truncated && index === lines.length - 1 && !text.endsWith('\n')
      if (!expectedTrailingFragment) malformed = true
    }
    if (records.length >= 10_000) break
  }
  return { records, envelope: null, malformed }
}

function makeProject(source, path, observedAt, identityKey) {
  return {
    id: projectId(source, path, identityKey),
    source,
    sessionCount: 0,
    workflowCount: 0,
    metadataCount: 0,
    toolCounts: emptyToolCounts(),
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
  }
}

function updateObserved(project, observedAt) {
  if (!project.firstObservedAt || observedAt < project.firstObservedAt) project.firstObservedAt = observedAt
  if (!project.lastObservedAt || observedAt > project.lastObservedAt) project.lastObservedAt = observedAt
}

function normalizedPath(value) {
  return String(value).replaceAll('\\', '/')
}

function workbuddyLocation(filePath) {
  const normalized = normalizedPath(filePath)
  const lower = normalized.toLowerCase()
  const markers = ['/.workbuddy-ai/', '/.workbuddy/', '/.codebuddy/']
    .map((marker) => ({ marker, index: lower.lastIndexOf(marker) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => right.index - left.index)
  const found = markers[0]
  if (!found) return null
  const segments = normalized.slice(found.index + found.marker.length).split('/').filter(Boolean)
  if (segments.length === 0) return null
  return {
    marker: found.marker,
    rootPath: normalized.slice(0, found.index),
    storePath: `${normalized.slice(0, found.index)}${found.marker.slice(0, -1)}`,
    area: segments[0].toLowerCase(),
    segments,
  }
}

function isConfiguredStore(location, root) {
  return pathIdentityKey(location.storePath) === pathIdentityKey(normalizedPath(root))
}

function configuredRootLocation(filePath, root) {
  const normalizedFile = normalizedPath(filePath)
  const normalizedRoot = normalizedPath(root).replace(/\/$/, '')
  const fileKey = pathIdentityKey(normalizedFile)
  const rootKey = pathIdentityKey(normalizedRoot)
  if (!fileKey.startsWith(`${rootKey}/`)) return null
  const segments = normalizedFile.slice(normalizedRoot.length + 1).split('/').filter(Boolean)
  if (segments.length === 0) return null
  return { storePath: normalizedRoot, area: segments[0].toLowerCase(), segments }
}

function classifyFile(filePath, source, root) {
  const extension = extname(filePath).toLowerCase()
  if (source !== 'workbuddy') {
    const normalizedFile = normalizedPath(filePath).toLowerCase()
    const normalizedRoot = normalizedPath(root).replace(/\/$/, '').toLowerCase()
    if (source === 'claude' && normalizedFile.endsWith('/.claude/history.jsonl')) return null
    if (source === 'claude' && extension === '.js' && normalizedRoot.endsWith('/workflows')) {
      return { kind: 'workflow', projectPath: dirname(root) }
    }
    return RECORD_EXTENSIONS.has(extension) ? { kind: 'session', projectPath: null } : null
  }

  const configuredLocation = configuredRootLocation(filePath, root)
  const location = workbuddyLocation(filePath)
  const globalStore = location && isConfiguredStore(location, root)
  const canonicalLocation = globalStore ? location : configuredLocation

  // Canonical CodeBuddy/WorkBuddy transcripts are under <config>/projects/<project>/<session>.jsonl.
  // Workflow runtime sidecars can contain scripts, arguments, journal entries, and result previews.
  const canonicalTail = canonicalLocation?.area === 'projects'
    ? canonicalLocation.segments.slice(2).map((segment) => segment.toLowerCase())
    : []
  if (canonicalTail.some((segment) => SENSITIVE_WORKFLOW_RUNTIME_AREAS.has(segment))) return null
  if (canonicalLocation?.area === 'projects' && canonicalLocation.segments.length >= 3
    && RECORD_EXTENSIONS.has(extension)) {
    return {
      kind: 'session',
      projectPath: `${canonicalLocation.storePath}/projects/${canonicalLocation.segments[1]}`,
    }
  }

  // Active process maps under a global <config>/sessions directory are stale/non-canonical.
  if (canonicalLocation?.area === 'sessions') return null

  const metadataLocation = location || configuredLocation
  if (!metadataLocation) return null
  const projectPath = globalStore ? location.storePath : location ? location.rootPath : metadataLocation.storePath
  if (WORKBUDDY_MEMORY_AREAS.has(metadataLocation.area) && WORKBUDDY_METADATA_EXTENSIONS.has(extension)) {
    return { kind: 'metadata', projectPath }
  }
  if (WORKBUDDY_WORKFLOW_AREAS.has(metadataLocation.area) && WORKBUDDY_METADATA_EXTENSIONS.has(extension)) {
    return { kind: 'workflow', projectPath }
  }
  if (!globalStore && configuredLocation?.area !== 'sessions' && WORKBUDDY_SESSION_AREAS.has(metadataLocation.area)
    && RECORD_EXTENSIONS.has(extension)) {
    return { kind: 'session', projectPath }
  }
  return null
}

function rememberNewest(state, file, limit) {
  const key = pathIdentityKey(file.path)
  if (state.seenPaths.has(key)) return
  state.seenPaths.add(key)
  state.candidates += 1
  if (state.files.length < limit) {
    state.files.push(file)
    return
  }

  let oldest = 0
  for (let index = 1; index < state.files.length; index += 1) {
    const candidate = state.files[index]
    const current = state.files[oldest]
    if (candidate.mtimeMs < current.mtimeMs
      || (candidate.mtimeMs === current.mtimeMs && candidate.path.localeCompare(current.path) > 0)) oldest = index
  }
  const current = state.files[oldest]
  if (file.mtimeMs > current.mtimeMs
    || (file.mtimeMs === current.mtimeMs && file.path.localeCompare(current.path) < 0)) {
    state.files[oldest] = file
  }
  state.skippedLimit += 1
}

async function collectFiles(root, source, config, state, signal) {
  const pending = [root]
  const maxDirectories = config.maxFilesPerSource * 20 + 100
  while (pending.length && state.directoriesVisited < maxDirectories) {
    throwIfAborted(signal)
    const directory = pending.pop()
    state.directoriesVisited += 1
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) state.errors += 1
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      throwIfAborted(signal)
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        const directoryName = entry.name.toLowerCase()
        if (!SKIP_DIRECTORIES.has(directoryName)
          && !(source === 'claude' && CLAUDE_EXCLUDED_DIRECTORIES.has(directoryName))) pending.push(path)
        continue
      }
      if (!entry.isFile()) continue
      const classification = classifyFile(path, source, root)
      if (!classification) continue
      try {
        const info = await stat(path)
        if (info.mtimeMs < config.cutoffMs) { state.skippedOld += 1; continue }
        const truncated = classification.kind === 'session' && info.size > config.maxBytesPerFile
        if (truncated && extname(path).toLowerCase() !== '.jsonl') {
          state.skippedOversize += 1
          continue
        }
        rememberNewest(state, {
          path,
          ...classification,
          truncated,
          mtime: iso(info.mtime)?.slice(0, 10) || null,
          mtimeMs: info.mtimeMs,
          size: info.size,
        }, config.maxFilesPerSource)
      } catch { state.errors += 1 }
    }
  }
}

export async function scanProjects(config, options = {}) {
  const signal = options.signal
  const requested = options.sources?.length ? [...new Set(options.sources)] : [...SOURCE_NAMES]
  if (requested.some((source) => !SOURCE_NAMES.includes(source))) {
    throw new TypeError('sources must contain only codex, claude, or workbuddy')
  }
  if (typeof config.identityKey !== 'string' || config.identityKey.length < 32) {
    throw new TypeError('identityKey must be a private string of at least 32 characters')
  }
  const scanConfig = {
    ...config,
    cutoffMs: Number.isFinite(config.cutoffMs)
      ? config.cutoffMs
      : Date.now() - config.recentDays * 86_400_000,
  }
  const projects = new Map()
  const sourceReports = []

  for (const source of requested) {
    throwIfAborted(signal)
    const state = {
      files: [], seenPaths: new Set(), candidates: 0, directoriesVisited: 0,
      errors: 0, skippedOld: 0, skippedOversize: 0, skippedLimit: 0,
    }
    for (const configuredRoot of rootsFor(source, scanConfig)) {
      await collectFiles(expandHome(configuredRoot, scanConfig.homeDirectory), source, scanConfig, state, signal)
    }
    state.files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path))

    for (const file of state.files) {
      throwIfAborted(signal)
      if (file.kind === 'workflow' || file.kind === 'metadata') {
        const id = projectId(source, file.projectPath, scanConfig.identityKey)
        const project = projects.get(id)
          || makeProject(source, file.projectPath, file.mtime, scanConfig.identityKey)
        if (file.kind === 'workflow') {
          project.workflowCount += 1
          project.toolCounts.workflow += 1
        } else {
          project.metadataCount += 1
        }
        updateObserved(project, file.mtime)
        projects.set(id, project)
        continue
      }
      try {
        const text = await readBounded(file.path, scanConfig.maxBytesPerFile, signal)
        throwIfAborted(signal)
        const parsed = parseRecords(text, extname(file.path).toLowerCase(), file.truncated)
        if (parsed.malformed) state.errors += 1
        const extracted = extractRecords(source, parsed.records, parsed.envelope)
        if (!extracted.recognizedSession) continue
        const keyPath = file.projectPath || extracted.projectPath || dirname(file.path)
        const id = projectId(source, keyPath, scanConfig.identityKey)
        const project = projects.get(id)
          || makeProject(source, keyPath, file.mtime, scanConfig.identityKey)
        project.sessionCount += 1
        if (extracted.toolCounts.workflow > 0) project.workflowCount += 1
        addToolCounts(project.toolCounts, extracted.toolCounts)
        updateObserved(project, file.mtime)
        projects.set(id, project)
      } catch (error) {
        if (signal?.aborted) throw error
        state.errors += 1
      }
    }

    const ownProjects = [...projects.values()].filter((project) => project.source === source)
    const toolCounts = emptyToolCounts()
    for (const project of ownProjects) addToolCounts(toolCounts, project.toolCounts)
    sourceReports.push({
      name: source,
      projectCount: ownProjects.length,
      sessionCount: ownProjects.reduce((sum, project) => sum + project.sessionCount, 0),
      workflowCount: ownProjects.reduce((sum, project) => sum + project.workflowCount, 0),
      metadataCount: ownProjects.reduce((sum, project) => sum + project.metadataCount, 0),
      toolCounts,
      filesConsidered: state.files.length,
      truncatedFiles: state.files.filter((file) => file.truncated).length,
      skippedOld: state.skippedOld,
      skippedOversize: state.skippedOversize,
      skippedLimit: state.skippedLimit,
      parseOrAccessErrors: state.errors,
    })
  }

  const projectList = [...projects.values()].sort((a, b) => a.id.localeCompare(b.id))
  for (const project of projectList) project.recommendation = recommend([project])
  return {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    privacy: PRIVACY_DECLARATION,
    sources: sourceReports,
    projects: projectList,
    recommendation: recommend(projectList),
  }
}

export function mergeReports(previous, fresh, scannedSources) {
  if (!previous || !Array.isArray(previous.projects) || !Array.isArray(previous.sources)
    || scannedSources.length === SOURCE_NAMES.length) return fresh
  const scanned = new Set(scannedSources)
  const projects = [...previous.projects.filter((project) => !scanned.has(project.source)), ...fresh.projects]
    .sort((a, b) => a.id.localeCompare(b.id))
  const sources = [...previous.sources.filter((source) => !scanned.has(source.name)), ...fresh.sources]
    .sort((a, b) => a.name.localeCompare(b.name))
  return { ...fresh, sources, projects, recommendation: recommend(projects) }
}
