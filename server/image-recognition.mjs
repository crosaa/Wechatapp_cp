import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  buildVisualEmbeddingIndex,
  ensureVisualEmbeddingIndex,
  retrieveVisualEmbeddingProducts
} from './visual-embedding.mjs'

const serverDir = fileURLToPath(new URL('.', import.meta.url))
const dataDir = resolve(process.env.DATA_DIR || join(serverDir, 'data'))
const uploadsDir = resolve(process.env.UPLOADS_DIR || join(serverDir, 'uploads'))
const publicDir = join(serverDir, 'public')
const indexPath = join(dataDir, 'image-search-index.json')
const INDEX_VERSION = 3
const FEATURE_SIZE = 24
const GRID_SIZE = 12
const PATCH_SIZE = 8
const PATCH_GRID_SIZE = 4
const MAX_IMAGES_PER_PRODUCT = 18
let cachedIndex = null
let refreshPromise = null
const decodedFeatureCache = new WeakMap()

function decodeImageData(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('请选择有效的 PNG、JPG 或 WebP 图片')
  const buffer = Buffer.from(match[1], 'base64')
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('识别图片需小于 8MB')
  return buffer
}

function safeLocalPath(baseDir, relativePath) {
  const base = resolve(baseDir)
  const filePath = resolve(baseDir, relativePath)
  if (filePath !== base && !filePath.startsWith(`${base}${sep}`)) throw new Error('图片路径无效')
  return filePath
}

async function imageInput(url) {
  if (url.startsWith('/uploads/')) {
    const filePath = safeLocalPath(uploadsDir, url.slice('/uploads/'.length))
    if (!existsSync(filePath)) throw new Error('商品图片文件不存在')
    return filePath
  }
  if (url.startsWith('/images/')) {
    const filePath = safeLocalPath(join(publicDir, 'images'), url.slice('/images/'.length))
    if (!existsSync(filePath)) throw new Error('商品图片文件不存在')
    return filePath
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`商品图片下载失败：${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('商品图片文件过大或为空')
  return buffer
}

function rgbOffset(x, y) {
  return (y * FEATURE_SIZE + x) * 3
}

function greyAt(rgb, x, y) {
  const offset = rgbOffset(
    Math.max(0, Math.min(FEATURE_SIZE - 1, x)),
    Math.max(0, Math.min(FEATURE_SIZE - 1, y))
  )
  return Math.round(rgb[offset] * 0.299 + rgb[offset + 1] * 0.587 + rgb[offset + 2] * 0.114)
}

function normalizedHistogram(counts) {
  const output = Buffer.alloc(counts.length)
  const total = counts.reduce((sum, value) => sum + value, 0)
  if (!total) return output
  for (let index = 0; index < counts.length; index += 1) {
    output[index] = Math.min(255, Math.round(counts[index] / total * 255))
  }
  return output
}

function colourBucket(red, green, blue) {
  return (red >> 6) * 16 + (green >> 6) * 4 + (blue >> 6)
}

function cornerBackground(rgb) {
  const samples = [
    [0, 0], [1, 1], [FEATURE_SIZE - 2, 1], [FEATURE_SIZE - 1, 0],
    [0, FEATURE_SIZE - 1], [1, FEATURE_SIZE - 2],
    [FEATURE_SIZE - 2, FEATURE_SIZE - 2], [FEATURE_SIZE - 1, FEATURE_SIZE - 1]
  ]
  const total = samples.reduce((sum, [x, y]) => {
    const offset = rgbOffset(x, y)
    sum[0] += rgb[offset]
    sum[1] += rgb[offset + 1]
    sum[2] += rgb[offset + 2]
    return sum
  }, [0, 0, 0])
  return total.map(value => value / samples.length)
}

function foregroundStrength(red, green, blue, background, x, y) {
  const distance = Math.sqrt(
    (red - background[0]) ** 2
    + (green - background[1]) ** 2
    + (blue - background[2]) ** 2
  )
  const nearWhite = red > 238 && green > 238 && blue > 238
  const central = x >= FEATURE_SIZE * 0.15
    && x <= FEATURE_SIZE * 0.85
    && y >= FEATURE_SIZE * 0.08
    && y <= FEATURE_SIZE * 0.94
  if (nearWhite && distance < 45) return 0
  if (distance >= 52) return central ? 3 : 2
  if (distance >= 28 && central) return 2
  return central && Math.max(red, green, blue) - Math.min(red, green, blue) >= 32 ? 1 : 0
}

function createLocalPatches(rgb) {
  const positions = [
    [2, 2], [8, 2], [14, 2],
    [2, 8], [8, 8], [14, 8],
    [2, 14], [8, 14], [14, 14]
  ]
  return positions.map(([left, top]) => {
    const greys = Buffer.alloc(PATCH_GRID_SIZE * PATCH_GRID_SIZE)
    const edges = Buffer.alloc(PATCH_GRID_SIZE * PATCH_GRID_SIZE)
    for (let y = 0; y < PATCH_GRID_SIZE; y += 1) {
      for (let x = 0; x < PATCH_GRID_SIZE; x += 1) {
        const sourceX = left + Math.round((x + 0.5) * PATCH_SIZE / PATCH_GRID_SIZE - 0.5)
        const sourceY = top + Math.round((y + 0.5) * PATCH_SIZE / PATCH_GRID_SIZE - 0.5)
        const index = y * PATCH_GRID_SIZE + x
        greys[index] = greyAt(rgb, sourceX, sourceY)
        const horizontal = Math.abs(greyAt(rgb, sourceX + 1, sourceY) - greyAt(rgb, sourceX - 1, sourceY))
        const vertical = Math.abs(greyAt(rgb, sourceX, sourceY + 1) - greyAt(rgb, sourceX, sourceY - 1))
        edges[index] = Math.min(255, horizontal + vertical)
      }
    }
    return Buffer.concat([greys, edges]).toString('base64')
  })
}

export async function createImageFeature(input) {
  const { data, info } = await sharp(input, { failOn: 'none', limitInputPixels: 60_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(FEATURE_SIZE, FEATURE_SIZE, { fit: 'contain', background: '#ffffff' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const rgb = info.channels === 3 ? data : Buffer.from(data)
  const globalCounts = new Array(64).fill(0)
  const foregroundCounts = new Array(64).fill(0)
  const compactRgb = Buffer.alloc(GRID_SIZE * GRID_SIZE * 3)
  const edges = Buffer.alloc(GRID_SIZE * GRID_SIZE)
  const silhouette = Buffer.alloc(GRID_SIZE * GRID_SIZE)
  const hashes = []
  const background = cornerBackground(rgb)

  for (let y = 0; y < FEATURE_SIZE; y += 1) {
    for (let x = 0; x < FEATURE_SIZE; x += 1) {
      const offset = rgbOffset(x, y)
      const red = rgb[offset]
      const green = rgb[offset + 1]
      const blue = rgb[offset + 2]
      globalCounts[colourBucket(red, green, blue)] += 1
      const strength = foregroundStrength(red, green, blue, background, x, y)
      if (strength) foregroundCounts[colourBucket(red, green, blue)] += strength
    }
  }

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const sourceX = x * 2 + 1
      const sourceY = y * 2 + 1
      const source = rgbOffset(sourceX, sourceY)
      const target = (y * GRID_SIZE + x) * 3
      compactRgb[target] = rgb[source]
      compactRgb[target + 1] = rgb[source + 1]
      compactRgb[target + 2] = rgb[source + 2]
      const horizontal = Math.abs(greyAt(rgb, sourceX + 1, sourceY) - greyAt(rgb, sourceX - 1, sourceY))
      const vertical = Math.abs(greyAt(rgb, sourceX, sourceY + 1) - greyAt(rgb, sourceX, sourceY - 1))
      edges[y * GRID_SIZE + x] = Math.min(255, horizontal + vertical)
      const strength = foregroundStrength(rgb[source], rgb[source + 1], rgb[source + 2], background, sourceX, sourceY)
      silhouette[y * GRID_SIZE + x] = strength ? 255 : 0
      hashes.push(greyAt(rgb, sourceX + 1, sourceY) >= greyAt(rgb, sourceX, sourceY) ? '1' : '0')
    }
  }

  return {
    rgb: compactRgb.toString('base64'),
    histogram: normalizedHistogram(globalCounts).toString('base64'),
    foregroundHistogram: normalizedHistogram(foregroundCounts).toString('base64'),
    edges: edges.toString('base64'),
    silhouette: silhouette.toString('base64'),
    hash: hashes.join(''),
    patches: createLocalPatches(rgb)
  }
}

function candidateEntries(product) {
  const entries = new Map()
  const add = (url, role, color = '') => {
    const value = String(url || '').trim()
    if (!value) return
    const current = entries.get(value) || { productId: product.id, url: value, roles: [], colors: [] }
    if (!current.roles.includes(role)) current.roles.push(role)
    if (color && !current.colors.includes(color)) current.colors.push(color)
    entries.set(value, current)
  }

  add(product.posterImage, 'poster')
  for (const url of (product.images || []).slice(0, 4)) add(url, 'main')
  for (const item of (product.realImages || []).slice(0, 5)) add(typeof item === 'string' ? item : item?.url, 'real')
  for (const [color, url] of Object.entries(product.colorImages || {}).slice(0, 6)) add(url, 'color', color)
  for (const url of (product.detailImages || []).slice(0, 3)) add(url, 'detail')
  for (const [color, urls] of Object.entries(product.colorGalleries || {})) {
    for (const url of (Array.isArray(urls) ? urls : []).slice(0, 2)) add(url, 'color', color)
  }

  return [...entries.values()].slice(0, MAX_IMAGES_PER_PRODUCT)
}

function loadIndex() {
  if (cachedIndex) return cachedIndex
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
    cachedIndex = parsed.version === INDEX_VERSION && Array.isArray(parsed.items) ? parsed : { version: INDEX_VERSION, items: [] }
  } catch {
    cachedIndex = { version: INDEX_VERSION, items: [] }
  }
  return cachedIndex
}

export async function buildImageSearchIndex(products, { force = false, onProgress = null } = {}) {
  const current = loadIndex()
  const saved = new Map((current.items || []).map(item => [`${item.productId}|${item.url}`, item]))
  const candidates = products.flatMap(candidateEntries)
  const items = []
  let cursor = 0
  let completed = 0
  const workers = Array.from({ length: 8 }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor]
      cursor += 1
      const key = `${candidate.productId}|${candidate.url}`
      const existing = !force && saved.get(key)
      if (existing) items.push({ ...existing, roles: candidate.roles, colors: candidate.colors })
      else {
        try {
          const input = await imageInput(candidate.url)
          items.push({ ...candidate, feature: await createImageFeature(input) })
        } catch (error) {
          items.push({ ...candidate, error: error.message })
        }
      }
      completed += 1
      if (onProgress) onProgress({ completed, total: candidates.length })
    }
  })
  await Promise.all(workers)
  const result = {
    version: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    weights: { color: 0.30, trademark: 0.22, style: 0.34, overall: 0.14 },
    items: items.filter(item => item.feature)
  }
  const temporaryPath = `${indexPath}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(result))
  renameSync(temporaryPath, indexPath)
  cachedIndex = result
  return result
}

export function ensureImageSearchIndex(products) {
  const expectedKeys = new Set(products.flatMap(candidateEntries).map(item => `${item.productId}|${item.url}`))
  const current = loadIndex()
  const currentKeys = new Set(current.items.map(item => `${item.productId}|${item.url}`))
  if (currentKeys.size === expectedKeys.size && [...expectedKeys].every(key => currentKeys.has(key))) return Promise.resolve(current)
  if (!refreshPromise) refreshPromise = buildImageSearchIndex(products).finally(() => { refreshPromise = null })
  return refreshPromise
}

function bufferSimilarity(left, right) {
  if (left.length !== right.length || !left.length) return 0
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference += Math.abs(left[index] - right[index])
  return Math.max(0, 1 - difference / (left.length * 255))
}

function histogramSimilarity(left, right) {
  if (left.length !== right.length || !left.length) return 0
  let common = 0
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    common += Math.min(left[index], right[index])
    total += Math.max(left[index], right[index])
  }
  return total ? common / total : 1
}

function hashSimilarity(left, right) {
  if (left.length !== right.length || !left.length) return 0
  let equal = 0
  for (let index = 0; index < left.length; index += 1) if (left[index] === right[index]) equal += 1
  return equal / left.length
}

function decodeFeature(feature) {
  const cached = decodedFeatureCache.get(feature)
  if (cached) return cached
  const decoded = {
    rgb: Buffer.from(feature.rgb, 'base64'),
    histogram: Buffer.from(feature.histogram, 'base64'),
    foregroundHistogram: Buffer.from(feature.foregroundHistogram, 'base64'),
    edges: Buffer.from(feature.edges, 'base64'),
    silhouette: Buffer.from(feature.silhouette, 'base64'),
    hash: feature.hash,
    patches: (feature.patches || []).map(value => Buffer.from(value, 'base64'))
  }
  decodedFeatureCache.set(feature, decoded)
  return decoded
}

function patchSimilarity(leftPatches = [], rightPatches = []) {
  if (!leftPatches.length || !rightPatches.length) return 0
  const bestForEachQueryPatch = leftPatches.map(left => {
    const split = left.length / 2
    let best = 0
    for (const right of rightPatches) {
      if (right.length !== left.length) continue
      const grey = bufferSimilarity(left.subarray(0, split), right.subarray(0, split))
      const edges = bufferSimilarity(left.subarray(split), right.subarray(split))
      best = Math.max(best, grey * 0.35 + edges * 0.65)
    }
    return best
  }).sort((left, right) => right - left)
  return bestForEachQueryPatch.slice(0, 2).reduce((sum, value) => sum + value, 0) / Math.min(2, bestForEachQueryPatch.length)
}

function featureSimilarity(left, right) {
  const leftDecoded = decodeFeature(left)
  const rightDecoded = decodeFeature(right)
  const color = histogramSimilarity(leftDecoded.foregroundHistogram, rightDecoded.foregroundHistogram)
  const trademark = patchSimilarity(leftDecoded.patches, rightDecoded.patches)
  const silhouette = bufferSimilarity(leftDecoded.silhouette, rightDecoded.silhouette)
  const edges = bufferSimilarity(leftDecoded.edges, rightDecoded.edges)
  const shape = hashSimilarity(leftDecoded.hash, rightDecoded.hash)
  const histogram = histogramSimilarity(leftDecoded.histogram, rightDecoded.histogram)
  const overall = bufferSimilarity(leftDecoded.rgb, rightDecoded.rgb)
  const style = silhouette * 0.41 + edges * 0.35 + shape * 0.24
  const score = color * 0.30 + trademark * 0.22 + style * 0.34 + (histogram * 0.57 + overall * 0.43) * 0.14
  return { score, color, trademark, style }
}

async function recognizeProductImageLegacy(buffer, products, limit = 12) {
  const queryFeature = await createImageFeature(buffer)
  const index = await ensureImageSearchIndex(products)
  if (!index.items.length) throw new Error('商品图片识别索引为空，请先为商品上传图片')
  const productById = new Map(products.map(product => [Number(product.id), product]))
  const matchesByProduct = new Map()
  for (const item of index.items) {
    const product = productById.get(Number(item.productId))
    if (!product) continue
    const similarity = featureSimilarity(queryFeature, item.feature)
    const matches = matchesByProduct.get(product.id) || []
    matches.push({ ...similarity, matchedImage: item.url, roles: item.roles || [], colors: item.colors || [] })
    matchesByProduct.set(product.id, matches)
  }
  return [...matchesByProduct].map(([productId, matches]) => {
    const product = productById.get(Number(productId))
    matches.sort((left, right) => right.score - left.score)
    const best = matches[0]
    return { product, best, score: best.score }
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(30, Number(limit) || 12)))
    .map(item => ({
      id: item.product.id,
      name: item.product.name,
      code: item.product.code,
      category: item.product.category,
      categories: item.product.categories || [],
      image: item.best.matchedImage || item.product.images?.[0] || '',
      score: Number(item.score.toFixed(4)),
      confidence: Math.round(item.best.score * 100),
      matchedColor: item.best.colors[0] || '',
      referenceType: item.best.roles[0] || '',
      basis: {
        trademark: Math.round(item.best.trademark * 100),
        color: Math.round(item.best.color * 100),
        style: Math.round(item.best.style * 100)
      }
    }))
}

function visualCandidates(products) {
  return products.flatMap(candidateEntries)
}

export function buildVisualImageSearchIndex(products, options = {}) {
  return buildVisualEmbeddingIndex(visualCandidates(products), imageInput, options)
}

export function ensureVisualImageSearchIndex(products) {
  return ensureVisualEmbeddingIndex(visualCandidates(products), imageInput)
}

export async function recognizeProductImage(dataUrl, products, limit = 12) {
  const buffer = decodeImageData(dataUrl)
  try {
    const visualMatches = await retrieveVisualEmbeddingProducts(buffer, products, Math.max(10, Number(limit) || 12))
    if (visualMatches?.length) {
      void ensureVisualImageSearchIndex(products)
      return visualMatches.slice(0, Math.max(1, Math.min(30, Number(limit) || 12)))
    }
  } catch (error) {
    console.warn(`百炼视觉向量检索已降级为传统检索：${error.message}`)
  }
  void ensureVisualImageSearchIndex(products)
  return recognizeProductImageLegacy(buffer, products, limit)
}
