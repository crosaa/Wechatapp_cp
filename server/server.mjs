import { createServer } from 'node:http'
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import XLSX from 'xlsx'
import { ensureImageSearchIndex, recognizeProductImage } from './image-recognition.mjs'
import {
  createAdminUser,
  createCategory,
  createProduct,
  deleteAdminUser,
  deleteCategory,
  deleteInventoryProductMapping,
  deleteProduct,
  ensureBootstrapAdmin,
  getAdminUserById,
  getAdminUserByUsername,
  getProduct,
  getStoreSettings,
  importInventory,
  importWarehouseInventory,
  listAdminUsers,
  listCategories,
  listInventoryImportMatches,
  listInventoryProductMappings,
  listProducts,
  recordAdminUserLogin,
  reorderCategories,
  reorderCategoryProducts,
  reorderProducts,
  upsertInventoryProductMapping,
  updateAdminUserPassword,
  updateCategory,
  updateProduct,
  updateStoreSettings
} from './db.mjs'
import { createUnmatchedInventoryReport } from './unmatched-inventory-report.mjs'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const publicDir = join(rootDir, 'public')
const uploadsDir = resolve(process.env.UPLOADS_DIR || join(rootDir, 'uploads'))
const thumbnailsDir = join(uploadsDir, '.thumbnails')
const inventoryReportsDir = resolve(process.env.INVENTORY_REPORTS_DIR || join(rootDir, 'inventory-reports'))
const latestInventoryReviewPath = join(inventoryReportsDir, '.latest-inventory-import.json')
mkdirSync(uploadsDir, { recursive: true })
mkdirSync(thumbnailsDir, { recursive: true })
mkdirSync(inventoryReportsDir, { recursive: true })

const port = Number(process.env.PORT || 3000)
const bootstrapAdminUsername = process.env.ADMIN_USERNAME || 'admin'
const bootstrapAdminPassword = process.env.ADMIN_PASSWORD || 'admin123'
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex')
const sessions = new Map()
const sessionMaxAge = 8 * 60 * 60 * 1000
const loginAttempts = new Map()
const loginWindowMs = 15 * 60 * 1000
const loginBlockMs = 15 * 60 * 1000
const loginAccountFailureLimit = 5
const loginIpFailureLimit = 30
const publicDataInstanceId = randomUUID()
let publicDataRevision = 1
let publicProductSummaryCacheVersion = ''
const publicProductSummaryCache = new Map()
let versionedDataCacheVersion = ''
const versionedDataCache = new Map()

function publicDataVersion() {
  return `${publicDataInstanceId}:${publicDataRevision}`
}

function markPublicDataChanged() {
  publicDataRevision += 1
  publicProductSummaryCache.clear()
  publicProductSummaryCacheVersion = publicDataVersion()
  versionedDataCache.clear()
  versionedDataCacheVersion = publicDataVersion()
  return publicDataVersion()
}

function cachedVersionedData(key, loader) {
  const version = publicDataVersion()
  if (versionedDataCacheVersion !== version) {
    versionedDataCache.clear()
    versionedDataCacheVersion = version
  }
  if (versionedDataCache.has(key)) return versionedDataCache.get(key)
  const value = loader()
  versionedDataCache.set(key, value)
  if (versionedDataCache.size > 160) {
    versionedDataCache.delete(versionedDataCache.keys().next().value)
  }
  return value
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders
  })
  res.end(JSON.stringify(body))
}

const publicJsonHeaders = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store'
}

const publicSettingsHeaders = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store'
}

const thumbnailTasks = new Map()
const imageMetadataCache = new Map()

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
    return paths
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUploadPaths(item, paths)
    return paths
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUploadPaths(item, paths)
  }
  return paths
}

function referencedUploadPaths() {
  const paths = new Set()
  collectUploadPaths(listProducts(), paths)
  collectUploadPaths(listCategories(), paths)
  collectUploadPaths(getStoreSettings(), paths)
  return paths
}

function deleteUploadFile(uploadPath) {
  const normalizedPath = uploadPathFromValue(uploadPath)
  if (!normalizedPath) return false
  const relative = normalizedPath.slice('/uploads/'.length)
  const filePath = resolve(uploadsDir, relative)
  if ((!filePath.startsWith(`${uploadsDir}${sep}`) && filePath !== uploadsDir) || !existsSync(filePath) || !statSync(filePath).isFile()) return false
  unlinkSync(filePath)
  const thumbnailHash = createHash('sha1').update(relative).digest('hex')
  for (const thumbnailName of readdirSync(thumbnailsDir)) {
    if (thumbnailName === `${thumbnailHash}.webp` || thumbnailName.startsWith(`${thumbnailHash}-`)) {
      const thumbnailPath = join(thumbnailsDir, thumbnailName)
      if (existsSync(thumbnailPath)) unlinkSync(thumbnailPath)
    }
  }
  return true
}

function cleanupRemovedUploadReferences(previousValue) {
  const candidates = collectUploadPaths(previousValue)
  if (!candidates.size) return 0
  const referenced = referencedUploadPaths()
  let removed = 0
  for (const uploadPath of candidates) {
    if (!referenced.has(uploadPath) && deleteUploadFile(uploadPath)) removed += 1
  }
  return removed
}

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '')
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, entry] of loginAttempts) {
    const latest = Math.max(entry.windowStartedAt || 0, entry.blockedUntil || 0)
    if (now - latest > loginWindowMs + loginBlockMs) loginAttempts.delete(key)
  }
}

function loginAttemptState(key, limit, now = Date.now()) {
  let entry = loginAttempts.get(key)
  if (!entry || now - entry.windowStartedAt >= loginWindowMs || (entry.blockedUntil > 0 && entry.blockedUntil <= now)) {
    entry = { failures: 0, windowStartedAt: now, blockedUntil: 0 }
    loginAttempts.set(key, entry)
  }
  return entry
}

function loginRetryAfterSeconds(req, username) {
  const now = Date.now()
  pruneLoginAttempts(now)
  const ip = requestIp(req)
  const account = loginAttemptState(`account:${ip}:${String(username || '').toLowerCase()}`, loginAccountFailureLimit, now)
  const aggregate = loginAttemptState(`ip:${ip}`, loginIpFailureLimit, now)
  return Math.max(0, Math.ceil((Math.max(account.blockedUntil, aggregate.blockedUntil) - now) / 1000))
}

function recordLoginFailure(req, username) {
  const now = Date.now()
  const ip = requestIp(req)
  for (const [key, limit] of [
    [`account:${ip}:${String(username || '').toLowerCase()}`, loginAccountFailureLimit],
    [`ip:${ip}`, loginIpFailureLimit]
  ]) {
    const entry = loginAttemptState(key, limit, now)
    entry.failures += 1
    if (entry.failures >= limit) entry.blockedUntil = now + loginBlockMs
  }
}

function clearLoginAccountFailures(req, username) {
  loginAttempts.delete(`account:${requestIp(req)}:${String(username || '').toLowerCase()}`)
}

function thumbnailSize(value, fallback = 360) {
  const parsed = Number(value)
  return [160, 200, 240, 320, 360, 480, 640, 960, 1200].includes(parsed) ? parsed : fallback
}

function localUploadPath(sourcePath) {
  const source = String(sourcePath || '')
  if (!source.startsWith('/uploads/')) return null
  const relativeSource = normalize(source.slice('/uploads/'.length)).replace(/^(\.\.[/\\])+/, '')
  const filePath = resolve(uploadsDir, relativeSource)
  if ((!filePath.startsWith(`${uploadsDir}${sep}`) && filePath !== uploadsDir) || !existsSync(filePath)) return null
  return { relativeSource, filePath }
}

function thumbnailFit(value) {
  return String(value || '').toLowerCase() === 'width' ? 'width' : 'inside'
}

async function ensureImageThumbnail(sourcePath, requestedSize = 360, requestedFit = 'inside') {
  const local = localUploadPath(sourcePath)
  if (!local) return null
  const size = thumbnailSize(requestedSize)
  const fit = thumbnailFit(requestedFit)
  const thumbnailName = `${createHash('sha1').update(local.relativeSource).digest('hex')}-${size}-${fit}.webp`
  const thumbnailPath = join(thumbnailsDir, thumbnailName)
  if (!existsSync(thumbnailPath)) {
    let task = thumbnailTasks.get(thumbnailPath)
    if (!task) {
      const resizeOptions = fit === 'width'
        ? { width: size, withoutEnlargement: true }
        : { width: size, height: size, fit: 'inside', withoutEnlargement: true }
      task = sharp(local.filePath)
        .rotate()
        .resize(resizeOptions)
        .webp({ quality: 76, effort: 4 })
        .toFile(thumbnailPath)
        .finally(() => thumbnailTasks.delete(thumbnailPath))
      thumbnailTasks.set(thumbnailPath, task)
    }
    await task
  }
  return thumbnailPath
}

async function serveProductThumbnail(res, sourcePath, requestedSize, requestedFit) {
  const thumbnailPath = await ensureImageThumbnail(sourcePath, requestedSize, requestedFit)
  if (!thumbnailPath) return false
  const content = await readFile(thumbnailPath)
  res.writeHead(200, {
    'content-type': 'image/webp',
    'content-length': content.length,
    'cache-control': 'public, max-age=2592000, immutable',
    'x-content-type-options': 'nosniff'
  })
  res.end(content)
  return true
}

function summarizeProduct(product) {
  const originalImage = Array.isArray(product.images) && product.images.length
    ? product.images[0]
    : (product.image || '')
  const image = originalImage.startsWith('/uploads/')
    ? `/api/product-thumbnail?src=${encodeURIComponent(originalImage)}&size=360`
    : originalImage
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    subtitle: product.subtitle,
    category: product.category,
    categories: Array.isArray(product.categories) ? product.categories : [],
    displayCategory: product.displayCategory,
    price: product.price,
    stock: product.stock,
    unit: product.unit,
    fabric: product.fabric,
    style: product.style,
    fit: product.fit,
    badge: product.badge,
    seasonalNew: Boolean(product.seasonalNew),
    sortOrder: product.sortOrder,
    previewImage: originalImage,
    posterImage: product.posterImage || '',
    image
  }
}

function summarizedProducts(params = {}) {
  const version = publicDataVersion()
  if (publicProductSummaryCacheVersion !== version) {
    publicProductSummaryCache.clear()
    publicProductSummaryCacheVersion = version
  }
  const q = String(params.q || '').trim()
  const category = String(params.category || '').trim()
  const key = `${q}\u0000${category}`
  if (publicProductSummaryCache.has(key)) return publicProductSummaryCache.get(key)
  const data = listProducts({ status: 'published', q, category }).map(summarizeProduct)
  publicProductSummaryCache.set(key, data)
  if (publicProductSummaryCache.size > 80) {
    publicProductSummaryCache.delete(publicProductSummaryCache.keys().next().value)
  }
  return data
}

function publicCategoriesData() {
  return cachedVersionedData('public:categories', () => listCategories().map(category => ({
    ...category,
    image: String(category.image || '').startsWith('/uploads/')
      ? `/api/product-thumbnail?src=${encodeURIComponent(category.image)}&size=200`
      : category.image
  })))
}

function publicStoreSettingsData() {
  return cachedVersionedData('public:store-settings', () => {
    const settings = getStoreSettings()
    const homeHeroImages = Array.isArray(settings.homeHeroImages)
      ? settings.homeHeroImages.map(image => String(image || '').startsWith('/uploads/')
        ? `/api/product-thumbnail?src=${encodeURIComponent(image)}&size=1200`
        : image)
      : []
    return {
      ...settings,
      storeIcon: String(settings.storeIcon || '').startsWith('/uploads/')
        ? `/api/product-thumbnail?src=${encodeURIComponent(settings.storeIcon)}&size=200`
        : settings.storeIcon,
      homeHeroImage: String(settings.homeHeroImage || '').startsWith('/uploads/')
        ? `/api/product-thumbnail?src=${encodeURIComponent(settings.homeHeroImage)}&size=1200`
        : settings.homeHeroImage,
      homeHeroImages
    }
  })
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=')
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function sign(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('hex')
}

function issueSession(user) {
  const id = randomBytes(24).toString('hex')
  sessions.set(id, {
    userId: Number(user.id),
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + sessionMaxAge
  })
  return `${id}.${sign(id)}`
}

function authenticatedAdmin(req) {
  const token = parseCookies(req).yz_admin_session
  if (!token) return null
  const [id, signature] = token.split('.')
  if (!id || !signature || signature.length !== 64) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) return null
  const session = sessions.get(id)
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id)
    return null
  }
  const user = getAdminUserById(session.userId)
  if (!user) {
    sessions.delete(id)
    return null
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    sessionId: id
  }
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return {
    passwordHash: scryptSync(String(password || ''), salt, 64).toString('hex'),
    passwordSalt: salt
  }
}

function securePasswordMatch(candidate, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false
  const actual = Buffer.from(user.passwordHash, 'hex')
  const supplied = scryptSync(String(candidate || ''), user.passwordSalt, 64)
  return actual.length === supplied.length && timingSafeEqual(actual, supplied)
}

function cleanAdminUsername(value) {
  const username = String(value || '').trim()
  const length = Array.from(username).length
  if (!length || length > 32) throw new Error('账号名称不能为空，且不能超过32个字符')
  if (/[\u0000-\u001f\u007f]/u.test(username)) throw new Error('账号名称不能包含控制字符')
  return username
}

function validateAdminPassword(value) {
  const password = String(value || '')
  if (password.length < 6 || password.length > 128) throw new Error('密码至少需要6位')
  return password
}

function publicAdminUser(user) {
  return user ? { id: Number(user.id), username: user.username, role: user.role } : null
}

function revokeAdminSessions(userId, exceptSessionId = '') {
  for (const [sessionId, session] of sessions) {
    if (Number(session.userId) === Number(userId) && sessionId !== exceptSessionId) sessions.delete(sessionId)
  }
}

const bootstrapCredentials = hashPassword(bootstrapAdminPassword)
ensureBootstrapAdmin({
  username: cleanAdminUsername(bootstrapAdminUsername),
  ...bootstrapCredentials
})

async function readJson(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function serveFile(res, baseDir, relativePath, cacheControl = '') {
  const safeRelative = normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
  const filePath = resolve(baseDir, safeRelative)
  if (!filePath.startsWith(resolve(baseDir)) || !existsSync(filePath)) return false
  const content = readFileSync(filePath)
  res.writeHead(200, {
    'content-type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': cacheControl || (extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600'),
    'x-content-type-options': 'nosniff'
  })
  res.end(content)
  return true
}

function serveDownload(res, baseDir, relativePath) {
  const safeRelative = normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
  const resolvedBase = resolve(baseDir)
  const filePath = resolve(baseDir, safeRelative)
  if ((!filePath.startsWith(`${resolvedBase}${sep}`) && filePath !== resolvedBase) || !existsSync(filePath)) return false
  const content = readFileSync(filePath)
  res.writeHead(200, {
    'content-type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeRelative)}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(content)
  return true
}

function latestInventoryReport() {
  return readdirSync(inventoryReportsDir)
    .filter(fileName => fileName.toLowerCase().endsWith('.xlsx'))
    .map(fileName => ({ fileName, modifiedAt: statSync(join(inventoryReportsDir, fileName)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.fileName || ''
}

function writeLatestInventoryReview({ rows = [], format = '', sourceFileName = '', report = null }) {
  const generatedAt = new Date().toISOString()
  const data = {
    version: 1,
    format: format === 'warehouse' ? 'warehouse' : 'template',
    sourceFileName: String(sourceFileName || '').slice(0, 300),
    generatedAt,
    reportFileName: report?.fileName || '',
    rows: Array.isArray(rows) ? rows : []
  }
  const temporaryPath = `${latestInventoryReviewPath}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(data))
  renameSync(temporaryPath, latestInventoryReviewPath)
  return data
}

function latestInventoryReview() {
  if (existsSync(latestInventoryReviewPath)) {
    try {
      const saved = JSON.parse(readFileSync(latestInventoryReviewPath, 'utf8'))
      const rows = Array.isArray(saved.rows) ? saved.rows : []
      return {
        fileName: saved.reportFileName || '',
        downloadUrl: saved.reportFileName ? `/api/admin/inventory/reports/${encodeURIComponent(saved.reportFileName)}` : '',
        sourceFileName: saved.sourceFileName || '',
        sourceFormat: saved.format === 'warehouse' ? '大库统计表' : '简洁模板',
        generatedAt: saved.generatedAt || '',
        total: rows.length,
        rows
      }
    } catch {}
  }
  const fileName = latestInventoryReport()
  return fileName ? inventoryReportDetails(fileName) : null
}

function inventoryReportDetails(fileName) {
  const filePath = resolve(inventoryReportsDir, fileName)
  const resolvedBase = resolve(inventoryReportsDir)
  if ((!filePath.startsWith(`${resolvedBase}${sep}`) && filePath !== resolvedBase) || !existsSync(filePath)) return null
  const workbook = XLSX.read(readFileSync(filePath), { type: 'buffer' })
  const noteSheet = workbook.Sheets['导入说明']
  const detailSheet = workbook.Sheets['未匹配产品']
  if (!detailSheet) return null
  const noteRows = noteSheet ? XLSX.utils.sheet_to_json(noteSheet, { header: 1, defval: '', raw: true }) : []
  const notes = Object.fromEntries(noteRows.slice(1).filter(row => row[0]).map(row => [String(row[0]).trim(), row[1]]))
  const rows = XLSX.utils.sheet_to_json(detailSheet, { defval: '', raw: true }).map(row => ({
    sourceType: row['来源类型'],
    rowNumber: row['来源行号'],
    location: row['货位'],
    code: row['款号'],
    name: row['商品名称'],
    color: row['颜色'],
    size: row['尺码/型号'],
    quantity: row['库存数量'],
    internalCode: row['来源内部编码'],
    reason: row['未匹配原因'],
    candidateCode: row['候选款号'],
    candidateName: row['候选商品'],
    productColors: row['商品现有颜色'],
    productSizes: row['商品现有尺码'],
  }))
  return {
    fileName,
    downloadUrl: `/api/admin/inventory/reports/${encodeURIComponent(fileName)}`,
    sourceFileName: notes['来源文件'] || '',
    sourceFormat: notes['来源格式'] || '',
    generatedAt: notes['生成时间'] || '',
    total: rows.length,
    rows,
  }
}

function cleanInventorySource(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function inventoryMappingKey(sourceName, sourceInternalCode) {
  return `${cleanInventorySource(sourceName)}\u0000${cleanInventorySource(sourceInternalCode)}`
}

function inventoryMappingSources(details, mappings, matches) {
  const mappingByKey = new Map(mappings.map(mapping => [
    inventoryMappingKey(mapping.sourceName, mapping.sourceInternalCode),
    mapping
  ]))
  const matchesByKey = new Map()
  for (const match of matches) {
    const key = inventoryMappingKey(match.sourceName, match.sourceInternalCode)
    if (!matchesByKey.has(key)) matchesByKey.set(key, [])
    matchesByKey.get(key).push(match)
  }
  const grouped = new Map()
  for (const row of details?.rows || []) {
    const sourceName = cleanInventorySource(row.name || row.code)
    const sourceInternalCode = cleanInventorySource(row.internalCode)
    if (!sourceName) continue
    const key = inventoryMappingKey(sourceName, sourceInternalCode)
    if (!grouped.has(key)) {
      grouped.set(key, {
        sourceName,
        sourceInternalCode,
        rowCount: 0,
        totalQuantity: 0,
        reasons: new Set(),
        colors: new Set(),
        sizes: new Set(),
        candidateCode: '',
        candidateName: '',
        productColors: '',
        productSizes: '',
        fromLatestReport: true,
        fromLatestImport: false
      })
    }
    const group = grouped.get(key)
    group.rowCount += 1
    group.totalQuantity += Number(row.quantity) || 0
    if (row.reason) group.reasons.add(String(row.reason))
    if (row.color) group.colors.add(String(row.color))
    if (row.size) group.sizes.add(String(row.size))
    if (!group.candidateName && row.candidateName) {
      group.candidateCode = String(row.candidateCode || '')
      group.candidateName = String(row.candidateName)
      group.productColors = String(row.productColors || '')
      group.productSizes = String(row.productSizes || '')
    }
  }
  for (const match of matches) {
    const key = inventoryMappingKey(match.sourceName, match.sourceInternalCode)
    if (!grouped.has(key)) {
      grouped.set(key, {
        sourceName: match.sourceName,
        sourceInternalCode: match.sourceInternalCode,
        rowCount: match.sourceRows,
        totalQuantity: match.sourceQuantity,
        reasons: new Set(),
        colors: new Set(match.color ? [match.color] : []),
        sizes: new Set(),
        candidateCode: '',
        candidateName: '',
        productColors: '',
        productSizes: '',
        fromLatestReport: false,
        fromLatestImport: true
      })
    } else {
      grouped.get(key).fromLatestImport = true
    }
  }
  for (const mapping of mappings) {
    const key = inventoryMappingKey(mapping.sourceName, mapping.sourceInternalCode)
    if (!grouped.has(key)) {
      grouped.set(key, {
        sourceName: mapping.sourceName,
        sourceInternalCode: mapping.sourceInternalCode,
        rowCount: 0,
        totalQuantity: 0,
        reasons: new Set(),
        colors: new Set(),
        sizes: new Set(),
        candidateCode: '',
        candidateName: '',
        productColors: '',
        productSizes: '',
        fromLatestReport: false,
        fromLatestImport: false
      })
    }
  }
  return [...grouped.entries()].map(([key, group]) => ({
    ...group,
    reasons: [...group.reasons],
    colors: [...group.colors],
    sizes: [...group.sizes],
    mapping: mappingByKey.get(key) || null,
    matches: matchesByKey.get(key) || []
  })).sort((left, right) => {
    const leftMatched = Boolean(left.mapping || left.matches.length)
    const rightMatched = Boolean(right.mapping || right.matches.length)
    if (leftMatched !== rightMatched) return leftMatched ? 1 : -1
    if (left.fromLatestReport !== right.fromLatestReport) return left.fromLatestReport ? -1 : 1
    return left.sourceName.localeCompare(right.sourceName, 'zh-CN')
  })
}

const uploadedImageLimits = {
  maxInputBytes: 15 * 1024 * 1024,
  maxOutputBytes: 5 * 1024 * 1024
}

const imagePurposeProfiles = {
  general: { maxWidth: 2000, maxHeight: 12000, quality: 85, maxOutputBytes: 5 * 1024 * 1024 },
  category: { maxWidth: 640, maxHeight: 640, quality: 80, maxOutputBytes: 450 * 1024, preferWebp: true },
  icon: { maxWidth: 640, maxHeight: 640, quality: 82, maxOutputBytes: 500 * 1024, preferWebp: true },
  hero: { maxWidth: 1800, maxHeight: 1200, quality: 84, maxOutputBytes: 1600 * 1024 },
  product: { maxWidth: 2000, maxHeight: 2400, quality: 86, maxOutputBytes: 2500 * 1024 },
  poster: { maxWidth: 1800, maxHeight: 2800, quality: 86, maxOutputBytes: 3 * 1024 * 1024 },
  detail: { maxWidth: 1600, maxHeight: 12000, quality: 84, maxOutputBytes: 4 * 1024 * 1024 },
  real: { maxWidth: 1800, maxHeight: 2800, quality: 85, maxOutputBytes: 3 * 1024 * 1024 }
}

function imagePurpose(value) {
  const purpose = String(value || 'general').toLowerCase()
  return imagePurposeProfiles[purpose] ? purpose : 'general'
}

function imageUploadMode(value) {
  return String(value || '').toLowerCase() === 'original' ? 'original' : 'auto'
}

async function optimizeUploadedImage(buffer, options = {}) {
  let metadata
  try {
    metadata = await sharp(buffer, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata()
  } catch {
    throw new Error('图片文件无效或像素过大')
  }
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('仅支持 PNG、JPG 或 WebP 图片')
  }

  const sourceWidth = Number(metadata.width)
  const sourceHeight = Number(metadata.height)
  const purpose = imagePurpose(options.purpose)
  const mode = imageUploadMode(options.mode)
  const profile = imagePurposeProfiles[purpose]
  const sourceExtension = metadata.format === 'jpeg' ? '.jpg' : `.${metadata.format}`

  if (mode === 'original') {
    return {
      buffer,
      extension: sourceExtension,
      metadata: {
        sourceWidth,
        sourceHeight,
        width: sourceWidth,
        height: sourceHeight,
        sourceBytes: buffer.length,
        bytes: buffer.length,
        changed: false,
        mode,
        purpose
      }
    }
  }

  const resizeOptions = {
    width: profile.maxWidth,
    height: profile.maxHeight,
    fit: 'inside',
    withoutEnlargement: true
  }
  const createPipeline = () => sharp(buffer, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate().resize(resizeOptions)

  let extension = profile.preferWebp ? '.webp' : metadata.format === 'png' ? '.png' : metadata.format === 'webp' ? '.webp' : '.jpg'
  let output = profile.preferWebp
    ? await createPipeline().webp({ quality: profile.quality, smartSubsample: true, effort: 4 }).toBuffer()
    : metadata.format === 'png'
    ? await createPipeline().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : metadata.format === 'webp'
      ? await createPipeline().webp({ quality: profile.quality, smartSubsample: true }).toBuffer()
      : await createPipeline().jpeg({ quality: profile.quality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer()

  if (output.length > Math.min(uploadedImageLimits.maxOutputBytes, profile.maxOutputBytes)) {
    output = await createPipeline().webp({ quality: Math.max(68, profile.quality - 8), smartSubsample: true, effort: 4 }).toBuffer()
    extension = '.webp'
  }

  const normalized = await sharp(output).metadata()
  return {
    buffer: output,
    extension,
    metadata: {
      sourceWidth,
      sourceHeight,
      width: Number(normalized.width) || sourceWidth,
      height: Number(normalized.height) || sourceHeight,
      sourceBytes: buffer.length,
      bytes: output.length,
      changed: sourceWidth !== normalized.width
        || sourceHeight !== normalized.height
        || buffer.length !== output.length
        || extension !== sourceExtension,
      mode,
      purpose
    }
  }
}

async function uploadImage(body) {
  const match = String(body.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('仅支持 PNG、JPG 或 WebP 图片')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > uploadedImageLimits.maxInputBytes) throw new Error('单张图片需小于 15MB')
  const purpose = imagePurpose(body.purpose)
  const mode = imageUploadMode(body.mode)
  const optimized = await optimizeUploadedImage(buffer, { purpose, mode })
  const filename = `${Date.now()}-${randomUUID()}${optimized.extension}`
  writeFileSync(join(uploadsDir, filename), optimized.buffer)
  const url = `/uploads/${filename}`
  if (['category', 'icon'].includes(purpose)) await ensureImageThumbnail(url, 200)
  if (purpose === 'hero') await ensureImageThumbnail(url, 1200)
  if (['product', 'poster', 'detail', 'real', 'general'].includes(purpose)) {
    await Promise.all([
      ensureImageThumbnail(url, 360),
      ensureImageThumbnail(url, 1200, 'width')
    ])
  }
  return { url, optimization: optimized.metadata }
}

async function localImageMetadata(source) {
  const imagePath = String(source || '').trim()
  const roots = imagePath.startsWith('/uploads/')
    ? { baseDir: uploadsDir, relativePath: imagePath.slice('/uploads/'.length) }
    : imagePath.startsWith('/images/')
      ? { baseDir: join(publicDir, 'images'), relativePath: imagePath.slice('/images/'.length) }
      : null
  if (!roots) throw new Error('只能读取本服务器图片')
  const baseDir = resolve(roots.baseDir)
  const safeRelative = normalize(roots.relativePath).replace(/^(\.\.[/\\])+/, '')
  const filePath = resolve(baseDir, safeRelative)
  if ((!filePath.startsWith(`${baseDir}${sep}`) && filePath !== baseDir) || !existsSync(filePath)) throw new Error('图片不存在')
  const fileStats = statSync(filePath)
  if (!fileStats.isFile()) throw new Error('图片不存在')
  const cacheKey = `${imagePath}\u0000${fileStats.size}\u0000${fileStats.mtimeMs}`
  if (imageMetadataCache.has(cacheKey)) return imageMetadataCache.get(cacheKey)
  const metadata = await sharp(filePath).metadata()
  if (!metadata.width || !metadata.height) throw new Error('无法读取图片像素')
  const result = {
    width: metadata.width,
    height: metadata.height,
    bytes: fileStats.size,
    format: metadata.format || extname(filePath).slice(1)
  }
  imageMetadataCache.set(cacheKey, result)
  if (imageMetadataCache.size > 2000) {
    imageMetadataCache.delete(imageMetadataCache.keys().next().value)
  }
  return result
}

function isPrivateNetworkAddress(address) {
  const normalized = String(address || '').toLowerCase().replace(/^::ffff:/u, '')
  if (!normalized) return true
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
  }
  if (isIP(normalized) === 6) {
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
  }
  return true
}

async function validateRemoteImageUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('图片链接格式不正确') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('仅支持公开 HTTPS 图片链接')
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('图片链接不能指向本机或内网')
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(item => isPrivateNetworkAddress(item.address))) throw new Error('图片链接不能指向本机或内网')
  return url
}

async function downloadImageToUploads(value, redirectCount = 0, options = {}) {
  const url = await validateRemoteImageUrl(value)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'PurunMiniappImageImporter/1.0' }
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('下载图片超时，请稍后重试')
    throw new Error('无法下载该图片，请确认链接可公开访问')
  } finally {
    clearTimeout(timeout)
  }
  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= 3) throw new Error('图片链接跳转次数过多')
    const location = response.headers.get('location')
    if (!location) throw new Error('图片链接跳转地址无效')
    return downloadImageToUploads(new URL(location, url).href, redirectCount + 1, options)
  }
  if (!response.ok || !response.body) throw new Error(`图片下载失败（HTTP ${response.status}）`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > 15 * 1024 * 1024) throw new Error('单张图片需小于 15MB')

  const chunks = []
  let total = 0
  const reader = response.body.getReader()
  while (true) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    total += chunk.byteLength
    if (total > 15 * 1024 * 1024) {
      await reader.cancel()
      throw new Error('单张图片需小于 15MB')
    }
    chunks.push(Buffer.from(chunk))
  }
  if (!total) throw new Error('下载到的图片为空')
  const buffer = Buffer.concat(chunks)
  const purpose = imagePurpose(options.purpose)
  const mode = imageUploadMode(options.mode)
  const optimized = await optimizeUploadedImage(buffer, { purpose, mode })
  const digest = createHash('sha256').update(optimized.buffer).digest('hex').slice(0, 24)
  const filename = `remote-${digest}${optimized.extension}`
  const filePath = join(uploadsDir, filename)
  if (!existsSync(filePath)) writeFileSync(filePath, optimized.buffer)
  const localUrl = `/uploads/${filename}`
  if (['category', 'icon'].includes(purpose)) await ensureImageThumbnail(localUrl, 200)
  if (purpose === 'hero') await ensureImageThumbnail(localUrl, 1200)
  if (['product', 'poster', 'detail', 'real', 'general'].includes(purpose)) {
    await Promise.all([
      ensureImageThumbnail(localUrl, 360),
      ensureImageThumbnail(localUrl, 1200, 'width')
    ])
  }
  return { url: localUrl, optimization: optimized.metadata }
}

async function parseInventoryWorkbook(body) {
  const match = String(body.dataUrl || '').match(/^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('请选择有效的 .xlsx Excel 文件')
  const buffer = Buffer.from(match[1], 'base64')
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('Excel 文件需小于 5MB')

  let workbook
  try { workbook = XLSX.read(buffer, { type: 'buffer' }) } catch { throw new Error('Excel 文件无法读取，请使用后台提供的模板') }
  if (workbook.SheetNames.includes('库存导入')) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets['库存导入'], { header: 1, defval: '', raw: true })
    const headers = new Map((matrix[0] || []).map((value, index) => [String(value).trim(), index]))
    const codeColumn = headers.get('款号*')
    const locationColumn = headers.get('货位')
    const colorColumn = headers.has('颜色*') ? headers.get('颜色*') : headers.get('颜色')
    const sizeColumn = headers.get('尺码*')
    const quantityColumn = headers.get('库存数量*')
    if (locationColumn === undefined || codeColumn === undefined || sizeColumn === undefined || quantityColumn === undefined) throw new Error('模板表头不正确，请勿修改“货位、款号*、尺码*、库存数量*”')
    if (matrix.length > 5001) throw new Error('简洁模板单次最多导入 5000 行库存')
    const rows = []
    for (let index = 1; index < matrix.length; index += 1) {
      const rowNumber = index + 1
      const row = matrix[index]
      const code = String(row[codeColumn] ?? '').trim()
      const location = String(row[locationColumn] ?? '').trim()
      const color = colorColumn === undefined ? '' : String(row[colorColumn] ?? '').trim()
      const size = String(row[sizeColumn] ?? '').trim()
      const quantityText = String(row[quantityColumn] ?? '').trim().replace(/,/g, '')
      if (!code && !location && !color && !size && !quantityText) continue
      rows.push({ code, location, color, size, quantity: Number(quantityText), rowNumber })
    }
    return { format: 'template', rows }
  }

  const warehouseSheetName = workbook.SheetNames.includes('Sheet1') ? 'Sheet1' : workbook.SheetNames.find(name => {
    const firstRow = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true, range: 0 }).slice(0, 1)[0] || []
    const headers = new Set(firstRow.map(value => String(value).trim()))
    return ['商品名称', '型号', '数量', '产地'].every(header => headers.has(header))
  })
  const warehouseSheet = warehouseSheetName ? workbook.Sheets[warehouseSheetName] : null
  if (!warehouseSheet) throw new Error('无法识别库存表：请使用后台简洁模板，或包含“商品名称、型号、数量、产地”的大库统计表')
  const matrix = XLSX.utils.sheet_to_json(warehouseSheet, { header: 1, defval: '', raw: true })
  const headers = new Map((matrix[0] || []).map((value, index) => [String(value).trim(), index]))
  const nameColumn = headers.get('商品名称')
  const sizeColumn = headers.get('型号')
  const quantityColumn = headers.get('数量')
  const internalCodeColumn = headers.get('产地')
  if ([nameColumn, sizeColumn, quantityColumn, internalCodeColumn].some(index => index === undefined)) throw new Error('大库统计表表头不正确，需要“商品名称、型号、数量、产地”四列')
  if (matrix.length > 20001) throw new Error('大库统计表单次最多导入 20000 行库存')
  const rows = []
  for (let index = 1; index < matrix.length; index += 1) {
    const rowNumber = index + 1
    const row = matrix[index]
    const name = String(row[nameColumn] ?? '').trim()
    const size = String(row[sizeColumn] ?? '').trim()
    const quantityText = String(row[quantityColumn] ?? '').trim().replace(/,/g, '')
    const internalCode = String(row[internalCodeColumn] ?? '').trim()
    if (!name && !size && !quantityText && !internalCode) continue
    rows.push({ name, size, quantity: Number(quantityText), internalCode, rowNumber })
  }
  return { format: 'warehouse', rows }
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type, authorization'
    })
    res.end()
    return true
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    json(res, 200, { ok: true, service: '普润制衣团购仓商品服务', time: new Date().toISOString() }, { 'access-control-allow-origin': '*' })
    return true
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req)
    const username = String(body.username || '').trim()
    const retryAfter = loginRetryAfterSeconds(req, username)
    if (retryAfter > 0) {
      json(res, 429, { error: '登录尝试过于频繁，请稍后再试', retryAfter }, { 'retry-after': String(retryAfter) })
      return true
    }
    const user = getAdminUserByUsername(username)
    if (!user || !securePasswordMatch(body.password, user)) {
      recordLoginFailure(req, username)
      json(res, 401, { error: '管理账号或密码不正确' })
      return true
    }
    clearLoginAccountFailures(req, username)
    recordAdminUserLogin(user.id)
    const token = issueSession(user)
    const secureCookie = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
    json(res, 200, { ok: true, data: publicAdminUser(user) }, {
      'set-cookie': `yz_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAge / 1000}${secureCookie}`
    })
    return true
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req).yz_admin_session || ''
    sessions.delete(token.split('.')[0])
    json(res, 200, { ok: true }, { 'set-cookie': 'yz_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' })
    return true
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = authenticatedAdmin(req)
    if (!user) json(res, 401, { error: '请先登录管理后台' })
    else json(res, 200, { data: publicAdminUser(user) })
    return true
  }

  if (url.pathname === '/api/categories' && req.method === 'GET') {
    json(res, 200, { data: publicCategoriesData() }, publicSettingsHeaders)
    return true
  }

  if (url.pathname === '/api/store-settings' && req.method === 'GET') {
    json(res, 200, { data: publicStoreSettingsData() }, publicSettingsHeaders)
    return true
  }

  if (url.pathname === '/api/home-content' && req.method === 'GET') {
    json(res, 200, {
      data: {
        version: publicDataVersion(),
        categories: publicCategoriesData(),
        storeSettings: publicStoreSettingsData()
      }
    }, publicSettingsHeaders)
    return true
  }

  if (url.pathname === '/api/catalog-content' && req.method === 'GET') {
    json(res, 200, {
      data: {
        version: publicDataVersion(),
        products: summarizedProducts(),
        categories: publicCategoriesData(),
        storeSettings: publicStoreSettingsData()
      }
    }, publicJsonHeaders)
    return true
  }

  if (url.pathname === '/api/data-version' && req.method === 'GET') {
    json(res, 200, { data: { version: publicDataVersion() } }, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    })
    return true
  }

  if (url.pathname === '/api/product-thumbnail' && req.method === 'GET') {
    if (!await serveProductThumbnail(res, url.searchParams.get('src'), url.searchParams.get('size'), url.searchParams.get('fit'))) json(res, 404, { error: '图片不存在' }, publicJsonHeaders)
    return true
  }

  if (url.pathname === '/api/products' && req.method === 'GET') {
    const params = { q: url.searchParams.get('q'), category: url.searchParams.get('category') }
    const data = url.searchParams.get('view') === 'summary'
      ? summarizedProducts(params)
      : cachedVersionedData(
        `public:products:${String(params.q || '')}\u0000${String(params.category || '')}`,
        () => listProducts({ status: 'published', ...params })
      )
    json(res, 200, { data }, publicJsonHeaders)
    return true
  }

  if (url.pathname === '/api/products/recognize' && req.method === 'POST') {
    const products = cachedVersionedData(
      'public:recognition-products',
      () => listProducts({ status: 'published' })
    )
    const body = await readJson(req, 12 * 1024 * 1024)
    const matches = await recognizeProductImage(body.dataUrl, products, body.limit)
    json(res, 200, { data: matches, total: matches.length }, { 'access-control-allow-origin': '*' })
    return true
  }

  const publicProductMatch = url.pathname.match(/^\/api\/products\/(\d+)$/)
  if (publicProductMatch && req.method === 'GET') {
    const product = cachedVersionedData(
      `public:product:${publicProductMatch[1]}`,
      () => getProduct(publicProductMatch[1])
    )
    if (!product || product.status !== 'published') json(res, 404, { error: '商品不存在' }, { 'access-control-allow-origin': '*' })
    else json(res, 200, { data: product }, publicJsonHeaders)
    return true
  }

  if (!url.pathname.startsWith('/api/admin/')) return false
  const currentAdmin = authenticatedAdmin(req)
  if (!currentAdmin) {
    json(res, 401, { error: '请先登录管理后台' })
    return true
  }

  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    if (currentAdmin.role !== 'owner') json(res, 403, { error: '只有主管理员可以管理账号' })
    else json(res, 200, { data: listAdminUsers() })
    return true
  }

  if (url.pathname === '/api/admin/users' && req.method === 'POST') {
    if (currentAdmin.role !== 'owner') {
      json(res, 403, { error: '只有主管理员可以新建账号' })
      return true
    }
    const body = await readJson(req)
    const username = cleanAdminUsername(body.username)
    const password = validateAdminPassword(body.password)
    if (getAdminUserByUsername(username)) {
      json(res, 409, { error: '该管理账号已经存在' })
      return true
    }
    const credentials = hashPassword(password)
    json(res, 201, {
      data: createAdminUser({
        username,
        ...credentials,
        createdBy: currentAdmin.username
      })
    })
    return true
  }

  const adminUserPasswordMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/)
  if (adminUserPasswordMatch && req.method === 'PUT') {
    if (currentAdmin.role !== 'owner') {
      json(res, 403, { error: '只有主管理员可以重置密码' })
      return true
    }
    const target = getAdminUserById(adminUserPasswordMatch[1])
    if (!target) {
      json(res, 404, { error: '管理账号不存在' })
      return true
    }
    const password = validateAdminPassword((await readJson(req)).password)
    const credentials = hashPassword(password)
    const updated = updateAdminUserPassword(target.id, credentials.passwordHash, credentials.passwordSalt)
    revokeAdminSessions(target.id, target.id === currentAdmin.id ? currentAdmin.sessionId : '')
    json(res, 200, { data: updated })
    return true
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/)
  if (adminUserMatch && req.method === 'DELETE') {
    if (currentAdmin.role !== 'owner') {
      json(res, 403, { error: '只有主管理员可以删除账号' })
      return true
    }
    const target = getAdminUserById(adminUserMatch[1])
    if (!target) {
      json(res, 404, { error: '管理账号不存在' })
      return true
    }
    if (target.id === currentAdmin.id) {
      json(res, 400, { error: '不能删除当前登录账号' })
      return true
    }
    const removed = deleteAdminUser(target.id)
    revokeAdminSessions(target.id)
    json(res, 200, { ok: true, data: removed })
    return true
  }

  if (url.pathname === '/api/admin/inventory/reports/latest/details' && req.method === 'GET') {
    const details = latestInventoryReview()
    if (!details?.rows?.length) json(res, 404, { error: '最近一次库存导入没有未匹配明细' })
    else json(res, 200, { data: details })
    return true
  }

  if (url.pathname === '/api/admin/inventory/mappings' && req.method === 'GET') {
    const mappings = listInventoryProductMappings()
    const matches = listInventoryImportMatches()
    const details = latestInventoryReview()
    const products = listProducts().map(product => ({
      id: product.id,
      code: product.code,
      name: product.name,
      status: product.status,
      category: product.category,
      colors: product.colors,
      sizes: product.sizes
    }))
    const sources = inventoryMappingSources(details, mappings, matches)
    const pendingSources = sources.filter(source => !source.mapping && !source.matches.length)
    json(res, 200, {
      data: {
        report: details ? {
          fileName: details.fileName,
          sourceFileName: details.sourceFileName,
          generatedAt: details.generatedAt,
          totalRows: details.total
        } : null,
        products,
        mappings,
        matches,
        sources,
        pendingSourceCount: pendingSources.length,
        latestPendingSourceCount: pendingSources.filter(source => source.fromLatestReport).length
      }
    })
    return true
  }

  if (url.pathname === '/api/admin/inventory/mappings' && req.method === 'PUT') {
    json(res, 200, { data: upsertInventoryProductMapping(await readJson(req)) })
    return true
  }

  if (url.pathname === '/api/admin/inventory/mappings' && req.method === 'DELETE') {
    const removed = deleteInventoryProductMapping(await readJson(req))
    if (!removed) json(res, 404, { error: '对应关系不存在或已删除' })
    else json(res, 200, { ok: true })
    return true
  }

  if (url.pathname === '/api/admin/inventory/reports/latest' && req.method === 'GET') {
    const fileName = latestInventoryReview()?.fileName || ''
    if (!fileName || !serveDownload(res, inventoryReportsDir, fileName)) json(res, 404, { error: '暂无未匹配表格，请先覆盖导入库存' })
    return true
  }

  const inventoryReportMatch = url.pathname.match(/^\/api\/admin\/inventory\/reports\/([^/]+\.xlsx)$/u)
  if (inventoryReportMatch && req.method === 'GET') {
    const fileName = decodeURIComponent(inventoryReportMatch[1])
    if (!serveDownload(res, inventoryReportsDir, fileName)) json(res, 404, { error: '未匹配产品表不存在或已过期' })
    return true
  }

  if (url.pathname === '/api/admin/products' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '')
    json(res, 200, {
      data: cachedVersionedData(`admin:products:${q}`, () => listProducts({ q }))
    })
    return true
  }

  if (url.pathname === '/api/admin/products/reorder' && req.method === 'POST') {
    const body = await readJson(req)
    const products = reorderProducts(body.ids)
    markPublicDataChanged()
    json(res, 200, { data: products })
    return true
  }

  if (url.pathname === '/api/admin/categories' && req.method === 'GET') {
    json(res, 200, {
      data: cachedVersionedData('admin:categories', () => listCategories())
    })
    return true
  }

  if (url.pathname === '/api/admin/categories' && req.method === 'POST') {
    const category = createCategory(await readJson(req))
    markPublicDataChanged()
    json(res, 201, { data: category })
    return true
  }

  if (url.pathname === '/api/admin/categories/reorder' && req.method === 'POST') {
    const body = await readJson(req)
    const categories = reorderCategories(body.ids)
    markPublicDataChanged()
    json(res, 200, { data: categories })
    return true
  }

  const adminCategoryProductOrderMatch = url.pathname.match(/^\/api\/admin\/categories\/(\d+)\/products\/reorder$/)
  if (adminCategoryProductOrderMatch && req.method === 'POST') {
    const body = await readJson(req)
    const category = reorderCategoryProducts(adminCategoryProductOrderMatch[1], body.ids)
    if (!category) json(res, 404, { error: '分类不存在' })
    else {
      markPublicDataChanged()
      json(res, 200, { data: category })
    }
    return true
  }

  const adminCategoryMatch = url.pathname.match(/^\/api\/admin\/categories\/(\d+)$/)
  if (adminCategoryMatch && req.method === 'PUT') {
    const previous = listCategories().find(category => category.id === Number(adminCategoryMatch[1]))
    const category = updateCategory(adminCategoryMatch[1], await readJson(req))
    if (!category) json(res, 404, { error: '分类不存在' })
    else {
      try { cleanupRemovedUploadReferences(previous) } catch (error) { console.warn(`Category image cleanup failed: ${error.message}`) }
      markPublicDataChanged()
      json(res, 200, { data: category })
    }
    return true
  }

  if (adminCategoryMatch && req.method === 'DELETE') {
    const previous = listCategories().find(category => category.id === Number(adminCategoryMatch[1]))
    const category = deleteCategory(adminCategoryMatch[1])
    if (!category) json(res, 404, { error: '分类不存在' })
    else {
      try { cleanupRemovedUploadReferences(previous) } catch (error) { console.warn(`Category image cleanup failed: ${error.message}`) }
      markPublicDataChanged()
      json(res, 200, { ok: true, data: category })
    }
    return true
  }

  if (url.pathname === '/api/admin/store-settings' && req.method === 'GET') {
    json(res, 200, {
      data: cachedVersionedData('admin:store-settings', () => getStoreSettings())
    })
    return true
  }

  if (url.pathname === '/api/admin/store-settings' && req.method === 'PUT') {
    const previous = getStoreSettings()
    const settings = updateStoreSettings(await readJson(req))
    try { cleanupRemovedUploadReferences(previous) } catch (error) { console.warn(`Store image cleanup failed: ${error.message}`) }
    markPublicDataChanged()
    json(res, 200, { data: settings })
    return true
  }

  if (url.pathname === '/api/admin/image-metadata' && req.method === 'GET') {
    json(res, 200, { data: await localImageMetadata(url.searchParams.get('url')) })
    return true
  }

  if (url.pathname === '/api/admin/inventory/import' && req.method === 'POST') {
    const body = await readJson(req, 8 * 1024 * 1024)
    const parsed = await parseInventoryWorkbook(body)
    const result = parsed.format === 'warehouse'
      ? importWarehouseInventory(parsed.rows, { sourceFileName: body.fileName })
      : importInventory(parsed.rows)
    const { unmatchedRows = [], ...data } = result
    data.unmatchedSourceCount = new Set(unmatchedRows.map(row => inventoryMappingKey(row.name || row.code, row.internalCode))).size
    data.unmatchedReport = null
    if (unmatchedRows.length) {
      try {
        const report = createUnmatchedInventoryReport({ rows: unmatchedRows, format: parsed.format, sourceFileName: body.fileName, outputDir: inventoryReportsDir })
        data.unmatchedReport = { ...report, url: `/api/admin/inventory/reports/${encodeURIComponent(report.fileName)}` }
      } catch (error) {
        data.unmatchedReportError = error.message || '未匹配产品表生成失败'
      }
    }
    writeLatestInventoryReview({
      rows: unmatchedRows,
      format: parsed.format,
      sourceFileName: body.fileName,
      report: data.unmatchedReport
    })
    if (data.applied) markPublicDataChanged()
    json(res, 200, { data })
    return true
  }

  if (url.pathname === '/api/admin/products' && req.method === 'POST') {
    const product = createProduct(await readJson(req))
    markPublicDataChanged()
    json(res, 201, { data: product })
    return true
  }

  const adminProductMatch = url.pathname.match(/^\/api\/admin\/products\/(\d+)$/)
  if (adminProductMatch && req.method === 'PUT') {
    const previous = getProduct(adminProductMatch[1])
    const product = updateProduct(adminProductMatch[1], await readJson(req))
    if (!product) json(res, 404, { error: '商品不存在' })
    else {
      try { cleanupRemovedUploadReferences(previous) } catch (error) { console.warn(`Product image cleanup failed: ${error.message}`) }
      markPublicDataChanged()
      json(res, 200, { data: product })
    }
    return true
  }

  if (adminProductMatch && req.method === 'DELETE') {
    const previous = getProduct(adminProductMatch[1])
    if (!deleteProduct(adminProductMatch[1])) json(res, 404, { error: '商品不存在' })
    else {
      try { cleanupRemovedUploadReferences(previous) } catch (error) { console.warn(`Product image cleanup failed: ${error.message}`) }
      markPublicDataChanged()
      json(res, 200, { ok: true })
    }
    return true
  }

  if (url.pathname === '/api/admin/uploads' && req.method === 'POST') {
    json(res, 201, await uploadImage(await readJson(req, 22 * 1024 * 1024)))
    return true
  }

  if (url.pathname === '/api/admin/uploads/from-url' && req.method === 'POST') {
    const body = await readJson(req)
    json(res, 201, await downloadImageToUploads(body.url, 0, { purpose: body.purpose, mode: body.mode }))
    return true
  }

  json(res, 404, { error: '接口不存在' })
  return true
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase()
  const publicSiteRequest = requestHost === 'xinghaiapp.top' || requestHost === 'www.xinghaiapp.top'
  try {
    if (await handleApi(req, res, url)) return
    if (url.pathname === '/') {
      if (publicSiteRequest && serveFile(res, join(publicDir, 'site'), 'index.html', 'public, max-age=300')) return
      res.writeHead(302, { location: '/admin/' })
      res.end()
      return
    }
    if (publicSiteRequest && url.pathname.startsWith('/admin/')) {
      res.writeHead(302, { location: `https://cpminiapp.xinghaiapp.top${url.pathname}` })
      res.end()
      return
    }
    if (url.pathname.startsWith('/uploads/') && serveFile(res, uploadsDir, url.pathname.slice('/uploads/'.length), 'public, max-age=2592000, immutable')) return
    if (url.pathname.startsWith('/images/') && serveFile(res, join(publicDir, 'images'), url.pathname.slice('/images/'.length), 'public, max-age=604800')) return
    if (url.pathname.startsWith('/admin/')) {
      const relative = url.pathname === '/admin/' ? 'index.html' : url.pathname.slice('/admin/'.length)
      if (serveFile(res, join(publicDir, 'admin'), relative, 'no-cache, no-store, must-revalidate')) return
    }
    json(res, 404, { error: '页面不存在' })
  } catch (error) {
    const message = error instanceof SyntaxError ? '请求格式不正确' : error.message || '服务异常'
    const duplicate = /UNIQUE constraint failed/.test(message)
    const duplicateCategory = /catalog_categories\.(?:name|category_key)/.test(message)
    json(res, duplicate ? 409 : 400, { error: duplicate ? (duplicateCategory ? '分类名称已存在，请更换名称' : '款号已存在，请更换款号') : message })
  }
})

server.listen(port, '127.0.0.1', () => {
  const summaryCount = summarizedProducts().length
  console.log(`普润制衣团购仓商品服务：http://127.0.0.1:${port}`)
  console.log(`商品管理后台：http://127.0.0.1:${port}/admin/`)
  console.log(`商品摘要缓存：${summaryCount} 款`)
  if (!process.env.ADMIN_PASSWORD) console.log('本地演示账号：admin / admin123（正式部署前必须修改）')
})

ensureImageSearchIndex(listProducts({ status: 'published' }))
  .then(index => console.log(`拍图识别索引：${index.items.length} 张商品图片`))
  .catch(error => console.warn(`拍图识别索引生成失败：${error.message}`))

export { server }
