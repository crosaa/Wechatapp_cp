const { fetchHomeContent, readHomeSnapshot, recognizeProductImage, refreshDataVersion, defaultStoreSettings } = require('../../common/api')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')

const initialHomeSnapshot = readHomeSnapshot()
const initialHomeSettings = initialHomeSnapshot?.storeSettings || defaultStoreSettings
const initialHeroImages = initialHomeSettings.homeHeroImages?.length ? initialHomeSettings.homeHeroImages : []
const initialHomeCategories = initialHomeSnapshot?.categories || []

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    keyword: '',
    homeReady: Boolean(initialHomeSnapshot),
    storeName: initialHomeSettings.storeName,
    storeIcon: initialHomeSettings.storeIcon,
    heroImages: initialHeroImages,
    heroSlides: initialHeroImages.map((url, index) => ({ url, src: index === 0 ? url : '' })),
    settings: initialHomeSettings,
    heroCurrent: 0,
    imageRecognizing: false,
    categories: initialHomeCategories
  },
  onLoad() {
    if (initialHomeSnapshot) {
      this.scheduleHeroNeighbors(0)
      this.refreshRemoteContent()
    } else {
      this.loadRemoteContent()
    }
  },
  onUnload() {
    this.clearHeroPrefetchTimer()
  },
  onShow() {
    wx.setStorageSync('categoryIntent', {
      reset: true,
      category: '全部商品',
      type: 'all',
      keyword: ''
    })
    if (this.data.keyword) this.setData({ keyword: '' })
    if (this.hasShownOnce) this.refreshRemoteContent()
    this.hasShownOnce = true
  },
  async refreshRemoteContent() {
    try {
      if (await refreshDataVersion(true)) await this.loadRemoteContent()
    } catch (error) {
      console.info('首页同步检查失败', error.errMsg || error.message)
    }
  },
  async loadRemoteContent() {
    try {
      this.applyHomeContent(await fetchHomeContent())
    } catch (error) {
      console.info('商品服务未启动，首页继续使用本地演示数据', error.errMsg || error.message)
    }
  },
  applyHomeContent(content = {}) {
    const remoteCategories = Array.isArray(content.categories) ? content.categories : []
    const storeSettings = content.storeSettings || defaultStoreSettings
    const heroImages = storeSettings.homeHeroImages?.length ? storeSettings.homeHeroImages : ['/assets/hero.jpg']
    const currentHeroImages = this.data.heroImages || []
    const sameHeroImages = currentHeroImages.length === heroImages.length
      && currentHeroImages.every((url, index) => url === heroImages[index])
    const patch = {
      storeName: storeSettings.storeName,
      storeIcon: storeSettings.storeIcon,
      settings: storeSettings,
      homeReady: true,
      categories: remoteCategories.length ? remoteCategories : this.data.categories
    }
    if (!sameHeroImages) {
      this.clearHeroPrefetchTimer()
      patch.heroImages = heroImages
      patch.heroSlides = heroImages.map((url, index) => ({ url, src: index === 0 ? url : '' }))
      patch.heroCurrent = 0
    }
    this.setData(patch, () => {
      if (!sameHeroImages) this.scheduleHeroNeighbors(0)
    })
    getApp().globalData.brandName = storeSettings.storeName
  },
  onHeroChange(e) {
    const heroCurrent = Number(e.detail.current) || 0
    this.setData({ heroCurrent })
    this.loadHeroNeighbors(heroCurrent)
  },
  clearHeroPrefetchTimer() {
    if (!this.heroPrefetchTimer) return
    clearTimeout(this.heroPrefetchTimer)
    this.heroPrefetchTimer = null
  },
  scheduleHeroNeighbors(index) {
    this.clearHeroPrefetchTimer()
    this.heroPrefetchTimer = setTimeout(() => {
      this.heroPrefetchTimer = null
      this.loadHeroNeighbors(index)
    }, 350)
  },
  loadHeroNeighbors(index) {
    const slides = this.data.heroSlides || []
    const count = slides.length
    if (count < 2) return
    const indexes = [index, (index + 1) % count, (index - 1 + count) % count]
    const patch = {}
    indexes.forEach(slideIndex => {
      const slide = slides[slideIndex]
      if (slide && !slide.src) patch[`heroSlides[${slideIndex}].src`] = slide.url
    })
    if (Object.keys(patch).length) this.setData(patch)
  },
  openSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },
  openImageSearch() {
    if (this.data.imageRecognizing) return
    wx.showActionSheet({
      itemList: ['拍照识别产品', '从相册选择图片'],
      success: result => this.chooseProductImage(result.tapIndex === 0 ? 'camera' : 'album')
    })
  },
  chooseProductImage(source) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      camera: 'back',
      success: result => {
        const path = result.tempFiles?.[0]?.tempFilePath
        if (path) this.prepareProductImage(path)
      }
    })
  },
  prepareProductImage(path) {
    wx.compressImage({
      src: path,
      quality: 72,
      success: result => this.runImageRecognition(result.tempFilePath || path),
      fail: () => this.runImageRecognition(path)
    })
  },
  runImageRecognition(path) {
    this.setData({ imageRecognizing: true })
    wx.showLoading({ title: '正在识别商品', mask: true })
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: async result => {
        try {
          const lowerPath = path.toLowerCase()
          const mime = lowerPath.endsWith('.png') ? 'image/png' : lowerPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
          const matches = await recognizeProductImage(`data:${mime};base64,${result.data}`, 20)
          if (!matches.length) throw new Error('暂未识别到相似商品')
          wx.setStorageSync('categoryIntent', {
            category: '拍图识别结果',
            type: 'image',
            productIds: matches.map(item => Number(item.id))
          })
          wx.switchTab({ url: '/pages/category/category' })
        } catch (error) {
          wx.showToast({ title: error.message || '图片识别失败，请重试', icon: 'none', duration: 2600 })
        } finally {
          wx.hideLoading()
          this.setData({ imageRecognizing: false })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ imageRecognizing: false })
        wx.showToast({ title: '图片读取失败，请重新拍摄', icon: 'none' })
      }
    })
  },
  goCategory(e) {
    const name = e.currentTarget.dataset.name
    const type = e.currentTarget.dataset.type || 'normal'
    wx.setStorageSync('categoryIntent', {
      category: name,
      type,
      keyword: '',
      productIds: []
    })
    wx.switchTab({ url: '/pages/category/category' })
  },
  goAll() {
    wx.setStorageSync('categoryIntent', {
      category: '全部商品',
      type: 'all',
      keyword: '',
      productIds: []
    })
    wx.switchTab({ url: '/pages/category/category' })
  },
  goProduct(e) {
    wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` })
  },
  onShareAppMessage() {
    return appShare({
      title: this.data.storeName || appName(),
      path: '/pages/home/home',
      imageUrl: this.data.heroImages[0] || this.data.storeIcon
    })
  },
  onShareTimeline() {
    return timelineShare({
      title: this.data.storeName || appName(),
      imageUrl: this.data.heroImages[0] || this.data.storeIcon
    })
  },
  onAddToFavorites() {
    return favoriteShare({
      title: this.data.storeName || appName(),
      imageUrl: this.data.heroImages[0] || this.data.storeIcon
    })
  }
})
