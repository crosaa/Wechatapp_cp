const { fetchProduct, fetchCatalogContent, readCatalogSnapshot, refreshDataVersion, dataVersion, thumbnailImage, defaultStoreSettings } = require('../../common/api')
const { appName, firstImage, appShare, timelineShare, favoriteShare } = require('../../common/share')
const { refreshFromServer } = require('../../common/pull-refresh')

const ALL_CATEGORY = { id: 'all', name: '全部商品', type: 'all', icon: 'ALL', tone: '#8b918a' }
const PAGE_SIZE = 24
// Product pages further than this (px) above or below the list viewport are
// collapsed to empty placeholders of the same height, so DOM size and decoded
// images stay bounded however far the list is scrolled.
const CHUNK_KEEP_MARGIN = 1500
const WARM_PRODUCT_LIMIT = 20
const WARM_VISIBLE_COUNT = 1
const WARM_PRODUCT_DELAY = 1600
const initialCatalogSnapshot = readCatalogSnapshot()
const initialCatalogVersion = initialCatalogSnapshot ? dataVersion() : ''
const initialCatalogProducts = initialCatalogSnapshot?.products || []
const initialCatalogCategories = initialCatalogSnapshot?.categories || []
const initialCatalogSettings = initialCatalogSnapshot?.storeSettings || defaultStoreSettings

function initialCategoryState() {
  const intent = wx.getStorageSync('categoryIntent')
  const activeIntent = intent && !intent.reset ? intent : null
  const keyword = typeof activeIntent?.keyword === 'string' ? activeIntent.keyword.trim() : ''
  const selected = keyword ? ALL_CATEGORY.name : (activeIntent?.category || ALL_CATEGORY.name)
  const selectedType = keyword ? 'all' : (activeIntent?.type || (selected === ALL_CATEGORY.name ? 'all' : 'normal'))
  const imageMatchIds = Array.isArray(activeIntent?.productIds) ? activeIntent.productIds.map(Number) : []
  const imagePosition = new Map(imageMatchIds.map((id, index) => [id, index]))
  const query = keyword.toLowerCase()
  let filtered = initialCatalogProducts.filter(product => {
    const productCategories = product.categories?.length ? product.categories : [product.category]
    if (query) {
      return `${product.name}${product.code}${product.subtitle}${product.style}${product.fabric}${product.displayCategory}${productCategories.join('')}`.toLowerCase().includes(query)
    }
    if (selectedType === 'image') return imagePosition.has(Number(product.id))
    return selectedType === 'all' || productCategories.includes(selected)
  })
  const category = initialCatalogCategories.find(item => item.name === selected && item.type === selectedType)
  const position = selectedType === 'image'
    ? imagePosition
    : new Map((category?.productIds || []).map((id, index) => [Number(id), index]))
  if (selectedType !== 'all') {
    filtered = filtered.slice().sort((left, right) => (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  }
  return {
    hasIntent: Boolean(activeIntent),
    selected,
    selectedType,
    keyword,
    imageMatchIds,
    products: filtered,
    resultMode: Boolean(keyword) || selectedType === 'image',
    resultTitle: keyword ? '搜索结果' : (selectedType === 'image' ? '识别结果' : selected)
  }
}

const initialCategory = initialCategoryState()

// Only the fields the list card renders are sent to the view layer; the full
// summaries stay in this.filteredProducts for navigation and sharing.
function listItem(product) {
  return {
    id: product.id,
    image: product.image,
    badge: product.badge,
    name: product.name,
    subtitle: product.subtitle,
    style: product.style,
    displayCategory: product.displayCategory,
    fabric: product.fabric,
    stock: product.stock,
    price: product.price
  }
}

// One loaded page of the list; height > 0 means it is collapsed to a placeholder.
function productChunk(products, id) {
  return { id, height: 0, items: products.map(listItem) }
}

// Splits the first `count` products into pages. Pages that were collapsed before
// (scrolled far away) stay collapsed, so refreshing data does not re-render them
// or move the scroll position.
function chunksFor(products, count, previousChunks = []) {
  const chunks = []
  for (let start = 0; start < count; start += PAGE_SIZE) {
    const id = chunks.length
    const chunk = productChunk(products.slice(start, Math.min(start + PAGE_SIZE, count)), id)
    const previous = previousChunks[id]
    if (previous?.height && previous.items.length === chunk.items.length) chunk.height = previous.height
    chunks.push(chunk)
  }
  return chunks
}

// The side nav only needs these; productIds stay in this.catalogCategories.
function navCategory(category) {
  return { id: category.id, name: category.name, type: category.type }
}

function primaryProductImage(product) {
  const firstColor = Array.isArray(product?.colors) ? product.colors[0] : ''
  const colorGallery = firstColor && Array.isArray(product?.colorGalleries?.[firstColor])
    ? product.colorGalleries[firstColor]
    : []
  return product?.posterImage || colorGallery[0] || product?.colorImages?.[firstColor] || product?.images?.[0] || product?.image || ''
}

function preloadImage(url) {
  return new Promise(resolve => {
    if (!url) {
      resolve()
      return
    }
    wx.getImageInfo({
      src: url,
      success: resolve,
      fail: resolve
    })
  })
}

function categoryShareState(page) {
  const keyword = String(page.data.keyword || '').trim()
  const category = keyword ? '搜索结果' : (page.data.resultTitle || page.data.selected || '全部商品')
  const query = keyword
    ? `keyword=${encodeURIComponent(keyword)}`
    : `category=${encodeURIComponent(page.data.selected || '全部商品')}&type=${encodeURIComponent(page.data.selectedType || 'all')}`
  return {
    title: `${category}｜${appName()}`,
    query,
    imageUrl: firstImage(page.filteredProducts?.[0])
  }
}

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    catalogReady: Boolean(initialCatalogSnapshot),
    categories: [ALL_CATEGORY, ...initialCatalogCategories].map(navCategory),
    selected: initialCategory.selected,
    selectedType: initialCategory.selectedType,
    keyword: initialCategory.keyword,
    sort: '综合',
    imageMatchIds: initialCategory.imageMatchIds,
    filterOpen: false,
    stockFilter: 'all',
    minPrice: '',
    maxPrice: '',
    draftStockFilter: 'all',
    draftMinPrice: '',
    draftMaxPrice: '',
    activeFilterCount: 0,
    searchPlaceholder: initialCatalogSettings.searchPlaceholder,
    productChunks: chunksFor(initialCategory.products, Math.min(PAGE_SIZE, initialCategory.products.length)),
    resultCount: initialCategory.products.length,
    hasMore: initialCategory.products.length > PAGE_SIZE,
    productScrollIntoView: 'product-top-a',
    resultMode: initialCategory.resultMode,
    resultTitle: initialCategory.resultTitle,
    listRefreshing: false
  },
  onLoad(options) {
    this.hasShownOnce = false
    this.warmedProducts = new Map()
    this.productWarmPromises = new Map()
    this.remoteProductIds = new Set(initialCatalogProducts.map(item => Number(item.id)))
    this.remoteProductsReady = initialCatalogProducts.length > 0
    this.catalogCategories = initialCatalogCategories
    this.catalogVersion = initialCatalogVersion
    this.productPool = initialCatalogProducts
    this.filteredProducts = initialCategory.products
    this.visibleCount = Math.min(PAGE_SIZE, initialCategory.products.length)
    this.chunkObservers = []
    this.chunkListToken = 0
    getApp().categoryPage = this
    const hasRouteOptions = Boolean(options.keyword || options.category || options.type)
    const keyword = options.keyword ? decodeURIComponent(options.keyword) : this.data.keyword
    const requestedCategory = options.category ? decodeURIComponent(options.category) : this.data.selected
    if (options.keyword || options.category || options.type) wx.removeStorageSync('categoryIntent')
    const category = keyword.trim() ? '全部商品' : requestedCategory
    const type = keyword.trim()
      ? 'all'
      : (options.type
          ? decodeURIComponent(options.type)
          : (options.category ? (category === ALL_CATEGORY.name ? 'all' : 'normal') : this.data.selectedType))
    if (hasRouteOptions) {
      this.applyProductState({ selected: category, selectedType: type, keyword })
    } else {
      if (initialCategory.hasIntent) wx.removeStorageSync('categoryIntent')
      this.scheduleWarmProducts(initialCategory.products.slice(0, WARM_VISIBLE_COUNT))
    }
    if (initialCatalogSnapshot) this.refreshRemoteDataIfChanged()
    else this.loadRemoteProducts()
  },
  async loadRemoteProducts({ rethrow = false } = {}) {
    try {
      // A refresh of a list the user is already looking at keeps its loaded pages and
      // scroll position; only the first load starts from the top page.
      const refreshing = this.remoteProductsReady && this.data.catalogReady
      const catalog = await fetchCatalogContent()
      this.catalogVersion = dataVersion()
      const remoteProducts = catalog.products
      const remoteCategories = catalog.categories
      const storeSettings = catalog.storeSettings
      if (remoteCategories.length) this.catalogCategories = remoteCategories
      this.productPool = remoteProducts.length ? remoteProducts : this.productPool
      this.remoteProductIds = new Set(remoteProducts.map(item => Number(item.id)))
      this.remoteProductsReady = remoteProducts.length > 0
      this.applyProductState({
        catalogReady: true,
        categories: [ALL_CATEGORY, ...this.catalogCategories].map(navCategory),
        searchPlaceholder: storeSettings.searchPlaceholder
      }, false, null, { keepLoaded: refreshing })
    } catch (error) {
      if (rethrow) throw error
      console.info('商品服务未启动，分类页继续使用本地演示数据', error.errMsg || error.message)
    }
  },
  onShow() {
    this.productNavigating = false
    const intent = wx.getStorageSync('categoryIntent')
    this.pageVisible = true
    // Usually the intent was already applied while this tab was hidden (see
    // applyIntentWhileHidden), so showing the page re-renders nothing.
    const appliedWhileHidden = this.intentAppliedWhileHidden
    this.intentAppliedWhileHidden = ''
    const firstShow = !this.hasShownOnce
    this.hasShownOnce = true
    if (intent) {
      wx.removeStorageSync('categoryIntent')
      this.applyIntent(intent)
    }
    if (firstShow) return
    // A reset asks for the latest catalog right away; other visits use the throttled check.
    if (intent?.reset || appliedWhileHidden === 'reset') this.syncLatestCatalog()
    else this.refreshRemoteDataIfChanged()
  },
  onHide() {
    this.pageVisible = false
  },
  applyIntent(intent) {
    if (intent.reset) {
      this.resetCategoryState()
      return
    }
    const intentKeyword = typeof intent.keyword === 'string' ? intent.keyword : (intent.type === 'image' ? '' : this.data.keyword)
    const isKeywordSearch = intentKeyword.trim().length > 0
    this.applyProductState({
      selected: isKeywordSearch ? '全部商品' : (intent.category || this.data.selected),
      selectedType: isKeywordSearch ? 'all' : (intent.type || (intent.category === '全部商品' ? 'all' : this.data.selectedType)),
      keyword: intentKeyword,
      imageMatchIds: Array.isArray(intent.productIds) ? intent.productIds.map(Number) : []
    }, true)
  },
  // Called (via setCategoryIntent) when another page sets an intent: while this tab is
  // hidden the new list is rendered right away, so switching to it shows no re-render.
  applyIntentWhileHidden() {
    if (this.pageVisible || !this.hasShownOnce) return
    const intent = wx.getStorageSync('categoryIntent')
    if (!intent) return
    wx.removeStorageSync('categoryIntent')
    this.applyIntent(intent)
    this.intentAppliedWhileHidden = intent.reset ? 'reset' : 'intent'
  },
  async refreshRemoteDataIfChanged(force = false) {
    try {
      await refreshDataVersion(force)
      if (dataVersion() === this.catalogVersion) return false
      this.warmedProducts.clear()
      this.productWarmPromises.clear()
      await this.loadRemoteProducts()
      return true
    } catch (error) {
      console.info('分类商品同步检查失败', error.errMsg || error.message)
      return false
    }
  },
  // Pull-to-refresh on the product list: the list keeps its category, filters and
  // scroll position; the catalog is only downloaded again when it changed.
  onListRefresh() {
    refreshFromServer(this, async () => {
      if (this.remoteProductsReady && dataVersion() === this.catalogVersion) return
      this.warmedProducts.clear()
      this.productWarmPromises.clear()
      await this.loadRemoteProducts({ rethrow: true })
    }, 'listRefreshing')
  },
  openSearch() {
    const keyword = this.data.keyword.trim()
    const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
    wx.navigateTo({ url: `/pages/search/search${query}` })
  },
  goBack() {
    // The home page resets this tab once it is hidden (applyIntentWhileHidden), so the
    // list does not visibly change before the switch.
    wx.setStorageSync('categoryIntent', {
      reset: true,
      category: ALL_CATEGORY.name,
      type: 'all',
      keyword: ''
    })
    wx.switchTab({ url: '/pages/home/home' })
  },
  resetCategoryState() {
    this.applyProductState({
      selected: ALL_CATEGORY.name,
      selectedType: 'all',
      keyword: '',
      imageMatchIds: [],
      sort: '综合',
      stockFilter: 'all',
      minPrice: '',
      maxPrice: '',
      draftStockFilter: 'all',
      draftMinPrice: '',
      draftMaxPrice: '',
      activeFilterCount: 0,
      filterOpen: false
    }, true)
  },
  syncLatestCatalog() {
    // Every catalog change on the server bumps the data version, so a version
    // check is enough to stay current; the full catalog is only re-downloaded
    // (and re-cached) when it actually changed or never loaded.
    if (this.remoteProductsReady) this.refreshRemoteDataIfChanged(true)
    else this.loadRemoteProducts()
  },
  selectCategory(e) {
    this.refreshRemoteDataIfChanged()
    this.applyProductState({ selected: e.currentTarget.dataset.name, selectedType: e.currentTarget.dataset.type || 'normal', keyword: '', imageMatchIds: [], filterOpen: false }, true)
  },
  setSort(e) {
    this.refreshRemoteDataIfChanged()
    this.applyProductState({ sort: e.currentTarget.dataset.sort }, true)
  },
  toggleFilter() {
    if (this.data.filterOpen) {
      this.closeFilter()
      return
    }
    this.setData({
      filterOpen: true,
      draftStockFilter: this.data.stockFilter,
      draftMinPrice: this.data.minPrice,
      draftMaxPrice: this.data.maxPrice
    })
  },
  closeFilter() {
    this.setData({ filterOpen: false })
  },
  noop() {},
  chooseStockFilter(e) {
    this.setData({ draftStockFilter: e.currentTarget.dataset.value })
  },
  onMinPrice(e) {
    this.setData({ draftMinPrice: e.detail.value })
  },
  onMaxPrice(e) {
    this.setData({ draftMaxPrice: e.detail.value })
  },
  applyFilter() {
    this.refreshRemoteDataIfChanged()
    let minPrice = this.normalisePrice(this.data.draftMinPrice)
    let maxPrice = this.normalisePrice(this.data.draftMaxPrice)
    if (minPrice !== '' && maxPrice !== '' && Number(minPrice) > Number(maxPrice)) {
      const originalMin = minPrice
      minPrice = maxPrice
      maxPrice = originalMin
    }
    const stockFilter = this.data.draftStockFilter || 'all'
    const activeFilterCount = (stockFilter === 'all' ? 0 : 1) + (minPrice !== '' || maxPrice !== '' ? 1 : 0)
    this.applyProductState({
      stockFilter,
      minPrice,
      maxPrice,
      draftMinPrice: minPrice,
      draftMaxPrice: maxPrice,
      activeFilterCount,
      filterOpen: false
    }, true)
  },
  resetFilter() {
    this.refreshRemoteDataIfChanged()
    this.applyProductState({
      stockFilter: 'all',
      minPrice: '',
      maxPrice: '',
      draftStockFilter: 'all',
      draftMinPrice: '',
      draftMaxPrice: '',
      activeFilterCount: 0,
      filterOpen: false
    }, true)
  },
  normalisePrice(value) {
    const number = Number.parseFloat(String(value || '').trim())
    return Number.isFinite(number) && number >= 0 ? String(number) : ''
  },
  calculateProductState(overrides = {}, options = {}) {
    const state = { ...this.data, ...overrides }
    const { keyword, selected, selectedType, sort, imageMatchIds, stockFilter, minPrice, maxPrice, activeFilterCount } = state
    const products = this.productPool || []
    const imagePosition = new Map(imageMatchIds.map((id, index) => [Number(id), index]))
    const q = keyword.trim().toLowerCase()
    const minimum = minPrice === '' ? null : Number(minPrice)
    const maximum = maxPrice === '' ? null : Number(maxPrice)
    const resultMode = Boolean(q) || activeFilterCount > 0 || selectedType === 'image'
    const resultTitle = q
      ? '搜索结果'
      : (selectedType === 'image' ? '识别结果' : (activeFilterCount > 0 ? '筛选结果' : selected))
    let list = products.filter(item => {
      const itemCategories = item.categories && item.categories.length ? item.categories : [item.category]
      const matchKeyword = !q || `${item.name}${item.code}${item.subtitle}${item.style}${item.fabric}${item.displayCategory}${itemCategories.join('')}`.toLowerCase().includes(q)
      const matchCategory = Boolean(q) || selectedType === 'all' || (selectedType === 'image' ? imagePosition.has(Number(item.id)) : itemCategories.includes(selected))
      const matchStock = stockFilter === 'all'
        || (stockFilter === 'available' && item.stock > 0)
        || (stockFilter === 'low' && item.stock > 0 && item.stock <= 10)
        || (stockFilter === 'out' && item.stock === 0)
      const matchPrice = (minimum === null || item.price >= minimum) && (maximum === null || item.price <= maximum)
      return matchKeyword && matchCategory && matchStock && matchPrice
    })
    if (sort === '综合') {
      const category = (this.catalogCategories || []).find(item => item.name === selected && item.type === selectedType)
      const position = selectedType === 'image' ? imagePosition : new Map((category?.productIds || []).map((id, index) => [Number(id), index]))
      list = list.slice().sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    }
    if (sort === '价格升序') list = list.slice().sort((a, b) => a.price - b.price)
    if (sort === '价格降序') list = list.slice().sort((a, b) => b.price - a.price)
    const loadedCount = options.keepLoaded ? Math.max(PAGE_SIZE, this.visibleCount || 0) : PAGE_SIZE
    const visibleCount = Math.min(loadedCount, list.length)
    return {
      list,
      visibleCount,
      patch: {
        productChunks: chunksFor(list, visibleCount, options.keepLoaded ? this.data.productChunks : []),
        resultCount: list.length,
        hasMore: visibleCount < list.length,
        resultMode,
        resultTitle
      }
    }
  },
  applyProductState(overrides = {}, resetScroll = false, callback, options = {}) {
    const result = this.calculateProductState(overrides, options)
    this.filteredProducts = result.list
    this.visibleCount = result.visibleCount
    const patch = { ...overrides, ...result.patch }
    if (resetScroll) {
      this.scrollAnchorToggle = !this.scrollAnchorToggle
      patch.productScrollIntoView = this.scrollAnchorToggle ? 'product-top-b' : 'product-top-a'
    }
    this.resetChunkObservers()
    this.setData(patch, () => {
      patch.productChunks.forEach(chunk => this.observeChunk(chunk.id))
      this.scheduleWarmProducts(result.list.slice(0, WARM_VISIBLE_COUNT))
      if (typeof callback === 'function') callback()
    })
  },
  filterProducts() {
    this.applyProductState()
  },
  loadMore() {
    if (!this.data.hasMore) return
    const list = this.filteredProducts || []
    const start = this.visibleCount || 0
    const end = Math.min(start + PAGE_SIZE, list.length)
    const chunkId = this.data.productChunks.length
    this.visibleCount = end
    this.setData({
      [`productChunks[${chunkId}]`]: productChunk(list.slice(start, end), chunkId),
      resultCount: list.length,
      hasMore: end < list.length
    }, () => this.observeChunk(chunkId))
  },
  observeChunk(chunkId) {
    const token = this.chunkListToken
    // initialRatio 1 makes the first callback fire for a page that is already out of
    // range when observed (e.g. after a fast fling), not only for intersecting ones.
    const observer = this.createIntersectionObserver({ initialRatio: 1 })
    observer
      .relativeTo('.product-list', { top: CHUNK_KEEP_MARGIN, bottom: CHUNK_KEEP_MARGIN })
      .observe(`#product-chunk-${chunkId}`, result => {
        // Ignore callbacks that were already queued for a list that has since been replaced.
        if (token !== this.chunkListToken) return
        const chunk = this.data.productChunks[chunkId]
        if (!chunk) return
        if (result.intersectionRatio > 0) {
          if (chunk.height) this.setData({ [`productChunks[${chunkId}].height`]: 0 })
          return
        }
        const height = result.boundingClientRect?.height || 0
        if (!chunk.height && height > 0) this.setData({ [`productChunks[${chunkId}].height`]: height })
      })
    this.chunkObservers.push(observer)
  },
  resetChunkObservers() {
    this.chunkListToken += 1
    this.chunkObservers.forEach(observer => observer.disconnect())
    this.chunkObservers = []
  },
  scheduleWarmProducts(items) {
    if (this.warmTimer) clearTimeout(this.warmTimer)
    if (!this.remoteProductsReady) return
    this.warmTimer = setTimeout(() => {
      ;(items || [])
        .filter(item => this.remoteProductIds?.has(Number(item.id)))
        .forEach(item => this.warmProductById(Number(item.id), { preloadImage: true }))
    }, WARM_PRODUCT_DELAY)
  },
  warmProductById(id, options = {}) {
    if (!id || !this.remoteProductsReady || !this.remoteProductIds?.has(Number(id))) return Promise.resolve(null)
    if (this.warmedProducts?.has(id)) return Promise.resolve(this.warmedProducts.get(id))
    if (this.productWarmPromises?.has(id)) return this.productWarmPromises.get(id)
    const promise = fetchProduct(id)
      .then(product => {
        this.warmedProducts.set(id, product)
        while (this.warmedProducts.size > WARM_PRODUCT_LIMIT) {
          this.warmedProducts.delete(this.warmedProducts.keys().next().value)
        }
        this.productWarmPromises.delete(id)
        // Only the idle warm-up of the first result preloads the large image; touches
        // while scrolling just fetch the small product JSON so they do not compete
        // with the visible list thumbnails for bandwidth.
        if (options.preloadImage && !this.productNavigating) preloadImage(thumbnailImage(primaryProductImage(product), 960, 'width'))
        return product
      })
      .catch(() => {
        this.productWarmPromises.delete(id)
        return null
      })
    this.productWarmPromises.set(id, promise)
    return promise
  },
  warmProduct(e) {
    this.warmProductById(Number(e.currentTarget.dataset.id))
  },
  goProduct(e) {
    if (this.productNavigating) return
    const id = Number(e.currentTarget.dataset.id)
    if (!this.remoteProductsReady || !this.remoteProductIds?.has(id)) {
      wx.showToast({ title: '商品正在加载，请稍候', icon: 'none' })
      return
    }
    const summary = (this.filteredProducts || this.productPool || []).find(item => Number(item.id) === id)
    const warmedProduct = this.warmedProducts?.get(id)
    const warmPromise = this.warmProductById(id)
    const app = getApp()
    this.productNavigating = true
    app.globalData.productPreview = warmedProduct || summary || null
    app.globalData.productPreviewReady = Boolean(warmedProduct)
    app.globalData.productWarmRequest = { id, promise: warmPromise }
    wx.navigateTo({
      url: `/pages/product/product?id=${id}`,
      fail: () => { this.productNavigating = false }
    })
  },
  onShareAppMessage() {
    const share = categoryShareState(this)
    return appShare({ ...share, path: `/pages/category/category?${share.query}` })
  },
  onShareTimeline() {
    return timelineShare(categoryShareState(this))
  },
  onAddToFavorites() {
    return favoriteShare(categoryShareState(this))
  },
  onReady() {
    // The first page rendered from initial data has no observer yet.
    if (!this.chunkObservers.length && this.data.productChunks.length) this.observeChunk(0)
  },
  onUnload() {
    if (getApp().categoryPage === this) getApp().categoryPage = null
    this.resetChunkObservers()
    if (this.warmTimer) clearTimeout(this.warmTimer)
  }
})
