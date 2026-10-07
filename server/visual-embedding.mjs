import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const serverDir = fileURLToPath(new URL('.', import.meta.url))
const dataDir = resolve(process.env.DATA_DIR || join(serverDir, 'data'))
const indexPath = resolve(process.env.VISUAL_EMBEDDING_INDEX_PATH || join(dataDir, 'visual-embedding-index.json'))
const baseUrl = String(process.env.VISUAL_EMBEDDING_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding').trim()
const apiKey = String(process.env.VISUAL_EMBEDDING_API_KEY || '').trim()
const model = String(process.env.VISUAL_EMBEDDING_MODEL || 'qwen3-vl-embedding').trim()
const dimensions = [256, 512, 768, 1024, 1536, 2048, 2560].includes(Number(process.env.VISUAL_EMBEDDING_DIMENSIONS))
  ? Number(process.env.VISUAL_EMBEDDING_DIMENSIONS)
  : 512
const batchSize = Math.max(1, Math.min(10, Number(process.env.VISUAL_EMBEDDING_BATCH_SIZE) || 10))
const imageSize = Math.max(224, Math.min(768, Number(process.env.VISUAL_EMBEDDING_IMAGE_SIZE) || 448))
const timeoutMs = Math.max(15_000, Math.min(120_000, Number(process.env.VISUAL_EMBEDDING_TIMEOUT_MS) || 60_000))
const instruction = String(process.env.VISUAL_EMBEDDING_INSTRUCTION || 'Retrieve the exact same clothing product despite different backgrounds, lighting, poses, occlusion, and camera angles.').trim()
const INDEX_VERSION = 1
const cacheTtlMs = 5 * 60 * 1000
const queryCache = new Map()
let cachedIndex = null
let refreshPromise = null

function configured() {
  return Boolean(baseUrl && apiKey && model)
}

function candidateKey(candidate) {
  return `${Number(candidate.productId)}|${String(candidate.url || '')}`
}

function metadataSignature(candidate) {
  return JSON.stringify([candidateKey(candidate), candidate.roles || [], candidate.colors || []])
}

function emptyIndex() {
  return {
    version: INDEX_VERSION,
    model,
    dimensions,
    generatedAt: '',
    items: [],
    vectors: '',
    vectorBuffer: Buffer.alloc(0)
  }
}

function loadIndex() {
  if (cachedIndex) return cachedIndex
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
    const vectorBuffer = Buffer.from(String(parsed.vectors || ''), 'base64')
    if (
      parsed.version !== INDEX_VERSION
      || parsed.model !== model
      || parsed.dimensions !== dimensions
      || !Array.isArray(parsed.items)
      || vectorBuffer.length !== parsed.items.length * dimensions
    ) throw new Error('视觉向量索引格式不兼容')
    cachedIndex = { ...parsed, vectorBuffer }
    void warmHubValues(cachedIndex)
  } catch {
    cachedIndex = emptyIndex()
  }
  return cachedIndex
}

export function normalizeEmbedding(values, expectedDimensions = dimensions) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) throw new Error('向量数据无效')
  if (values.length !== expectedDimensions) throw new Error(`向量维度不正确：${values.length}`)
  let squared = 0
  const output = new Float32Array(expectedDimensions)
  for (let index = 0; index < expectedDimensions; index += 1) {
    const value = Number(values[index])
    if (!Number.isFinite(value)) throw new Error('向量包含无效数值')
    output[index] = value
    squared += value * value
  }
  const divisor = Math.sqrt(squared)
  if (!divisor) throw new Error('向量长度为零')
  for (let index = 0; index < expectedDimensions; index += 1) output[index] /= divisor
  return output
}

export function parseDashScopeEmbeddingResponse(payload, expectedCount, expectedDimensions = dimensions) {
  const rows = payload?.output?.embeddings
  if (!Array.isArray(rows) || rows.length !== expectedCount) throw new Error('百炼未返回完整图片向量')
  return [...rows]
    .sort((left, right) => Number(left.index) - Number(right.index))
    .map(row => normalizeEmbedding(row.embedding, expectedDimensions))
}

export function quantizeEmbedding(vector) {
  const output = Buffer.alloc(vector.length)
  for (let index = 0; index < vector.length; index += 1) {
    output.writeInt8(Math.max(-127, Math.min(127, Math.round(vector[index] * 127))), index)
  }
  return output
}

export function quantizedCosine(query, buffer, offset = 0) {
  let score = 0
  for (let index = 0; index < query.length; index += 1) score += query[index] * buffer.readInt8(offset + index) / 127
  return Math.max(-1, Math.min(1, score))
}

async function compactImageDataUri(input) {
  const buffer = await sharp(input, { failOn: 'none', limitInputPixels: 60_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: imageSize, height: imageSize, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, chromaSubsampling: '4:2:0' })
    .toBuffer()
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function requestEmbeddings(images, attempt = 0) {
  if (!configured()) throw new Error('百炼视觉向量接口未配置')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        input: { contents: images.map(image => ({ image })) },
        parameters: {
          dimension: dimensions,
          instruct: instruction,
          enable_fusion: false
        }
      })
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = String(payload?.message || payload?.code || '').slice(0, 160)
      const error = new Error(`百炼视觉向量接口返回 HTTP ${response.status}：${detail}`)
      error.retryable = response.status === 429 || response.status >= 500
      error.globalFailure = response.status === 401
        || response.status === 403
        || /access denied|overdue|arrear|invalid.?api.?key|account is not in good standing/iu.test(detail)
      throw error
    }
    return parseDashScopeEmbeddingResponse(payload, images.length)
  } catch (error) {
    const retryable = error?.name === 'AbortError' || error?.retryable
    if (retryable && attempt < 2) {
      await wait(700 * (attempt + 1))
      return requestEmbeddings(images, attempt + 1)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function compactInputs(inputs) {
  const output = []
  for (let cursor = 0; cursor < inputs.length; cursor += 3) {
    output.push(...await Promise.all(inputs.slice(cursor, cursor + 3).map(compactImageDataUri)))
  }
  return output
}

async function embedInputs(inputs) {
  return requestEmbeddings(await compactInputs(inputs))
}

async function embedBatchWithFallback(entries) {
  if (!entries.length) return []
  try {
    const vectors = await embedInputs(entries.map(entry => entry.input))
    return entries.map((entry, index) => ({ candidate: entry.candidate, vector: vectors[index] }))
  } catch (error) {
    if (error?.globalFailure) throw error
    if (entries.length === 1) {
      console.warn(`商品图片向量生成失败：${entries[0].candidate.url}（${error.message}）`)
      return []
    }
    const middle = Math.ceil(entries.length / 2)
    return [
      ...await embedBatchWithFallback(entries.slice(0, middle)),
      ...await embedBatchWithFallback(entries.slice(middle))
    ]
  }
}

function uniqueCandidates(candidates) {
  const seen = new Set()
  return candidates.filter(candidate => {
    const key = candidateKey(candidate)
    if (!candidate.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function persistIndex(candidates, vectorsByKey) {
  const items = []
  const vectorBuffers = []
  for (const candidate of candidates) {
    const vector = vectorsByKey.get(candidateKey(candidate))
    if (!vector) continue
    items.push({
      productId: Number(candidate.productId),
      url: candidate.url,
      roles: candidate.roles || [],
      colors: candidate.colors || []
    })
    vectorBuffers.push(vector)
  }
  const vectorBuffer = Buffer.concat(vectorBuffers)
  const result = {
    version: INDEX_VERSION,
    model,
    dimensions,
    generatedAt: new Date().toISOString(),
    items,
    vectors: vectorBuffer.toString('base64')
  }
  writeFileSync(`${indexPath}.tmp`, JSON.stringify(result))
  renameSync(`${indexPath}.tmp`, indexPath)
  cachedIndex = { ...result, vectorBuffer }
  return cachedIndex
}

export async function buildVisualEmbeddingIndex(candidates, imageLoader, { force = false, onProgress = null } = {}) {
  if (!configured()) throw new Error('百炼视觉向量接口未配置')
  const expected = uniqueCandidates(candidates)
  const current = loadIndex()
  const savedOffsets = new Map(current.items.map((item, index) => [candidateKey(item), index * dimensions]))
  const vectorsByKey = new Map()
  const pending = []

  for (const candidate of expected) {
    const key = candidateKey(candidate)
    const savedOffset = !force ? savedOffsets.get(key) : undefined
    if (savedOffset !== undefined) {
      vectorsByKey.set(key, Buffer.from(current.vectorBuffer.subarray(savedOffset, savedOffset + dimensions)))
    } else {
      pending.push(candidate)
    }
  }

  const reused = expected.length - pending.length
  let completed = reused
  onProgress?.({ completed, total: expected.length, reused })
  for (let cursor = 0; cursor < pending.length; cursor += batchSize) {
    const batch = pending.slice(cursor, cursor + batchSize)
    const savedCount = vectorsByKey.size
    const entries = []
    for (const candidate of batch) {
      try {
        entries.push({ candidate, input: await imageLoader(candidate.url) })
      } catch (error) {
        console.warn(`商品图片读取失败：${candidate.url}（${error.message}）`)
      }
    }
    const embedded = await embedBatchWithFallback(entries)
    for (const result of embedded) {
      vectorsByKey.set(candidateKey(result.candidate), quantizeEmbedding(result.vector))
    }
    // Persist every paid batch so an interruption can resume without regenerating it.
    if (vectorsByKey.size > savedCount) persistIndex(expected, vectorsByKey)
    completed += batch.length
    onProgress?.({ completed, total: expected.length, reused })
  }

  if (pending.length && vectorsByKey.size === reused) {
    throw new Error('没有生成任何新的视觉向量，已保留原索引')
  }

  const built = persistIndex(expected, vectorsByKey)
  void warmHubValues(built)
  return built
}

export function ensureVisualEmbeddingIndex(candidates, imageLoader) {
  if (!configured()) return Promise.resolve(loadIndex())
  const expected = uniqueCandidates(candidates)
  const current = loadIndex()
  const currentMetadata = new Set(current.items.map(metadataSignature))
  const upToDate = current.items.length === expected.length
    && expected.every(candidate => currentMetadata.has(metadataSignature(candidate)))
  if (upToDate) return Promise.resolve(current)
  if (!refreshPromise) {
    refreshPromise = buildVisualEmbeddingIndex(expected, imageLoader)
      .catch(error => {
        console.warn(`视觉向量索引更新失败：${error.message}`)
        return loadIndex()
      })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

function cachedQuery(key) {
  const entry = queryCache.get(key)
  if (!entry || Date.now() - entry.savedAt > cacheTtlMs) {
    queryCache.delete(key)
    return null
  }
  return entry.vector
}

async function queryEmbedding(input) {
  const key = createHash('sha256').update(input).digest('hex')
  const saved = cachedQuery(key)
  if (saved) return saved
  const [vector] = await embedInputs([input])
  queryCache.set(key, { savedAt: Date.now(), vector })
  while (queryCache.size > 100) queryCache.delete(queryCache.keys().next().value)
  return vector
}

// Hubness correction. Some pictures resemble many other products' pictures (warehouse
// shots share background and lighting, plain garments look alike), so they top the
// ranking for unrelated queries. A picture's "hub" value is its mean similarity to its
// closest pictures of other products; it is subtracted from the query similarity, and
// warehouse photos get a small extra penalty. On the shop's own pictures this nearly
// doubled first-place hits for photos matched against catalog pictures (9.5% -> 17.4%).
const HUB_NEIGHBOURS = 10
const HUB_WEIGHT = 0.75
const REAL_PHOTO_PENALTY = 0.03
// Correcting only each query's closest pictures ranks exactly like correcting all of them.
const HUB_CANDIDATES = 200
const hubPath = indexPath.replace(/\.json$/u, '') + '-hub.json'
let hubIndex = null
let hubValues = null
let hubWarming = null

// Hub values of the current index (NaN = not computed yet), restored from disk when the
// saved values belong to this index.
function hubStore(index) {
  if (hubIndex === index) return hubValues
  hubIndex = index
  hubValues = new Float32Array(index.items.length).fill(Number.NaN)
  try {
    const saved = JSON.parse(readFileSync(hubPath, 'utf8'))
    const buffer = Buffer.from(String(saved.values || ''), 'base64')
    if (saved.generatedAt === index.generatedAt && saved.count === index.items.length && buffer.length === index.items.length * 4) {
      hubValues.set(new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)))
    }
  } catch {}
  return hubValues
}

// Computes every picture's hub value in the background after the index is loaded or
// rebuilt (about a minute of CPU on the server, in small slices so requests are not held
// up) and saves them, so recognitions do not wait for it.
async function warmHubValues(index) {
  if (hubWarming === index || !index.items.length) return
  hubWarming = index
  const values = hubStore(index)
  let computed = 0
  for (let itemIndex = 0; itemIndex < index.items.length; itemIndex += 1) {
    if (hubWarming !== index || cachedIndex !== index) return
    if (Number.isNaN(values[itemIndex])) {
      hubValue(index, itemIndex)
      computed += 1
      if (computed % 5 === 0) await new Promise(resolve => setImmediate(resolve))
    }
  }
  if (computed) {
    try {
      writeFileSync(`${hubPath}.tmp`, JSON.stringify({
        generatedAt: index.generatedAt,
        count: index.items.length,
        values: Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64')
      }))
      renameSync(`${hubPath}.tmp`, hubPath)
    } catch (error) {
      console.warn(`视觉向量校正值保存失败：${error.message}`)
    }
  }
  if (hubWarming === index) hubWarming = null
}

function hubValue(index, itemIndex) {
  const values = hubStore(index)
  if (!Number.isNaN(values[itemIndex])) return values[itemIndex]
  const vectors = new Int8Array(index.vectorBuffer.buffer, index.vectorBuffer.byteOffset, index.vectorBuffer.length)
  const productId = index.items[itemIndex].productId
  const own = itemIndex * dimensions
  const closest = []
  for (let other = 0; other < index.items.length; other += 1) {
    if (index.items[other].productId === productId) continue
    const offset = other * dimensions
    let sum = 0
    for (let d = 0; d < dimensions; d += 1) sum += vectors[own + d] * vectors[offset + d]
    const similarity = sum / (127 * 127)
    if (closest.length < HUB_NEIGHBOURS) {
      closest.push(similarity)
      if (closest.length === HUB_NEIGHBOURS) closest.sort((left, right) => left - right)
    } else if (similarity > closest[0]) {
      closest[0] = similarity
      closest.sort((left, right) => left - right)
    }
  }
  const value = closest.length ? closest.reduce((total, similarity) => total + similarity, 0) / closest.length : 0
  values[itemIndex] = value
  return value
}

// Products ranked for a query vector: cosine to every indexed picture of the given products,
// the hubness correction for the closest ones, then each product's best picture.
// `keep(item, itemIndex, cosine)` can leave pictures out (the recognition evaluation leaves
// out the query picture and its copies); `correct: false` gives the plain cosine ranking.
export async function rankProductsForVector(query, productIds, { keep = () => true, correct = true } = {}) {
  const index = loadIndex()
  const scored = []
  index.items.forEach((item, itemIndex) => {
    if (!productIds.has(Number(item.productId))) return
    const cosine = quantizedCosine(query, index.vectorBuffer, itemIndex * dimensions)
    if (keep(item, itemIndex, cosine)) scored.push({ item, itemIndex, cosine })
  })
  scored.sort((left, right) => right.cosine - left.cosine)
  const corrected = correct ? Math.min(HUB_CANDIDATES, scored.length) : 0
  // Each uncached hub value scans the whole index; yield now and then so a cold cache does
  // not hold up other requests.
  for (let position = 0; position < corrected; position += 1) {
    if (position % 10 === 9) await new Promise(resolve => setImmediate(resolve))
    scored[position].hub = hubValue(index, scored[position].itemIndex)
  }
  const bestByProduct = new Map()
  scored.forEach((entry, position) => {
    // Pictures beyond the corrected ones keep their cosine order, below all corrected ones.
    const score = position < corrected
      ? entry.cosine - HUB_WEIGHT * entry.hub - (entry.item.roles?.includes('real') ? REAL_PHOTO_PENALTY : 0)
      : entry.cosine - (correct ? 10 : 0)
    const productId = Number(entry.item.productId)
    const current = bestByProduct.get(productId)
    if (!current || score > current.score) bestByProduct.set(productId, { ...entry, productId, score })
  })
  return [...bestByProduct.values()].sort((left, right) => right.score - left.score)
}

// The indexed pictures with their vectors, for the recognition evaluation script.
export function indexedPictures() {
  const index = loadIndex()
  return index.items.map((item, itemIndex) => ({
    ...item,
    itemIndex,
    vector: () => normalizeEmbedding(Array.from(index.vectorBuffer.subarray(itemIndex * dimensions, (itemIndex + 1) * dimensions), value => (value > 127 ? value - 256 : value) / 127))
  }))
}

export async function retrieveVisualEmbeddingProducts(input, products, limit = 30) {
  const index = loadIndex()
  if (!configured() || !index.items.length) return null
  const query = await queryEmbedding(input)
  const productById = new Map(products.map(product => [Number(product.id), product]))
  const ranked = await rankProductsForVector(query, new Set(productById.keys()))
  return ranked
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 30)))
    .map(entry => ({ ...entry, product: productById.get(entry.productId) }))
    .map(({ item, product, cosine, score }) => ({
      id: product.id,
      name: product.name,
      code: product.code,
      category: product.category,
      categories: product.categories || [],
      image: item.url || product.images?.[0] || '',
      score: Number(cosine.toFixed(4)),
      // Ranking score after the correction; the lead of the first product over the second
      // decides whether the vision review is asked.
      retrievalScore: Number(score.toFixed(4)),
      confidence: Math.max(0, Math.min(100, Math.round((cosine + 1) * 50))),
      matchedColor: item.colors?.[0] || '',
      referenceType: item.roles?.[0] || '',
      recognitionMethod: 'qwen3-vl-embedding',
      basis: { embedding: Math.round(cosine * 100) }
    }))
}

export function visualEmbeddingStatus() {
  const index = loadIndex()
  return {
    configured: configured(),
    model: configured() ? model : '',
    dimensions,
    indexedImages: index.items.length,
    generatedAt: index.generatedAt,
    refreshing: Boolean(refreshPromise),
    indexPresent: existsSync(indexPath)
  }
}
