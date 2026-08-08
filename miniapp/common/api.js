function apiBase() {
  return getApp()?.globalData?.apiBase || 'https://cpminiapp.xinghaiapp.top'
}

const responseCache = new Map()
let currentDataVersion = ''
let versionRequest = null
let lastVersionCheckAt = 0
const VERSION_CHECK_INTERVAL = 5000
const PERSISTENT_CACHE_PREFIX = 'purun-public-cache-v3:'
const PERSISTENT_CACHE_INDEX = `${PERSISTENT_CACHE_PREFIX}index`
const PERSISTENT_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const PERSISTENT_CACHE_MAX_ENTRIES = 40
const PERSISTENT_PRODUCT_MAX_ENTRIES = 24
let persistentCacheIndex = null

function storageKeyForCache(key) {
  return `${PERSISTENT_CACHE_PREFIX}${encodeURIComponent(key)}`
}

function readPersistentCacheIndex() {
  if (persistentCacheIndex) return persistentCacheIndex
  try {
    const stored = wx.getStorageSync(PERSISTENT_CACHE_INDEX)
    persistentCacheIndex = stored && typeof stored === 'object'
      ? {
          version: String(stored.version || ''),
          keys: Array.isArray(stored.keys) ? stored.keys : [],
          productKeys: Array.isArray(stored.productKeys) ? stored.productKeys : []
        }
      : { version: '', keys: [], productKeys: [] }
  } catch {
    persistentCacheIndex = { version: '', keys: [], productKeys: [] }
  }
  return persistentCacheIndex
}

function savePersistentCacheIndex() {
  try { wx.setStorageSync(PERSISTENT_CACHE_INDEX, persistentCacheIndex) } catch {}
}

function removePersistentCacheKey(key) {
  try { wx.removeStorageSync(storageKeyForCache(key)) } catch {}
}

function alignPersistentCacheVersion(version) {
  if (!version) return
  const index = readPersistentCacheIndex()
  if (index.version === version) return
  index.keys.forEach(removePersistentCacheKey)
  persistentCacheIndex = { version, keys: [], productKeys: [] }
  savePersistentCacheIndex()
}

function readPersistentCache(key, allowStoredVersion = false) {
  const index = readPersistentCacheIndex()
  const expectedVersion = currentDataVersion || (allowStoredVersion ? index.version : '')
  if (!expectedVersion || index.version !== expectedVersion || !index.keys.includes(key)) return undefined
  try {
    const entry = wx.getStorageSync(storageKeyForCache(key))
    if (!entry || entry.version !== expectedVersion || Date.now() - Number(entry.savedAt || 0) > PERSISTENT_CACHE_MAX_AGE) {
      removePersistentCacheKey(key)
      index.keys = index.keys.filter(item => item !== key)
      index.productKeys = index.productKeys.filter(item => item !== key)
      savePersistentCacheIndex()
      return undefined
    }
    return entry.value
  } catch {
    return undefined
  }
}

function writePersistentCache(key, value) {
  if (!currentDataVersion) return
  const index = readPersistentCacheIndex()
  if (index.version !== currentDataVersion) alignPersistentCacheVersion(currentDataVersion)
  const activeIndex = readPersistentCacheIndex()
  activeIndex.keys = activeIndex.keys.filter(item => item !== key)
  activeIndex.keys.push(key)
  if (/^product:\d+$/.test(key)) {
    activeIndex.productKeys = activeIndex.productKeys.filter(item => item !== key)
    activeIndex.productKeys.push(key)
  }
  while (activeIndex.productKeys.length > PERSISTENT_PRODUCT_MAX_ENTRIES) {
    const removed = activeIndex.productKeys.shift()
    activeIndex.keys = activeIndex.keys.filter(item => item !== removed)
    removePersistentCacheKey(removed)
  }
  while (activeIndex.keys.length > PERSISTENT_CACHE_MAX_ENTRIES) {
    const removed = activeIndex.keys.shift()
    activeIndex.productKeys = activeIndex.productKeys.filter(item => item !== removed)
    removePersistentCacheKey(removed)
  }
  try {
    wx.setStorageSync(storageKeyForCache(key), {
      version: currentDataVersion,
      savedAt: Date.now(),
      value
    })
    savePersistentCacheIndex()
  } catch {}
}

function cached(key, ttl, loader, options = {}) {
  const now = Date.now()
  const existing = responseCache.get(key)
  if (existing && existing.expiresAt > now && existing.value !== undefined) return Promise.resolve(existing.value)
  if (existing?.promise) return existing.promise
  const persisted = options.persistent ? readPersistentCache(key) : undefined
  if (persisted !== undefined) {
    responseCache.set(key, { value: persisted, expiresAt: now + ttl })
    return Promise.resolve(persisted)
  }
  const promise = loader().then(value => {
    responseCache.set(key, { value, expiresAt: Date.now() + ttl })
    if (options.persistent) writePersistentCache(key, value)
    return value
  }).catch(error => {
    responseCache.delete(key)
    throw error
  })
  responseCache.set(key, { promise, expiresAt: now + ttl })
  return promise
}

function request(path, data = {}, options = {}) {
  const method = options.method || 'GET'
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase()}${path}`,
      method,
      data,
      timeout: options.timeout || 8000,
      enableCache: options.enableCache === true,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data)
        else reject(new Error(response.data?.error || `服务返回 ${response.statusCode}`))
      },
      fail: reject
    })
  })
}

function clearPublicDataCache() {
  responseCache.clear()
}

function acceptDataVersion(nextVersion) {
  const normalizedVersion = String(nextVersion || '')
  if (!normalizedVersion) return false
  const changed = Boolean(currentDataVersion && normalizedVersion !== currentDataVersion)
  if (!currentDataVersion || changed) clearPublicDataCache()
  alignPersistentCacheVersion(normalizedVersion)
  currentDataVersion = normalizedVersion
  return changed
}

function refreshDataVersion(force = false) {
  const now = Date.now()
  if (!force && currentDataVersion && now - lastVersionCheckAt < VERSION_CHECK_INTERVAL) {
    return Promise.resolve(false)
  }
  if (versionRequest) return versionRequest
  lastVersionCheckAt = now
  versionRequest = request('/api/data-version', {}, { enableCache: false, timeout: 5000 })
    .then(result => {
      return acceptDataVersion(result?.data?.version)
    })
    .catch(() => false)
    .finally(() => {
      versionRequest = null
    })
  return versionRequest
}

function absoluteImage(path) {
  if (!path) return '/assets/polo-grid.jpg'
  if (/^https?:\/\//.test(path) || path.startsWith('/assets/')) return path
  return `${apiBase()}${path.startsWith('/') ? '' : '/'}${path}`
}

function thumbnailImage(path, size = 360, fit = 'inside') {
  const source = String(path || '')
  if (!source) return ''
  const base = apiBase()
  const thumbnailPath = source.startsWith('/api/product-thumbnail?')
    ? source
    : source.startsWith(`${base}/api/product-thumbnail?`)
      ? source.slice(base.length)
      : ''
  if (thumbnailPath) {
    let resized = /[?&]size=\d+/.test(thumbnailPath)
      ? thumbnailPath.replace(/([?&])size=\d+/, `$1size=${size}`)
      : `${thumbnailPath}&size=${size}`
    resized = resized.replace(/&fit=[^&]*/g, '')
    if (fit === 'width') resized += '&fit=width'
    return `${base}${resized}`
  }
  const localPath = source.startsWith('/uploads/')
    ? source
    : source.startsWith(`${base}/uploads/`)
      ? source.slice(base.length)
      : ''
  if (localPath) {
    const fitQuery = fit === 'width' ? '&fit=width' : ''
    return `${base}/api/product-thumbnail?src=${encodeURIComponent(localPath)}&size=${size}${fitQuery}`
  }
  return absoluteImage(source)
}

function normaliseColorSizeStocks(colors, sizes, rawColorSizeStocks, legacySizeStocks) {
  const source = rawColorSizeStocks && typeof rawColorSizeStocks === 'object' ? rawColorSizeStocks : {}
  const legacy = legacySizeStocks && typeof legacySizeStocks === 'object' ? legacySizeStocks : {}
  const hasColorMatrix = colors.some(color => source[color] && typeof source[color] === 'object')
  if (hasColorMatrix) {
    return Object.fromEntries(colors.map(color => [
      color,
      Object.fromEntries(sizes.map(size => [size, Math.max(0, Number(source[color]?.[size]) || 0)]))
    ]))
  }
  return Object.fromEntries(colors.map((color, colorIndex) => [
    color,
    Object.fromEntries(sizes.map(size => {
      const quantity = Math.max(0, Number(legacy[size]) || 0)
      const base = colors.length ? Math.floor(quantity / colors.length) : 0
      return [size, base + (colorIndex < quantity % Math.max(colors.length, 1) ? 1 : 0)]
    }))
  ]))
}

function hydrateProduct(product) {
  const images = (product.images || []).map(absoluteImage)
  const colors = product.colors || []
  const sizes = product.sizes || []
  const rawColorImages = product.colorImages && typeof product.colorImages === 'object' ? product.colorImages : {}
  const rawColorGalleries = product.colorGalleries && typeof product.colorGalleries === 'object' ? product.colorGalleries : {}
  const colorGalleries = Object.fromEntries(colors.map(color => {
    const gallery = Array.isArray(rawColorGalleries[color]) ? rawColorGalleries[color].map(absoluteImage) : []
    const explicitImage = rawColorImages[color] ? absoluteImage(rawColorImages[color]) : ''
    return [color, gallery.length ? gallery : (explicitImage ? [explicitImage] : [])]
  }))
  const colorImages = Object.fromEntries(colors.map(color => colorGalleries[color][0] ? [color, colorGalleries[color][0]] : null).filter(Boolean))
  const detailImages = (product.detailImages || []).map(absoluteImage)
  const realImages = (product.realImages || []).map(item => ({ ...item, url: absoluteImage(item.url) }))
  const legacySizeStocks = product.sizeStocks && typeof product.sizeStocks === 'object' ? product.sizeStocks : {}
  const colorSizeStocks = normaliseColorSizeStocks(colors, sizes, product.colorSizeStocks, legacySizeStocks)
  const sizeStocks = Object.fromEntries(sizes.map(size => [
    size,
    colors.length
      ? colors.reduce((total, color) => total + colorSizeStocks[color][size], 0)
      : Math.max(0, Number(legacySizeStocks[size]) || 0)
  ]))
  const sizeOptions = sizes.map(name => ({ name, stock: sizeStocks[name] }))
  const stock = sizeOptions.reduce((total, option) => total + option.stock, 0)
  return {
    ...product,
    categories: Array.isArray(product.categories) && product.categories.length ? product.categories : (product.category ? [product.category] : []),
    seasonalNew: Boolean(product.seasonalNew),
    stock,
    sizeStocks,
    colorSizeStocks,
    sizeOptions,
    images,
    posterImage: product.posterImage ? absoluteImage(product.posterImage) : '',
    colorImages,
    colorGalleries,
    detailImages: detailImages.length ? detailImages : images,
    realImages: realImages.length ? realImages : images.map(url => ({ url, category: '实物展示' })),
    image: images[0] || absoluteImage(product.image),
    colors,
    sizes
  }
}

function hydrateProductSummary(product) {
  const categories = Array.isArray(product.categories) && product.categories.length
    ? product.categories
    : (product.category ? [product.category] : [])
  const sourceImage = product.image || (Array.isArray(product.images) ? product.images[0] : '')
  const previewImage = product.previewImage || sourceImage
  return {
    id: Number(product.id),
    code: product.code || '',
    name: product.name || '',
    subtitle: product.subtitle || '',
    category: product.category || categories[0] || '',
    categories,
    displayCategory: product.displayCategory || product.category || categories[0] || '',
    price: Number(product.price) || 0,
    stock: Math.max(0, Number(product.stock) || 0),
    unit: product.unit || '件',
    fabric: product.fabric || '',
    style: product.style || '',
    fit: product.fit || '',
    badge: product.badge || '',
    seasonalNew: Boolean(product.seasonalNew),
    sortOrder: Number(product.sortOrder) || 0,
    images: sourceImage ? [absoluteImage(sourceImage)] : [],
    previewImage: previewImage ? absoluteImage(previewImage) : '',
    posterImage: product.posterImage ? absoluteImage(product.posterImage) : '',
    image: absoluteImage(sourceImage)
  }
}

const defaultStoreSettings = {
  storeName: '普润制衣团购仓',
  storeIcon: '',
  homeHeroImage: '',
  homeHeroImages: [],
  homeHeroImageMode: 'aspectFill',
  homeEyebrow: 'WHOLESALE · CUSTOM',
  homeSubtitle: '企业团购与服装定制',
  searchPlaceholder: '搜索款号、品类或面料',
  heroNote: '现货供应 · 多色可选',
  categoryTitle: '热门分类',
  categorySubtitle: 'SHOP BY CATEGORY',
  categoryMoreText: '查看全部 →',
  homeServices: ['支持小单起订', '免费设计效果图', '企业专属报价'],
  profileLayout: 'member',
  profilePageTitle: '我的',
  profileTitle: '普润制衣服务中心',
  profileSubtitle: '企业团购与服装定制',
  serviceTitle: '常用服务',
  services: ['设计草稿', '个人资料', '原创精品', '企业认证'],
  profileAboutTitle: '关于店铺',
  productFeatures: ['团体定制', '透气亲肤', '可绣可印', '品质检验'],
  aboutText: '专注企业团购、团队服装与个性化定制服务。',
  footerText: '品质团购 · 专业定制'
}

function hydrateStoreSettings(settings = {}) {
  const sourceHeroImages = Array.isArray(settings.homeHeroImages) ? settings.homeHeroImages : []
  const homeHeroImages = sourceHeroImages.length
    ? sourceHeroImages.map(image => thumbnailImage(image, 960, 'width'))
    : [settings.homeHeroImage ? thumbnailImage(settings.homeHeroImage, 960, 'width') : '/assets/hero.jpg']
  return {
    ...defaultStoreSettings,
    ...settings,
    storeIcon: settings.storeIcon ? thumbnailImage(settings.storeIcon, 200) : '',
    homeHeroImage: homeHeroImages[0],
    homeHeroImages,
    homeServices: Array.isArray(settings.homeServices) ? settings.homeServices : defaultStoreSettings.homeServices,
    services: Array.isArray(settings.services) ? settings.services : defaultStoreSettings.services,
    productFeatures: Array.isArray(settings.productFeatures) ? settings.productFeatures : defaultStoreSettings.productFeatures
  }
}

function hydrateCategories(items = []) {
  return items.map((category, index) => ({
    id: category.id || `remote-${index}`,
    key: category.key || `category-${index}`,
    name: category.name || category.category,
    category: category.name || category.category,
    type: category.type || 'normal',
    image: category.image ? thumbnailImage(category.image, 200) : '',
    icon: category.icon || (category.name || category.category || '').slice(0, 2),
    tone: category.tone || ['#8fa594', '#c18f72', '#7995aa', '#b9975a'][index % 4],
    count: Number(category.count) || 0,
    productIds: Array.isArray(category.productIds) ? category.productIds.map(Number) : [],
    sortOrder: Number(category.sortOrder) || 0
  }))
}

function primePublicCache(key, value, persistent = false) {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + 30 * 60 * 1000
  })
  if (persistent) writePersistentCache(key, value)
}

function readHomeSnapshot() {
  const index = readPersistentCacheIndex()
  if (!index.version) return null
  acceptDataVersion(index.version)
  const cachedCategories = readPersistentCache('categories', true)
  const cachedStoreSettings = readPersistentCache('store-settings', true)
  if (cachedCategories === undefined || cachedStoreSettings === undefined) return null
  primePublicCache('categories', cachedCategories)
  primePublicCache('store-settings', cachedStoreSettings)
  return {
    categories: cachedCategories,
    storeSettings: cachedStoreSettings
  }
}

function readCatalogSnapshot() {
  const index = readPersistentCacheIndex()
  if (!index.version) return null
  acceptDataVersion(index.version)
  const cachedProducts = readPersistentCache('product-summaries:{}', true)
  const cachedCategories = readPersistentCache('categories', true)
  const cachedStoreSettings = readPersistentCache('store-settings', true)
  if (cachedProducts === undefined || cachedCategories === undefined || cachedStoreSettings === undefined) return null
  primePublicCache('product-summaries:{}', cachedProducts)
  primePublicCache('categories', cachedCategories)
  primePublicCache('store-settings', cachedStoreSettings)
  return {
    products: cachedProducts,
    categories: cachedCategories,
    storeSettings: cachedStoreSettings
  }
}

function readProductSnapshot(id) {
  const numericId = Number(id)
  if (!numericId) return null
  const index = readPersistentCacheIndex()
  if (!index.version) return null
  acceptDataVersion(index.version)
  const product = readPersistentCache(`product:${numericId}`, true)
  if (product === undefined) return null
  primePublicCache(`product:${numericId}`, product)
  return product
}

async function fetchHomeContent() {
  const result = await request('/api/home-content', {}, { enableCache: false, timeout: 8000 })
  const payload = result?.data || {}
  acceptDataVersion(payload.version)
  lastVersionCheckAt = Date.now()
  const homeCategories = hydrateCategories(payload.categories || [])
  const homeStoreSettings = hydrateStoreSettings(payload.storeSettings || {})
  primePublicCache('categories', homeCategories, true)
  primePublicCache('store-settings', homeStoreSettings, true)
  return {
    categories: homeCategories,
    storeSettings: homeStoreSettings
  }
}

async function fetchCatalogContent() {
  const result = await request('/api/catalog-content', {}, { enableCache: false, timeout: 10000 })
  const payload = result?.data || {}
  acceptDataVersion(payload.version)
  lastVersionCheckAt = Date.now()
  const catalogProducts = (payload.products || []).map(hydrateProductSummary)
  const catalogCategories = hydrateCategories(payload.categories || [])
  const catalogStoreSettings = hydrateStoreSettings(payload.storeSettings || {})
  primePublicCache('product-summaries:{}', catalogProducts, true)
  primePublicCache('categories', catalogCategories, true)
  primePublicCache('store-settings', catalogStoreSettings, true)
  return {
    products: catalogProducts,
    categories: catalogCategories,
    storeSettings: catalogStoreSettings
  }
}

async function fetchProducts(params = {}) {
  await refreshDataVersion()
  const key = `products:${JSON.stringify(params)}`
  return cached(key, 30 * 60 * 1000, async () => {
    const result = await request('/api/products', params)
    return (result.data || []).map(hydrateProduct)
  })
}

async function fetchProductSummaries(params = {}) {
  await refreshDataVersion()
  const key = `product-summaries:${JSON.stringify(params)}`
  return cached(key, 30 * 60 * 1000, async () => {
    const result = await request('/api/products', { ...params, view: 'summary' })
    return (result.data || []).map(hydrateProductSummary)
  }, { persistent: true })
}

async function fetchProduct(id) {
  await refreshDataVersion()
  return cached(`product:${id}`, 30 * 60 * 1000, async () => {
    const result = await request(`/api/products/${id}`)
    return hydrateProduct(result.data)
  }, { persistent: true })
}

async function fetchCategories() {
  await refreshDataVersion()
  return cached('categories', 30 * 60 * 1000, async () => {
    const result = await request('/api/categories')
    return hydrateCategories(result.data || [])
  }, { persistent: true })
}

async function fetchStoreSettings() {
  await refreshDataVersion()
  return cached('store-settings', 30 * 60 * 1000, async () => {
    const result = await request('/api/store-settings')
    return hydrateStoreSettings(result.data)
  }, { persistent: true })
}

async function recognizeProductImage(dataUrl, limit = 12) {
  const result = await request('/api/products/recognize', { dataUrl, limit }, { method: 'POST', timeout: 30000 })
  return result.data || []
}

module.exports = { fetchProducts, fetchProductSummaries, fetchProduct, fetchCategories, fetchStoreSettings, fetchHomeContent, fetchCatalogContent, readHomeSnapshot, readCatalogSnapshot, readProductSnapshot, recognizeProductImage, refreshDataVersion, clearPublicDataCache, hydrateProduct, hydrateProductSummary, hydrateStoreSettings, thumbnailImage, defaultStoreSettings }
