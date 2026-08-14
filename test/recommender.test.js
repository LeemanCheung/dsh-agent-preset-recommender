import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULTS, sourceDefaultRoots } from '../src/constants.js'
import { categorizeTool, extractRecords } from '../src/extractors.js'
import { apply, internals } from '../src/index.js'
import { recommend } from '../src/recommender.js'
import { scanProjects } from '../src/scanner.js'
import { ReportStore } from '../src/store.js'
import { emptyToolCounts, projectId } from '../src/utils.js'

const syntheticSecret = ['fixture', 'token', 'must', 'not', 'persist'].join('-')
const syntheticPrompt = ['private', 'fixture', 'prompt', 'must', 'not', 'persist'].join('-')

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'preset-recommender-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function config(root, overrides = {}) {
  return {
    ...DEFAULTS,
    scanOnStart: false,
    intervalMinutes: 0,
    codexRoots: [join(root, 'codex')],
    claudeRoots: [join(root, 'claude')],
    claudeTranscriptRoots: [],
    workbuddyRoots: [join(root, 'workbuddy')],
    homeDirectory: root,
    identityKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    cutoffMs: 0,
    ...overrides,
  }
}

async function put(path, body) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
}

test('extractors select project/tool metadata and categorize tools', () => {
  const codex = extractRecords('codex', [
    { type: 'session_meta', payload: { cwd: '/synthetic/project', prompt: syntheticPrompt } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell_command', arguments: syntheticSecret } },
  ])
  const claude = extractRecords('claude', [{ cwd: '/synthetic/project', message: { content: [{ type: 'tool_use', name: 'Read', input: { secret: syntheticSecret } }] } }])
  const workbuddy = extractRecords('workbuddy', [{ projectPath: '/synthetic/project', tools: ['workflow_run', { name: 'mcp_lookup' }] }])

  assert.equal(codex.toolCounts.shell, 1)
  assert.equal(claude.toolCounts.files, 1)
  assert.equal(workbuddy.toolCounts.workflow, 1)
  assert.equal(workbuddy.toolCounts.mcp, 1)
  assert.equal(categorizeTool('language_server_definition'), 'lsp')
  assert.equal(JSON.stringify({ codex, claude, workbuddy }).includes(syntheticSecret), false)
  assert.equal(JSON.stringify({ codex, claude, workbuddy }).includes(syntheticPrompt), false)
})

test('project IDs require an installation-local keyed identity', () => {
  const key = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
  assert.notEqual(projectId('codex', '/synthetic/project', key), projectId('codex', '/synthetic/project', `${key}0`))
  assert.throws(() => projectId('codex', '/synthetic/project', ''), /identityKey/)
})

test('recommendations map activity to built-in presets and optional capabilities', () => {
  const tools = emptyToolCounts()
  tools.web = 2
  tools.lsp = 1
  tools.workflow = 3
  const project = { source: 'codex', sessionCount: 12, workflowCount: 2, toolCounts: tools }
  const result = recommend([project])
  assert.equal(result.preset, 'standard')
  assert.deepEqual(result.capabilities, ['Codex delegation', 'workflows', 'web', 'LSP'])
  assert.ok(result.confidence > 0.35)
  assert.equal(result.advisoryOnly, true)
  assert.equal(recommend([]).preset, 'minimal')
})

test('scanner handles Codex, Claude, WorkBuddy workflows and strips private content', async (t) => {
  const root = await sandbox(t)
  await put(join(root, 'codex', 'one.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/synthetic/alpha', prompt: syntheticPrompt } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell_command', arguments: `echo ${syntheticSecret}` } }),
  ].join('\n'))
  await put(join(root, 'claude', 'session.jsonl'), JSON.stringify({
    cwd: '/synthetic/beta',
    message: { content: [
      { type: 'tool_use', name: 'WebSearch', input: { query: syntheticSecret } },
      { type: 'tool_use', name: 'Task', input: { prompt: syntheticPrompt } },
    ] },
  }))
  await put(join(root, 'workbuddy', 'sample-project', 'result.json'), JSON.stringify({ secret: syntheticSecret }))
  await put(join(root, 'workbuddy', 'sample-project', '.codebuddy', 'sessions', 'session.json'), JSON.stringify({ tool: 'mcp_lookup', response: syntheticPrompt }))
  await put(join(root, 'workbuddy', 'sample-project', '.codebuddy', 'workflows', 'plan.md'), `${syntheticSecret}\n${syntheticPrompt}`)
  await put(join(root, 'workbuddy', 'sample-project', '.workbuddy', 'memory', 'MEMORY.md'), `${syntheticSecret}\n${syntheticPrompt}`)

  const report = await scanProjects(config(root))
  const serialized = JSON.stringify(report)
  assert.equal(report.projects.length, 3)
  assert.equal(report.sources.find((source) => source.name === 'codex').sessionCount, 1)
  assert.equal(report.sources.find((source) => source.name === 'claude').toolCounts.web, 1)
  assert.equal(report.sources.find((source) => source.name === 'claude').workflowCount, 1)
  assert.equal(report.sources.find((source) => source.name === 'workbuddy').sessionCount, 1)
  assert.equal(report.sources.find((source) => source.name === 'workbuddy').workflowCount, 1)
  assert.equal(report.sources.find((source) => source.name === 'workbuddy').metadataCount, 1)
  assert.equal(serialized.includes(syntheticSecret), false)
  assert.equal(serialized.includes(syntheticPrompt), false)
  assert.equal(serialized.includes('/synthetic/'), false)
  assert.equal(report.privacy.contentRetention, false)
})

test('scanner recognizes canonical CodeBuddy and WorkBuddy global project stores', async (t) => {
  const root = await sandbox(t)
  const codebuddy = join(root, '.codebuddy')
  const workbuddy = join(root, '.workbuddy')
  await put(join(codebuddy, 'projects', 'encoded-codebuddy-project', 'session.jsonl'), JSON.stringify({
    type: 'function_call', name: 'shell_command', content: syntheticSecret,
  }))
  await put(join(codebuddy, 'projects', 'encoded-codebuddy-project', 'session', 'subagents', 'agent.jsonl'), JSON.stringify({
    type: 'message', content: syntheticPrompt,
  }))
  await put(join(codebuddy, 'sessions', '12345.json'), JSON.stringify({
    sessionId: 'stale-map', cwd: '/sensitive/path', content: syntheticSecret,
  }))
  await put(join(workbuddy, 'projects', 'encoded-workbuddy-project', 'session.jsonl'), JSON.stringify({
    type: 'function_call', name: 'Read', content: syntheticPrompt,
  }))
  await put(join(workbuddy, 'automations', 'opaque-id', 'automation.toml'), `prompt = "${syntheticSecret}"`)

  const report = await scanProjects(config(root, { workbuddyRoots: [codebuddy, workbuddy] }), { sources: ['workbuddy'] })
  const source = report.sources[0]
  assert.equal(source.sessionCount, 3)
  assert.equal(source.workflowCount, 1)
  assert.equal(source.toolCounts.shell, 1)
  assert.equal(source.toolCounts.files, 1)
  assert.equal(source.projectCount, 3)
  assert.equal(JSON.stringify(report).includes(syntheticSecret), false)
  assert.equal(JSON.stringify(report).includes(syntheticPrompt), false)
})

test('environment config roots override default product locations', () => {
  const roots = sourceDefaultRoots({
    CODEX_HOME: '/configured/codex',
    CLAUDE_CONFIG_DIR: '/configured/claude',
    CODEBUDDY_CONFIG_DIR: '/configured/codebuddy',
    WORKBUDDY_CONFIG_DIR: '/configured/workbuddy',
  })
  assert.deepEqual(roots.codexRoots, [join('/configured/codex', 'sessions'), join('/configured/codex', 'archived_sessions')])
  assert.deepEqual(roots.claudeRoots, [join('/configured/claude', 'projects')])
  assert.deepEqual(roots.workbuddyRoots, ['/configured/codebuddy', '/configured/workbuddy'])
})

test('scanner honors a non-dot CodeBuddy configuration root', async (t) => {
  const root = await sandbox(t)
  const customConfig = join(root, 'custom-codebuddy-config')
  await put(join(customConfig, 'projects', 'encoded-project', 'session.jsonl'), JSON.stringify({
    type: 'function_call', name: 'Read', content: syntheticPrompt,
  }))
  await put(join(customConfig, 'sessions', '12345.json'), JSON.stringify({
    sessionId: 'stale-map', content: syntheticSecret,
  }))

  const report = await scanProjects(config(root, { workbuddyRoots: [customConfig] }), { sources: ['workbuddy'] })
  assert.equal(report.sources[0].sessionCount, 1)
  assert.equal(report.sources[0].toolCounts.files, 1)
  assert.equal(JSON.stringify(report).includes(syntheticPrompt), false)
  assert.equal(JSON.stringify(report).includes(syntheticSecret), false)
})

test('scanner tolerates malformed files and enforces byte/file bounds', async (t) => {
  const root = await sandbox(t)
  await put(join(root, 'codex', '01-malformed.json'), '{not-json')
  await put(join(root, 'codex', '02-large.json'), JSON.stringify({ value: 'x'.repeat(4096) }))
  await put(join(root, 'codex', '03-valid.jsonl'), JSON.stringify({ type: 'tool_call', name: 'Read', cwd: '/synthetic/bounded' }))
  await put(join(root, 'codex', '04-truncated.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/synthetic/truncated' } }),
    JSON.stringify({ type: 'message', content: 'x'.repeat(4096) }),
  ].join('\n'))
  await put(join(root, 'codex', '05-malformed.jsonl'), '{not-json\n')

  const report = await scanProjects(config(root, { maxFilesPerSource: 4, maxBytesPerFile: 1024 }), { sources: ['codex'] })
  const source = report.sources[0]
  assert.equal(source.filesConsidered, 4)
  assert.equal(source.truncatedFiles, 1)
  assert.equal(source.skippedOversize, 1)
  assert.equal(source.parseOrAccessErrors, 2)
  assert.equal(report.projects.length, 2)
  assert.equal(report.projects.reduce((sum, project) => sum + project.toolCounts.files, 0), 1)
})

test('scanner keeps the newest files when a source exceeds its file limit', async (t) => {
  const root = await sandbox(t)
  const paths = []
  for (let index = 1; index <= 3; index += 1) {
    const path = join(root, 'codex', `session-${index}.jsonl`)
    paths.push(path)
    await put(path, JSON.stringify({ type: 'tool_call', name: 'Read', cwd: `/synthetic/project-${index}` }))
    const time = new Date(`2026-01-0${index}T00:00:00.000Z`)
    await utimes(path, time, time)
  }

  const report = await scanProjects(config(root, { maxFilesPerSource: 2 }), { sources: ['codex'] })
  assert.equal(report.sources[0].filesConsidered, 2)
  assert.equal(report.sources[0].skippedLimit, 1)
  assert.equal(report.projects.length, 2)
})

test('atomic store persists aggregate report and no sensitive strings', async (t) => {
  const root = await sandbox(t)
  const store = new ReportStore(join(root, 'state'))
  const report = await scanProjects(config(root))
  await store.save(report)
  assert.deepEqual(await store.load(), report)
  const updated = { ...report, generatedAt: '2026-01-02T00:00:00.000Z' }
  await store.save(updated)
  assert.deepEqual(await store.load(), updated)
  const raw = await readFile(store.path, 'utf8')
  assert.equal(raw.includes(syntheticSecret), false)
  assert.equal(raw.includes(syntheticPrompt), false)
  assert.equal(raw.includes(root), false)
})

test('report store creates one private identity key for keyed project IDs', async (t) => {
  const root = await sandbox(t)
  const store = new ReportStore(join(root, 'state'))
  const first = await store.identityKey()
  const second = await store.identityKey()
  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.notEqual(projectId('codex', '/synthetic/project', first), projectId('codex', '/synthetic/project', `${first}0`))
  assert.equal((await readFile(store.identityPath, 'utf8')).trim(), first)
})

test('plugin registers raw tools and lifecycle cleanup aborts safely', async (t) => {
  const root = await sandbox(t)
  const registered = []
  const effects = []
  const ctx = {
    tools: { register(tool) { registered.push(tool); return () => {} } },
    effect(factory) { const dispose = factory(); effects.push(dispose); return dispose },
  }
  apply(ctx, config(root, { stateDirectory: join(root, 'state') }))
  assert.deepEqual(registered.map((tool) => tool.name), ['scan_agent_projects', 'get_agent_preset_recommendations'])
  assert.equal(registered.every((tool) => tool.parameters.type === 'object' && typeof tool.execute === 'function'), true)

  const scanText = await registered[0].execute({ sources: ['codex'] }, {})
  assert.match(scanText, /Preset: minimal/)
  const getText = await registered[1].execute({})
  assert.match(getText, /Advisory only/)
  await Promise.all(effects.map((dispose) => dispose()))
})

test('scan honors an already-aborted signal', async (t) => {
  const root = await sandbox(t)
  const controller = new AbortController()
  controller.abort(new DOMException('cancelled', 'AbortError'))
  await assert.rejects(scanProjects(config(root), { signal: controller.signal }), { name: 'AbortError' })
})

test('default state path is under DSH_HOME state directory', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = join(tmpdir(), 'synthetic-dsh-home')
  try {
    assert.equal(internals.stateDirectory({ stateDirectory: '' }), join(process.env.DSH_HOME, 'state', 'agent-preset-recommender'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
