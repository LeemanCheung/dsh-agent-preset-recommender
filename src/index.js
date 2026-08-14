import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { clearInterval, setInterval } from 'node:timers'
import z from '@deepseek-ai/schemastery'
import { DEFAULTS, SOURCE_NAMES } from './constants.js'
import { renderReport } from './render.js'
import { mergeReports, scanProjects } from './scanner.js'
import { ReportStore } from './store.js'
import { combineSignals, expandHome, isAbortError, throwIfAborted } from './utils.js'

export const name = 'agent-preset-recommender'
export const inject = ['tools']

const stringList = (defaults) => z.array(z.string()).default(defaults)
export const Config = z.object({
  scanOnStart: z.boolean().default(DEFAULTS.scanOnStart),
  intervalMinutes: z.number().min(0).max(35791).default(DEFAULTS.intervalMinutes),
  maxFilesPerSource: z.number().step(1).min(1).max(100000).default(DEFAULTS.maxFilesPerSource),
  maxBytesPerFile: z.number().step(1).min(1024).max(64 * 1024 * 1024).default(DEFAULTS.maxBytesPerFile),
  recentDays: z.number().min(1).max(3650).default(DEFAULTS.recentDays),
  stateDirectory: z.string().default(DEFAULTS.stateDirectory),
  codexRoots: stringList(DEFAULTS.codexRoots),
  claudeRoots: stringList(DEFAULTS.claudeRoots),
  claudeTranscriptRoots: stringList(DEFAULTS.claudeTranscriptRoots),
  claudeWorkflowRoots: stringList(DEFAULTS.claudeWorkflowRoots),
  workbuddyRoots: stringList(DEFAULTS.workbuddyRoots),
})

function stateDirectory(config) {
  if (config.stateDirectory) return expandHome(config.stateDirectory)
  const dshHome = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
  return join(dshHome, 'state', 'agent-preset-recommender')
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidToolInput() {
  throw new TypeError('Invalid tool input.')
}

function scanSourcesFromInput(args) {
  if (!isPlainObject(args) || Object.keys(args).some((key) => key !== 'sources')) invalidToolInput()
  if (args.sources === undefined) return undefined
  if (!Array.isArray(args.sources) || args.sources.some((source) => !SOURCE_NAMES.includes(source))) invalidToolInput()
  return args.sources
}

function projectIdFromInput(args) {
  if (!isPlainObject(args) || Object.keys(args).some((key) => key !== 'project_id')) invalidToolInput()
  if (args.project_id === undefined) return undefined
  if (typeof args.project_id !== 'string' || !/^(codex|claude|workbuddy)-[a-f0-9]{16}$/i.test(args.project_id)) invalidToolInput()
  return args.project_id
}

function safeDiagnostic(error) {
  if (error?.name === 'AbortError') return 'aborted'
  if (typeof error?.code === 'string' && /^[A-Z0-9_]{1,16}$/.test(error.code)) return error.code
  return 'failed'
}

function makeBackgroundRunner(runScan, logger, canRun = () => true) {
  let queued = false
  return () => {
    if (!canRun() || queued) return
    queued = true
    const task = Promise.resolve().then(() => runScan()).catch((error) => {
      if (!isAbortError(error)) logger?.warn?.('scan failed: %s', safeDiagnostic(error))
    }).finally(() => { queued = false })
    return task
  }
}

function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function makeScanTool(runScan) {
  return {
    name: 'scan_agent_projects',
    description: 'Run a fresh privacy-safe local scan of Codex, Claude Code, CodeBuddy, and WorkBuddy metadata, persist aggregate recommendations, and return a bounded summary.',
    parameters: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          description: 'Optional sources to refresh.',
          items: { type: 'string', enum: SOURCE_NAMES },
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, execution) {
      const report = await runScan(scanSourcesFromInput(args), execution?.signal)
      return renderReport(report)
    },
  }
}

function makeGetTool(getReport) {
  return {
    name: 'get_agent_preset_recommendations',
    description: 'Return the persisted local agent-preset recommendation report without scanning or changing any preset.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Optional installation-keyed project id for one project.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return renderReport(await getReport(), projectIdFromInput(args))
    },
  }
}

export function apply(ctx, config) {
  const lifecycle = new AbortController()
  const store = new ReportStore(stateDirectory(config))
  const runtimeConfig = { ...config, homeDirectory: homedir() }
  const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : null
  let latest = null
  let identityKey = null
  let active = Promise.resolve()

  async function getIdentityKey() {
    if (identityKey) return identityKey
    identityKey = await store.identityKey()
    return identityKey
  }

  async function getReport() {
    if (latest) return latest
    latest = await store.load()
    return latest
  }

  function runScan(sources, externalSignal) {
    const signal = combineSignals(lifecycle.signal, externalSignal)
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    const selected = sources?.length ? [...new Set(sources)] : [...SOURCE_NAMES]
    const task = async () => {
      throwIfAborted(signal)
      const previous = await getReport()
      throwIfAborted(signal)
      const fresh = await scanProjects({
        ...runtimeConfig,
        identityKey: await getIdentityKey(),
        cutoffMs: Date.now() - runtimeConfig.recentDays * 86_400_000,
      }, { sources: selected, signal })
      throwIfAborted(signal)
      const report = mergeReports(previous, fresh, selected)
      throwIfAborted(signal)
      await store.save(report, signal)
      throwIfAborted(signal)
      latest = report
      return report
    }
    const result = active.then(task, task)
    active = result.catch(() => {})
    return abortable(result, signal)
  }

  ctx.tools.register(makeScanTool(runScan))
  ctx.tools.register(makeGetTool(getReport))

  ctx.effect(() => {
    let timer = null
    const backgroundScan = makeBackgroundRunner(runScan, logger, () => !lifecycle.signal.aborted)
    if (config.scanOnStart) queueMicrotask(backgroundScan)
    if (config.intervalMinutes > 0) {
      timer = setInterval(backgroundScan, config.intervalMinutes * 60_000)
      timer.unref?.()
    }
    return async () => {
      lifecycle.abort(new DOMException('Plugin disposed', 'AbortError'))
      if (timer) clearInterval(timer)
      await active
    }
  }, 'agent-preset-recommender.lifecycle')
}

export const internals = {
  makeScanTool, makeGetTool, makeBackgroundRunner, abortable, stateDirectory, scanSourcesFromInput, projectIdFromInput, safeDiagnostic,
}
