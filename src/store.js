import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { IDENTITY_FILENAME, REPORT_FILENAME, REPORT_VERSION } from './constants.js'

export class ReportStore {
  constructor(directory) {
    this.directory = directory
    this.path = join(directory, REPORT_FILENAME)
    this.identityPath = join(directory, IDENTITY_FILENAME)
  }

  async identityKey() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const existing = (await readFile(this.identityPath, 'utf8')).trim()
      if (/^[a-f0-9]{64}$/i.test(existing)) return existing
      throw new Error('agent preset recommender identity key is invalid')
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
      if (!/^[a-f0-9]{64}$/i.test(raced)) throw new Error('agent preset recommender identity key is invalid')
      return raced
    } finally {
      await chmod(this.identityPath, 0o600).catch(() => {})
    }
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      if (!parsed || parsed.version !== REPORT_VERSION
        || !Array.isArray(parsed.projects) || !Array.isArray(parsed.sources)) return null
      return parsed
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  async save(report) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(dirname(this.path), `.${REPORT_FILENAME}.${process.pid}.${Date.now()}.tmp`)
    const body = `${JSON.stringify(report, null, 2)}\n`
    try {
      await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
      await chmod(this.path, 0o600).catch(() => {})
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    return report
  }
}
