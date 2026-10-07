const { fetchHomeContent, readHomeSnapshot, recognizeProductImage, refreshDataVersion, dataVersion, defaultStoreSettings } = require('../../common/api')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')
const { setCategoryIntent } = require('../../common/category-intent')
const { refreshFromServer } = require('../../common/pull-refresh')
const { findScrollHandle, scrollToTopNow } = require('../../common/scroll-handle')
const { homeGridCategories } = require('../../common/category-groups')

const initialHomeSnapshot = readHomeSnapshot()
const initialHomeVersion = initialHomeSnapshot?.dataVersion || ''
const initialHomeSettings = initialHomeSnapshot?.storeSettings || defaultStoreSettings
const initialHeroImages = initialHomeSettings.homeHeroImages?.length ? initialHomeSettings.homeHeroImages : []
const initialHomeCategories = homeGridCategories(initialHomeSnapshot?.categories)

// The link to all products, with its arrow drawn as an icon (the text is set in the backend).
function moreLabel(text) {
  return String(text || '').replace(/[\s→>›»]+$/, '') || '查看全部'
}

// The 首页 section of the main page (pages/home/home; see common/tabs.js).
Component({
  options: {
    addGlobalClass: true
  },
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    keyword: '',
    homeReady: Boolean(initialHomeSnapshot),
    storeName: initialHomeSettings.storeName,
    storeIcon: initialHomeSettings.storeIcon,
    heroImages: initialHeroImages,
    heroSlides: initialHeroImages.map((url, index) => ({ url, src: index === 0 ? url : '' })),
    settings: initialHomeSettings,
    categoryMoreLabel: moreLabel(initialHomeSettings.categoryMoreText),
    heroCurrent: 0,
    heroAutoplay: true,
    imageRecognizing: false,
    categories: initialHomeCategories,
    refreshing: false
  },
  lifetimes: {
    attached() {
      this.contentVersion = initialHomeVersion
      if (initialHomeSnapshot) {
        this.scheduleHeroNeighbors(0)
        this.refreshRemoteContent()
      } else {
        this.loadRemoteContent()
      }
    },
    ready() {
      findScrollHandle(this, '.page-scroll', handle => { this.contentScroll = handle })
    },
    detached() {
      this.clearHeroPrefetchTimer()
    }
  },
  methods: {
    // The section is showing (the main page switched to it, or came back to the screen).
    viewShown() {
      if (this.data.keyword) this.setData({ keyword: '' })
      if (!this.data.heroAutoplay) this.setData({ heroAutoplay: true })
      if (this.hasShownOnce) this.refreshRemoteContent()
      this.hasShownOnce = true
    },
    // The section is not showing; stop the carousel so it does not keep firing change events and
    // setData meanwhile.
    viewHidden() {
      this.setData({ heroAutoplay: false })
    },
    // Another section is showing now: back to the top, so the next visit starts like the first one.
    // Done while this section is out of sight, so it is not seen.
    leftFor() {
      scrollToTopNow(this.contentScroll)
    },
    async refreshRemoteContent() {
      try {
        await refreshDataVersion(true)
        if (dataVersion() !== this.contentVersion) await this.loadRemoteContent()
      } catch (error) {
        console.info('首页同步检查失败', error.errMsg || error.message)
      }
    },
    async loadRemoteContent() {
      try {
        this.showHomeContent(await fetchHomeContent())
      } catch (error) {
        console.info('商品服务未启动，首页继续使用本地演示数据', error.errMsg || error.message)
      }
    },
    onRefresh() {
      refreshFromServer(this, async () => {
        if (dataVersion() === this.contentVersion) return null
        const content = await fetchHomeContent()
        return () => this.showHomeContent(content)
      })
    },
    showHomeContent(content) {
      this.applyHomeContent(content)
      this.contentVersion = content.dataVersion || ''
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
        categoryMoreLabel: moreLabel(storeSettings.categoryMoreText),
        homeReady: true,
        categories: remoteCategories.length ? homeGridCategories(remoteCategories) : this.data.categories
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
            setCategoryIntent({
              category: '拍图识别结果',
              type: 'image',
              productIds: matches.map(item => Number(item.id))
            })
            this.triggerEvent('opentab', { tab: 'category' })
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
      setCategoryIntent({
        category: name,
        type,
        keyword: '',
        productIds: []
      })
      this.triggerEvent('opentab', { tab: 'category' })
    },
    goAll() {
      setCategoryIntent({
        category: '全部商品',
        type: 'all',
        keyword: '',
        productIds: []
      })
      this.triggerEvent('opentab', { tab: 'category' })
    },
    goProduct(e) {
      wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` })
    },
    // What the main page shares while this section is showing.
    shareMessage() {
      return appShare({
        title: this.data.storeName || appName(),
        path: '/pages/home/home',
        imageUrl: this.data.heroImages[0] || this.data.storeIcon
      })
    },
    shareTimeline() {
      return timelineShare({
        title: this.data.storeName || appName(),
        imageUrl: this.data.heroImages[0] || this.data.storeIcon
      })
    },
    favorite() {
      return favoriteShare({
        title: this.data.storeName || appName(),
        imageUrl: this.data.heroImages[0] || this.data.storeIcon
      })
    }
  }
})
