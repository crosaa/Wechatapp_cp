const { fetchProduct, readProductSnapshot, refreshDataVersion, dataVersion, thumbnailImage } = require('../../common/api')
const { firstImage, appShare, timelineShare, favoriteShare, productTitle, productQuery } = require('../../common/share')
const { saveOriginalImage } = require('../../common/image')
const { refreshFromServer } = require('../../common/pull-refresh')

const DETAIL_BATCH_SIZE = 6
const PREVIEW_IMAGE_SIZE = 2000

function buildDetailSlides(product) {
  return (product.detailImages || []).map(original => ({
    original,
    display: thumbnailImage(original, 960, 'width'),
    preview: thumbnailImage(original, PREVIEW_IMAGE_SIZE, 'width')
  }))
}

function detailState(product, detailSlides = buildDetailSlides(product)) {
  const image = product.image || product.images?.[0] || ''
  const detailImages = product.detailImages || []
  return {
    id: product.id,
    code: product.code || '',
    name: product.name || '',
    subtitle: product.subtitle || '',
    image,
    imageDisplay: thumbnailImage(image, 960, 'width'),
    imagePreview: thumbnailImage(image, PREVIEW_IMAGE_SIZE, 'width'),
    detailText: product.detailText || '',
    detailImages,
    detailImageCount: detailSlides.length,
    detailSlides: detailSlides.slice(0, DETAIL_BATCH_SIZE),
    displayCategory: product.displayCategory || '',
    category: product.category || '',
    fabric: product.fabric || '',
    style: product.style || '',
    colors: product.colors || []
  }
}

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    pageReady: false,
    product: detailState({ colors: [], detailImages: [] }),
    refreshing: false
  },
  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/home/home' })
  },
  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },
  onLoad(options) {
    this.productId = Number(options.id)
    this.hasShownOnce = false
    const cachedProduct = readProductSnapshot(this.productId)
    if (cachedProduct) {
      this.applyProduct(cachedProduct)
      this.refreshProduct()
    }
    else this.loadProduct(options.id)
  },
  onShow() {
    if (this.hasShownOnce) this.refreshProduct()
    this.hasShownOnce = true
  },
  async refreshProduct() {
    try {
      if (await refreshDataVersion(true)) await this.loadProduct(this.productId)
    } catch (error) {
      console.info('商品详情同步检查失败', error.errMsg || error.message)
    }
  },
  onRefresh() {
    refreshFromServer(this, async () => {
      // Unchanged since it was shown: skip the re-render, which on a page with this many
      // pictures made the refresh animation stutter.
      if (dataVersion() !== this.renderedVersion) this.applyProduct(await fetchProduct(this.productId))
    })
  },
  async loadProduct(id) {
    try { this.applyProduct(await fetchProduct(id)) }
    catch (error) { console.info('商品服务未启动，详情页继续使用本地演示数据', error.errMsg || error.message) }
  },
  applyProduct(product) {
    this.renderedVersion = dataVersion()
    this.allDetailSlides = buildDetailSlides(product)
    this.setData({ pageReady: true, product: detailState(product, this.allDetailSlides) })
  },
  loadMoreSlides() {
    const visible = this.data.product.detailSlides || []
    if (visible.length >= (this.allDetailSlides || []).length) return
    this.setData({
      'product.detailSlides': this.allDetailSlides.slice(0, visible.length + DETAIL_BATCH_SIZE)
    })
  },
  onDetailImageError(event) {
    const original = event.currentTarget.dataset.url
    const visible = this.data.product.detailSlides || []
    if (!visible.some(slide => slide.original === original)) return
    // Hide a picture that cannot be loaded (e.g. its file is missing on the server)
    // instead of leaving an empty box with a download button.
    this.allDetailSlides = (this.allDetailSlides || []).filter(slide => slide.original !== original)
    this.setData({
      'product.detailSlides': this.allDetailSlides.slice(0, visible.length),
      'product.detailImageCount': this.allDetailSlides.length
    })
  },
  previewImage(event) {
    const currentOriginal = event.currentTarget.dataset.url
    if (!currentOriginal) return
    const previewPairs = [
      { original: this.data.product.image, preview: this.data.product.imagePreview },
      ...(this.allDetailSlides || [])
    ].filter(item => item.original && item.preview)
    const current = previewPairs.find(item => item.original === currentOriginal)?.preview
    if (!current) return
    const urls = [...new Set([
      ...previewPairs.map(item => item.preview)
    ].filter(Boolean))]
    wx.previewImage({ current, urls, showmenu: true })
  },
  downloadOriginal(event) {
    saveOriginalImage(event.currentTarget.dataset.url)
  },
  onShareAppMessage() {
    const query = productQuery(this.data.product)
    return appShare({
      title: `${this.data.product.name || '商品'}详情`,
      path: `/pages/product-detail/product-detail?${query}`,
      imageUrl: firstImage(this.data.product)
    })
  },
  onShareTimeline() {
    return timelineShare({
      title: productTitle(this.data.product),
      query: productQuery(this.data.product),
      imageUrl: firstImage(this.data.product)
    })
  },
  onAddToFavorites() {
    return favoriteShare({
      title: productTitle(this.data.product),
      query: productQuery(this.data.product),
      imageUrl: firstImage(this.data.product)
    })
  }
})
