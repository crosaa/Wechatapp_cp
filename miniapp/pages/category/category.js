const { fetchProduct, fetchCatalogContent, readCatalogSnapshot, refreshDataVersion, clearPublicDataCache, thumbnailImage, defaultStoreSettings } = require('../../common/api')
const { appName, firstImage, appShare, timelineShare, favoriteShare } = require('../../common/share')

const ALL_CATEGORY = { id: 'all', name: '全部商品', type: 'all', icon: 'ALL', tone: '#8b918a' }
const PAGE_SIZE = 24
const WARM_PRODUCT_LIMIT = 20
const WARM_VISIBLE_COUNT = 1
const WARM_PRODUCT_DELAY = 1600
const initialCatalogSnapshot = readCatalogSnapshot()
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
    imageUrl: firstImage(page.data.displayProducts?.[0])
  }
}

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    catalogReady: Boolean(initialCatalogSnapshot),
    categories: [ALL_CATEGORY, ...initialCatalogCategories],
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
    displayProducts: initialCategory.products.slice(0, PAGE_SIZE),
    resultCount: initialCategory.products.length,
    hasMore: initialCategory.products.length > PAGE_SIZE,
    productScrollIntoView: 'product-top-a',
    resultMode: initialCategory.resultMode,
    resultTitle: initialCategory.resultTitle
  },
  onLoad(options) {
    this.hasShownOnce = false
    this.warmedProducts = new Map()
    this.productWarmPromises = new Map()
    this.remoteProductIds = new Set(initialCatalogProducts.map(item => Number(item.id)))
    this.remoteProductsReady = initialCatalogProducts.length > 0
    this.productPool = initialCatalogProducts
    this.filteredProducts = initialCategory.products
    this.visibleCount = Math.min(PAGE_SIZE, initialCategory.products.length)
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
  async loadRemoteProducts() {
    try {
      const catalog = await fetchCatalogContent()
      const remoteProducts = catalog.products
      const remoteCategories = catalog.categories
      const storeSettings = catalog.storeSettings
      const allCategories = [ALL_CATEGORY].concat(remoteCategories.length ? remoteCategories : this.data.categories.slice(1))
      this.productPool = remoteProducts.length ? remoteProducts : this.productPool
      this.remoteProductIds = new Set(remoteProducts.map(item => Number(item.id)))
      this.remoteProductsReady = remoteProducts.length > 0
      this.applyProductState({
        catalogReady: true,
        categories: allCategories,
        searchPlaceholder: storeSettings.searchPlaceholder
      })
    } catch (error) {
      console.info('商品服务未启动，分类页继续使用本地演示数据', error.errMsg || error.message)
    }
  },
  onShow() {
    this.productNavigating = false
    const intent = wx.getStorageSync('categoryIntent')
    if (intent && intent.reset) {
      wx.removeStorageSync('categoryIntent')
      const reloadLatest = this.hasShownOnce
      this.hasShownOnce = true
      this.resetCategoryState(reloadLatest)
      return
    }
    if (intent) {
      wx.removeStorageSync('categoryIntent')
      const intentKeyword = typeof intent.keyword === 'string' ? intent.keyword : (intent.type === 'image' ? '' : this.data.keyword)
      const isKeywordSearch = intentKeyword.trim().length > 0
      this.applyProductState({
        selected: isKeywordSearch ? '全部商品' : (intent.category || this.data.selected),
        selectedType: isKeywordSearch ? 'all' : (intent.type || (intent.category === '全部商品' ? 'all' : this.data.selectedType)),
        keyword: intentKeyword,
        imageMatchIds: Array.isArray(intent.productIds) ? intent.productIds.map(Number) : []
      }, true)
    }
    if (this.hasShownOnce) this.refreshRemoteDataIfChanged()
    this.hasShownOnce = true
  },
  async refreshRemoteDataIfChanged(force = false) {
    try {
      const changed = await refreshDataVersion(force)
      if (!changed) return false
      this.warmedProducts.clear()
      this.productWarmPromises.clear()
      await this.loadRemoteProducts()
      return true
    } catch (error) {
      console.info('分类商品同步检查失败', error.errMsg || error.message)
      return false
    }
  },
  openSearch() {
    const keyword = this.data.keyword.trim()
    const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
    wx.navigateTo({ url: `/pages/search/search${query}` })
  },
  goBack() {
    this.resetCategoryState(false)
    wx.setStorageSync('categoryIntent', {
      reset: true,
      category: ALL_CATEGORY.name,
      type: 'all',
      keyword: ''
    })
    wx.switchTab({ url: '/pages/home/home' })
  },
  resetCategoryState(reloadLatest = false) {
    if (reloadLatest) {
      clearPublicDataCache()
      this.warmedProducts.clear()
      this.productWarmPromises.clear()
    }
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
    }, true, () => {
      if (reloadLatest) this.loadRemoteProducts()
    })
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
  calculateProductState(overrides = {}) {
    const state = { ...this.data, ...overrides }
    const { keyword, selected, selectedType, sort, categories, imageMatchIds, stockFilter, minPrice, maxPrice, activeFilterCount } = state
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
      const category = categories.find(item => item.name === selected && item.type === selectedType)
      const position = selectedType === 'image' ? imagePosition : new Map((category?.productIds || []).map((id, index) => [Number(id), index]))
      list = list.slice().sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    }
    if (sort === '价格升序') list = list.slice().sort((a, b) => a.price - b.price)
    if (sort === '价格降序') list = list.slice().sort((a, b) => b.price - a.price)
    const visibleCount = Math.min(PAGE_SIZE, list.length)
    return {
      list,
      visibleCount,
      patch: {
        displayProducts: list.slice(0, visibleCount),
        resultCount: list.length,
        hasMore: visibleCount < list.length,
        resultMode,
        resultTitle
      }
    }
  },
  applyProductState(overrides = {}, resetScroll = false, callback) {
    const result = this.calculateProductState(overrides)
    this.filteredProducts = result.list
    this.visibleCount = result.visibleCount
    const patch = { ...overrides, ...result.patch }
    if (resetScroll) {
      this.scrollAnchorToggle = !this.scrollAnchorToggle
      patch.productScrollIntoView = this.scrollAnchorToggle ? 'product-top-b' : 'product-top-a'
    }
    this.setData(patch, () => {
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
    const updates = {
      resultCount: list.length,
      hasMore: end < list.length
    }
    list.slice(start, end).forEach((item, index) => {
      updates[`displayProducts[${start + index}]`] = item
    })
    this.visibleCount = end
    this.setData(updates)
  },
  scheduleWarmProducts(items) {
    if (this.warmTimer) clearTimeout(this.warmTimer)
    if (!this.remoteProductsReady) return
    this.warmTimer = setTimeout(() => {
      ;(items || [])
        .filter(item => this.remoteProductIds?.has(Number(item.id)))
        .forEach(item => this.warmProductById(Number(item.id)))
    }, WARM_PRODUCT_DELAY)
  },
  warmProductById(id) {
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
        if (!this.productNavigating) preloadImage(thumbnailImage(primaryProductImage(product), 960, 'width'))
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
  onUnload() {
    if (this.warmTimer) clearTimeout(this.warmTimer)
  }
})
