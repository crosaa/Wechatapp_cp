import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Real 拍图识别 requests kept for improving recognition later: the photo (shrunk) and what
// recognition answered (the right product can be chosen for them afterwards). Not every request
// is kept: all the unsure ones (retrieval was not confident enough to skip the review), which are
// the ones most often wrong, and a share of the sure ones. At most RECOGNITION_CASES_MAX cases and
// none older than RECOGNITION_CASES_DAYS are kept, the oldest going first, so they take a few tens
// of MB at most.
const serverDir = fileURLToPath(new URL('.', import.meta.url))
const dataDir = resolve(process.env.DATA_DIR || join(serverDir, 'data'))
const casesDir = resolve(process.env.RECOGNITION_CASES_DIR || join(dataDir, 'recognition-cases'))
const enabled = String(process.env.RECOGNITION_CASES || '').trim().toLowerCase() !== 'off'
const maxCases = Math.max(10, Math.min(5000, Number(process.env.RECOGNITION_CASES_MAX) || 400))
const maxDays = Math.max(1, Math.min(365, Number(process.env.RECOGNITION_CASES_DAYS) || 60))
const sureShareSetting = String(process.env.RECOGNITION_CASES_SURE_SHARE ?? '').trim()
const sureShare = sureShareSetting !== '' && Number.isFinite(Number(sureShareSetting)) ? Math.max(0, Math.min(1, Number(sureShareSetting))) : 0.2
const PHOTO_SIZE = 640
const RESULTS_KEPT = 10
const caseIdPattern = /^\d{8}-\d{6}-[0-9a-f]{6}$/u

function caseFile(caseId) {
  return join(casesDir, `${caseId}.json`)
}

function newCaseId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15)
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

function writeJson(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 1), { mode: 0o640 })
  renameSync(`${file}.tmp`, file)
}

// Oldest first past the limits; a case is its .json and .jpg.
export function pruneRecognitionCases(now = Date.now()) {
  if (!existsSync(casesDir)) return 0
  const ids = readdirSync(casesDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(id => caseIdPattern.test(id)).sort()
  const cutoff = new Date(now - maxDays * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15)
  const remove = ids.filter((id, index) => id.slice(0, 15) < cutoff || index < ids.length - maxCases)
  for (const id of remove) {
    for (const file of [caseFile(id), join(casesDir, `${id}.jpg`)]) {
      try { unlinkSync(file) } catch {}
    }
  }
  return remove.length
}

// Decides whether this recognition is kept and returns its case id ('' when not kept). The photo
// and record are written afterwards, so the answer to the customer does not wait for them.
// retrieved: retrieval's ranking; matches: what the customer was shown (after the review).
export function keepRecognitionCase({ dataUrl, retrieved = [], matches = [], recognition = {} }, random = Math.random) {
  if (!enabled || !matches.length) return ''
  const sure = recognition.reason === 'retrieval-confident'
  if (sure && random() >= sureShare) return ''
  const caseId = newCaseId()
  const lead = Number(retrieved[0]?.retrievalScore) - Number(retrieved[1]?.retrievalScore)
  const record = {
    id: caseId,
    at: new Date().toISOString(),
    sure,
    lead: Number.isFinite(lead) ? Number(lead.toFixed(4)) : null,
    recognition: {
      method: recognition.method || '',
      model: recognition.used ? recognition.model || '' : '',
      reviewed: Boolean(recognition.used),
      uncertain: Boolean(recognition.uncertain),
      reason: recognition.reason || '',
      elapsedMs: recognition.elapsedMs || 0
    },
    results: matches.slice(0, RESULTS_KEPT).map(match => ({
      id: Number(match.id),
      code: match.code || '',
      name: match.name || '',
      image: match.image || '',
      wholeImage: match.wholeImage || '',
      score: match.score ?? null,
      retrievalScore: match.retrievalScore ?? null,
      method: match.recognitionMethod || ''
    })),
    retrieved: retrieved.slice(0, RESULTS_KEPT).map(match => Number(match.id))
  }
  void saveCase(caseId, dataUrl, record).catch(error => console.warn(`拍图识别案例保存失败：${error.message}`))
  return caseId
}

async function saveCase(caseId, dataUrl, record) {
  const match = String(dataUrl || '').match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/u)
  if (!match) return
  mkdirSync(casesDir, { recursive: true, mode: 0o750 })
  const photo = await sharp(Buffer.from(match[1], 'base64'), { failOn: 'none', limitInputPixels: 60_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: PHOTO_SIZE, height: PHOTO_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, chromaSubsampling: '4:2:0' })
    .toBuffer()
  writeFileSync(join(casesDir, `${caseId}.jpg`), photo, { mode: 0o640 })
  writeJson(caseFile(caseId), { ...record, photo: `${caseId}.jpg` })
  pruneRecognitionCases()
}

export function recognitionCasesStatus() {
  const count = existsSync(casesDir) ? readdirSync(casesDir).filter(name => name.endsWith('.json')).length : 0
  return { enabled, count, maxCases, maxDays, sureShare }
}
