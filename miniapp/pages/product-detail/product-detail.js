const { fetchProduct, readProductSnapshot, refreshDataVersion, thumbnailImage } = require('../../common/api')
const { firstImage, appShare, timelineShare, favoriteShare, productTitle, productQuery } = require('../../common/share')

const DETAIL_BATCH_SIZE = 6

function buildDetailSlides(product) {
  return (product.detailImages || []).map(original => ({
    original,
    display: thumbnailImage(original, 960, 'width')
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
    product: detailState({ colors: [], detailImages: [] })
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
  async loadProduct(id) {
    try { this.applyProduct(await fetchProduct(id)) }
    catch (error) { console.info('商品服务未启动，详情页继续使用本地演示数据', error.errMsg || error.message) }
  },
  applyProduct(product) {
    this.allDetailSlides = buildDetailSlides(product)
    this.setData({ pageReady: true, product: detailState(product, this.allDetailSlides) })
  },
  onReachBottom() {
    const visible = this.data.product.detailSlides || []
    if (visible.length >= (this.allDetailSlides || []).length) return
    this.setData({
      'product.detailSlides': this.allDetailSlides.slice(0, visible.length + DETAIL_BATCH_SIZE)
    })
  },
  previewImage(event) {
    const current = event.currentTarget.dataset.url
    if (!current) return
    const urls = [...new Set([
      this.data.product.image,
      ...(this.data.product.detailImages || [])
    ].filter(Boolean))]
    wx.previewImage({ current, urls, showmenu: true })
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
