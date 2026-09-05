const { fetchProduct, fetchStoreSettings, readProductSnapshot, refreshDataVersion, thumbnailImage, defaultStoreSettings } = require('../../common/api')
const { firstImage, appShare, timelineShare, favoriteShare, productTitle, productQuery } = require('../../common/share')
const { saveOriginalImage } = require('../../common/image')

const featureIcons = ['◫', '♨', '⌁', '✓', '★', '品', '服', '定']
const PREVIEW_IMAGE_SIZE = 2000

function featureItems(features) {
  return (features || []).map((name, index) => ({ name, icon: featureIcons[index % featureIcons.length] }))
}

function normaliseColorSizeStocks(product) {
  const colors = product.colors || []
  const sizes = product.sizes || []
  const source = product.colorSizeStocks && typeof product.colorSizeStocks === 'object' ? product.colorSizeStocks : {}
  const legacy = product.sizeStocks && typeof product.sizeStocks === 'object' ? product.sizeStocks : {}
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

function prepareProduct(source) {
  const product = source && typeof source === 'object' ? source : {}
  const colors = Array.isArray(product.colors) ? product.colors.filter(Boolean) : []
  const sizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean) : []
  const specialSizePrices = (Array.isArray(product.specialSizePrices) ? product.specialSizePrices : []).map(item => ({
    fromSize: String(item?.fromSize || ''),
    toSize: String(item?.toSize || ''),
    price: Number(item?.price)
  })).filter(item => sizes.includes(item.fromSize) && sizes.includes(item.toSize) && Number.isFinite(item.price) && item.price >= 0)
  const images = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : (product.image ? [product.image] : [])
  const safeProduct = { ...product, price: Math.max(0, Number(product.price) || 0), colors, sizes, specialSizePrices, images }
  const colorSizeStocks = normaliseColorSizeStocks(safeProduct)
  const sizeStocks = Object.fromEntries(sizes.map(size => [
    size,
    colors.length
      ? colors.reduce((total, color) => total + (colorSizeStocks[color]?.[size] || 0), 0)
      : Math.max(0, Number(product.sizeStocks?.[size]) || 0)
  ]))
  const sourceColorImages = product.colorImages || {}
  const sourceColorGalleries = product.colorGalleries || {}
  const colorGalleries = Object.fromEntries(colors.map(color => {
    const gallery = Array.isArray(sourceColorGalleries[color]) ? sourceColorGalleries[color].filter(Boolean) : []
    const explicitImage = sourceColorImages[color] || ''
    return [color, gallery.length ? gallery : (explicitImage ? [explicitImage] : [])]
  }))
  const colorImages = Object.fromEntries(colors.map(color => colorGalleries[color][0] ? [color, colorGalleries[color][0]] : null).filter(Boolean))
  return {
    ...safeProduct,
    image: product.image || images[0] || '',
    detailImageCount: Array.isArray(product.detailImages) ? product.detailImages.length : 0,
    realImageCount: Array.isArray(product.realImages) ? product.realImages.length : 0,
    detailImages: [],
    realImages: [],
    sizeStocks,
    colorSizeStocks,
    colorImages,
    colorGalleries
  }
}

function priceForSize(product, size) {
  const basePrice = Math.max(0, Number(product.price) || 0)
  const sizeIndex = (product.sizes || []).indexOf(size)
  if (sizeIndex < 0) return { price: basePrice, specialPrice: false }
  const matchedRange = (product.specialSizePrices || []).find(range => {
    const fromIndex = product.sizes.indexOf(range.fromSize)
    const toIndex = product.sizes.indexOf(range.toSize)
    return fromIndex >= 0 && toIndex >= fromIndex && sizeIndex >= fromIndex && sizeIndex <= toIndex
  })
  return matchedRange
    ? { price: Math.max(0, Number(matchedRange.price) || 0), specialPrice: true }
    : { price: basePrice, specialPrice: false }
}

function sizeOptionsForColor(product, color) {
  const colorStocks = product.colorSizeStocks?.[color]
  const source = colorStocks && typeof colorStocks === 'object' ? colorStocks : product.sizeStocks || {}
  return (product.sizes || []).map(name => {
    const stock = Math.max(0, Number(source[name]) || 0)
    const pricing = priceForSize(product, name)
    return {
      name,
      stock,
      ...pricing,
      stockLabel: stock === 0 ? '缺货' : `库存 ${stock}${pricing.specialPrice ? ` · ¥${pricing.price}` : ''}`
    }
  })
}

function selectProductColor(product, color) {
  const sizeOptions = sizeOptionsForColor(product, color)
  const selectedOption = sizeOptions.find(option => option.stock > 0)
  return {
    product: { ...product, sizeOptions },
    displayStock: sizeOptions.reduce((total, option) => total + option.stock, 0),
    selectedSize: selectedOption?.name || '',
    displayPrice: selectedOption?.price ?? product.price,
    specialPriceActive: Boolean(selectedOption?.specialPrice)
  }
}

function colorGalleryFor(product, color) {
  const gallery = product.colorGalleries?.[color]
  return Array.isArray(gallery) && gallery.length ? gallery : [product.images?.[0] || product.image]
}

function galleryState(product, color, preferColorImage = false) {
  const colorGallery = colorGalleryFor(product, color).filter(Boolean)
  const selectedGallery = [...new Set([product.posterImage, ...colorGallery].filter(Boolean))]
  const firstColorImage = colorGallery.find(url => url !== product.posterImage) || colorGallery[0] || ''
  const colorImageIndex = firstColorImage ? selectedGallery.indexOf(firstColorImage) : 0
  const galleryCurrent = preferColorImage && colorImageIndex >= 0 ? colorImageIndex : 0
  const currentImage = selectedGallery[galleryCurrent] || ''
  return {
    selectedGallery,
    selectedGallerySlides: selectedGallery.map((original, index) => ({
      original,
      display: thumbnailImage(original, 960, 'width'),
      preview: thumbnailImage(original, PREVIEW_IMAGE_SIZE, 'width'),
      src: index === galleryCurrent ? thumbnailImage(original, 960, 'width') : ''
    })),
    galleryCurrent,
    galleryLabel: product.posterImage && currentImage === product.posterImage ? '商品海报' : (color || '商品图片')
  }
}

const emptyProduct = prepareProduct({
  id: 0,
  code: '',
  name: '',
  subtitle: '',
  category: '',
  displayCategory: '',
  price: 0,
  stock: 0,
  unit: '件',
  fabric: '',
  style: '',
  colors: [],
  sizes: [],
  images: [],
  image: '',
  detailImages: [],
  realImages: []
})

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    product: emptyProduct,
    selectedColor: '',
    selectedGallery: [],
    selectedGallerySlides: [],
    galleryCurrent: 0,
    galleryLabel: '商品图片',
    selectedSize: '',
    displayStock: 0,
    displayPrice: 0,
    specialPriceActive: false,
    productReady: false,
    loadError: false,
    featureItems: featureItems(defaultStoreSettings.productFeatures)
  },
  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/home/home' })
  },
  onLoad(options) {
    const id = Number(options.id)
    this.currentProductId = id
    this.hasShownOnce = false
    const app = getApp()
    const pendingPreview = app.globalData.productPreview
    const pendingWarmRequest = app.globalData.productWarmRequest
    const cachedProduct = readProductSnapshot(id)
    const previewReady = Boolean(cachedProduct || app.globalData.productPreviewReady)
    const rawPreview = cachedProduct || (pendingPreview && Number(pendingPreview.id) === id ? pendingPreview : null)
    const preview = !previewReady && rawPreview?.previewImage
      ? { ...rawPreview, image: rawPreview.previewImage, images: [rawPreview.previewImage] }
      : rawPreview
    const warmPromise = pendingWarmRequest && Number(pendingWarmRequest.id) === id
      ? pendingWarmRequest.promise
      : null
    app.globalData.productPreview = null
    app.globalData.productPreviewReady = false
    app.globalData.productWarmRequest = null
    if (preview) this.applyProduct(preview, previewReady)
    this.loadRemoteProduct(id, warmPromise, previewReady)
  },
  onShow() {
    if (this.hasShownOnce) this.refreshCurrentProduct()
    this.hasShownOnce = true
  },
  async refreshCurrentProduct() {
    if (!this.currentProductId) return
    try {
      if (!await refreshDataVersion(true)) return
      const product = await fetchProduct(this.currentProductId)
      this.applyProduct(product, true)
      const settings = await fetchStoreSettings()
      this.setData({ featureItems: featureItems(settings.productFeatures) })
    } catch (error) {
      console.info('商品详情同步检查失败', error.errMsg || error.message)
    }
  },
  applyProduct(source, productReady) {
    const product = prepareProduct(source)
    const selectedColor = product.colors[0] || ''
    const selection = selectProductColor(product, selectedColor)
    this.clearGalleryPrefetchTimer()
    this.setData({
      ...selection,
      selectedColor,
      ...galleryState(product, selectedColor),
      productReady,
      loadError: false
    }, () => this.scheduleGalleryNeighbors(this.data.galleryCurrent))
  },
  async loadRemoteProduct(id, warmPromise, skipDuplicateApply = false) {
    const settingsPromise = fetchStoreSettings()
    try {
      const product = await (warmPromise || fetchProduct(id))
      if (!product) throw new Error('商品资料加载失败')
      if (!skipDuplicateApply) this.applyProduct(product, true)
    } catch (error) {
      this.setData({ loadError: true })
      console.info('商品资料加载失败', error.errMsg || error.message)
    }
    settingsPromise
      .then(storeSettings => this.setData({ featureItems: featureItems(storeSettings.productFeatures) }))
      .catch(error => console.info('店铺设置加载失败', error.errMsg || error.message))
  },
  selectColor(e) {
    const selectedColor = e.currentTarget.dataset.value
    const selection = selectProductColor(this.data.product, selectedColor)
    this.clearGalleryPrefetchTimer()
    this.setData(
      { ...selection, selectedColor, ...galleryState(selection.product, selectedColor, true) },
      () => this.scheduleGalleryNeighbors(this.data.galleryCurrent)
    )
  },
  onGalleryChange(e) {
    const galleryCurrent = e.detail.current
    const currentImage = this.data.selectedGallery[galleryCurrent] || ''
    const galleryLabel = this.data.product.posterImage && currentImage === this.data.product.posterImage ? '商品海报' : (this.data.selectedColor || '商品图片')
    this.setData({ galleryCurrent, galleryLabel })
    this.scheduleGalleryNeighbors(galleryCurrent)
  },
  clearGalleryPrefetchTimer() {
    if (this.galleryPrefetchTimer) {
      clearTimeout(this.galleryPrefetchTimer)
      this.galleryPrefetchTimer = null
    }
  },
  scheduleGalleryNeighbors(index) {
    this.clearGalleryPrefetchTimer()
    this.galleryPrefetchTimer = setTimeout(() => {
      this.galleryPrefetchTimer = null
      const slides = this.data.selectedGallerySlides || []
      const indexes = [index, index - 1, index + 1].filter(value => value >= 0 && value < slides.length)
      const updates = {}
      indexes.forEach(value => {
        if (!slides[value].src) updates[`selectedGallerySlides[${value}].src`] = slides[value].display
      })
      if (Object.keys(updates).length) this.setData(updates)
    }, 180)
  },
  previewGalleryImage(e) {
    const original = e.currentTarget.dataset.url || this.data.selectedGallery[this.data.galleryCurrent]
    const slides = this.data.selectedGallerySlides || []
    const current = slides.find(item => item.original === original)?.preview
    if (!current) return
    wx.previewImage({
      current,
      urls: [...new Set(slides.map(item => item.preview).filter(Boolean))],
      showmenu: true
    })
  },
  downloadOriginal(e) {
    saveOriginalImage(e.currentTarget.dataset.url || this.data.selectedGallery[this.data.galleryCurrent])
  },
  selectSize(e) {
    if (Number(e.currentTarget.dataset.stock) <= 0) {
      wx.showToast({ title: '该尺码暂时缺货', icon: 'none' })
      return
    }
    const selectedSize = e.currentTarget.dataset.value
    const selectedOption = (this.data.product.sizeOptions || []).find(option => option.name === selectedSize)
    this.setData({
      selectedSize,
      displayPrice: selectedOption?.price ?? this.data.product.price,
      specialPriceActive: Boolean(selectedOption?.specialPrice)
    })
  },
  savePoster() {
    const posterImage = this.data.product.posterImage
    if (!posterImage) {
      wx.showToast({ title: '该商品暂未上传海报', icon: 'none' })
      return
    }
    const preview = thumbnailImage(posterImage, PREVIEW_IMAGE_SIZE, 'width')
    wx.previewImage({ current: preview, urls: [preview], showmenu: true })
  },
  goHome() { wx.switchTab({ url: '/pages/home/home' }) },
  goDetailPage() { wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${this.data.product.id}` }) },
  goRealPhotos() { wx.navigateTo({ url: `/pages/real-photos/real-photos?id=${this.data.product.id}` }) },
  goDesigner() {
    const { id, code, name, image, colorImages, colorGalleries } = this.data.product
    const selectedColor = this.data.selectedColor || ''
    const colorGallery = colorGalleries?.[selectedColor] || []
    const sourceImage = colorImages?.[selectedColor] || colorGallery[0] || image
    wx.setStorageSync('designerProduct', {
      id,
      code,
      name,
      image,
      selectedColor,
      sourceImage,
      sourceType: selectedColor ? `${selectedColor}款式图` : '商品款式图',
      launchKey: `${Date.now()}-${id}-${selectedColor}`
    })
    wx.switchTab({ url: '/pages/designer/designer' })
  },
  onShareAppMessage() {
    const query = productQuery(this.data.product)
    return appShare({
      title: productTitle(this.data.product),
      path: `/pages/product/product?${query}`,
      imageUrl: this.data.selectedGallery[this.data.galleryCurrent] || firstImage(this.data.product)
    })
  },
  onShareTimeline() {
    return timelineShare({
      title: productTitle(this.data.product),
      query: productQuery(this.data.product),
      imageUrl: this.data.selectedGallery[this.data.galleryCurrent] || firstImage(this.data.product)
    })
  },
  onAddToFavorites() {
    return favoriteShare({
      title: productTitle(this.data.product),
      query: productQuery(this.data.product),
      imageUrl: this.data.selectedGallery[this.data.galleryCurrent] || firstImage(this.data.product)
    })
  },
  onUnload() {
    this.clearGalleryPrefetchTimer()
  }
})
