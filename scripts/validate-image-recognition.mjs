import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { listProducts } from '../server/db.mjs'
import { recognizeProductImage } from '../server/image-recognition.mjs'

const serverDir = resolve(fileURLToPath(new URL('../server', import.meta.url)))
const uploadsDir = resolve(process.env.UPLOADS_DIR || join(serverDir, 'uploads'))
const publicDir = join(serverDir, 'public')
const sampleLimit = Math.max(1, Math.min(100, Number(process.argv[2]) || 24))
const products = listProducts({ status: 'published' })

function localPath(url) {
  if (url?.startsWith('/uploads/')) return join(uploadsDir, url.slice('/uploads/'.length))
  if (url?.startsWith('/images/')) return join(publicDir, 'images', url.slice('/images/'.length))
  return ''
}

function sampleImage(product) {
  const real = (product.realImages || []).map(item => typeof item === 'string' ? item : item?.url)
  const colors = Object.values(product.colorGalleries || {}).flat()
  return [...real, ...colors, ...(product.images || [])]
    .map(url => ({ url, path: localPath(url) }))
    .find(item => item.path && existsSync(item.path))
}

const candidates = products
  .map(product => ({ product, image: sampleImage(product) }))
  .filter(item => item.image)
const step = Math.max(1, Math.floor(candidates.length / sampleLimit))
const samples = candidates.filter((_, index) => index % step === 0).slice(0, sampleLimit)
const results = []

for (const sample of samples) {
  const transformed = await sharp(readFileSync(sample.image.path), { failOn: 'none' })
    .rotate(0.8, { background: '#ffffff' })
    .resize({ width: 720, height: 920, fit: 'inside', withoutEnlargement: false })
    .modulate({ brightness: 0.96, saturation: 1.04 })
    .jpeg({ quality: 72 })
    .toBuffer()
  const startedAt = performance.now()
  const matches = await recognizeProductImage(`data:image/jpeg;base64,${transformed.toString('base64')}`, products, 10)
  const elapsedMs = Math.round(performance.now() - startedAt)
  const rank = matches.findIndex(item => item.id === sample.product.id) + 1
  results.push({
    id: sample.product.id,
    code: sample.product.code,
    sourceType: sample.image.url.includes('cpfst-real') ? 'real' : 'catalog',
    rank,
    elapsedMs,
    topCode: matches[0]?.code || '',
    confidence: matches[0]?.confidence || 0
  })
}

const summary = {
  samples: results.length,
  top1: results.filter(item => item.rank === 1).length,
  top5: results.filter(item => item.rank > 0 && item.rank <= 5).length,
  top10: results.filter(item => item.rank > 0 && item.rank <= 10).length,
  averageMs: Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / Math.max(1, results.length)),
  failures: results.filter(item => item.rank !== 1)
}
console.log(JSON.stringify(summary, null, 2))
