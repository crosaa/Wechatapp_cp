import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  backupCatalogDatabase,
  getStoreSettings,
  listCategories,
  listProducts
} from '../server/db.mjs'

const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('../server/data', import.meta.url)))
const uploadsDir = resolve(process.env.UPLOADS_DIR || fileURLToPath(new URL('../server/uploads', import.meta.url)))
const backupsDir = resolve(process.env.BACKUP_DIR || join(dataDir, 'backups'))
const inventoryReportsDir = resolve(process.env.INVENTORY_REPORTS_DIR || fileURLToPath(new URL('../server/inventory-reports', import.meta.url)))
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 5))
const inventoryReportRetentionCount = Math.max(1, Number(process.env.INVENTORY_REPORT_RETENTION_COUNT || 5))
const graceHoursArgument = process.argv.find(value => value.startsWith('--orphan-grace-hours='))
const orphanGraceHours = Math.max(0, Number(graceHoursArgument?.split('=')[1] ?? process.env.ORPHAN_GRACE_HOURS ?? 24))
const dryRun = process.argv.includes('--dry-run')
const skipBackup = process.argv.includes('--skip-backup')
const now = Date.now()

function uploadPathFromValue(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  let pathname = text
  if (/^https?:\/\//i.test(text)) {
    try { pathname = new URL(text).pathname } catch { return '' }
  }
  if (!pathname.startsWith('/uploads/')) return ''
  const relative = normalize(decodeURIComponent(pathname.slice('/uploads/'.length))).replace(/^(\.\.[/\\])+/, '')
  if (!relative || relative === '.thumbnails' || relative.startsWith(`.thumbnails${sep}`)) return ''
  return `/uploads/${relative.replaceAll('\\', '/')}`
}

function collectUploadPaths(value, paths = new Set()) {
  if (typeof value === 'string') {
    const uploadPath = uploadPathFromValue(value)
    if (uploadPath) paths.add(uploadPath)
  } else if (Array.isArray(value)) {
    for (const item of value) collectUploadPaths(item, paths)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUploadPaths(item, paths)
  }
  return paths
}

function walkFiles(directory, files = []) {
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) walkFiles(filePath, files)
    else if (entry.isFile()) files.push(filePath)
  }
  return files
}

function removeFile(filePath, summaryKey, summary) {
  const size = statSync(filePath).size
  if (!dryRun) unlinkSync(filePath)
  summary[summaryKey] += 1
  summary.reclaimedBytes += size
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z')
}

mkdirSync(backupsDir, { recursive: true })
const summary = {
  dryRun,
  backupCreated: '',
  expiredBackupsRemoved: 0,
  expiredInventoryReportsRemoved: 0,
  orphanUploadsRemoved: 0,
  orphanThumbnailsRemoved: 0,
  reclaimedBytes: 0,
  referencedUploads: 0
}

if (!skipBackup && !dryRun) {
  const destination = join(backupsDir, `catalog-${timestamp()}.db`)
  await backupCatalogDatabase(destination)
  summary.backupCreated = destination
}

const backupCutoff = now - retentionDays * 24 * 60 * 60 * 1000
for (const filePath of walkFiles(backupsDir)) {
  if (extname(filePath).toLowerCase() !== '.db') continue
  if (statSync(filePath).mtimeMs < backupCutoff) removeFile(filePath, 'expiredBackupsRemoved', summary)
}

const inventoryReports = walkFiles(inventoryReportsDir)
  .filter(filePath => ['.xlsx', '.xls', '.csv'].includes(extname(filePath).toLowerCase()))
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
for (const filePath of inventoryReports.slice(inventoryReportRetentionCount)) {
  removeFile(filePath, 'expiredInventoryReportsRemoved', summary)
}

const referenced = new Set()
collectUploadPaths(listProducts(), referenced)
collectUploadPaths(listCategories(), referenced)
collectUploadPaths(getStoreSettings(), referenced)
summary.referencedUploads = referenced.size

const graceCutoff = now - orphanGraceHours * 60 * 60 * 1000
const thumbnailsDir = join(uploadsDir, '.thumbnails')
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.ico'])
for (const filePath of walkFiles(uploadsDir)) {
  if (filePath.startsWith(`${thumbnailsDir}${sep}`)) continue
  if (!allowedExtensions.has(extname(filePath).toLowerCase())) continue
  const relative = filePath.slice(uploadsDir.length + 1).replaceAll('\\', '/')
  const uploadPath = `/uploads/${relative}`
  if (!referenced.has(uploadPath) && statSync(filePath).mtimeMs <= graceCutoff) {
    removeFile(filePath, 'orphanUploadsRemoved', summary)
  }
}

const referencedThumbnailHashes = new Set([...referenced].map(uploadPath => {
  const relative = uploadPath.slice('/uploads/'.length)
  return createHash('sha1').update(relative).digest('hex')
}))
for (const filePath of walkFiles(thumbnailsDir)) {
  const thumbnailHash = basename(filePath).match(/^([a-f0-9]{40})(?:-|\.webp$)/)?.[1]
  if ((!thumbnailHash || !referencedThumbnailHashes.has(thumbnailHash)) && statSync(filePath).mtimeMs <= graceCutoff) {
    removeFile(filePath, 'orphanThumbnailsRemoved', summary)
  }
}

console.log(JSON.stringify(summary, null, 2))
