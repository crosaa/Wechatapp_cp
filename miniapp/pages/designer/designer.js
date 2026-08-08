const { fetchProduct, refreshDataVersion, thumbnailImage } = require('../../common/api')
const { appName, appShare, timelineShare, favoriteShare } = require('../../common/share')

const DEFAULT_TEXT = '团队名称'
const MAX_HISTORY = 20
const BASE_IMAGE_BATCH_SIZE = 18
const DEFAULT_DESIGNER_PRODUCT = {
  id: 0,
  code: '',
  name: '请选择商品开始设计',
  image: '/assets/polo-grid.jpg',
  images: ['/assets/polo-grid.jpg'],
  colors: [],
  colorImages: {},
  colorGalleries: {},
  realImages: [],
  detailImages: []
}

function numberOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function defaultFaceDesign() {
  return {
    overlayText: DEFAULT_TEXT,
    draftText: DEFAULT_TEXT,
    textVisible: true,
    textColor: '#1f2832',
    textFontSize: 30,
    textX: 110,
    textY: 176,
    textScale: 1,
    textRotation: 0,
    overlayImage: '',
    imageX: 142,
    imageY: 82,
    imageScale: 1,
    imageRotation: 0,
    selectedLayer: 'text'
  }
}

function normaliseFaceDesign(source = {}) {
  source = source || {}
  const fallback = defaultFaceDesign()
  return {
    overlayText: String(source.overlayText || fallback.overlayText).slice(0, 20),
    draftText: String(source.draftText || source.overlayText || fallback.draftText).slice(0, 20),
    textVisible: source.textVisible !== false,
    textColor: source.textColor || fallback.textColor,
    textFontSize: numberOr(source.textFontSize, fallback.textFontSize),
    textX: numberOr(source.textX, fallback.textX),
    textY: numberOr(source.textY, fallback.textY),
    textScale: numberOr(source.textScale, fallback.textScale),
    textRotation: numberOr(source.textRotation, fallback.textRotation),
    overlayImage: source.overlayImage || '',
    imageX: numberOr(source.imageX, fallback.imageX),
    imageY: numberOr(source.imageY, fallback.imageY),
    imageScale: numberOr(source.imageScale, fallback.imageScale),
    imageRotation: numberOr(source.imageRotation, fallback.imageRotation),
    selectedLayer: source.selectedLayer === 'image' ? 'image' : 'text'
  }
}

function productImageForColor(product, color) {
  const gallery = product.colorGalleries?.[color]
  if (Array.isArray(gallery) && gallery[0]) return gallery[0]
  if (product.colorImages?.[color]) return product.colorImages[color]
  return product.image || product.images?.[0] || '/assets/polo-grid.jpg'
}

function collectProductImages(product, preferredImage = '', preferredLabel = '') {
  const options = []
  const seen = new Set()
  const add = (url, label, group, color = '') => {
    if (!url || seen.has(url)) return
    seen.add(url)
    options.push({ url, displayUrl: thumbnailImage(url, 360, 'width'), label, group, color })
  }

  add(preferredImage, preferredLabel || '当前底图', '当前')
  add(product.posterImage, '商品海报', '海报')
  add(product.image, '商品主图', '主图')
  ;(product.images || []).forEach((url, index) => add(url, `展示图 ${index + 1}`, '展示图'))
  Object.entries(product.colorGalleries || {}).forEach(([color, gallery]) => {
    ;(gallery || []).forEach((url, index) => add(url, `${color} ${index + 1}`, '颜色图', color))
  })
  ;(product.realImages || []).forEach((item, index) => {
    add(item?.url, `${item?.category || '实拍图'} ${index + 1}`, '实拍图')
  })
  ;(product.detailImages || []).forEach((url, index) => add(url, `详情图 ${index + 1}`, '详情图'))
  return options
}

function formatSavedTime(timestamp) {
  if (!timestamp) return '尚未保存'
  const date = new Date(timestamp)
  return `已保存 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const storedDesignerProduct = wx.getStorageSync('designerProduct')
const initialDesignerProduct = storedDesignerProduct?.id
  ? { ...DEFAULT_DESIGNER_PRODUCT, ...storedDesignerProduct }
  : DEFAULT_DESIGNER_PRODUCT
const initialDesignerImage = initialDesignerProduct.sourceImage || initialDesignerProduct.image || DEFAULT_DESIGNER_PRODUCT.image
const initialDesignerImages = collectProductImages(initialDesignerProduct, initialDesignerImage)

Page({
  data: {
    pageNavigation: getApp().globalData.pageNavigation,
    product: initialDesignerProduct,
    garmentImage: initialDesignerImage,
    baseImageOptions: initialDesignerImages,
    baseImageCount: initialDesignerImages.length,
    productColors: initialDesignerProduct.colors || [],
    selectedProductColor: initialDesignerProduct.selectedColor || initialDesignerProduct.colors?.[0] || '',
    designSourceType: '商品款式图',
    face: '正面',
    ...defaultFaceDesign(),
    themeColors: ['#1f2832', '#ffffff', '#d6382f', '#1564b4', '#16915d', '#f0b62f', '#8f43a7', '#ef7d9d'],
    textPresets: ['团队名称', '企业LOGO', '安全生产', '志愿服务', '团结协作', '品质保障'],
    showTextPanel: false,
    showPresetPanel: false,
    dirty: false,
    lastSavedText: '尚未保存',
    canUndo: false,
    loadingProduct: false
  },

  onShow() {
    const storedProduct = wx.getStorageSync('designerProduct')
    const product = storedProduct?.id ? storedProduct : this.data.product
    const launchKey = product.launchKey || `${product.id}-${product.sourceImage || product.image || ''}-${product.selectedColor || ''}`
    if (this.loadedDesignKey === launchKey) {
      this.refreshLoadedProduct(product)
      return
    }
    this.loadedDesignKey = launchKey
    this.loadedProductId = Number(product.id)
    this.history = []
    this.faceDesigns = { front: defaultFaceDesign(), back: defaultFaceDesign() }
    this.restoreDraft(product)
    if (Number(product.id) > 0) this.loadProduct(product)
  },

  async refreshLoadedProduct(product) {
    if (Number(product?.id) <= 0) return
    try {
      if (await refreshDataVersion(true)) await this.loadProduct(product)
    } catch (error) {
      console.info('设计商品同步检查失败', error.errMsg || error.message)
    }
  },

  onHide() {
    if (this.loadedProductId && this.data.dirty) this.persistDraft(false)
  },

  faceKey(face = this.data.face) {
    return face === '背面' ? 'back' : 'front'
  },

  captureCurrentFace() {
    if (!this.faceDesigns) this.faceDesigns = { front: defaultFaceDesign(), back: defaultFaceDesign() }
    this.faceDesigns[this.faceKey()] = normaliseFaceDesign({
      overlayText: this.data.overlayText,
      draftText: this.data.draftText,
      textVisible: this.data.textVisible,
      textColor: this.data.textColor,
      textFontSize: this.data.textFontSize,
      textX: this.data.textX,
      textY: this.data.textY,
      textScale: this.data.textScale,
      textRotation: this.data.textRotation,
      overlayImage: this.data.overlayImage,
      imageX: this.data.imageX,
      imageY: this.data.imageY,
      imageScale: this.data.imageScale,
      imageRotation: this.data.imageRotation,
      selectedLayer: this.data.selectedLayer
    })
  },

  applyFace(face, extra = {}) {
    const design = normaliseFaceDesign(this.faceDesigns?.[this.faceKey(face)])
    this.faceDesigns[this.faceKey(face)] = design
    this.setData({ face, ...design, showTextPanel: false, showPresetPanel: false, ...extra })
  },

  restoreDraft(product) {
    const draft = wx.getStorageSync('designerDraft')
    const matches = draft && Number(draft.productId) === Number(product.id)
    const isFreshLaunch = Boolean(product.launchKey && (!matches || draft.launchKey !== product.launchKey))
    this.preferLaunchSource = isFreshLaunch
    if (matches && Number(draft.version) >= 2 && draft.faces) {
      this.faceDesigns = {
        front: normaliseFaceDesign(draft.faces.front),
        back: normaliseFaceDesign(draft.faces.back)
      }
      const face = draft.face === '背面' ? '背面' : '正面'
      const design = this.faceDesigns[this.faceKey(face)]
      const selectedProductColor = isFreshLaunch
        ? (product.selectedColor || '')
        : (draft.selectedProductColor || product.selectedColor || '')
      const garmentImage = isFreshLaunch
        ? (product.sourceImage || product.image || draft.garmentImage)
        : (draft.garmentImage || product.sourceImage || product.image)
      const designSourceType = isFreshLaunch
        ? (product.sourceType || '商品款式图')
        : (draft.designSourceType || product.sourceType || '商品款式图')
      const baseImageOptions = collectProductImages(product, garmentImage, designSourceType)
      this.allBaseImageOptions = baseImageOptions
      this.setData({
        product,
        face,
        ...design,
        selectedProductColor,
        garmentImage,
        designSourceType,
        baseImageOptions: baseImageOptions.slice(0, BASE_IMAGE_BATCH_SIZE),
        baseImageCount: baseImageOptions.length,
        lastSavedText: formatSavedTime(draft.savedAt),
        dirty: false,
        canUndo: false
      })
      return
    }
    if (matches) {
      this.faceDesigns.front = normaliseFaceDesign({
        overlayText: draft.overlayText,
        draftText: draft.overlayText,
        textColor: draft.textColor
      })
    }
    const baseImageOptions = collectProductImages(
      product,
      product.sourceImage || product.image || this.data.garmentImage,
      product.sourceType || '商品款式图'
    )
    this.allBaseImageOptions = baseImageOptions
    this.setData({
      product,
      face: '正面',
      ...this.faceDesigns.front,
      selectedProductColor: product.selectedColor || '',
      garmentImage: product.sourceImage || product.image || this.data.garmentImage,
      designSourceType: product.sourceType || '商品款式图',
      baseImageOptions: baseImageOptions.slice(0, BASE_IMAGE_BATCH_SIZE),
      baseImageCount: baseImageOptions.length,
      lastSavedText: matches ? formatSavedTime(draft.savedAt) : '尚未保存',
      dirty: false,
      canUndo: false
    })
  },

  async loadProduct(product) {
    if (Number(product?.id) <= 0) {
      this.setData({ loadingProduct: false })
      return
    }
    const loadKey = this.loadedDesignKey
    this.setData({ loadingProduct: true })
    try {
      const remoteProduct = await fetchProduct(product.id)
      if (loadKey !== this.loadedDesignKey) return
      const colors = remoteProduct.colors || []
      const requestedColor = this.preferLaunchSource ? product.selectedColor : this.data.selectedProductColor
      const selectedColor = colors.includes(requestedColor)
        ? requestedColor
        : (colors[0] || '')
      const preserveRealPhoto = !this.preferLaunchSource && this.data.designSourceType === '实拍图'
      const sourceImage = this.preferLaunchSource
        ? product.sourceImage
        : (preserveRealPhoto ? this.data.garmentImage : '')
      const designSourceType = sourceImage
        ? (this.preferLaunchSource ? product.sourceType : this.data.designSourceType)
        : (selectedColor ? `${selectedColor}款式图` : '商品款式图')
      const garmentImage = sourceImage || productImageForColor(remoteProduct, selectedColor)
      const baseImageOptions = collectProductImages(remoteProduct, garmentImage, designSourceType)
      this.allBaseImageOptions = baseImageOptions
      this.setData({
        product: remoteProduct,
        productColors: colors,
        selectedProductColor: selectedColor,
        garmentImage,
        designSourceType,
        baseImageOptions: baseImageOptions.slice(0, BASE_IMAGE_BATCH_SIZE),
        baseImageCount: baseImageOptions.length,
        loadingProduct: false
      })
      wx.setStorageSync('designerProduct', {
        ...product,
        id: remoteProduct.id,
        code: remoteProduct.code,
        name: remoteProduct.name,
        image: remoteProduct.image
      })
    } catch (error) {
      if (loadKey !== this.loadedDesignKey) return
      const colors = product.colors || []
      const requestedColor = this.preferLaunchSource ? product.selectedColor : this.data.selectedProductColor
      const selectedColor = colors.includes(requestedColor) ? requestedColor : (requestedColor || colors[0] || '')
      const sourceImage = this.preferLaunchSource ? product.sourceImage : this.data.garmentImage
      const garmentImage = sourceImage || productImageForColor(product, selectedColor)
      const designSourceType = sourceImage
        ? (this.preferLaunchSource ? product.sourceType : this.data.designSourceType)
        : (selectedColor ? `${selectedColor}款式图` : '商品款式图')
      const baseImageOptions = collectProductImages(product, garmentImage, designSourceType)
      this.allBaseImageOptions = baseImageOptions
      this.setData({
        product,
        productColors: colors,
        selectedProductColor: selectedColor,
        garmentImage,
        designSourceType,
        baseImageOptions: baseImageOptions.slice(0, BASE_IMAGE_BATCH_SIZE),
        baseImageCount: baseImageOptions.length,
        loadingProduct: false
      })
      console.info('商品服务未启动，设计页继续使用当前商品图片', error.errMsg || error.message)
    }
  },

  snapshot() {
    this.captureCurrentFace()
    return {
      face: this.data.face,
      selectedProductColor: this.data.selectedProductColor,
      garmentImage: this.data.garmentImage,
      designSourceType: this.data.designSourceType,
      faces: JSON.parse(JSON.stringify(this.faceDesigns))
    }
  },

  pushHistory() {
    if (!this.history) this.history = []
    this.history.push(this.snapshot())
    if (this.history.length > MAX_HISTORY) this.history.shift()
    this.setData({ canUndo: true })
  },

  undo() {
    const previous = this.history?.pop()
    if (!previous) {
      wx.showToast({ title: '没有可撤销的操作', icon: 'none' })
      return
    }
    this.faceDesigns = {
      front: normaliseFaceDesign(previous.faces.front),
      back: normaliseFaceDesign(previous.faces.back)
    }
    const selectedColor = previous.selectedProductColor || ''
    this.applyFace(previous.face, {
      selectedProductColor: selectedColor,
      garmentImage: previous.garmentImage || productImageForColor(this.data.product, selectedColor),
      designSourceType: previous.designSourceType || (selectedColor ? `${selectedColor}款式图` : '商品款式图'),
      dirty: true,
      canUndo: this.history.length > 0
    })
  },

  markDirty() {
    if (!this.data.dirty) this.setData({ dirty: true })
  },

  setFace(event) {
    const face = event.currentTarget.dataset.face
    if (face === this.data.face) return
    this.captureCurrentFace()
    this.applyFace(face)
  },

  copyCurrentFace() {
    this.pushHistory()
    this.captureCurrentFace()
    const currentKey = this.faceKey()
    const targetFace = this.data.face === '正面' ? '背面' : '正面'
    this.faceDesigns[this.faceKey(targetFace)] = normaliseFaceDesign(
      JSON.parse(JSON.stringify(this.faceDesigns[currentKey]))
    )
    this.setData({ dirty: true })
    wx.showToast({ title: `已复制到${targetFace}`, icon: 'success' })
  },

  selectProductColor(event) {
    const color = event.currentTarget.dataset.color
    if (color === this.data.selectedProductColor) return
    this.pushHistory()
    const garmentImage = productImageForColor(this.data.product, color)
    this.setData({
      selectedProductColor: color,
      garmentImage,
      designSourceType: `${color}款式图`,
      dirty: true
    })
  },

  selectBaseImage(event) {
    const url = event.currentTarget.dataset.url
    if (!url || url === this.data.garmentImage) return
    this.pushHistory()
    this.setData({
      garmentImage: url,
      designSourceType: event.currentTarget.dataset.label || '商品图片',
      selectedProductColor: event.currentTarget.dataset.color || '',
      dirty: true
    })
  },

  loadMoreBaseImages() {
    const visible = this.data.baseImageOptions || []
    if (visible.length >= (this.allBaseImageOptions || []).length) return
    this.setData({
      baseImageOptions: this.allBaseImageOptions.slice(0, visible.length + BASE_IMAGE_BATCH_SIZE)
    })
  },

  selectLayer(event) {
    const selectedLayer = event.currentTarget.dataset.layer
    if (selectedLayer === 'image' && !this.data.overlayImage) return
    this.setData({ selectedLayer, showTextPanel: false, showPresetPanel: false })
  },

  beginLayerGesture(event) {
    if (!this.gestureLayer) this.pushHistory()
    this.gestureLayer = event.currentTarget.dataset.layer
    this.setData({ selectedLayer: this.gestureLayer })
  },

  onTextMove(event) {
    this.pendingTextPosition = { x: event.detail.x, y: event.detail.y }
  },

  onTextScale(event) {
    this.pendingTextScale = event.detail.scale
  },

  onImageMove(event) {
    this.pendingImagePosition = { x: event.detail.x, y: event.detail.y }
  },

  onImageScale(event) {
    this.pendingImageScale = event.detail.scale
  },

  endLayerGesture() {
    const updates = { dirty: true }
    if (this.gestureLayer === 'text') {
      if (this.pendingTextPosition) {
        updates.textX = this.pendingTextPosition.x
        updates.textY = this.pendingTextPosition.y
      }
      if (this.pendingTextScale) updates.textScale = this.pendingTextScale
    }
    if (this.gestureLayer === 'image') {
      if (this.pendingImagePosition) {
        updates.imageX = this.pendingImagePosition.x
        updates.imageY = this.pendingImagePosition.y
      }
      if (this.pendingImageScale) updates.imageScale = this.pendingImageScale
    }
    this.pendingTextPosition = null
    this.pendingImagePosition = null
    this.pendingTextScale = null
    this.pendingImageScale = null
    this.gestureLayer = ''
    this.setData(updates)
  },

  toggleTextPanel() {
    this.setData({
      selectedLayer: 'text',
      textVisible: true,
      showTextPanel: !this.data.showTextPanel,
      showPresetPanel: false
    })
  },

  onDraft(event) {
    this.setData({ draftText: event.detail.value })
  },

  applyText() {
    this.pushHistory()
    const text = this.data.draftText.trim() || DEFAULT_TEXT
    this.setData({
      overlayText: text,
      draftText: text,
      textVisible: true,
      selectedLayer: 'text',
      showTextPanel: false,
      dirty: true
    })
  },

  toggleTextVisibility() {
    this.pushHistory()
    this.setData({ textVisible: !this.data.textVisible, dirty: true })
  },

  pickColor(event) {
    const textColor = event.currentTarget.dataset.color
    if (textColor === this.data.textColor) return
    this.pushHistory()
    this.setData({ textColor, textVisible: true, selectedLayer: 'text', dirty: true })
  },

  onTextSize(event) {
    this.pushHistory()
    this.setData({ textFontSize: Number(event.detail.value), dirty: true })
  },

  onLayerScaleChange(event) {
    this.pushHistory()
    const value = Number(event.detail.value) / 100
    const key = this.data.selectedLayer === 'image' ? 'imageScale' : 'textScale'
    this.setData({ [key]: value, dirty: true })
  },

  onLayerRotationChange(event) {
    this.pushHistory()
    const key = this.data.selectedLayer === 'image' ? 'imageRotation' : 'textRotation'
    this.setData({ [key]: Number(event.detail.value), dirty: true })
  },

  togglePresetPanel() {
    this.setData({ showPresetPanel: !this.data.showPresetPanel, showTextPanel: false })
  },

  choosePreset(event) {
    this.pushHistory()
    const text = event.currentTarget.dataset.text
    this.setData({
      overlayText: text,
      draftText: text,
      textVisible: true,
      selectedLayer: 'text',
      showPresetPanel: false,
      dirty: true
    })
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: result => {
        const path = result.tempFiles?.[0]?.tempFilePath
        if (!path) return
        wx.compressImage({
          src: path,
          quality: 82,
          success: compressed => this.saveOverlayImage(compressed.tempFilePath || path),
          fail: () => this.saveOverlayImage(path)
        })
      }
    })
  },

  saveOverlayImage(tempFilePath) {
    wx.saveFile({
      tempFilePath,
      success: result => this.applyOverlayImage(result.savedFilePath || tempFilePath),
      fail: () => {
        this.applyOverlayImage(tempFilePath)
        wx.showToast({ title: '图片仅在本次使用中保留', icon: 'none' })
      }
    })
  },

  applyOverlayImage(path) {
    this.pushHistory()
    this.setData({
      overlayImage: path,
      imageX: 142,
      imageY: 82,
      imageScale: 1,
      imageRotation: 0,
      selectedLayer: 'image',
      dirty: true
    })
    wx.showToast({ title: '图案已添加，可拖动缩放', icon: 'none' })
  },

  removeOverlayImage() {
    if (!this.data.overlayImage) return
    this.pushHistory()
    this.setData({ overlayImage: '', selectedLayer: 'text', dirty: true })
  },

  resetSelectedLayer() {
    this.pushHistory()
    if (this.data.selectedLayer === 'image') {
      this.setData({ imageX: 142, imageY: 82, imageScale: 1, imageRotation: 0, dirty: true })
    } else {
      this.setData({ textX: 110, textY: 176, textScale: 1, textRotation: 0, textFontSize: 30, dirty: true })
    }
  },

  createNew() {
    wx.showModal({
      title: '新建设计',
      content: '将清空当前商品正面和背面的文字与图案，是否继续？',
      confirmText: '清空重做',
      confirmColor: '#c47e1f',
      success: result => {
        if (!result.confirm) return
        this.pushHistory()
        this.faceDesigns = { front: defaultFaceDesign(), back: defaultFaceDesign() }
        wx.removeStorageSync('designerDraft')
        this.applyFace('正面', {
          selectedProductColor: this.data.productColors[0] || '',
          garmentImage: productImageForColor(this.data.product, this.data.productColors[0] || ''),
          dirty: true,
          lastSavedText: '尚未保存'
        })
      }
    })
  },

  chooseStyle() {
    wx.setStorageSync('categoryIntent', { category: '全部商品', type: 'all' })
    wx.switchTab({ url: '/pages/category/category' })
    wx.showToast({ title: '进入商品后点击“用这款开始设计”', icon: 'none', duration: 2200 })
  },

  draftPayload() {
    this.captureCurrentFace()
    return {
      version: 3,
      productId: this.data.product.id,
      productCode: this.data.product.code || '',
      launchKey: this.loadedDesignKey || '',
      selectedProductColor: this.data.selectedProductColor,
      garmentImage: this.data.garmentImage,
      designSourceType: this.data.designSourceType,
      face: this.data.face,
      faces: this.faceDesigns,
      savedAt: Date.now()
    }
  },

  persistDraft(showToast = true) {
    const payload = this.draftPayload()
    wx.setStorageSync('designerDraft', payload)
    this.setData({ dirty: false, lastSavedText: formatSavedTime(payload.savedAt) })
    if (showToast) wx.showToast({ title: '设计草稿已保存', icon: 'success' })
    return payload
  },

  saveDraft() {
    this.persistDraft(true)
  },

  showHelp() {
    wx.showModal({
      title: '设计说明',
      content: '1. 选择商品颜色和正面/背面；\n2. 点击文字或图案后可拖动、双指缩放；\n3. 下方可精确调整大小和角度；\n4. 上传图案会保存到当前微信设备；\n5. 正面和背面的设计会分别保存。',
      showCancel: false
    })
  },

  finish() {
    this.persistDraft(false)
    wx.showModal({
      title: '设计已保存',
      content: '正面和背面的当前效果已保存为草稿，可随时回来继续修改。',
      confirmText: '查看商品',
      cancelText: '继续设计',
      success: result => {
        if (result.confirm) wx.navigateTo({ url: `/pages/product/product?id=${this.data.product.id}` })
      }
    })
  },

  onShareAppMessage() {
    return appShare({
      title: `服装在线设计｜${appName()}`,
      path: '/pages/designer/designer',
      imageUrl: this.data.garmentImage
    })
  },

  onShareTimeline() {
    return timelineShare({
      title: `服装在线设计｜${appName()}`,
      imageUrl: this.data.garmentImage
    })
  },

  onAddToFavorites() {
    return favoriteShare({
      title: `服装在线设计｜${appName()}`,
      imageUrl: this.data.garmentImage
    })
  }
})
