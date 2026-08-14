import { createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'

export function expandHome(value, home = homedir()) {
  if (value === '~') return home
  if (value.startsWith(`~${sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return resolve(home, value.slice(2))
  }
  return resolve(value)
}

export function pathIdentityKey(path) {
  const normalized = String(path || 'unknown').replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function projectId(source, projectPath, identityKey) {
  if (typeof identityKey !== 'string' || identityKey.length < 32) {
    throw new TypeError('identityKey must be a private string of at least 32 characters')
  }
  const digest = createHmac('sha256', identityKey)
    .update(`${source}\0${pathIdentityKey(projectPath)}`)
    .digest('hex')
    .slice(0, 16)
  return `${source}-${digest}`
}

export function emptyToolCounts() {
  return {
    shell: 0, files: 0, search: 0, web: 0, mcp: 0,
    lsp: 0, delegation: 0, workflow: 0, other: 0,
  }
}

export function addToolCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += Number(source?.[key] || 0)
  return target
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

export function combineSignals(...signals) {
  const usable = signals.filter(Boolean)
  if (usable.length === 0) return undefined
  if (usable.length === 1) return usable[0]
  return AbortSignal.any(usable)
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

export function iso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
