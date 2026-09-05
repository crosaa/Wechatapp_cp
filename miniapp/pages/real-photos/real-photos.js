const { fetchProduct, readProductSnapshot, refreshDataVersion, thumbnailImage } = require('../../common/api')
const { firstImage, appShare, timelineShare, favoriteShare, productTitle, productQuery } = require('../../common/share')
const { saveOriginalImage } = require('../../common/image')

const PHOTO_BATCH_SIZE = 8
const PREVIEW_IMAGE_SIZE = 2000

function galleryImages(product, selected = '全部') {
  const realImages = product.realImages || []
  const selectedImages = selected === '全部' ? realImages : realImages.filter(item => item.category === selected)
  return selectedImages.map(item => ({
    ...item,
    displayUrl: thumbnailImage(item.url, 960, 'width'),
    previewUrl: thumbnailImage(item.url, PREVIEW_IMAGE_SIZE, 'width')
  }))
}

function galleryState(product, selected = '全部', displayImages = galleryImages(product, selected)) {
  const realImages = product.realImages || []
  const categories = ['全部', ...new Set(realImages.map(item => item.category || '实物展示'))]
  return {
    product: { id: product.id, name: product.name || '' },
    categories,
    selected,
    imageCount: displayImages.length,
    displayImages: displayImages.slice(0, PHOTO_BATCH_SIZE)
  }
}

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    pageReady: false,
    ...galleryState({ id: 0, name: '', realImages: [] })
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
      this.sourceProduct = cachedProduct
      this.applyGallery(cachedProduct)
      this.refreshProduct()
    } else {
      this.loadProduct(options.id)
    }
  },
  onShow() {
    if (this.hasShownOnce) this.refreshProduct()
    this.hasShownOnce = true
  },
  async refreshProduct() {
    try {
      if (await refreshDataVersion(true)) await this.loadProduct(this.productId, this.data.selected)
    } catch (error) {
      console.info('实拍图同步检查失败', error.errMsg || error.message)
    }
  },
  async loadProduct(id, selected = '全部') {
    try {
      this.sourceProduct = await fetchProduct(id)
      const categories = ['全部', ...new Set((this.sourceProduct.realImages || []).map(item => item.category || '实物展示'))]
      this.applyGallery(this.sourceProduct, categories.includes(selected) ? selected : '全部')
    }
    catch (error) { console.info('商品服务未启动，实拍图继续使用本地演示数据', error.errMsg || error.message) }
  },
  selectCategory(event) {
    if (!this.sourceProduct) return
    this.applyGallery(this.sourceProduct, event.currentTarget.dataset.category)
  },
  applyGallery(product, selected = '全部') {
    this.allDisplayImages = galleryImages(product, selected)
    this.setData({ pageReady: true, ...galleryState(product, selected, this.allDisplayImages) })
  },
  onReachBottom() {
    const visible = this.data.displayImages || []
    if (visible.length >= (this.allDisplayImages || []).length) return
    this.setData({
      displayImages: this.allDisplayImages.slice(0, visible.length + PHOTO_BATCH_SIZE)
    })
  },
  previewImage(event) {
    const original = event.currentTarget.dataset.url
    const images = this.allDisplayImages || this.data.displayImages
    const current = images.find(item => item.url === original)?.previewUrl
    if (!current) return
    const urls = images.map(item => item.previewUrl).filter(Boolean)
    wx.previewImage({ current, urls, showmenu: true })
  },
  downloadOriginal(event) {
    saveOriginalImage(event.currentTarget.dataset.url)
  },
  designWithPhoto(event) {
    const sourceImage = event.currentTarget.dataset.url
    const product = this.sourceProduct
    if (!sourceImage || !product) return
    wx.setStorageSync('designerProduct', {
      id: product.id,
      code: product.code || '',
      name: product.name || '',
      image: product.image || sourceImage,
      selectedColor: '',
      sourceImage,
      sourceType: '实拍图',
      launchKey: `${Date.now()}-${product.id}-real`
    })
    wx.switchTab({ url: '/pages/designer/designer' })
  },
  onShareAppMessage() {
    const query = productQuery(this.sourceProduct || this.data.product)
    return appShare({
      title: `${this.data.product.name || '商品'}实拍图`,
      path: `/pages/real-photos/real-photos?${query}`,
      imageUrl: this.data.displayImages[0]?.url || firstImage(this.sourceProduct)
    })
  },
  onShareTimeline() {
    const product = this.sourceProduct || this.data.product
    return timelineShare({
      title: productTitle(product),
      query: productQuery(product),
      imageUrl: this.data.displayImages[0]?.url || firstImage(product)
    })
  },
  onAddToFavorites() {
    const product = this.sourceProduct || this.data.product
    return favoriteShare({
      title: productTitle(product),
      query: productQuery(product),
      imageUrl: this.data.displayImages[0]?.url || firstImage(product)
    })
  }
})
