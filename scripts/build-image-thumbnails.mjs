import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { listProducts } from '../server/db.mjs'

const serverDir = fileURLToPath(new URL('../server/', import.meta.url))
const uploadsDir = resolve(process.env.UPLOADS_DIR || join(serverDir, 'uploads'))
const thumbnailsDir = join(uploadsDir, '.thumbnails')
const sizeArgument = process.argv.find(value => value.startsWith('--size='))
const concurrencyArgument = process.argv.find(value => value.startsWith('--concurrency='))
const limitArgument = process.argv.find(value => value.startsWith('--limit='))
const requestedSize = Number(sizeArgument?.split('=')[1] || 2000)
const allowedSizes = new Set([1600, 2000])
const size = allowedSizes.has(requestedSize) ? requestedSize : 2000
const concurrency = Math.min(8, Math.max(1, Number(concurrencyArgument?.split('=')[1] || 2)))
const limit = Math.max(0, Number(limitArgument?.split('=')[1] || 0))
const quality = size >= 1600 ? 86 : 76

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

function thumbnailJob(uploadPath) {
  const relative = uploadPath.slice('/uploads/'.length)
  const sourcePath = resolve(uploadsDir, relative)
  if ((!sourcePath.startsWith(`${uploadsDir}${sep}`) && sourcePath !== uploadsDir) || !existsSync(sourcePath)) return null
  const hash = createHash('sha1').update(relative).digest('hex')
  return {
    sourcePath,
    thumbnailPath: join(thumbnailsDir, `${hash}-${size}-width.webp`)
  }
}

mkdirSync(thumbnailsDir, { recursive: true })
const uploadPaths = [...collectUploadPaths(listProducts())]
const jobs = uploadPaths.map(thumbnailJob).filter(Boolean).slice(0, limit || undefined)
let cursor = 0
const summary = { size, quality, concurrency, discovered: uploadPaths.length, processed: jobs.length, created: 0, skipped: 0, failed: 0 }

async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++]
    if (existsSync(job.thumbnailPath)) {
      summary.skipped += 1
      continue
    }
    try {
      await sharp(job.sourcePath)
        .rotate()
        .resize({ width: size, withoutEnlargement: true })
        .webp({ quality, smartSubsample: true, effort: 4 })
        .toFile(job.thumbnailPath)
      summary.created += 1
    } catch (error) {
      summary.failed += 1
      console.error(`${job.sourcePath}: ${error.message}`)
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))
console.log(JSON.stringify(summary, null, 2))
