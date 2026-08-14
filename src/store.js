import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { IDENTITY_FILENAME, REPORT_FILENAME, REPORT_VERSION, SOURCE_NAMES, TOOL_CATEGORIES } from './constants.js'
import { throwIfAborted } from './utils.js'

const STORAGE_CODES = new Set(['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EBUSY', 'EIO', 'ENOENT'])

export class ReportStoreError extends Error {
  constructor(operation, cause) {
    const code = STORAGE_CODES.has(cause?.code) ? cause.code : 'IO'
    super(`Agent preset recommender storage ${operation} failed (${code}).`)
    this.name = 'ReportStoreError'
    this.code = code
  }
}

function rethrowStorageError(operation, error) {
  if (error?.name === 'AbortError' || error instanceof ReportStoreError) throw error
  throw new ReportStoreError(operation, error)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isToolCounts(value) {
  return isObject(value) && TOOL_CATEGORIES.every((category) => isCount(value[category]))
}

function isRecommendation(value) {
  return isObject(value)
    && (value.preset === 'minimal' || value.preset === 'standard')
    && Array.isArray(value.capabilities) && value.capabilities.every((item) => typeof item === 'string')
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
    && isObject(value.evidence) && isCount(value.evidence.sessions) && isCount(value.evidence.workflows)
    && isCount(value.evidence.metadataFiles) && isCount(value.evidence.categorizedToolCalls)
    && isCount(value.evidence.activeToolCategories) && Array.isArray(value.evidence.sources)
    && isToolCounts(value.evidence.toolCounts) && typeof value.advisoryOnly === 'boolean'
}

function isProject(value) {
  return isObject(value) && typeof value.id === 'string' && typeof value.source === 'string'
    && SOURCE_NAMES.includes(value.source) && isCount(value.sessionCount) && isCount(value.workflowCount)
    && isCount(value.metadataCount) && isToolCounts(value.toolCounts) && isRecommendation(value.recommendation)
    && (typeof value.firstObservedAt === 'string' || value.firstObservedAt === null)
    && (typeof value.lastObservedAt === 'string' || value.lastObservedAt === null)
}

function isSource(value) {
  return isObject(value) && SOURCE_NAMES.includes(value.name) && isCount(value.projectCount)
    && isCount(value.sessionCount) && isCount(value.workflowCount) && isCount(value.metadataCount)
    && isToolCounts(value.toolCounts) && isCount(value.filesConsidered) && isCount(value.truncatedFiles)
    && isCount(value.skippedOld) && isCount(value.skippedOversize) && isCount(value.skippedLimit)
    && isCount(value.parseOrAccessErrors)
}

export function isValidReport(value) {
  return isObject(value) && value.version === REPORT_VERSION && typeof value.generatedAt === 'string'
    && isObject(value.privacy) && typeof value.privacy.summary === 'string'
    && Array.isArray(value.projects) && value.projects.every(isProject)
    && Array.isArray(value.sources) && value.sources.every(isSource)
    && isRecommendation(value.recommendation)
}

export class ReportStore {
  constructor(directory) {
    this.directory = directory
    this.path = join(directory, REPORT_FILENAME)
    this.identityPath = join(directory, IDENTITY_FILENAME)
  }

  async identityKey() {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      try {
        const existing = (await readFile(this.identityPath, 'utf8')).trim()
        if (/^[a-f0-9]{64}$/i.test(existing)) return existing
        throw new Error('identity key is invalid')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }

      const created = randomBytes(32).toString('hex')
      try {
        await writeFile(this.identityPath, `${created}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        return created
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const raced = (await readFile(this.identityPath, 'utf8')).trim()
        if (!/^[a-f0-9]{64}$/i.test(raced)) throw new Error('identity key is invalid')
        return raced
      } finally {
        await chmod(this.identityPath, 0o600).catch(() => {})
      }
    } catch (error) {
      rethrowStorageError('initialization', error)
    }
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      return isValidReport(parsed) ? parsed : null
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
      rethrowStorageError('read', error)
    }
  }

  async save(report, signal) {
    if (!isValidReport(report)) throw new ReportStoreError('validation')
    let temporary
    try {
      throwIfAborted(signal)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      throwIfAborted(signal)
      temporary = join(dirname(this.path), `.${REPORT_FILENAME}.${process.pid}.${Date.now()}.tmp`)
      const body = `${JSON.stringify(report, null, 2)}\n`
      await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      throwIfAborted(signal)
      await rename(temporary, this.path)
      await chmod(this.path, 0o600).catch(() => {})
    } catch (error) {
      rethrowStorageError('write', error)
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {})
    }
    return report
  }
}
