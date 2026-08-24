const $ = selector => document.querySelector(selector)

const state = {
  currentUser: null,
  adminUsers: [],
  products: [],
  categories: [],
  categoryImageId: null,
  expandedCategoryId: null,
  settings: null,
  storeIcon: '',
  homeHeroImages: [],
  editingId: null,
  images: [],
  posterImage: '',
  colorGalleries: {},
  detailImages: [],
  realImages: [],
  sizeStocks: {},
  colorSizeStocks: {},
  specialSizePrices: [],
  unmatchedReport: null,
  unmatchedReportPage: 1,
  unmatchedReportPageSize: 50,
  inventoryMappingData: null,
  inventoryMappingPage: 1,
  inventoryMappingPageSize: 30,
  inventoryMappingsLoaded: false,
  productPage: 1,
  productPageSize: 30,
  mediaPage: 1,
  mediaPageSize: 36,
  uploadInProgress: false,
  inventoryImportInProgress: false,
  editorSessionOpen: false,
  imageUploadMode: localStorage.getItem('admin-image-upload-mode') === 'original' ? 'original' : 'auto'
}

function syncImageUploadModeControl() {
  const select = $('#imageUploadModeSelect')
  const hint = $('#imageUploadModeHint')
  if (!select || !hint) return
  select.value = state.imageUploadMode
  hint.textContent = state.imageUploadMode === 'original'
    ? '保存原始像素；分类和商品列表仍自动加载缩略图'
    : '按分类图、轮播图、主图或详情图用途自动优化'
}

$('#imageUploadModeSelect')?.addEventListener('change', event => {
  state.imageUploadMode = event.target.value === 'original' ? 'original' : 'auto'
  localStorage.setItem('admin-image-upload-mode', state.imageUploadMode)
  syncImageUploadModeControl()
  toast(state.imageUploadMode === 'original' ? '后续上传将保留原图' : '后续上传将按图片用途自动优化')
})
syncImageUploadModeControl()

const productTableWrap = document.querySelector('#products .table-wrap')
const productHorizontalScroll = document.querySelector('#productHorizontalScroll')
const productHorizontalScrollSpacer = document.querySelector('#productHorizontalScrollSpacer')
let syncingProductHorizontalScroll = false
let productHorizontalScrollFrame = 0

function updateProductHorizontalScroll() {
  if (!productTableWrap || !productHorizontalScroll || !productHorizontalScrollSpacer) return
  const productPanel = document.querySelector('#products')
  const rect = productTableWrap.getBoundingClientRect()
  const hasOverflow = productTableWrap.scrollWidth > productTableWrap.clientWidth + 1
  const tableIsVisible = rect.top < window.innerHeight && rect.bottom > 0
  const shouldShow = productPanel?.classList.contains('is-active') && hasOverflow && tableIsVisible

  productHorizontalScroll.classList.toggle('is-hidden', !shouldShow)
  if (!shouldShow) return

  productHorizontalScroll.style.left = `${Math.max(0, rect.left)}px`
  productHorizontalScroll.style.width = `${Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left))}px`
  productHorizontalScrollSpacer.style.width = `${productTableWrap.scrollWidth}px`
  if (!syncingProductHorizontalScroll) productHorizontalScroll.scrollLeft = productTableWrap.scrollLeft
}

function scheduleProductHorizontalScrollUpdate() {
  if (productHorizontalScrollFrame) return
  productHorizontalScrollFrame = requestAnimationFrame(() => {
    productHorizontalScrollFrame = 0
    updateProductHorizontalScroll()
  })
}

productTableWrap?.addEventListener('scroll', () => {
  if (syncingProductHorizontalScroll) return
  syncingProductHorizontalScroll = true
  productHorizontalScroll.scrollLeft = productTableWrap.scrollLeft
  syncingProductHorizontalScroll = false
})

productHorizontalScroll?.addEventListener('scroll', () => {
  if (syncingProductHorizontalScroll) return
  syncingProductHorizontalScroll = true
  productTableWrap.scrollLeft = productHorizontalScroll.scrollLeft
  syncingProductHorizontalScroll = false
})

window.addEventListener('scroll', scheduleProductHorizontalScrollUpdate, { passive: true })
window.addEventListener('resize', scheduleProductHorizontalScrollUpdate)
new ResizeObserver(scheduleProductHorizontalScrollUpdate).observe(productTableWrap)
new MutationObserver(scheduleProductHorizontalScrollUpdate).observe(document.querySelector('#productRows'), { childList: true })

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || '请求失败')
    error.status = response.status
    throw error
  }
  return body
}

function requestJsonWithUploadProgress(path, payload, { onProgress, onProcessing } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', path)
    request.withCredentials = true
    request.setRequestHeader('content-type', 'application/json')
    request.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    })
    request.upload.addEventListener('load', () => onProcessing?.())
    request.addEventListener('load', () => {
      let body = {}
      try { body = request.responseText ? JSON.parse(request.responseText) : {} } catch {}
      if (request.status >= 200 && request.status < 300) {
        resolve(body)
        return
      }
      const error = new Error(body.error || '请求失败')
      error.status = request.status
      reject(error)
    })
    request.addEventListener('error', () => reject(new Error('网络连接失败，请检查网络后重试')))
    request.addEventListener('abort', () => reject(new Error('上传已取消')))
    request.send(JSON.stringify(payload))
  })
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
}

function imageUrl(url) {
  return url || '/images/polo-grid.jpg'
}

const imageFileSizeCache = new Map()

function formatImageFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 100 * 1024 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function readImageFileSize(url) {
  const requestUrl = imageUrl(url)
  if (!imageFileSizeCache.has(requestUrl)) {
    imageFileSizeCache.set(requestUrl, fetch(requestUrl, {
      method: 'HEAD',
      cache: 'force-cache',
      credentials: 'same-origin'
    }).then(response => {
      if (!response.ok) return ''
      return formatImageFileSize(response.headers.get('content-length'))
    }).catch(() => ''))
  }
  return imageFileSizeCache.get(requestUrl)
}

function readRenderedImageDimensions(image) {
  if (image.complete) {
    return Promise.resolve(image.naturalWidth && image.naturalHeight
      ? `${image.naturalWidth} × ${image.naturalHeight} px`
      : '')
  }
  return new Promise(resolve => {
    image.addEventListener('load', () => {
      resolve(image.naturalWidth && image.naturalHeight
        ? `${image.naturalWidth} × ${image.naturalHeight} px`
        : '')
    }, { once: true })
    image.addEventListener('error', () => resolve(''), { once: true })
  })
}

function hydrateImageMetadata(container) {
  container?.querySelectorAll('[data-image-metadata]').forEach(async label => {
    const image = label.closest('.image-item, .poster-image-item, .color-gallery-image')?.querySelector('img')
    if (!image) return
    const [dimensions, fileSize] = await Promise.all([
      readRenderedImageDimensions(image),
      readImageFileSize(label.dataset.imageUrl)
    ])
    if (!label.isConnected) return
    label.textContent = [dimensions, fileSize].filter(Boolean).join(' · ') || '图片信息暂不可用'
  })
}

function renderAdminBrand(settings = {}) {
  const storeName = String(settings.storeName || '普润制衣团购仓').trim()
  const storeIcon = settings.storeIcon || '/images/purun-gold-drop-logo.png'
  document.querySelectorAll('[data-admin-store-icon]').forEach(image => {
    image.src = storeIcon
    image.alt = `${storeName}图标`
  })
  document.querySelectorAll('[data-admin-store-name]').forEach(element => {
    element.textContent = storeName
  })
}

async function loadPublicBrand() {
  try {
    const response = await fetch('/api/store-settings')
    const body = await response.json()
    if (response.ok && body.data) renderAdminBrand(body.data)
  } catch {}
}

function formatPrice(value) {
  const [integer, decimal] = Math.max(0, Number(value) || 0).toFixed(2).split('.')
  return { integer: Number(integer).toLocaleString('zh-CN'), decimal }
}

function toast(message) {
  const element = $('#toast')
  element.textContent = message
  element.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200)
}

function beginOperationProgress(title, detail = '正在准备文件…') {
  clearTimeout(beginOperationProgress.timer)
  const panel = $('#operationProgress')
  panel.className = 'operation-progress'
  $('#operationProgressTitle').textContent = title
  $('#operationProgressState').textContent = '准备中'
  $('#operationProgressPercent').textContent = '0%'
  $('#operationProgressFill').style.width = '0%'
  $('#operationProgressDetail').textContent = detail
}

function updateOperationProgress(percent, detail, stateText = '正在上传') {
  const value = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)))
  const panel = $('#operationProgress')
  panel.classList.remove('is-hidden', 'is-processing', 'is-complete', 'is-error')
  $('#operationProgressState').textContent = stateText
  $('#operationProgressPercent').textContent = `${value}%`
  $('#operationProgressFill').style.width = `${value}%`
  if (detail) $('#operationProgressDetail').textContent = detail
}

function showOperationProcessing(detail) {
  const panel = $('#operationProgress')
  panel.classList.remove('is-hidden', 'is-complete', 'is-error')
  panel.classList.add('is-processing')
  $('#operationProgressState').textContent = '服务器处理中'
  $('#operationProgressPercent').textContent = '处理中'
  if (detail) $('#operationProgressDetail').textContent = detail
}

function completeOperationProgress(detail) {
  const panel = $('#operationProgress')
  panel.classList.remove('is-hidden', 'is-processing', 'is-error')
  panel.classList.add('is-complete')
  $('#operationProgressState').textContent = '已完成'
  $('#operationProgressPercent').textContent = '100%'
  $('#operationProgressFill').style.width = '100%'
  $('#operationProgressDetail').textContent = detail
  clearTimeout(beginOperationProgress.timer)
  beginOperationProgress.timer = setTimeout(() => panel.classList.add('is-hidden'), 2600)
}

function failOperationProgress(detail) {
  const panel = $('#operationProgress')
  panel.classList.remove('is-hidden', 'is-processing', 'is-complete')
  panel.classList.add('is-error')
  $('#operationProgressState').textContent = '操作失败'
  $('#operationProgressPercent').textContent = '!'
  $('#operationProgressDetail').textContent = detail
  clearTimeout(beginOperationProgress.timer)
  beginOperationProgress.timer = setTimeout(() => panel.classList.add('is-hidden'), 5000)
}

function setFileOperationsBusy(busy) {
  document.body.classList.toggle('upload-busy', busy)
  document.querySelectorAll('input[type="file"]').forEach(input => { input.disabled = busy })
}

function showImportMessage(message, type, report = null, mappingReview = null) {
  const element = $('#inventoryImportMessage')
  element.className = `inventory-import-message ${type}`
  element.replaceChildren(document.createTextNode(message))
  if (report?.url) {
    const link = document.createElement('a')
    link.className = 'inventory-report-link'
    link.href = report.url
    link.download = report.fileName || '未匹配产品.xlsx'
    link.textContent = `下载未匹配产品表（${report.count || 0} 条）`
    element.append(' ', link)
    requestAnimationFrame(() => link.click())
  }
  if (Number(mappingReview?.pendingSourceCount) > 0) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inventory-report-link'
    button.textContent = `立即处理 ${Number(mappingReview.pendingSourceCount).toLocaleString('zh-CN')} 个新增待对应名称`
    button.addEventListener('click', async () => {
      $('#inventoryMappingStatus').value = 'unmapped'
      location.hash = '#inventory-mappings'
      await loadInventoryMappings({ scroll: true })
    })
    element.append(' ', button)
  }
}

async function downloadLatestUnmatchedReport() {
  const response = await fetch('/api/admin/inventory/reports/latest', { credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || '未匹配表格下载失败')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const fileName = encodedName ? decodeURIComponent(encodedName) : '未匹配产品.xlsx'
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function closeUnmatchedReport() {
  $('#unmatchedReportModal').classList.add('is-hidden')
  $('#unmatchedReportBackdrop').classList.add('is-hidden')
}

function renderPaginationSelector(selectId, totalId, currentPage, totalPages) {
  const select = $(selectId)
  if (!select) return
  select.innerHTML = Array.from(
    { length: totalPages },
    (_, index) => `<option value="${index + 1}"${index + 1 === currentPage ? ' selected' : ''}>${index + 1}</option>`
  ).join('')
  const total = $(totalId)
  if (total) total.textContent = totalPages
}

function renderUnmatchedReport() {
  const report = state.unmatchedReport
  if (!report) return
  const query = $('#unmatchedReportSearch').value.trim().toLowerCase()
  const reason = $('#unmatchedReportReason').value
  const filtered = report.rows.filter(row => {
    if (reason !== 'all' && row.reason !== reason) return false
    if (!query) return true
    return [row.rowNumber, row.location, row.code, row.name, row.color, row.size, row.internalCode, row.reason, row.candidateCode, row.candidateName, row.productColors, row.productSizes]
      .some(value => String(value ?? '').toLowerCase().includes(query))
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.unmatchedReportPageSize))
  state.unmatchedReportPage = Math.min(Math.max(1, state.unmatchedReportPage), totalPages)
  const start = (state.unmatchedReportPage - 1) * state.unmatchedReportPageSize
  const visible = filtered.slice(start, start + state.unmatchedReportPageSize)
  $('#unmatchedReportRows').innerHTML = visible.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.rowNumber || '—')}</strong><small>${escapeHtml(row.sourceType || '')}</small></td>
      <td><div class="unmatched-source-product"><strong>${escapeHtml(row.name || row.code || '—')}</strong><small>${row.code ? `款号：${escapeHtml(row.code)}` : ''}${row.internalCode ? `${row.code ? ' · ' : ''}内部编码：${escapeHtml(row.internalCode)}` : ''}${row.location ? ` · 货位：${escapeHtml(row.location)}` : ''}</small></div></td>
      <td>${escapeHtml(row.color || '—')}</td>
      <td>${escapeHtml(row.size || '—')}</td>
      <td><strong class="unmatched-quantity">${Number(row.quantity || 0).toLocaleString('zh-CN')}</strong></td>
      <td><span class="unmatched-reason">${escapeHtml(row.reason || '未说明')}</span></td>
      <td><div class="unmatched-candidate"><strong>${escapeHtml(row.candidateName || '无唯一候选')}</strong><small>${row.candidateCode ? `款号：${escapeHtml(row.candidateCode)}` : ''}</small></div></td>
      <td><div class="unmatched-existing"><strong>${escapeHtml(row.productColors || '—')}</strong><small>${row.productSizes ? `尺码：${escapeHtml(row.productSizes)}` : '—'}</small></div></td>
    </tr>
  `).join('')
  $('#unmatchedReportCount').textContent = `${filtered.length.toLocaleString('zh-CN')} 条明细`
  renderPaginationSelector('#unmatchedReportPageSelect', '#unmatchedReportTotalPages', state.unmatchedReportPage, totalPages)
  $('#unmatchedReportPrevious').disabled = state.unmatchedReportPage <= 1
  $('#unmatchedReportNext').disabled = state.unmatchedReportPage >= totalPages
  $('#unmatchedReportEmpty').classList.toggle('is-hidden', filtered.length > 0)
}

async function openUnmatchedReport(button) {
  button.disabled = true
  try {
    const result = await api('/api/admin/inventory/reports/latest/details')
    state.unmatchedReport = result.data
    state.unmatchedReportPage = 1
    $('#unmatchedReportSearch').value = ''
    const reasons = [...new Set(result.data.rows.map(row => row.reason).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    $('#unmatchedReportReason').innerHTML = `<option value="all">全部未匹配原因</option>${reasons.map(reason => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}`
    $('#unmatchedReportMeta').textContent = `${result.data.sourceFileName || '最近一次库存表'} · ${result.data.generatedAt || '生成时间未知'} · 共 ${Number(result.data.total || 0).toLocaleString('zh-CN')} 条`
    $('#unmatchedReportModal').classList.remove('is-hidden')
    $('#unmatchedReportBackdrop').classList.remove('is-hidden')
    renderUnmatchedReport()
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
  }
}

function inventorySourceToken(sourceName, sourceInternalCode) {
  return encodeURIComponent(JSON.stringify([sourceName || '', sourceInternalCode || '']))
}

function productOptionLabel(product) {
  return `${product.code} ｜ ${product.name}`
}

function findInventoryMappingProduct(value) {
  const products = state.inventoryMappingData?.products || []
  const keyword = String(value || '').trim().toLowerCase()
  if (!keyword) return null
  const exactLabel = products.find(product => productOptionLabel(product).toLowerCase() === keyword)
  if (exactLabel) return exactLabel
  const exactCode = products.find(product => String(product.code).trim().toLowerCase() === keyword)
  if (exactCode) return exactCode
  const exactNames = products.filter(product => String(product.name).trim().toLowerCase() === keyword)
  return exactNames.length === 1 ? exactNames[0] : null
}

let inventoryProductSearchInput = null

function inventorySearchKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[|｜·•,，。:：;；'"“”‘’()（）【】[\]{}<>《》/\\_—–\-\s]+/gu, '')
}

function inventoryProductSearchResults(value, limit = 20) {
  const products = state.inventoryMappingData?.products || []
  const rawQuery = String(value || '').normalize('NFKC').trim().toLowerCase()
  const query = inventorySearchKey(rawQuery)
  if (!query) return []
  const queryParts = rawQuery.match(/[a-z]+|\d+|[\u3400-\u9fff]+/giu)?.map(inventorySearchKey).filter(Boolean) || [query]
  return products.map(product => {
    const code = inventorySearchKey(product.code)
    const name = inventorySearchKey(product.name)
    const category = inventorySearchKey(product.category)
    const colors = inventorySearchKey((product.colors || []).join(' '))
    const combined = `${code}${name}${category}${colors}`
    if (!combined.includes(query) && !queryParts.every(part => combined.includes(part))) return null
    let score = 0
    if (code === query) score += 1200
    else if (code.startsWith(query)) score += 1000
    else if (code.includes(query)) score += 850
    if (name === query) score += 1100
    else if (name.startsWith(query)) score += 760
    else if (name.includes(query)) score += 620
    if (category.includes(query)) score += 160
    if (colors.includes(query)) score += 80
    if (queryParts.length > 1 && queryParts.every(part => combined.includes(part))) score += 500
    return { product, score }
  }).filter(Boolean).sort((left, right) =>
    right.score - left.score ||
    String(left.product.code).localeCompare(String(right.product.code), 'zh-CN', { numeric: true })
  ).slice(0, limit).map(item => item.product)
}

function hideInventoryProductSearchPopup() {
  inventoryProductSearchInput = null
  $('#inventoryProductSearchPopup').classList.add('is-hidden')
  $('#inventoryProductSearchPopup').innerHTML = ''
}

function renderInventoryProductSearchPopup(input) {
  inventoryProductSearchInput = input
  const popup = $('#inventoryProductSearchPopup')
  const results = inventoryProductSearchResults(input.value)
  popup.innerHTML = results.length
    ? results.map(product => `
        <button type="button" data-inventory-search-product-id="${product.id}">
          <strong>${escapeHtml(product.code)}</strong>
          <span>${escapeHtml(product.name)}</span>
          <small>${escapeHtml(product.category || '未分类')}${(product.colors || []).length ? ` · ${escapeHtml(product.colors.join('、'))}` : ''}</small>
        </button>
      `).join('')
    : `<div class="inventory-product-search-empty">${input.value.trim() ? '没有找到匹配商品，请换一段款号或名称' : '请输入任意一段款号或商品名称'}</div>`
  const rect = input.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 390), window.innerWidth - 24)
  popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`
  popup.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - 180)}px`
  popup.style.width = `${width}px`
  popup.classList.remove('is-hidden')
}

function inventoryColorOptions(product, selectedColor = '') {
  if (!product) return '<option value="">请先选择数据库商品</option>'
  const colors = product.colors || []
  if (!colors.length) return '<option value="">该商品未设置颜色</option>'
  return `<option value="">请选择对应颜色</option>${colors.map(color =>
    `<option value="${escapeHtml(color)}" ${color === selectedColor ? 'selected' : ''}>${escapeHtml(color)}</option>`
  ).join('')}`
}

function inventoryMappingFilteredSources() {
  const sources = state.inventoryMappingData?.sources || []
  const query = $('#inventoryMappingSearch').value.trim().toLowerCase()
  const status = $('#inventoryMappingStatus').value
  const reason = $('#inventoryMappingReason').value
  return sources.filter(source => {
    const manuallyMatched = Boolean(source.mapping)
    const automaticallyMatched = !manuallyMatched && Boolean((source.matches || []).length)
    const matched = manuallyMatched || automaticallyMatched
    if (status === 'mapped' && !matched) return false
    if (status === 'unmapped' && matched) return false
    if (status === 'manual' && !manuallyMatched) return false
    if (status === 'automatic' && !automaticallyMatched) return false
    if (reason !== 'all' && !(source.reasons || []).includes(reason)) return false
    if (!query) return true
    return [
      source.sourceName,
      source.sourceInternalCode,
      ...(source.reasons || []),
      source.candidateCode,
      source.candidateName,
      source.mapping?.productCode,
      source.mapping?.productName,
      ...(source.matches || []).flatMap(match => [match.productCode, match.productName])
    ].some(value => String(value ?? '').toLowerCase().includes(query))
  }).sort((left, right) => {
    const leftMatched = Boolean(left.mapping || (left.matches || []).length)
    const rightMatched = Boolean(right.mapping || (right.matches || []).length)
    if (leftMatched !== rightMatched) return leftMatched ? -1 : 1
    return left.sourceName.localeCompare(right.sourceName, 'zh-CN')
  })
}

function renderInventoryMappings() {
  const data = state.inventoryMappingData
  if (!data) return
  hideInventoryProductSearchPopup()
  const filtered = inventoryMappingFilteredSources()
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.inventoryMappingPageSize))
  state.inventoryMappingPage = Math.min(Math.max(1, state.inventoryMappingPage), totalPages)
  const start = (state.inventoryMappingPage - 1) * state.inventoryMappingPageSize
  const visible = filtered.slice(start, start + state.inventoryMappingPageSize)
  $('#inventoryMappingRows').innerHTML = visible.map(source => {
    const token = inventorySourceToken(source.sourceName, source.sourceInternalCode)
    const mapping = source.mapping
    const automaticMatches = source.matches || []
    const mappedProduct = mapping ? data.products.find(product => product.id === mapping.productId) : null
    const automaticProduct = !mapping && automaticMatches.length === 1
      ? data.products.find(product => product.id === automaticMatches[0].productId)
      : null
    const selectedProduct = mappedProduct || automaticProduct
    const selectedColor = mapping?.targetColor || (automaticMatches.length === 1 ? automaticMatches[0].color : '')
    const currentValue = mappedProduct
      ? productOptionLabel(mappedProduct)
      : automaticProduct ? productOptionLabel(automaticProduct) : ''
    const reasonText = (source.reasons || []).join('；') || (
      source.fromLatestImport
        ? `本次已成功写入 ${automaticMatches.reduce((sum, match) => sum + Number(match.matchedRows || 0), 0)} 行`
        : source.fromLatestReport ? '未说明原因' : '历史人工对应，不在最近一次库存表中'
    )
    const currentMappingHtml = mapping
      ? `<div class="inventory-mapped-product"><span>人工对应</span><strong>${escapeHtml(mapping.productName)}</strong><small>款号：${escapeHtml(mapping.productCode)}${mapping.targetColor ? ` · 颜色：${escapeHtml(mapping.targetColor)}` : ''} · 后续导入优先采用</small></div>`
      : automaticMatches.length
        ? `<div class="inventory-mapped-product automatic"><span>自动匹配</span>${automaticMatches.map(match => `<strong>${escapeHtml(match.productName)}</strong><small>款号：${escapeHtml(match.productCode)} · ${Number(match.matchedRows || 0)} 行已写入${match.color ? ` · ${escapeHtml(match.color)}` : ''}</small>`).join('')}</div>`
        : `<div class="inventory-unmapped-state"><span>待人工选择</span>${source.candidateName ? `<small>系统候选：${escapeHtml(source.candidateCode)} ｜ ${escapeHtml(source.candidateName)}</small>` : ''}</div>`
    return `
      <tr data-inventory-source="${escapeHtml(token)}">
        <td>
          <div class="inventory-source-name">
            <strong>${escapeHtml(source.sourceName)}</strong>
            <small>${source.sourceInternalCode ? `内部编码：${escapeHtml(source.sourceInternalCode)}` : '无内部编码'}</small>
          </div>
        </td>
        <td>
          <div class="inventory-source-detail">
            <strong>${Number(source.rowCount || 0).toLocaleString('zh-CN')} 行 · 数量 ${Number(source.totalQuantity || 0).toLocaleString('zh-CN')}</strong>
            <small>${escapeHtml(reasonText)}</small>
            ${(source.sizes || []).length ? `<em>来源尺码：${escapeHtml(source.sizes.slice(0, 12).join('、'))}${source.sizes.length > 12 ? '…' : ''}</em>` : ''}
          </div>
        </td>
        <td>
          ${currentMappingHtml}
        </td>
        <td>
          <label class="inventory-product-search">
            <input type="search" value="${escapeHtml(currentValue)}" placeholder="输入任意一段款号或商品名称" autocomplete="off" />
            <small>可搜索全部 ${data.products.length.toLocaleString('zh-CN')} 个数据库商品</small>
          </label>
        </td>
        <td>
          <label class="inventory-color-select">
            <select>${inventoryColorOptions(selectedProduct, selectedColor)}</select>
            <small>每个 Excel 颜色独立对应</small>
          </label>
        </td>
        <td>
          <div class="inventory-mapping-actions">
            <button type="button" class="primary-button" data-mapping-action="save">${mapping ? '更新人工对应' : automaticMatches.length ? '改为人工对应' : '保存对应'}</button>
            ${mapping ? '<button type="button" class="secondary-button danger" data-mapping-action="delete">删除对应</button>' : ''}
          </div>
        </td>
      </tr>
    `
  }).join('')
  const mappedCount = data.sources.filter(source => source.mapping || (source.matches || []).length).length
  const pendingCount = data.sources.filter(source => !source.mapping && !(source.matches || []).length).length
  $('#inventoryMappingSourceCount').textContent = data.sources.filter(source => source.fromLatestReport || source.fromLatestImport).length.toLocaleString('zh-CN')
  $('#inventoryMappingPendingCount').textContent = pendingCount.toLocaleString('zh-CN')
  $('#inventoryMappingSavedCount').textContent = mappedCount.toLocaleString('zh-CN')
  $('#inventoryMappingProductCount').textContent = data.products.length.toLocaleString('zh-CN')
  $('#inventoryMappingVisibleCount').textContent = `${filtered.length.toLocaleString('zh-CN')} 项`
  renderPaginationSelector('#inventoryMappingPageSelect', '#inventoryMappingTotalPages', state.inventoryMappingPage, totalPages)
  $('#inventoryMappingPrevious').disabled = state.inventoryMappingPage <= 1
  $('#inventoryMappingNext').disabled = state.inventoryMappingPage >= totalPages
  $('#inventoryMappingEmpty').classList.toggle('is-hidden', visible.length > 0)
}

async function loadInventoryMappings({ scroll = false } = {}) {
  const button = $('#inventoryMappingRefresh')
  button.disabled = true
  button.textContent = '正在读取…'
  try {
    const result = await api('/api/admin/inventory/mappings')
    state.inventoryMappingData = result.data
    state.inventoryMappingsLoaded = true
    state.inventoryMappingPage = 1
    const reasons = [...new Set((result.data.sources || []).flatMap(source => source.reasons || []))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    $('#inventoryMappingReason').innerHTML = `<option value="all">全部未匹配原因</option>${reasons.map(reason => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}`
    const report = result.data.report
    $('#inventoryMappingReportMeta').textContent = report
      ? `最近来源：${report.sourceFileName || report.fileName} · ${report.generatedAt || '时间未知'} · ${Number(report.totalRows || 0).toLocaleString('zh-CN')} 条未写入明细`
      : '当前没有未匹配库存表；已保存的历史对应仍会继续生效。'
    $('#inventoryMappingDownload').disabled = !Number(report?.totalRows)
    renderInventoryMappings()
    if (scroll) $('#inventory-mappings').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
    button.textContent = '刷新最新明细'
  }
}

function stockLevel(quantity) {
  const value = Math.max(0, Math.trunc(Number(quantity) || 0))
  if (value === 0) return { className: 'out', label: '缺货' }
  if (value <= 5) return { className: 'low', label: '低库存' }
  return { className: 'normal', label: '正常' }
}

function orderedSizeStocks(product) {
  const sizeStocks = product.sizeStocks || {}
  const sizes = [...new Set([...(product.sizes || []), ...Object.keys(sizeStocks)])]
  return sizes.map(size => ({ size, quantity: Math.max(0, Math.trunc(Number(sizeStocks[size]) || 0)) }))
}

function orderedColorSizeStocks(product) {
  const colors = product.colors || []
  const sizes = product.sizes || []
  const matrix = product.colorSizeStocks || {}
  return colors.map(color => ({
    color,
    sizes: sizes.map(size => ({ size, quantity: Math.max(0, Math.trunc(Number(matrix[color]?.[size]) || 0)) }))
  }))
}

function productCategoryNames(product) {
  return Array.isArray(product?.categories) && product.categories.length
    ? product.categories
    : (product?.category ? [product.category] : [])
}

function renderHomepageOverview(products) {
  const published = products.filter(product => product.status === 'published')
  const categories = state.categories.map(category => {
    const categoryProducts = published.filter(product => productCategoryNames(product).includes(category.name))
    return {
      ...category,
      products: categoryProducts,
      count: categoryProducts.length,
      stock: categoryProducts.reduce((total, product) => total + (Number(product.stock) || 0), 0)
    }
  })

  $('#popularCategoryCount').textContent = `${categories.length} 个`
  $('#popularCategoryList').innerHTML = categories.length
    ? categories.map(category => `
      <div class="popular-category-item">
        <div class="popular-category-cover" style="background-color:${escapeHtml(category.tone)}22;color:${escapeHtml(category.tone)};">${category.image ? `<img src="${escapeHtml(category.image)}" alt="" loading="lazy" decoding="async" />` : `<span>${escapeHtml(category.icon || category.name.slice(0, 2))}</span>`}</div>
        <div class="popular-category-summary"><div><strong>${escapeHtml(category.name)}</strong><small>${category.count} 款商品 · 库存 ${category.stock}</small></div><button type="button" data-filter-category="${escapeHtml(category.name)}">管理商品</button></div>
      </div>
    `).join('')
    : '<div class="homepage-content-empty">暂无可展示分类</div>'
}

const adminPageNames = new Set(['products', 'inventory-mappings', 'homepage', 'categories', 'media', 'settings', 'accounts'])
const adminPageLabels = {
  products: '商品管理',
  'inventory-mappings': '库存对应',
  homepage: '首页展示',
  categories: '分类管理',
  media: '素材中心',
  settings: '店铺设置',
  accounts: '账号管理'
}
const adminPageIcons = {
  products: '▦',
  'inventory-mappings': '⇄',
  homepage: '⌂',
  categories: '▤',
  media: '▧',
  settings: '⚙',
  accounts: '♙'
}
let openAdminPages = ['products']
let operationPagesRestored = false
let activeAdminPage = 'products'
const renderedAdminPages = new Set()
const adminPageScrollPositions = new Map()

function saveOpenAdminPages() {
  try { sessionStorage.setItem('purunAdminOpenPages', JSON.stringify(openAdminPages)) } catch {}
}

function restoreOpenAdminPages() {
  if (operationPagesRestored) return
  operationPagesRestored = true
  try {
    const saved = JSON.parse(sessionStorage.getItem('purunAdminOpenPages') || '[]')
    if (Array.isArray(saved)) {
      openAdminPages = [...new Set(saved)].filter(page =>
        adminPageNames.has(page) && (page !== 'accounts' || state.currentUser?.role === 'owner')
      )
    }
  } catch {}
  if (!openAdminPages.length) openAdminPages = ['products']
}

function renderOperationPageTabs(activePage) {
  openAdminPages = openAdminPages.filter(page =>
    adminPageNames.has(page) && (page !== 'accounts' || state.currentUser?.role === 'owner')
  )
  if (!openAdminPages.includes(activePage)) openAdminPages.push(activePage)
  saveOpenAdminPages()
  $('#operationPageTabs').innerHTML = openAdminPages.map(page => `
    <div class="operation-page-tab ${page === activePage ? 'active' : ''}" role="presentation">
      <button class="operation-page-tab-select" type="button" role="tab" aria-selected="${page === activePage}" data-operation-tab="${page}" title="打开${escapeHtml(adminPageLabels[page])}">
        <span aria-hidden="true">${adminPageIcons[page]}</span>
        <strong>${escapeHtml(adminPageLabels[page])}</strong>
      </button>
      <button class="operation-page-tab-close" type="button" data-close-operation-tab="${page}" aria-label="关闭${escapeHtml(adminPageLabels[page])}" title="关闭">×</button>
    </div>
  `).join('')
  const activeTab = $('#operationPageTabs').querySelector('.operation-page-tab.active')
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function closeOperationPageTab(pageName) {
  const index = openAdminPages.indexOf(pageName)
  if (index < 0) return
  const activePage = adminPageFromHash()
  openAdminPages.splice(index, 1)
  if (!openAdminPages.length) openAdminPages.push('products')
  saveOpenAdminPages()
  if (pageName === activePage) {
    const nextPage = openAdminPages[Math.min(index, openAdminPages.length - 1)] || 'products'
    if (location.hash === `#${nextPage}`) showAdminPage(nextPage)
    else location.hash = `#${nextPage}`
    return
  }
  renderOperationPageTabs(activePage)
}

function adminPageFromHash() {
  const name = decodeURIComponent(location.hash.replace(/^#/, ''))
  if (name === 'accounts' && state.currentUser?.role !== 'owner') return 'products'
  return adminPageNames.has(name) ? name : 'products'
}

function showAdminPage(name = adminPageFromHash(), { scrollTop = false, renderPage = false } = {}) {
  const requestedPage = adminPageNames.has(name) ? name : 'products'
  const pageName = requestedPage === 'accounts' && state.currentUser?.role !== 'owner'
    ? 'products'
    : requestedPage
  if (activeAdminPage !== pageName) adminPageScrollPositions.set(activeAdminPage, window.scrollY)
  activeAdminPage = pageName
  document.querySelectorAll('[data-admin-page]').forEach(element => {
    element.classList.toggle('is-active', element.dataset.adminPage === pageName)
  })
  document.querySelectorAll('.nav-item').forEach(link => {
    link.classList.toggle('active', link.getAttribute('href') === `#${pageName}`)
  })
  renderOperationPageTabs(pageName)
  document.title = `${state.settings?.storeName || '普润制衣团购仓'}，${adminPageLabels[pageName] || '商品管理'}`
  if (pageName === 'inventory-mappings' && !state.inventoryMappingsLoaded) loadInventoryMappings()
  const shouldRenderPage = renderPage || !renderedAdminPages.has(pageName)
  if (shouldRenderPage && pageName === 'products') renderProductTable()
  if (shouldRenderPage && pageName === 'homepage') renderHomepageOverview(state.products)
  if (shouldRenderPage && pageName === 'categories') renderCategoryManagement()
  if (shouldRenderPage && pageName === 'media') renderMediaProducts()
  if (shouldRenderPage && pageName === 'accounts' && state.currentUser?.role === 'owner') loadAdminUsers()
  renderedAdminPages.add(pageName)
  syncEditorVisibilityForPage(pageName)
  scheduleProductHorizontalScrollUpdate()
  const nextScrollTop = scrollTop ? 0 : (adminPageScrollPositions.get(pageName) || 0)
  requestAnimationFrame(() => window.scrollTo({ top: nextScrollTop, behavior: 'auto' }))
}

function showApp() {
  $('#loginScreen').classList.add('is-hidden')
  $('#appShell').classList.remove('is-hidden')
  document.querySelectorAll('.owner-only').forEach(element => {
    element.classList.toggle('is-hidden', state.currentUser?.role !== 'owner')
  })
  $('#currentAdminLabel').textContent = state.currentUser
    ? `${state.currentUser.username} · ${state.currentUser.role === 'owner' ? '主管理员' : '普通管理员'}`
    : ''
  restoreOpenAdminPages()
  scheduleProductHorizontalScrollUpdate()
}

function showLogin(message = '') {
  state.currentUser = null
  state.adminUsers = []
  $('#appShell').classList.add('is-hidden')
  scheduleProductHorizontalScrollUpdate()
  $('#loginScreen').classList.remove('is-hidden')
  $('#loginMessage').textContent = message
}

async function loadProducts() {
  try {
    const [productResult, settingsResult, categoryResult, currentUserResult] = await Promise.all([
      api('/api/admin/products'),
      api('/api/admin/store-settings'),
      api('/api/admin/categories'),
      api('/api/auth/me')
    ])
    state.products = productResult.data
    state.settings = settingsResult.data
    state.currentUser = currentUserResult.data
    renderAdminBrand(settingsResult.data)
    state.categories = categoryResult.data
    state.storeIcon = settingsResult.data.storeIcon || ''
    state.homeHeroImages = Array.isArray(settingsResult.data.homeHeroImages) && settingsResult.data.homeHeroImages.length
      ? [...settingsResult.data.homeHeroImages]
      : (settingsResult.data.homeHeroImage ? [settingsResult.data.homeHeroImage] : [])
    showApp()
    render()
    renderSettingsForm()
    showAdminPage(adminPageFromHash(), { scrollTop: false, renderPage: false })
  } catch (error) {
    if (error.status === 401) showLogin()
    else toast(error.message)
  }
}

function renderStoreIconPreview() {
  const preview = $('#storeIconPreview')
  const name = $('#storeSettingsForm').elements.storeName.value.trim() || state.settings?.storeName || '店铺'
  preview.innerHTML = state.storeIcon
    ? `<img src="${escapeHtml(state.storeIcon)}" alt="店铺图标" />`
    : `<span>${escapeHtml(name.slice(0, 2).toUpperCase())}</span>`
}

const homeHeroMetadataCache = new Map()

function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 100 * 1024 ? 0 : 1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function homeHeroAssessment({ width, height, bytes }) {
  if (bytes > 15 * 1024 * 1024) return { text: '文件超过15MB', className: 'warning' }
  if (width < 750 || height < 390) return { text: '像素偏小', className: 'warning' }
  const ratioDifference = Math.abs(width / height - 750 / 390)
  if (ratioDifference > 0.22) return { text: '可用 · 满铺时会裁切', className: 'notice' }
  return { text: '尺寸可用', className: 'ready' }
}

async function homeHeroMetadata(url) {
  if (!homeHeroMetadataCache.has(url)) {
    homeHeroMetadataCache.set(url, api(`/api/admin/image-metadata?url=${encodeURIComponent(url)}`).then(result => result.data))
  }
  return homeHeroMetadataCache.get(url)
}

function refreshHomeHeroMetadata() {
  document.querySelectorAll('[data-home-hero-meta]').forEach(async element => {
    const index = Number(element.dataset.homeHeroMeta)
    const url = state.homeHeroImages[index]
    if (!url) return
    try {
      const metadata = await homeHeroMetadata(url)
      if (!element.isConnected || state.homeHeroImages[index] !== url) return
      const assessment = homeHeroAssessment(metadata)
      element.innerHTML = `
        <div><strong>${metadata.width.toLocaleString('zh-CN')} × ${metadata.height.toLocaleString('zh-CN')} px</strong><span>${formatFileSize(metadata.bytes)}</span></div>
        <small class="${assessment.className}">${assessment.text}</small>
      `
    } catch {
      if (element.isConnected && state.homeHeroImages[index] === url) {
        element.innerHTML = '<div><strong>像素与大小读取失败</strong></div><small class="warning">请重新上传图片</small>'
      }
    }
  })
}

function renderHomeHeroPreview() {
  $('#homeHeroPreview').innerHTML = state.homeHeroImages.length
    ? state.homeHeroImages.map((url, index) => `<div class="home-hero-preview-item">
        <img src="${escapeHtml(url)}" alt="首页轮播图 ${index + 1}" loading="lazy" decoding="async" />
        <span>${index === 0 ? '默认图' : `第 ${index + 1} 张`}</span>
        <div class="home-hero-preview-meta" data-home-hero-meta="${index}">
          <div><strong>正在读取像素与大小…</strong></div>
          <small>建议 1500 × 780 px</small>
        </div>
        <div class="home-hero-preview-actions">
          <button type="button" data-hero-action="previous" data-hero-index="${index}" ${index === 0 ? 'disabled' : ''}>前移</button>
          <button type="button" data-hero-action="next" data-hero-index="${index}" ${index === state.homeHeroImages.length - 1 ? 'disabled' : ''}>后移</button>
          <button type="button" data-hero-action="remove" data-hero-index="${index}">删除</button>
        </div>
      </div>`).join('')
    : '<div class="home-hero-empty">还没有轮播图片，小程序将使用默认图片。</div>'
  refreshHomeHeroMetadata()
}

function renderSettingsForm() {
  if (!state.settings) return
  const form = $('#storeSettingsForm')
  form.elements.storeName.value = state.settings.storeName || ''
  form.elements.homeEyebrow.value = state.settings.homeEyebrow || ''
  form.elements.homeSubtitle.value = state.settings.homeSubtitle || ''
  form.elements.searchPlaceholder.value = state.settings.searchPlaceholder || ''
  form.elements.heroNote.value = state.settings.heroNote || ''
  form.elements.homeHeroImageMode.value = state.settings.homeHeroImageMode || 'aspectFill'
  form.elements.categoryTitle.value = state.settings.categoryTitle || ''
  form.elements.categorySubtitle.value = state.settings.categorySubtitle || ''
  form.elements.categoryMoreText.value = state.settings.categoryMoreText || ''
  form.elements.homeServices.value = (state.settings.homeServices || []).join(', ')
  form.elements.profileLayout.value = state.settings.profileLayout || 'member'
  form.elements.profilePageTitle.value = state.settings.profilePageTitle || '我的'
  form.elements.profileTitle.value = state.settings.profileTitle || ''
  form.elements.profileSubtitle.value = state.settings.profileSubtitle || ''
  form.elements.serviceTitle.value = state.settings.serviceTitle || '常用服务'
  form.elements.services.value = (state.settings.services || []).join(', ')
  form.elements.profileAboutTitle.value = state.settings.profileAboutTitle || ''
  form.elements.productFeatures.value = (state.settings.productFeatures || []).join(', ')
  form.elements.aboutText.value = state.settings.aboutText || ''
  form.elements.footerText.value = state.settings.footerText || ''
  $('#storeIconUrl').value = state.storeIcon || ''
  $('#settingsMessage').textContent = ''
  renderStoreIconPreview()
  renderHomeHeroPreview()
}

function renderCategoryManagement() {
  const productById = new Map(state.products.map(product => [product.id, product]))
  $('#categoryManagementList').innerHTML = state.categories.map((category, index) => {
    const orderedProducts = (category.productIds || []).map(id => productById.get(id)).filter(Boolean)
    const expanded = state.expandedCategoryId === category.id
    return `
      <article class="category-management-item ${expanded ? 'is-expanded' : ''}" data-category-row="${category.id}">
        <label class="category-position-control">
          <span>排序</span>
          <input type="number" inputmode="numeric" min="1" max="${state.categories.length}" step="1" value="${index + 1}" data-category-position="${category.id}" aria-label="${escapeHtml(category.name)}的大类排序位置" />
        </label>
        <div class="category-cover" style="background-color:${escapeHtml(category.tone)}22;color:${escapeHtml(category.tone)};">
          ${category.image ? `<img src="${escapeHtml(category.image)}" alt="${escapeHtml(category.name)}首页图片" loading="lazy" decoding="async" />` : `<span>${escapeHtml(category.icon || category.name.slice(0, 2))}</span>`}
        </div>
        <div class="category-edit-fields">
          <label><span>分类名称</span><input data-category-name="${category.id}" value="${escapeHtml(category.name)}" maxlength="30" /></label>
          <label class="category-image-link"><span>分类图片链接（自动下载到本服务器）</span><input type="text" inputmode="url" data-category-image-url="${category.id}" value="${escapeHtml(category.image || '')}" placeholder="粘贴公开 HTTPS 图片链接" /></label>
          <small>${category.count || 0} 款已上架商品</small>
        </div>
        <div class="category-item-actions">
          <button type="button" class="category-products-button" data-category-toggle="${category.id}">${expanded ? '收起商品' : `商品排序 ${orderedProducts.length}`}</button>
          <button type="button" data-category-save="${category.id}">保存</button>
          <button type="button" data-category-image="${category.id}">换图</button>
          <button type="button" data-category-move="up" data-id="${category.id}" ${index === 0 ? 'disabled' : ''} title="分类上移">↑</button>
          <button type="button" data-category-move="down" data-id="${category.id}" ${index === state.categories.length - 1 ? 'disabled' : ''} title="分类下移">↓</button>
          <button type="button" class="category-delete-button" data-category-delete="${category.id}">删除分类</button>
        </div>
        ${expanded ? `<section class="category-product-order">
          <div class="category-product-order-head"><strong>分类下商品顺序</strong><span>共 ${orderedProducts.length} 款 · 输入位置数字后立即保存</span></div>
          <div class="category-product-order-list">
            ${orderedProducts.length ? orderedProducts.map((product, productIndex) => `
              <div class="category-product-order-item">
                <img src="${escapeHtml(imageUrl(product.images[0]))}" alt="" loading="lazy" decoding="async" />
                <div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.code)}</small></div>
                <label><span>位置（1–${orderedProducts.length}）</span><input type="number" inputmode="numeric" min="1" max="${orderedProducts.length}" step="1" value="${productIndex + 1}" data-category-product-position="${category.id}" data-product-id="${product.id}" aria-label="${escapeHtml(product.name)}在${escapeHtml(category.name)}中的位置" /></label>
              </div>
            `).join('') : '<div class="category-product-order-empty">该分类暂无已上架商品</div>'}
          </div>
        </section>` : ''}
      </article>
    `
  }).join('')
}

function renderSharedAdminData() {
  const all = state.products
  const category = $('#categoryFilter').value

  $('#totalCount').textContent = all.length
  $('#publishedCount').textContent = all.filter(item => item.status === 'published').length
  $('#draftCount').textContent = all.filter(item => item.status === 'draft').length
  $('#lowStockCount').textContent = all.filter(item => orderedColorSizeStocks(item).some(group => group.sizes.some(({ quantity }) => quantity <= 5))).length
  $('#categoryCount').textContent = new Set(all.flatMap(productCategoryNames)).size
  const categoryNames = state.categories.map(item => item.name)
  const selectedCategory = categoryNames.includes(category) ? category : 'all'
  $('#categoryOptions').innerHTML = categoryNames.map(name => `<option value="${escapeHtml(name)}"></option>`).join('')
  $('#categoryFilter').innerHTML = `<option value="all">全部分类</option>${categoryNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`
  $('#categoryFilter').value = selectedCategory
}

function renderProductTable() {
  const all = state.products
  const globalProductPosition = new Map(all.map((product, index) => [product.id, index + 1]))
  const query = $('#searchInput').value.trim().toLowerCase()
  const status = $('#statusFilter').value
  const category = $('#categoryFilter').value
  const selectedCategory = category === 'all' ? null : state.categories.find(item => item.name === category)
  const categoryProductPosition = new Map((selectedCategory?.productIds || []).map((id, index) => [Number(id), index + 1]))
  const colorImageStatus = $('#colorImageFilter').value
  let filtered = all.filter(product => {
    const colors = product.colors || []
    const mappedColors = colors.filter(color => (product.colorGalleries?.[color] || []).length || product.colorImages?.[color]).length
    const colorImagesComplete = !colors.length || mappedColors === colors.length
    const matchesQuery = !query || `${product.code} ${product.name} ${productCategoryNames(product).join(' ')}`.toLowerCase().includes(query)
    const matchesStatus = status === 'all' || product.status === status
    const matchesCategory = category === 'all' || productCategoryNames(product).includes(category)
    const matchesColorImages = colorImageStatus === 'all' || (colorImageStatus === 'complete' ? colorImagesComplete : !colorImagesComplete)
    return matchesQuery && matchesStatus && matchesCategory && matchesColorImages
  })
  if (selectedCategory) {
    filtered = filtered.slice().sort((left, right) =>
      (categoryProductPosition.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (categoryProductPosition.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    )
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.productPageSize))
  state.productPage = Math.min(Math.max(1, state.productPage), totalPages)
  const pageStart = (state.productPage - 1) * state.productPageSize
  const visible = filtered.slice(pageStart, pageStart + state.productPageSize)

  $('#productRows').innerHTML = visible.map(product => {
    const sizeDetails = orderedSizeStocks(product)
    const colorDetails = orderedColorSizeStocks(product)
    const colorCount = (product.colors || []).length
    const mappedColorCount = (product.colors || []).filter(color => (product.colorGalleries?.[color] || []).length || product.colorImages?.[color]).length
    const colorImagesComplete = !colorCount || mappedColorCount === colorCount
    const hasLowStock = colorDetails.some(group => group.sizes.some(({ quantity }) => quantity <= 5))
    const price = formatPrice(product.price)
    const productPosition = selectedCategory ? categoryProductPosition.get(product.id) : globalProductPosition.get(product.id)
    const positionLimit = selectedCategory ? categoryProductPosition.size : all.length
    const positionUnavailable = !productPosition
    const positionScope = selectedCategory ? '分类内' : '全部'
    return `
    <tr>
      <td><div class="product-cell"><img class="product-thumb" src="${escapeHtml(imageUrl(product.images[0]))}" alt="" loading="lazy" decoding="async" /><div><strong>${escapeHtml(product.name)}</strong><small class="product-location">货位：${escapeHtml(product.subtitle || '未设置')}</small><small class="product-code">款号：${escapeHtml(product.code)}</small>${colorCount ? `<small class="product-color-image-status ${colorImagesComplete ? 'complete' : 'incomplete'}">颜色图 ${mappedColorCount}/${colorCount}${colorImagesComplete ? ' 已对应' : ' 待完善'}</small>` : ''}</div></div></td>
      <td class="product-sort-cell"><label class="product-position-control"><input type="number" inputmode="numeric" min="1" max="${positionLimit}" step="1" value="${productPosition || ''}" data-product-position="${product.id}" data-position-category-id="${selectedCategory?.id || ''}" aria-label="${escapeHtml(product.name)}的${positionScope}排序位置" ${positionUnavailable ? 'disabled' : ''} /><small>${positionUnavailable ? '上架后排序' : `${positionScope} 1–${positionLimit}`}</small></label></td>
      <td>${escapeHtml(productCategoryNames(product).join('、'))}</td>
      <td class="price-cell"><span class="price-currency">¥</span><strong class="price-number"><span class="price-integer">${price.integer}</span><span class="price-decimal">.${price.decimal}</span></strong><small class="price-unit"> / ${escapeHtml(product.unit)}</small></td>
      <td class="inventory-cell">
        <div class="inventory-total"><span class="stock-badge ${Number(product.stock) === 0 ? 'out' : hasLowStock ? 'low' : 'normal'}">总库存 ${Number(product.stock)} ${escapeHtml(product.unit)}</span><small>${sizeDetails.length} 个尺码</small></div>
        <div class="color-stock-detail">${colorDetails.map(group => `<div class="color-stock-group"><strong>${escapeHtml(group.color)}</strong><div class="stock-detail-list">${group.sizes.map(({ size, quantity }) => {
          const level = stockLevel(quantity)
          return `<span class="size-quantity-chip ${level.className}" title="${escapeHtml(group.color)} / ${escapeHtml(size)}：${quantity}（${level.label}）"><b>${escapeHtml(size)}</b><i>${quantity}</i></span>`
        }).join('')}</div></div>`).join('')}</div>
      </td>
      <td><div class="row-actions"><button data-action="toggle" data-id="${product.id}">${product.status === 'published' ? '下架' : '上架'}</button><button data-action="edit" data-id="${product.id}">编辑</button></div></td>
      <td><span class="status-badge ${product.status}"><i class="dot ${product.status === 'published' ? 'green' : 'amber'}"></i>${product.status === 'published' ? '已上架' : '草稿'}</span></td>
      <td>${new Date(product.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
    </tr>
  `}).join('')
  $('#emptyState').classList.toggle('is-hidden', visible.length > 0)
  $('#productSortHeader').textContent = selectedCategory ? '分类内排序' : '全局排序'
  $('#productVisibleCount').textContent = `共 ${filtered.length.toLocaleString('zh-CN')} 款`
  $('#productPageSelect').innerHTML = Array.from(
    { length: totalPages },
    (_, index) => `<option value="${index + 1}"${index + 1 === state.productPage ? ' selected' : ''}>${index + 1}</option>`
  ).join('')
  $('#productTotalPages').textContent = totalPages
  $('#productPrevious').disabled = state.productPage <= 1
  $('#productNext').disabled = state.productPage >= totalPages
  scheduleProductHorizontalScrollUpdate()
}

function scrollProductTableToTop() {
  document.querySelector('#products .panel-toolbar')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function scrollInventoryMappingToTop() {
  document.querySelector('#inventory-mappings .inventory-mapping-toolbar')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function scrollMediaManagementToTop() {
  document.querySelector('#media .media-management-toolbar')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function scrollUnmatchedReportToTop() {
  const tableWrap = $('#unmatchedReportModal .unmatched-report-table-wrap')
  if (tableWrap) tableWrap.scrollTop = 0
}

function render() {
  renderSharedAdminData()
  const pageName = adminPageFromHash()
  if (pageName === 'products') renderProductTable()
  if (pageName === 'homepage') renderHomepageOverview(state.products)
  if (pageName === 'categories') renderCategoryManagement()
  if (pageName === 'media') renderMediaProducts()
  if (pageName === 'accounts' && state.currentUser?.role === 'owner') renderAdminUsers()
  renderedAdminPages.add(pageName)
}

function formatAdminTime(value) {
  if (!value) return '尚未登录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function renderAdminUsers() {
  const users = state.adminUsers || []
  $('#adminUserCount').textContent = `${users.length} 个账号`
  $('#adminUserRows').innerHTML = users.map(user => {
    const isCurrent = Number(user.id) === Number(state.currentUser?.id)
    const isOwner = user.role === 'owner'
    return `
      <tr data-admin-user-id="${user.id}">
        <td><div class="account-identity"><strong>${escapeHtml(user.username)}</strong>${isCurrent ? '<small>当前账号</small>' : ''}<span>创建人：${escapeHtml(user.createdBy || '系统')}</span></div></td>
        <td><span class="account-role ${isOwner ? 'owner' : ''}">${isOwner ? '主管理员' : '普通管理员'}</span></td>
        <td>${escapeHtml(formatAdminTime(user.lastLoginAt))}</td>
        <td><div class="account-password-reset"><input type="password" autocomplete="new-password" minlength="6" maxlength="128" placeholder="输入至少6位新密码" data-admin-password="${user.id}" /><button type="button" data-reset-admin-password="${user.id}">保存新密码</button></div></td>
        <td><button type="button" class="account-delete" data-delete-admin-user="${user.id}" ${isOwner || isCurrent ? 'disabled' : ''}>删除账号</button></td>
      </tr>
    `
  }).join('')
  $('#adminUserEmpty').classList.toggle('is-hidden', users.length > 0)
}

async function loadAdminUsers() {
  if (state.currentUser?.role !== 'owner') return
  try {
    const result = await api('/api/admin/users')
    state.adminUsers = result.data
    renderAdminUsers()
  } catch (error) {
    if (error.status === 401) showLogin('登录已过期，请重新登录')
    else toast(error.message)
  }
}

function renderMediaProducts() {
  const grid = $('#mediaProductGrid')
  if (!grid) return
  const query = $('#mediaSearchInput').value.trim().toLowerCase()
  const filter = $('#mediaCompletenessFilter').value
  const filtered = state.products.filter(product => {
    const colorCount = (product.colors || []).length
    const mappedColorCount = (product.colors || []).filter(color => (product.colorGalleries?.[color] || []).length || product.colorImages?.[color]).length
    const complete = (product.images || []).length > 0 && (!colorCount || mappedColorCount === colorCount)
    const matchesQuery = !query || `${product.code} ${product.name}`.toLowerCase().includes(query)
    const matchesFilter = filter === 'all' || (filter === 'complete' ? complete : !complete)
    return matchesQuery && matchesFilter
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.mediaPageSize))
  state.mediaPage = Math.min(Math.max(1, state.mediaPage), totalPages)
  const start = (state.mediaPage - 1) * state.mediaPageSize
  const visible = filtered.slice(start, start + state.mediaPageSize)
  grid.innerHTML = visible.map(product => {
    const colorCount = (product.colors || []).length
    const mappedColorCount = (product.colors || []).filter(color => (product.colorGalleries?.[color] || []).length || product.colorImages?.[color]).length
    const complete = (product.images || []).length > 0 && (!colorCount || mappedColorCount === colorCount)
    return `
      <article class="media-product-card">
        <img src="${escapeHtml(imageUrl(product.images?.[0]))}" alt="" loading="lazy" decoding="async" />
        <div class="media-product-info">
          <h3>${escapeHtml(product.name)}</h3>
          <small>款号：${escapeHtml(product.code)}</small>
          <div class="media-counts">
            <span class="${(product.images || []).length ? '' : 'incomplete'}">主图 ${(product.images || []).length}</span>
            <span class="${!colorCount || mappedColorCount === colorCount ? '' : 'incomplete'}">颜色图 ${mappedColorCount}/${colorCount}</span>
            <span>详情图 ${(product.detailImages || []).length}</span>
            <span>实拍图 ${(product.realImages || []).length}</span>
          </div>
          <div class="media-product-actions">
            <em class="${complete ? '' : 'incomplete'}">${complete ? '主要图片已完整' : '主要图片待完善'}</em>
            <button type="button" data-media-edit="${product.id}">编辑图片</button>
          </div>
        </div>
      </article>
    `
  }).join('')
  $('#mediaProductCount').textContent = `${filtered.length.toLocaleString('zh-CN')} 款商品`
  renderPaginationSelector('#mediaPageSelect', '#mediaTotalPages', state.mediaPage, totalPages)
  $('#mediaPrevious').disabled = state.mediaPage <= 1
  $('#mediaNext').disabled = state.mediaPage >= totalPages
  $('#mediaProductEmpty').classList.toggle('is-hidden', visible.length > 0)
}

function openDrawer(product = null) {
  state.editingId = product?.id || null
  state.images = [...(product?.images || [])]
  state.posterImage = product?.posterImage || ''
  state.colorGalleries = Object.fromEntries((product?.colors || []).map(color => {
    const savedGallery = product?.colorGalleries?.[color]
    const fallback = product?.colorImages?.[color]
    return [color, Array.isArray(savedGallery) && savedGallery.length ? [...savedGallery] : (fallback ? [fallback] : [])]
  }))
  state.detailImages = [...(product?.detailImages || [])]
  state.realImages = (product?.realImages || []).map(item => ({ ...item }))
  state.sizeStocks = { ...(product?.sizeStocks || {}) }
  state.colorSizeStocks = Object.fromEntries((product?.colors || []).map(color => [color, { ...(product?.colorSizeStocks?.[color] || {}) }]))
  state.specialSizePrices = (product?.specialSizePrices || []).map(item => ({ ...item }))
  const form = $('#productForm')
  form.reset()
  form.elements.code.value = product?.code || ''
  form.elements.name.value = product?.name || ''
  form.elements.subtitle.value = product?.subtitle || ''
  form.elements.category.value = product?.category || ''
  form.elements.displayCategory.value = product?.displayCategory || product?.category || ''
  form.elements.badge.value = product?.badge || ''
  form.elements.price.value = product?.price ?? ''
  form.elements.stock.value = product?.stock ?? 0
  form.elements.unit.value = product?.unit || '件'
  form.elements.fabric.value = product?.fabric || ''
  form.elements.style.value = product?.style || ''
  form.elements.fit.value = product?.fit || ''
  form.elements.colors.value = (product?.colors || []).join(', ')
  form.elements.sizes.value = (product?.sizes || []).join(', ')
  form.elements.detailText.value = product?.detailText || ''
  form.elements.sortOrder.value = product?.sortOrder || 0
  form.elements.status.value = product?.status || 'draft'
  $('#drawerTitle').textContent = product ? '编辑商品' : '新增商品'
  $('#deleteProductButton').classList.toggle('is-hidden', !product)
  $('#formMessage').textContent = ''
  renderProductCategoryChoices(productCategoryNames(product))
  renderSpecialSizePrices()
  renderSizeStocks(state.colorSizeStocks)
  renderImages()
  renderPosterImage()
  renderColorGalleries()
  renderDetailImages()
  renderRealImages()
  $('#drawerBackdrop').classList.remove('is-hidden')
  $('#editorDrawer').classList.remove('is-hidden')
  state.editorSessionOpen = true
  document.body.classList.add('editor-open')
  $('#editorScrollArea').scrollTop = 0
  setEditorSectionActive('editorBasic')
  setTimeout(() => {
    updateEditorScrollSlider()
    form.elements.code.focus()
  }, 80)
}

function readProductCategories() {
  const primary = $('#productForm').elements.category.value.trim()
  const checked = [...document.querySelectorAll('[data-product-category-choice]:checked')].map(input => input.value)
  return [...new Set([primary, ...checked].filter(Boolean))]
}

function renderProductCategoryChoices(selected = readProductCategories()) {
  const primary = $('#productForm').elements.category.value.trim()
  const selectedNames = new Set([primary, ...selected].filter(Boolean))
  const categories = state.categories
  $('#productCategoryChoices').innerHTML = categories.length
    ? categories.map(category => `<label class="product-category-choice"><input type="checkbox" value="${escapeHtml(category.name)}" data-product-category-choice ${selectedNames.has(category.name) ? 'checked' : ''} /><span>${escapeHtml(category.name)}</span></label>`).join('')
    : '<span class="image-empty">暂无可选分类</span>'
}

function closeDrawer() {
  state.editorSessionOpen = false
  $('#drawerBackdrop').classList.add('is-hidden')
  $('#editorDrawer').classList.add('is-hidden')
  document.body.classList.remove('editor-open')
}

function syncEditorVisibilityForPage(pageName) {
  const visible = state.editorSessionOpen && pageName === 'products'
  $('#drawerBackdrop').classList.toggle('is-hidden', !visible)
  $('#editorDrawer').classList.toggle('is-hidden', !visible)
  document.body.classList.toggle('editor-open', visible)
}

function setEditorSectionActive(sectionId) {
  document.querySelectorAll('[data-editor-target]').forEach(button => {
    button.classList.toggle('active', button.dataset.editorTarget === sectionId)
  })
}

function renderImages() {
  $('#imageGrid').innerHTML = state.images.length
    ? state.images.map((url, index) => `<div class="image-item main-image-item">
        <div class="image-item-visual">
          <img src="${escapeHtml(url)}" alt="商品图片 ${index + 1}" loading="lazy" decoding="async" />
          <span class="image-index">主图 ${index + 1}</span>
          <button type="button" data-remove-image="${index}" aria-label="移除图片">×</button>
        </div>
        <small class="image-file-metadata" data-image-metadata data-image-url="${escapeHtml(url)}">正在读取图片信息…</small>
      </div>`).join('')
    : '<div class="image-empty">还没有商品图片，可先保存文字信息，稍后再添加。</div>'
  hydrateImageMetadata($('#imageGrid'))
}

function renderPosterImage() {
  $('#posterImagePreview').innerHTML = state.posterImage
    ? `<div class="poster-image-item">
        <img src="${escapeHtml(state.posterImage)}" alt="商品海报" loading="lazy" decoding="async" />
        <small class="image-file-metadata" data-image-metadata data-image-url="${escapeHtml(state.posterImage)}">正在读取图片信息…</small>
        <button type="button" id="removePosterImageButton">删除海报</button>
      </div>`
    : '<div class="poster-image-empty">还没有上传海报。上传后，顾客点击商品页“海报”即可查看。</div>'
  hydrateImageMetadata($('#posterImagePreview'))
}

function renderColorGalleries() {
  const colors = splitList($('#productForm').elements.colors.value)
  if (!colors.length) {
    state.colorGalleries = {}
    $('#colorGalleryList').innerHTML = '<div class="image-empty">请先填写商品颜色，再分别添加每个颜色的商品图片。</div>'
    return
  }
  const nextColorGalleries = {}
  const mappedCount = colors.filter(color => Array.isArray(state.colorGalleries[color]) && state.colorGalleries[color].length).length
  $('#colorGalleryList').innerHTML = `<div class="color-gallery-summary">已准确对应 ${mappedCount} / ${colors.length} 个颜色；未设置的颜色在小程序中暂用商品默认主图。</div>` + colors.map(color => {
    const gallery = Array.isArray(state.colorGalleries[color]) ? [...state.colorGalleries[color]] : []
    nextColorGalleries[color] = gallery
    const images = gallery.map((url, imageIndex) => `<div class="color-gallery-image">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(color)}商品图片 ${imageIndex + 1}" loading="lazy" decoding="async" />
      <span class="color-gallery-image-label">${imageIndex === 0 ? '封面' : `第 ${imageIndex + 1} 张`}</span>
      <small class="image-file-metadata" data-image-metadata data-image-url="${escapeHtml(url)}">正在读取图片信息…</small>
      <div class="color-gallery-actions">
        <button type="button" data-gallery-action="previous" data-gallery-color="${escapeHtml(color)}" data-gallery-index="${imageIndex}" ${imageIndex === 0 ? 'disabled' : ''}>前移</button>
        <button type="button" data-gallery-action="next" data-gallery-color="${escapeHtml(color)}" data-gallery-index="${imageIndex}" ${imageIndex === gallery.length - 1 ? 'disabled' : ''}>后移</button>
        <button type="button" data-gallery-action="remove" data-gallery-color="${escapeHtml(color)}" data-gallery-index="${imageIndex}">删除</button>
      </div>
    </div>`).join('')
    return `<section class="color-gallery-item">
      <div class="color-gallery-item-head">
        <div class="color-gallery-title"><strong>${escapeHtml(color)}</strong><span class="color-gallery-count">${gallery.length} 张</span></div>
        <label class="color-gallery-upload">＋ 单独添加图片<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-color-gallery-upload="${escapeHtml(color)}" /></label>
      </div>
      <div class="image-link-row color-gallery-link-row"><input type="text" inputmode="url" data-color-gallery-url="${escapeHtml(color)}" placeholder="粘贴${escapeHtml(color)}图片 HTTPS 链接（自动保存到本服务器）" /><button type="button" data-color-gallery-link="${escapeHtml(color)}">导入到服务器</button></div>
      ${images ? `<div class="color-gallery-images">${images}</div>` : '<div class="color-gallery-empty">未设置专属图片；前端暂用商品默认主图。请上传确认属于这个颜色的图片。</div>'}
    </section>`
  }).join('')
  state.colorGalleries = nextColorGalleries
  hydrateImageMetadata($('#colorGalleryList'))
}

function renderDetailImages() {
  $('#detailImageGrid').innerHTML = state.detailImages.length
    ? state.detailImages.map((url, index) => `<div class="image-item"><img src="${escapeHtml(url)}" alt="详情图片 ${index + 1}" loading="lazy" decoding="async" /><button type="button" data-remove-detail-image="${index}" aria-label="移除详情图片">×</button></div>`).join('')
    : '<div class="image-empty">还没有详情长图，商品详情页会先使用主图。</div>'
}

function renderRealImages() {
  const categories = ['正面实拍', '背面实拍', '细节特写', '颜色展示', '穿着效果', '实物展示']
  $('#realImageGrid').innerHTML = state.realImages.length
    ? state.realImages.map((item, index) => `<div class="real-image-item"><img src="${escapeHtml(item.url)}" alt="实拍图 ${index + 1}" loading="lazy" decoding="async" /><select data-real-category="${index}" aria-label="实拍图 ${index + 1} 分类">${categories.map(category => `<option value="${category}" ${item.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select><button type="button" data-remove-real-image="${index}" aria-label="移除实拍图">×</button></div>`).join('')
    : '<div class="image-empty">还没有实拍图，可上传后为每张图选择分类。</div>'
}

function fileDataUrl(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`${file.name || '文件'}读取失败，请重新选择`))
    reader.onabort = () => reject(new Error(`${file.name || '文件'}读取已取消`))
    reader.onprogress = event => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    reader.readAsDataURL(file)
  })
}

async function uploadFiles(files, { title = '上传图片', purpose = 'general' } = {}) {
  if (state.uploadInProgress || state.inventoryImportInProgress) throw new Error('已有文件正在处理，请等待完成后再上传')
  const selectedFiles = [...files]
  if (!selectedFiles.length) return []
  selectedFiles.forEach(file => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`${file.name} 格式不支持，请使用 PNG、JPG 或 WebP`)
    if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} 超过15MB，请压缩后重新上传`)
  })
  const totalBytes = Math.max(1, selectedFiles.reduce((sum, file) => sum + file.size, 0))
  const urls = []
  let optimizedCount = 0
  let completedBytes = 0
  state.uploadInProgress = true
  setFileOperationsBusy(true)
  beginOperationProgress(title, `共 ${selectedFiles.length} 张，合计 ${formatFileSize(totalBytes)}`)
  try {
    for (const [index, file] of selectedFiles.entries()) {
      updateOperationProgress(
        completedBytes / totalBytes * 100,
        `正在读取第 ${index + 1}/${selectedFiles.length} 张：${file.name}`,
        '读取文件'
      )
      const dataUrl = await fileDataUrl(file)
      const result = await requestJsonWithUploadProgress('/api/admin/uploads', {
        fileName: file.name,
        dataUrl,
        purpose,
        mode: state.imageUploadMode
      }, {
        onProgress(loaded, total) {
          const currentRatio = total > 0 ? loaded / total : 0
          const uploadedBytes = completedBytes + file.size * currentRatio
          updateOperationProgress(
            uploadedBytes / totalBytes * 100,
            `第 ${index + 1}/${selectedFiles.length} 张：${file.name} · ${formatFileSize(Math.min(file.size, file.size * currentRatio))} / ${formatFileSize(file.size)}`
          )
        },
        onProcessing() {
          showOperationProcessing(`第 ${index + 1}/${selectedFiles.length} 张已传完，服务器正在保存：${file.name}`)
        }
      })
      urls.push(result.url)
      if (result.optimization?.changed) optimizedCount += 1
      completedBytes += file.size
      updateOperationProgress(completedBytes / totalBytes * 100, `已完成 ${index + 1}/${selectedFiles.length} 张`, '继续处理')
    }
    const modeMessage = state.imageUploadMode === 'original'
      ? '，已按“保留原图”保存；列表和分类页仍会自动使用轻量缩略图'
      : optimizedCount ? `，其中 ${optimizedCount} 张已按展示位置自动优化像素和体积` : '，图片尺寸已经符合当前展示位置'
    completeOperationProgress(`${selectedFiles.length} 张图片已上传到服务器${modeMessage}；请完成当前页面的保存。`)
    return urls
  } catch (error) {
    failOperationProgress(error.message)
    throw error
  } finally {
    state.uploadInProgress = false
    setFileOperationsBusy(false)
  }
}

function splitList(value) {
  return value.split(/[,，]/).map(item => item.trim()).filter(Boolean)
}

async function importImageUrl(value, { purpose = 'general' } = {}) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('请先粘贴图片链接。')
  if (/^\/(?:uploads|images)\//u.test(raw)) return raw
  if (state.uploadInProgress || state.inventoryImportInProgress) throw new Error('已有文件正在处理，请等待完成后再导入')
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') throw new Error()
    state.uploadInProgress = true
    setFileOperationsBusy(true)
    beginOperationProgress('导入链接图片', url.hostname)
    showOperationProcessing('服务器正在下载、校验并保存图片；完成后只使用本服务器地址。')
    const result = await api('/api/admin/uploads/from-url', {
      method: 'POST',
      body: JSON.stringify({ url: url.href, purpose, mode: state.imageUploadMode })
    })
    if (!/^\/uploads\//u.test(result.url || '')) throw new Error()
    completeOperationProgress('图片已保存到本服务器；请完成当前页面的保存。')
    return result.url
  } catch (error) {
    const message = error.message === '已有文件正在处理，请等待完成后再导入'
      ? error.message
      : '图片链接导入失败；请确认是公开可访问的 HTTPS 图片，服务器会先下载后再保存。'
    failOperationProgress(message)
    throw new Error(message)
  } finally {
    state.uploadInProgress = false
    setFileOperationsBusy(false)
  }
}

function pushUniqueImage(list, url) {
  if (!list.includes(url)) list.push(url)
}

function readColorSizeStocks() {
  const result = {}
  document.querySelectorAll('[data-color-size-stock]').forEach(input => {
    const color = input.dataset.stockColor
    const size = input.dataset.stockSize
    if (!result[color]) result[color] = {}
    result[color][size] = Math.max(0, Math.trunc(Number(input.value) || 0))
  })
  return result
}

function aggregateSizeStocks(colorSizeStocks = readColorSizeStocks()) {
  const sizes = [...new Set(splitList($('#productForm').elements.sizes.value))]
  const colors = [...new Set(splitList($('#productForm').elements.colors.value))]
  return Object.fromEntries(sizes.map(size => [size, colors.reduce((sum, color) => sum + (Number(colorSizeStocks[color]?.[size]) || 0), 0)]))
}

function updateStockTotal() {
  state.colorSizeStocks = readColorSizeStocks()
  state.sizeStocks = aggregateSizeStocks(state.colorSizeStocks)
  const total = Object.values(state.sizeStocks).reduce((sum, quantity) => sum + quantity, 0)
  $('#productForm').elements.stock.value = total
  $('#stockTotalLabel').textContent = `合计 ${total}`
  const unit = $('#productForm').elements.unit.value.trim() || '件'
  document.querySelectorAll('[data-color-size-stock]').forEach(input => {
    const level = stockLevel(input.value)
    const item = input.closest('.size-stock-item')
    item.classList.remove('normal', 'low', 'out')
    item.classList.add(level.className)
    item.querySelector('.size-stock-state').textContent = level.label
    item.querySelector('.size-stock-unit').textContent = unit
  })
}

function renderSizeStocks(source = state.colorSizeStocks) {
  const sizes = [...new Set(splitList($('#productForm').elements.sizes.value))]
  const colors = [...new Set(splitList($('#productForm').elements.colors.value))]
  state.colorSizeStocks = Object.fromEntries(colors.map(color => [color, Object.fromEntries(sizes.map(size => [size, Math.max(0, Math.trunc(Number(source?.[color]?.[size]) || 0))]))]))
  $('#sizeStockGrid').innerHTML = colors.map(color => `<section class="color-size-stock-group"><h4>${escapeHtml(color)}</h4><div class="color-size-stock-items">${sizes.map(size => {
    const quantity = state.colorSizeStocks[color][size]
    const level = stockLevel(quantity)
    return `<label class="size-stock-item ${level.className}"><span class="size-stock-label"><b>${escapeHtml(size)} 码</b><em class="size-stock-state">${level.label}</em></span><span class="size-stock-input"><input type="number" min="0" step="1" value="${quantity}" data-color-size-stock data-stock-color="${escapeHtml(color)}" data-stock-size="${escapeHtml(size)}" aria-label="${escapeHtml(color)} ${escapeHtml(size)} 码库存" /><i class="size-stock-unit">${escapeHtml($('#productForm').elements.unit.value || '件')}</i></span></label>`
  }).join('')}</div></section>`).join('')
  $('#sizeStockEmpty').textContent = colors.length ? '请先填写尺码，例如 S, M, L, XL' : '请先填写颜色和尺码，库存将按颜色分别设置'
  $('#sizeStockEmpty').classList.toggle('is-hidden', colors.length > 0 && sizes.length > 0)
  updateStockTotal()
}

function readSpecialSizePrices() {
  return [...document.querySelectorAll('[data-special-size-price-row]')].map(row => ({
    fromSize: row.querySelector('[data-special-size-price-from]').value,
    toSize: row.querySelector('[data-special-size-price-to]').value,
    price: row.querySelector('[data-special-size-price-value]').value === ''
      ? Number.NaN
      : Number(row.querySelector('[data-special-size-price-value]').value)
  }))
}

function renderSpecialSizePrices(source = state.specialSizePrices) {
  const sizes = [...new Set(splitList($('#productForm').elements.sizes.value))]
  const list = $('#specialSizePriceList')
  const empty = $('#specialSizePriceEmpty')
  if (!sizes.length) {
    list.innerHTML = ''
    empty.textContent = '请先在“颜色与库存”中填写尺码，再添加特殊尺码价格。'
    empty.classList.remove('is-hidden')
    return
  }
  state.specialSizePrices = (Array.isArray(source) ? source : []).map(item => ({
    fromSize: sizes.includes(item.fromSize) ? item.fromSize : sizes[0],
    toSize: sizes.includes(item.toSize) ? item.toSize : (sizes.includes(item.fromSize) ? item.fromSize : sizes[0]),
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : Number($('#productForm').elements.price.value || 0)
  }))
  const optionsFor = selected => sizes.map(size => `<option value="${escapeHtml(size)}" ${size === selected ? 'selected' : ''}>${escapeHtml(size)}</option>`).join('')
  list.innerHTML = state.specialSizePrices.map((item, index) => `
    <div class="special-size-price-row" data-special-size-price-row>
      <label><span>起始尺码</span><select data-special-size-price-from>${optionsFor(item.fromSize)}</select></label>
      <span class="special-size-price-separator">至</span>
      <label><span>结束尺码</span><select data-special-size-price-to>${optionsFor(item.toSize)}</select></label>
      <label><span>区间团购价（元）</span><input type="number" min="0" step="0.01" value="${item.price}" data-special-size-price-value /></label>
      <button type="button" class="special-size-price-remove" data-remove-special-size-price="${index}" aria-label="删除特殊尺码价格">×</button>
    </div>
  `).join('')
  empty.textContent = '当前没有特殊尺码价格，所有尺码均使用默认团购价。'
  empty.classList.toggle('is-hidden', state.specialSizePrices.length > 0)
}

function formPayload(form) {
  return {
    code: form.elements.code.value,
    name: form.elements.name.value,
    subtitle: form.elements.subtitle.value,
    category: form.elements.category.value,
    categories: readProductCategories(),
    displayCategory: form.elements.displayCategory.value,
    badge: form.elements.badge.value,
    price: Number(form.elements.price.value),
    specialSizePrices: readSpecialSizePrices(),
    stock: Number(form.elements.stock.value),
    unit: form.elements.unit.value,
    fabric: form.elements.fabric.value,
    style: form.elements.style.value,
    fit: form.elements.fit.value,
    colors: splitList(form.elements.colors.value),
    colorGalleries: state.colorGalleries,
    sizes: splitList(form.elements.sizes.value),
    sizeStocks: aggregateSizeStocks(),
    colorSizeStocks: readColorSizeStocks(),
    detailText: form.elements.detailText.value,
    sortOrder: Number(form.elements.sortOrder.value),
    status: form.elements.status.value,
    images: state.images,
    posterImage: state.posterImage,
    detailImages: state.detailImages,
    realImages: state.realImages
  }
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault()
  $('#loginMessage').textContent = ''
  try {
    const username = $('#username').value.trim()
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: $('#password').value })
    })
    localStorage.setItem('purunAdminUsername', username)
    $('#password').value = ''
    await loadProducts()
  } catch (error) {
    $('#loginMessage').textContent = error.message
  }
})

$('#logoutButton').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {})
  showLogin('已退出管理后台')
})

$('#username').value = localStorage.getItem('purunAdminUsername') || ''

function generateSecurePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return [...values].map(value => alphabet[value % alphabet.length]).join('')
}

$('#generateAdminPassword').addEventListener('click', () => {
  const input = $('#newAdminPassword')
  input.type = 'text'
  input.value = generateSecurePassword()
  input.focus()
  input.select()
  $('#accountCreateMessage').textContent = '已生成安全密码，请复制并妥善交给该管理员。'
})

$('#createAdminForm').addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button[type="submit"]')
  button.disabled = true
  $('#accountCreateMessage').textContent = ''
  try {
    const username = $('#newAdminUsername').value.trim()
    const password = $('#newAdminPassword').value
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    })
    toast(`管理账号 ${username} 已创建`)
    form.reset()
    $('#newAdminPassword').type = 'password'
    await loadAdminUsers()
  } catch (error) {
    $('#accountCreateMessage').textContent = error.message
  } finally {
    button.disabled = false
  }
})

$('#adminUserRows').addEventListener('click', async event => {
  const resetButton = event.target.closest('[data-reset-admin-password]')
  if (resetButton) {
    const id = Number(resetButton.dataset.resetAdminPassword)
    const input = document.querySelector(`[data-admin-password="${id}"]`)
    const password = input.value
    if (!password || !confirm('确定把这个账号的旧密码替换为新密码吗？')) return
    resetButton.disabled = true
    try {
      await api(`/api/admin/users/${id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password })
      })
      input.value = ''
      toast('管理密码已更新，其他已登录设备将退出')
      await loadAdminUsers()
    } catch (error) {
      toast(error.message)
    } finally {
      resetButton.disabled = false
    }
    return
  }

  const deleteButton = event.target.closest('[data-delete-admin-user]')
  if (!deleteButton) return
  const id = Number(deleteButton.dataset.deleteAdminUser)
  const user = state.adminUsers.find(item => Number(item.id) === id)
  if (!user || !confirm(`确定删除管理账号“${user.username}”吗？删除后该账号会立即无法登录。`)) return
  deleteButton.disabled = true
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE', body: '{}' })
    toast(`管理账号 ${user.username} 已删除`)
    await loadAdminUsers()
  } catch (error) {
    toast(error.message)
    deleteButton.disabled = false
  }
})

$('#newProductButton').addEventListener('click', () => openDrawer())
$('#closeDrawerButton').addEventListener('click', closeDrawer)
$('#cancelButton').addEventListener('click', closeDrawer)
$('#drawerBackdrop').addEventListener('click', closeDrawer)
$('#editorDrawer').addEventListener('click', event => {
  const button = event.target.closest('[data-editor-target]')
  if (!button) return
  const section = document.getElementById(button.dataset.editorTarget)
  if (!section) return
  setEditorSectionActive(section.id)
  section.scrollIntoView({ behavior: 'smooth', block: 'start' })
})
let editorScrollFrame = 0
function updateEditorScrollSlider() {
  const scrollArea = $('#editorScrollArea')
  const maximum = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
  const ratio = maximum ? Math.min(1, Math.max(0, scrollArea.scrollTop / maximum)) : 0
  $('#editorScrollSlider').value = String(Math.round(ratio * 1000))
  $('#editorScrollPercent').value = `${Math.round(ratio * 100)}%`
}

$('#editorScrollArea').addEventListener('scroll', event => {
  if (editorScrollFrame) return
  const scrollArea = event.currentTarget
  editorScrollFrame = requestAnimationFrame(() => {
    editorScrollFrame = 0
    const scrollAreaTop = scrollArea.getBoundingClientRect().top + 70
    const sections = [...document.querySelectorAll('.editor-section[id]')]
    let activeSection = sections[0]?.id || 'editorBasic'
    sections.forEach(section => {
      if (section.getBoundingClientRect().top <= scrollAreaTop) activeSection = section.id
    })
    setEditorSectionActive(activeSection)
    updateEditorScrollSlider()
  })
})
$('#editorScrollSlider').addEventListener('input', event => {
  const scrollArea = $('#editorScrollArea')
  const maximum = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
  scrollArea.scrollTop = maximum * (Number(event.currentTarget.value) / 1000)
  updateEditorScrollSlider()
})
let productSearchTimer = 0
$('#searchInput').addEventListener('input', () => {
  state.productPage = 1
  clearTimeout(productSearchTimer)
  productSearchTimer = setTimeout(renderProductTable, 120)
})
$('#categoryFilter').addEventListener('change', () => { state.productPage = 1; renderProductTable() })
$('#statusFilter').addEventListener('change', () => { state.productPage = 1; renderProductTable() })
$('#colorImageFilter').addEventListener('change', () => { state.productPage = 1; renderProductTable() })
$('#productPrevious').addEventListener('click', () => {
  state.productPage -= 1
  renderProductTable()
  scrollProductTableToTop()
})
$('#productNext').addEventListener('click', () => {
  state.productPage += 1
  renderProductTable()
  scrollProductTableToTop()
})
$('#productPageSelect').addEventListener('change', event => {
  state.productPage = Number(event.currentTarget.value) || 1
  renderProductTable()
  scrollProductTableToTop()
})
$('#popularCategoryList').addEventListener('click', event => {
  const button = event.target.closest('[data-filter-category]')
  if (!button) return
  $('#categoryFilter').value = button.dataset.filterCategory
  $('#statusFilter').value = 'published'
  state.productPage = 1
  location.hash = '#products'
  showAdminPage('products', { scrollTop: true, renderPage: true })
})
$('#productForm').elements.sizes.addEventListener('input', () => {
  renderSizeStocks()
  renderSpecialSizePrices()
})
$('#productForm').elements.category.addEventListener('change', () => renderProductCategoryChoices())
$('#productForm').elements.unit.addEventListener('input', updateStockTotal)
$('#sizeStockGrid').addEventListener('input', updateStockTotal)
$('#addSpecialSizePriceButton').addEventListener('click', () => {
  const sizes = [...new Set(splitList($('#productForm').elements.sizes.value))]
  if (!sizes.length) {
    toast('请先填写商品尺码')
    document.querySelector('[data-editor-target="editorInventory"]').click()
    return
  }
  state.specialSizePrices = readSpecialSizePrices()
  state.specialSizePrices.push({
    fromSize: sizes[0],
    toSize: sizes[0],
    price: Number($('#productForm').elements.price.value || 0)
  })
  renderSpecialSizePrices()
})
$('#specialSizePriceList').addEventListener('input', () => {
  state.specialSizePrices = readSpecialSizePrices()
})
$('#specialSizePriceList').addEventListener('change', () => {
  state.specialSizePrices = readSpecialSizePrices()
})
$('#specialSizePriceList').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-special-size-price]')
  if (!button) return
  state.specialSizePrices = readSpecialSizePrices()
  state.specialSizePrices.splice(Number(button.dataset.removeSpecialSizePrice), 1)
  renderSpecialSizePrices()
})

$('#latestUnmatchedReportButton').addEventListener('click', async event => {
  await openUnmatchedReport(event.currentTarget)
})
$('#closeUnmatchedReportButton').addEventListener('click', closeUnmatchedReport)
$('#unmatchedReportBackdrop').addEventListener('click', closeUnmatchedReport)
$('#unmatchedReportSearch').addEventListener('input', () => { state.unmatchedReportPage = 1; renderUnmatchedReport() })
$('#unmatchedReportReason').addEventListener('change', () => { state.unmatchedReportPage = 1; renderUnmatchedReport() })
$('#unmatchedReportPrevious').addEventListener('click', () => {
  state.unmatchedReportPage -= 1
  renderUnmatchedReport()
  scrollUnmatchedReportToTop()
})
$('#unmatchedReportNext').addEventListener('click', () => {
  state.unmatchedReportPage += 1
  renderUnmatchedReport()
  scrollUnmatchedReportToTop()
})
$('#unmatchedReportPageSelect').addEventListener('change', event => {
  state.unmatchedReportPage = Number(event.currentTarget.value) || 1
  renderUnmatchedReport()
  scrollUnmatchedReportToTop()
})
$('#latestUnmatchedDownloadButton').addEventListener('click', async event => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await downloadLatestUnmatchedReport()
    toast('未匹配表格已下载')
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
  }
})

$('#operationPageTabs').addEventListener('click', event => {
  const closeButton = event.target.closest('[data-close-operation-tab]')
  if (closeButton) {
    if (state.editorSessionOpen && closeButton.dataset.closeOperationTab === 'products') closeDrawer()
    closeOperationPageTab(closeButton.dataset.closeOperationTab)
    return
  }
  const tabButton = event.target.closest('[data-operation-tab]')
  if (!tabButton) return
  const pageName = tabButton.dataset.operationTab
  if (adminPageFromHash() === pageName) showAdminPage(pageName)
  else location.hash = `#${pageName}`
})
window.addEventListener('hashchange', () => showAdminPage(adminPageFromHash()))

$('#inventoryMappingRefresh').addEventListener('click', () => loadInventoryMappings())
$('#inventoryMappingSearch').addEventListener('input', () => {
  state.inventoryMappingPage = 1
  renderInventoryMappings()
})
$('#inventoryMappingStatus').addEventListener('change', () => {
  state.inventoryMappingPage = 1
  renderInventoryMappings()
})
$('#inventoryMappingReason').addEventListener('change', () => {
  state.inventoryMappingPage = 1
  renderInventoryMappings()
})
$('#inventoryMappingPrevious').addEventListener('click', () => {
  state.inventoryMappingPage -= 1
  renderInventoryMappings()
  scrollInventoryMappingToTop()
})
$('#inventoryMappingNext').addEventListener('click', () => {
  state.inventoryMappingPage += 1
  renderInventoryMappings()
  scrollInventoryMappingToTop()
})
$('#inventoryMappingPageSelect').addEventListener('change', event => {
  state.inventoryMappingPage = Number(event.currentTarget.value) || 1
  renderInventoryMappings()
  scrollInventoryMappingToTop()
})
$('#inventoryMappingDownload').addEventListener('click', async event => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await downloadLatestUnmatchedReport()
    toast('未匹配表格已下载')
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
  }
})
$('#inventoryMappingRows').addEventListener('input', event => {
  const input = event.target.closest('.inventory-product-search input')
  if (!input) return
  const row = input.closest('[data-inventory-source]')
  const product = findInventoryMappingProduct(input.value)
  row.querySelector('.inventory-color-select select').innerHTML = inventoryColorOptions(
    product,
    product?.colors?.length === 1 ? product.colors[0] : ''
  )
  renderInventoryProductSearchPopup(input)
})
$('#inventoryMappingRows').addEventListener('focusin', event => {
  const input = event.target.closest('.inventory-product-search input')
  if (input) renderInventoryProductSearchPopup(input)
})
$('#inventoryMappingRows').addEventListener('keydown', event => {
  const input = event.target.closest('.inventory-product-search input')
  if (!input) return
  const popup = $('#inventoryProductSearchPopup')
  const buttons = [...popup.querySelectorAll('[data-inventory-search-product-id]')]
  if (event.key === 'Escape') {
    hideInventoryProductSearchPopup()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || popup.classList.contains('is-hidden')) return
  const currentIndex = buttons.findIndex(button => button.classList.contains('is-active'))
  if (event.key === 'Enter') {
    const selected = currentIndex >= 0 ? buttons[currentIndex] : buttons.length === 1 ? buttons[0] : null
    if (selected) {
      event.preventDefault()
      selected.click()
    }
    return
  }
  event.preventDefault()
  const nextIndex = event.key === 'ArrowDown'
    ? Math.min(buttons.length - 1, currentIndex + 1)
    : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1)
  buttons.forEach((button, index) => button.classList.toggle('is-active', index === nextIndex))
  buttons[nextIndex]?.scrollIntoView({ block: 'nearest' })
})
$('#inventoryProductSearchPopup').addEventListener('click', event => {
  const button = event.target.closest('[data-inventory-search-product-id]')
  if (!button || !inventoryProductSearchInput) return
  const product = state.inventoryMappingData?.products?.find(item => item.id === Number(button.dataset.inventorySearchProductId))
  if (!product) return
  const input = inventoryProductSearchInput
  const row = input.closest('[data-inventory-source]')
  input.value = productOptionLabel(product)
  row.querySelector('.inventory-color-select select').innerHTML = inventoryColorOptions(
    product,
    product.colors?.length === 1 ? product.colors[0] : ''
  )
  hideInventoryProductSearchPopup()
  input.focus()
})
document.addEventListener('pointerdown', event => {
  if (event.target.closest('#inventoryProductSearchPopup') || event.target.closest('.inventory-product-search input')) return
  hideInventoryProductSearchPopup()
})
window.addEventListener('resize', hideInventoryProductSearchPopup)
window.addEventListener('scroll', event => {
  if (event.target?.closest?.('#inventoryProductSearchPopup')) return
  hideInventoryProductSearchPopup()
}, true)
$('#inventoryMappingRows').addEventListener('click', async event => {
  const button = event.target.closest('[data-mapping-action]')
  if (!button || !state.inventoryMappingData) return
  const row = button.closest('[data-inventory-source]')
  let sourceName = ''
  let sourceInternalCode = ''
  try {
    [sourceName, sourceInternalCode] = JSON.parse(decodeURIComponent(row.dataset.inventorySource))
  } catch {
    toast('无法读取这条来源名称，请刷新后重试')
    return
  }
  const source = state.inventoryMappingData.sources.find(item =>
    item.sourceName === sourceName && item.sourceInternalCode === sourceInternalCode
  )
  if (!source) {
    toast('这条来源名称已变化，请刷新后重试')
    return
  }
  button.disabled = true
  try {
    if (button.dataset.mappingAction === 'save') {
      const product = findInventoryMappingProduct(row.querySelector('.inventory-product-search input').value)
      if (!product) throw new Error('请从搜索选项中选择一个明确的数据库商品')
      const targetColor = row.querySelector('.inventory-color-select select').value
      if ((product.colors || []).length > 1 && !targetColor) throw new Error('该商品有多个颜色，请选择这个 Excel 名称对应的具体颜色')
      const result = await api('/api/admin/inventory/mappings', {
        method: 'PUT',
        body: JSON.stringify({ sourceName, sourceInternalCode, productId: product.id, targetColor })
      })
      source.mapping = result.data
      toast(`已永久记住：${product.code} ｜ ${product.name}${result.data.targetColor ? ` ｜ ${result.data.targetColor}` : ''}；下次导入自动采用`)
    } else {
      if (!confirm(`确定删除“${sourceName}”的库存对应关系吗？`)) return
      await api('/api/admin/inventory/mappings', {
        method: 'DELETE',
        body: JSON.stringify({ sourceName, sourceInternalCode })
      })
      source.mapping = null
      toast('对应关系已删除')
    }
    renderInventoryMappings()
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
  }
})

$('#mediaSearchInput').addEventListener('input', () => {
  state.mediaPage = 1
  renderMediaProducts()
})
$('#mediaCompletenessFilter').addEventListener('change', () => {
  state.mediaPage = 1
  renderMediaProducts()
})
$('#mediaPrevious').addEventListener('click', () => {
  state.mediaPage -= 1
  renderMediaProducts()
  scrollMediaManagementToTop()
})
$('#mediaNext').addEventListener('click', () => {
  state.mediaPage += 1
  renderMediaProducts()
  scrollMediaManagementToTop()
})
$('#mediaPageSelect').addEventListener('change', event => {
  state.mediaPage = Number(event.currentTarget.value) || 1
  renderMediaProducts()
  scrollMediaManagementToTop()
})
$('#mediaProductGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-media-edit]')
  if (!button) return
  const product = state.products.find(item => item.id === Number(button.dataset.mediaEdit))
  if (product) openDrawer(product)
})

$('#inventoryExcelInput').addEventListener('change', async event => {
  const file = event.target.files[0]
  if (!file) return
  if (state.inventoryImportInProgress || state.uploadInProgress) {
    showImportMessage('已有文件正在处理，请等待完成后再导入。', 'warning')
    event.target.value = ''
    return
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    showImportMessage('请选择 .xlsx 文件（支持简洁模板或大库统计表）。', 'error')
    event.target.value = ''
    return
  }
  if (!confirm('支持两种格式：①后台简洁模板；②含“商品名称、型号、数量、产地”的大库统计表。\n\n匹配成功的商品会覆盖库存；未匹配到商品的来源行会自动另存为新的 Excel。颜色、尺码、数量等格式错误仍会整批回滚。大库统计表不会修改现有货位。确定继续吗？')) {
    event.target.value = ''
    return
  }
  showImportMessage(`正在读取并校验 ${file.name}…`, 'loading')
  state.inventoryImportInProgress = true
  setFileOperationsBusy(true)
  beginOperationProgress('覆盖导入库存', `${file.name} · ${formatFileSize(file.size)}`)
  try {
    const dataUrl = await fileDataUrl(file, (loaded, total) => {
      const ratio = total > 0 ? loaded / total : 0
      updateOperationProgress(ratio * 8, `正在读取 Excel：${formatFileSize(loaded)} / ${formatFileSize(total)}`, '读取文件')
    })
    const result = await requestJsonWithUploadProgress('/api/admin/inventory/import', { dataUrl, fileName: file.name }, {
      onProgress(loaded, total) {
        const ratio = total > 0 ? loaded / total : 0
        updateOperationProgress(8 + ratio * 82, `正在上传 Excel：${formatFileSize(loaded)} / ${formatFileSize(total)}`)
      },
      onProcessing() {
        showOperationProcessing('文件已上传，服务器正在校验款号、颜色、尺码并覆盖最终库存…')
      }
    })
    const report = result.data.unmatchedReport
    const mappingReview = { pendingSourceCount: result.data.unmatchedSourceCount || 0 }
    const reportFailure = result.data.unmatchedRowsCount && !report ? `；未匹配表生成失败：${result.data.unmatchedReportError || '请重新导入'}` : ''
    if (!result.data.applied) {
      showImportMessage(`没有找到可覆盖的匹配商品，原库存保持不变。${result.data.unmatchedRowsCount || 0} 条未匹配明细已整理。${reportFailure}`, 'warning', report, mappingReview)
    } else if (result.data.format === 'warehouse') {
      showImportMessage(`大库统计表覆盖成功：读取 ${result.data.sourceRows} 行，按颜色和尺码准确匹配 ${result.data.matchedProducts} 个商品；${result.data.unmatchedRowsCount || 0} 条未写入明细已另存。现有货位保持不变。${reportFailure}`, 'success', report, mappingReview)
    } else {
      showImportMessage(`简洁模板覆盖成功：读取 ${result.data.rowsRead} 行，已写入 ${result.data.rowsUpdated} 条最终库存；${result.data.unmatchedRowsCount || 0} 条未匹配商品已另存。${result.data.locationsUpdated} 个商品设置货位，${result.data.locationsCleared} 个商品原货位已清空。${reportFailure}`, 'success', report, mappingReview)
    }
    updateOperationProgress(97, '库存覆盖完成，正在刷新商品和对应关系…', '刷新后台')
    await loadProducts()
    state.inventoryMappingsLoaded = false
    await loadInventoryMappings()
    completeOperationProgress(`库存导入完成：${result.data.unmatchedRowsCount || 0} 条未匹配明细已保留供人工对应。`)
  } catch (error) {
    showImportMessage(`导入失败：${error.message}`, 'error')
    failOperationProgress(error.message)
  } finally {
    state.inventoryImportInProgress = false
    setFileOperationsBusy(false)
    event.target.value = ''
  }
})

async function saveProductPosition(input) {
  const productId = Number(input.dataset.productPosition)
  const categoryId = Number(input.dataset.positionCategoryId) || 0
  const requestedPosition = Number(input.value)

  if (categoryId) {
    const category = state.categories.find(item => item.id === categoryId)
    if (!category) return
    const orderedIds = [...(category.productIds || [])].map(Number)
    const currentIndex = orderedIds.indexOf(productId)
    if (currentIndex < 0) return
    if (!Number.isInteger(requestedPosition) || requestedPosition < 1 || requestedPosition > orderedIds.length) {
      input.value = currentIndex + 1
      toast(`分类内排序位置请输入 1–${orderedIds.length} 的整数`)
      return
    }
    const nextIndex = requestedPosition - 1
    if (nextIndex === currentIndex) return

    const [movedId] = orderedIds.splice(currentIndex, 1)
    orderedIds.splice(nextIndex, 0, movedId)
    const movedProduct = state.products.find(product => product.id === productId)
    input.disabled = true
    try {
      const result = await api(`/api/admin/categories/${categoryId}/products/reorder`, {
        method: 'POST',
        body: JSON.stringify({ ids: orderedIds })
      })
      state.categories = state.categories.map(item => item.id === categoryId ? result.data : item)
      renderProductTable()
      toast(`“${movedProduct?.name || '商品'}”已调整到“${category.name}”第 ${requestedPosition} 位`)
    } catch (error) {
      input.disabled = false
      input.value = currentIndex + 1
      toast(error.message)
    }
    return
  }

  const currentIndex = state.products.findIndex(product => product.id === productId)
  if (currentIndex < 0) return
  if (!Number.isInteger(requestedPosition) || requestedPosition < 1 || requestedPosition > state.products.length) {
    input.value = currentIndex + 1
    toast(`全局排序位置请输入 1–${state.products.length} 的整数`)
    return
  }
  const nextIndex = requestedPosition - 1
  if (nextIndex === currentIndex) return

  const orderedProducts = [...state.products]
  const [movedProduct] = orderedProducts.splice(currentIndex, 1)
  orderedProducts.splice(nextIndex, 0, movedProduct)
  input.disabled = true
  try {
    const result = await api('/api/admin/products/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids: orderedProducts.map(product => product.id) })
    })
    state.products = result.data
    renderSharedAdminData()
    renderProductTable()
    toast(`“${movedProduct.name}”已调整到全部商品第 ${requestedPosition} 位`)
  } catch (error) {
    input.disabled = false
    input.value = currentIndex + 1
    toast(error.message)
  }
}

$('#productRows').addEventListener('change', event => {
  const input = event.target.closest('[data-product-position]')
  if (input) saveProductPosition(input)
})

$('#productRows').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || !event.target.matches('[data-product-position]')) return
  event.preventDefault()
  event.target.blur()
})

$('#productRows').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]')
  if (!button) return
  const product = state.products.find(item => item.id === Number(button.dataset.id))
  if (!product) return
  if (button.dataset.action === 'edit') openDrawer(product)
  if (button.dataset.action === 'toggle') {
    try {
      await api(`/api/admin/products/${product.id}`, { method: 'PUT', body: JSON.stringify({ status: product.status === 'published' ? 'draft' : 'published' }) })
      toast(product.status === 'published' ? '商品已下架' : '商品已上架')
      await loadProducts()
    } catch (error) { toast(error.message) }
  }
})

$('#imageInput').addEventListener('change', async event => {
  const files = [...event.target.files]
  if (!files.length) return
  $('#formMessage').textContent = '正在上传图片…'
  try {
    state.images.push(...await uploadFiles(files, { title: '上传商品主图', purpose: 'product' }))
    renderImages()
    renderColorGalleries()
    $('#formMessage').textContent = ''
  } catch (error) { $('#formMessage').textContent = error.message }
  event.target.value = ''
})

$('#addMainImageUrl').addEventListener('click', async () => {
  try {
    const url = await importImageUrl($('#mainImageUrl').value, { purpose: 'product' })
    pushUniqueImage(state.images, url)
    $('#mainImageUrl').value = ''
    renderImages()
    renderColorGalleries()
    $('#formMessage').textContent = '主图链接已添加，保存商品后生效。'
  } catch (error) { $('#formMessage').textContent = error.message }
})

$('#posterImageInput').addEventListener('change', async event => {
  const file = event.target.files[0]
  if (!file) return
  $('#formMessage').textContent = '正在上传商品海报…'
  try {
    const [url] = await uploadFiles([file], { title: '上传商品海报', purpose: 'poster' })
    state.posterImage = url
    renderPosterImage()
    $('#formMessage').textContent = '海报已上传，保存商品后同步到小程序。'
  } catch (error) { $('#formMessage').textContent = error.message }
  event.target.value = ''
})

$('#applyPosterImageUrl').addEventListener('click', async () => {
  try {
    state.posterImage = await importImageUrl($('#posterImageUrl').value, { purpose: 'poster' })
    $('#posterImageUrl').value = ''
    renderPosterImage()
    $('#formMessage').textContent = '海报链接已设置，保存商品后生效。'
  } catch (error) { $('#formMessage').textContent = error.message }
})

$('#posterImagePreview').addEventListener('click', event => {
  if (!event.target.closest('#removePosterImageButton')) return
  state.posterImage = ''
  renderPosterImage()
  $('#formMessage').textContent = '海报已移除，保存商品后生效。'
})

$('#detailImageInput').addEventListener('change', async event => {
  const files = [...event.target.files]
  if (!files.length) return
  $('#formMessage').textContent = '正在上传详情图片…'
  try {
    state.detailImages.push(...await uploadFiles(files, { title: '上传商品详情图', purpose: 'detail' }))
    renderDetailImages()
    $('#formMessage').textContent = ''
  } catch (error) { $('#formMessage').textContent = error.message }
  event.target.value = ''
})

$('#addDetailImageUrl').addEventListener('click', async () => {
  try {
    const url = await importImageUrl($('#detailImageUrl').value, { purpose: 'detail' })
    pushUniqueImage(state.detailImages, url)
    $('#detailImageUrl').value = ''
    renderDetailImages()
    $('#formMessage').textContent = '详情图链接已添加，保存商品后生效。'
  } catch (error) { $('#formMessage').textContent = error.message }
})

$('#realImageInput').addEventListener('change', async event => {
  const files = [...event.target.files]
  if (!files.length) return
  $('#formMessage').textContent = '正在上传实拍图…'
  try {
    const urls = await uploadFiles(files, { title: '上传商品实拍图', purpose: 'real' })
    state.realImages.push(...urls.map(url => ({ url, category: '正面实拍' })))
    renderRealImages()
    $('#formMessage').textContent = ''
  } catch (error) { $('#formMessage').textContent = error.message }
  event.target.value = ''
})

$('#addRealImageUrl').addEventListener('click', async () => {
  try {
    const url = await importImageUrl($('#realImageUrl').value, { purpose: 'real' })
    if (!state.realImages.some(item => item.url === url)) {
      state.realImages.push({ url, category: $('#realImageLinkCategory').value || '正面实拍' })
    }
    $('#realImageUrl').value = ''
    renderRealImages()
    $('#formMessage').textContent = '实拍图链接已添加，保存商品后生效。'
  } catch (error) { $('#formMessage').textContent = error.message }
})

$('#storeIconInput').addEventListener('change', async event => {
  const file = event.target.files[0]
  if (!file) return
  $('#settingsMessage').textContent = '正在上传店铺图标…'
  try {
    const [url] = await uploadFiles([file], { title: '上传店铺图标', purpose: 'icon' })
    state.storeIcon = url
    renderStoreIconPreview()
    $('#settingsMessage').textContent = '图标已上传，请点击“保存店铺设置”完成同步。'
  } catch (error) { $('#settingsMessage').textContent = error.message }
  event.target.value = ''
})

$('#applyStoreIconUrl').addEventListener('click', async () => {
  try {
    state.storeIcon = await importImageUrl($('#storeIconUrl').value, { purpose: 'icon' })
    renderStoreIconPreview()
    $('#settingsMessage').textContent = '图标链接已设置，请点击“保存店铺设置”完成同步。'
  } catch (error) { $('#settingsMessage').textContent = error.message }
})

$('#clearStoreIcon').addEventListener('click', () => {
  state.storeIcon = ''
  $('#storeIconUrl').value = ''
  renderStoreIconPreview()
  $('#settingsMessage').textContent = '图标已清除，请点击“保存店铺设置”完成同步。'
})

$('#homeHeroImageInput').addEventListener('change', async event => {
  const files = [...event.target.files]
  if (!files.length) return
  const available = 11 - state.homeHeroImages.length
  if (available <= 0) {
    $('#settingsMessage').textContent = '首页轮播图最多11张，请先删除后再上传。'
    event.target.value = ''
    return
  }
  const acceptedFiles = files.slice(0, available)
  $('#settingsMessage').textContent = `正在上传轮播图片（${acceptedFiles.length}张）…`
  try {
    const urls = await uploadFiles(acceptedFiles, { title: '上传首页轮播图', purpose: 'hero' })
    state.homeHeroImages.push(...urls)
    renderHomeHeroPreview()
    $('#settingsMessage').textContent = files.length > acceptedFiles.length
      ? `已添加${acceptedFiles.length}张，轮播图最多11张；请点击“保存店铺设置”完成同步。`
      : `已添加${acceptedFiles.length}张，请点击“保存店铺设置”完成同步。`
  } catch (error) { $('#settingsMessage').textContent = error.message }
  event.target.value = ''
})

$('#addHomeHeroUrl').addEventListener('click', async () => {
  if (state.homeHeroImages.length >= 11) {
    $('#settingsMessage').textContent = '首页轮播图最多11张，请先删除后再添加。'
    return
  }
  try {
    const url = await importImageUrl($('#homeHeroUrl').value, { purpose: 'hero' })
    pushUniqueImage(state.homeHeroImages, url)
    $('#homeHeroUrl').value = ''
    renderHomeHeroPreview()
    $('#settingsMessage').textContent = '轮播图链接已添加，请点击“保存店铺设置”完成同步。'
  } catch (error) { $('#settingsMessage').textContent = error.message }
})

$('#homeHeroPreview').addEventListener('click', event => {
  const button = event.target.closest('[data-hero-action]')
  if (!button) return
  const index = Number(button.dataset.heroIndex)
  if (button.dataset.heroAction === 'remove') state.homeHeroImages.splice(index, 1)
  if (button.dataset.heroAction === 'previous' && index > 0) [state.homeHeroImages[index - 1], state.homeHeroImages[index]] = [state.homeHeroImages[index], state.homeHeroImages[index - 1]]
  if (button.dataset.heroAction === 'next' && index < state.homeHeroImages.length - 1) [state.homeHeroImages[index + 1], state.homeHeroImages[index]] = [state.homeHeroImages[index], state.homeHeroImages[index + 1]]
  renderHomeHeroPreview()
  $('#settingsMessage').textContent = '轮播图顺序已调整，请点击“保存店铺设置”完成同步。'
})

async function addCategory() {
  const input = $('#newCategoryName')
  const name = input.value.trim()
  if (!name) {
    $('#categoryManagementMessage').textContent = '请先输入新分类名称。'
    input.focus()
    return
  }
  $('#addCategoryButton').disabled = true
  $('#categoryManagementMessage').textContent = '正在添加新分类…'
  try {
    const result = await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name }) })
    state.categories.push(result.data)
    input.value = ''
    $('#categoryManagementMessage').textContent = ''
    render()
    toast('新分类已添加，可继续上传图片和调整位置')
  } catch (error) { $('#categoryManagementMessage').textContent = error.message }
  $('#addCategoryButton').disabled = false
}

$('#addCategoryButton').addEventListener('click', addCategory)
$('#newCategoryName').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    addCategory()
  }
})

async function saveCategoryPosition(input) {
  const categoryId = Number(input.dataset.categoryPosition)
  const currentIndex = state.categories.findIndex(item => item.id === categoryId)
  const requestedPosition = Number(input.value)
  if (currentIndex < 0) return
  if (!Number.isInteger(requestedPosition) || requestedPosition < 1 || requestedPosition > state.categories.length) {
    input.value = currentIndex + 1
    toast(`大类排序位置请输入 1–${state.categories.length} 的整数`)
    return
  }

  const nextIndex = requestedPosition - 1
  if (nextIndex === currentIndex) return
  const reordered = state.categories.slice()
  const [movedCategory] = reordered.splice(currentIndex, 1)
  reordered.splice(nextIndex, 0, movedCategory)
  input.disabled = true
  $('#categoryManagementMessage').textContent = `正在把“${movedCategory.name}”调整到第 ${requestedPosition} 位…`
  try {
    const result = await api('/api/admin/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids: reordered.map(item => item.id) })
    })
    state.categories = result.data
    $('#categoryManagementMessage').textContent = ''
    render()
    toast(`“${movedCategory.name}”已调整到大类第 ${requestedPosition} 位并同步到小程序`)
  } catch (error) {
    input.disabled = false
    input.value = currentIndex + 1
    $('#categoryManagementMessage').textContent = error.message
    toast(error.message)
  }
}

$('#categoryManagementList').addEventListener('change', async event => {
  const categoryPositionInput = event.target.closest('[data-category-position]')
  if (categoryPositionInput) {
    await saveCategoryPosition(categoryPositionInput)
    return
  }
  const positionInput = event.target.closest('[data-category-product-position]')
  if (!positionInput) return
  const categoryId = Number(positionInput.dataset.categoryProductPosition)
  const productId = Number(positionInput.dataset.productId)
  const category = state.categories.find(item => item.id === categoryId)
  if (!category) return
  const ids = [...(category.productIds || [])]
  const currentIndex = ids.indexOf(productId)
  const nextIndex = Number(positionInput.value) - 1
  if (currentIndex < 0 || !Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= ids.length) {
    $('#categoryManagementMessage').textContent = `请输入 1 到 ${ids.length} 之间的位置数字。`
    renderCategoryManagement()
    return
  }
  if (currentIndex === nextIndex) return
  ids.splice(currentIndex, 1)
  ids.splice(nextIndex, 0, productId)
  $('#categoryManagementMessage').textContent = `正在调整“${category.name}”商品位置…`
  try {
    const result = await api(`/api/admin/categories/${categoryId}/products/reorder`, { method: 'POST', body: JSON.stringify({ ids }) })
    state.categories = state.categories.map(item => item.id === categoryId ? result.data : item)
    $('#categoryManagementMessage').textContent = ''
    render()
    toast(`“${category.name}”商品位置已保存`)
  } catch (error) {
    $('#categoryManagementMessage').textContent = error.message
    renderCategoryManagement()
  }
})

$('#categoryManagementList').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('[data-category-position], [data-category-product-position]')) {
    event.preventDefault()
    event.target.blur()
  }
})

$('#categoryManagementList').addEventListener('click', async event => {
  const toggleButton = event.target.closest('[data-category-toggle]')
  if (toggleButton) {
    const id = Number(toggleButton.dataset.categoryToggle)
    state.expandedCategoryId = state.expandedCategoryId === id ? null : id
    renderCategoryManagement()
    if (state.expandedCategoryId) requestAnimationFrame(() => document.querySelector(`[data-category-row="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
    return
  }

  const deleteButton = event.target.closest('[data-category-delete]')
  if (deleteButton) {
    const id = Number(deleteButton.dataset.categoryDelete)
    const category = state.categories.find(item => item.id === id)
    if (!category) return
    const productCount = Number(category.count) || 0
    const confirmed = window.confirm(`确定删除“${category.name}”吗？\n\n${productCount ? `该分类目前有 ${productCount} 款已上架商品。` : '该分类目前没有已上架商品。'}删除分类不会删除商品、库存或图片，只会解除商品与该分类的归属。`)
    if (!confirmed) return
    deleteButton.disabled = true
    $('#categoryManagementMessage').textContent = `正在删除“${category.name}”…`
    try {
      const result = await api(`/api/admin/categories/${id}`, { method: 'DELETE' })
      await loadProducts()
      $('#categoryManagementMessage').textContent = ''
      toast(`“${category.name}”已删除，${result.data.affectedProducts || 0} 款商品已安全解除分类`)
    } catch (error) {
      deleteButton.disabled = false
      $('#categoryManagementMessage').textContent = error.message
    }
    return
  }

  const imageButton = event.target.closest('[data-category-image]')
  if (imageButton) {
    state.categoryImageId = Number(imageButton.dataset.categoryImage)
    $('#categoryImageInput').click()
    return
  }

  const saveButton = event.target.closest('[data-category-save]')
  if (saveButton) {
    const id = Number(saveButton.dataset.categorySave)
    const name = document.querySelector(`[data-category-name="${id}"]`).value.trim()
    const imageValue = document.querySelector(`[data-category-image-url="${id}"]`).value.trim()
    $('#categoryManagementMessage').textContent = '正在保存分类名称和图片…'
    try {
      const image = imageValue ? await importImageUrl(imageValue, { purpose: 'category' }) : ''
      await api(`/api/admin/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name, image }) })
      $('#categoryManagementMessage').textContent = ''
      toast('分类名称和图片已保存，商品分类已同步更新')
      await loadProducts()
    } catch (error) { $('#categoryManagementMessage').textContent = error.message }
    return
  }

  const moveButton = event.target.closest('[data-category-move]')
  if (!moveButton || moveButton.disabled) return
  const id = Number(moveButton.dataset.id)
  const index = state.categories.findIndex(item => item.id === id)
  const nextIndex = moveButton.dataset.categoryMove === 'up' ? index - 1 : index + 1
  if (index < 0 || nextIndex < 0 || nextIndex >= state.categories.length) return
  const reordered = state.categories.slice()
  const [moved] = reordered.splice(index, 1)
  reordered.splice(nextIndex, 0, moved)
  $('#categoryManagementMessage').textContent = '正在调整分类位置…'
  try {
    const result = await api('/api/admin/categories/reorder', { method: 'POST', body: JSON.stringify({ ids: reordered.map(item => item.id) }) })
    state.categories = result.data
    $('#categoryManagementMessage').textContent = ''
    render()
    toast('分类位置已同步到小程序')
  } catch (error) { $('#categoryManagementMessage').textContent = error.message }
})

$('#categoryImageInput').addEventListener('change', async event => {
  const file = event.target.files[0]
  const id = state.categoryImageId
  const category = state.categories.find(item => item.id === id)
  if (!file || !category) return
  $('#categoryManagementMessage').textContent = `正在上传“${category.name}”首页图片…`
  try {
    const [image] = await uploadFiles([file], { title: `上传“${category.name}”分类图片`, purpose: 'category' })
    const result = await api(`/api/admin/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name: category.name, image }) })
    state.categories = state.categories.map(item => item.id === id ? result.data : item)
    $('#categoryManagementMessage').textContent = ''
    render()
    toast('分类首页图片已更新')
  } catch (error) { $('#categoryManagementMessage').textContent = error.message }
  event.target.value = ''
  state.categoryImageId = null
})

$('#storeSettingsForm').elements.storeName.addEventListener('input', () => {
  if (!state.storeIcon) renderStoreIconPreview()
})

$('#storeSettingsForm').addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.currentTarget
  const button = $('#saveSettingsButton')
  button.disabled = true
  $('#settingsMessage').textContent = ''
  try {
    const result = await api('/api/admin/store-settings', {
      method: 'PUT',
      body: JSON.stringify({
        storeName: form.elements.storeName.value,
        storeIcon: state.storeIcon,
        homeHeroImage: state.homeHeroImages[0] || '',
        homeHeroImages: state.homeHeroImages,
        homeEyebrow: form.elements.homeEyebrow.value,
        homeSubtitle: form.elements.homeSubtitle.value,
        searchPlaceholder: form.elements.searchPlaceholder.value,
        heroNote: form.elements.heroNote.value,
        homeHeroImageMode: form.elements.homeHeroImageMode.value,
        categoryTitle: form.elements.categoryTitle.value,
        categorySubtitle: form.elements.categorySubtitle.value,
        categoryMoreText: form.elements.categoryMoreText.value,
        homeServices: splitList(form.elements.homeServices.value),
        profileLayout: form.elements.profileLayout.value,
        profilePageTitle: form.elements.profilePageTitle.value,
        profileTitle: form.elements.profileTitle.value,
        profileSubtitle: form.elements.profileSubtitle.value,
        serviceTitle: form.elements.serviceTitle.value,
        services: splitList(form.elements.services.value),
        profileAboutTitle: form.elements.profileAboutTitle.value,
        productFeatures: splitList(form.elements.productFeatures.value),
        aboutText: form.elements.aboutText.value,
        footerText: form.elements.footerText.value
      })
    })
    state.settings = result.data
    renderAdminBrand(result.data)
    state.storeIcon = result.data.storeIcon || ''
    state.homeHeroImages = Array.isArray(result.data.homeHeroImages) && result.data.homeHeroImages.length
      ? [...result.data.homeHeroImages]
      : (result.data.homeHeroImage ? [result.data.homeHeroImage] : [])
    renderSettingsForm()
    toast('店铺设置已保存并同步到小程序')
  } catch (error) { $('#settingsMessage').textContent = error.message }
  button.disabled = false
})

$('#imageGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-image]')
  if (!button) return
  state.images.splice(Number(button.dataset.removeImage), 1)
  renderImages()
  renderColorGalleries()
})

$('#colorGalleryList').addEventListener('change', async event => {
  const input = event.target.closest('[data-color-gallery-upload]')
  if (!input) return
  const files = [...input.files]
  if (!files.length) return
  const color = input.dataset.colorGalleryUpload
  $('#formMessage').textContent = `正在上传${color}商品图片…`
  input.disabled = true
  try {
    const urls = await uploadFiles(files, { title: `上传“${color}”颜色图片`, purpose: 'product' })
    state.colorGalleries[color] = [...(state.colorGalleries[color] || []), ...urls]
    renderColorGalleries()
    $('#formMessage').textContent = ''
  } catch (error) { $('#formMessage').textContent = error.message }
})

$('#colorGalleryList').addEventListener('click', async event => {
  const linkButton = event.target.closest('[data-color-gallery-link]')
  if (linkButton) {
    const color = linkButton.dataset.colorGalleryLink
    const input = linkButton.closest('.color-gallery-item').querySelector('[data-color-gallery-url]')
    try {
      const url = await importImageUrl(input.value, { purpose: 'product' })
      if (!state.colorGalleries[color]) state.colorGalleries[color] = []
      pushUniqueImage(state.colorGalleries[color], url)
      input.value = ''
      renderColorGalleries()
      $('#formMessage').textContent = `${color}图片链接已添加，保存商品后生效。`
    } catch (error) { $('#formMessage').textContent = error.message }
    return
  }
  const button = event.target.closest('[data-gallery-action]')
  if (!button) return
  const color = button.dataset.galleryColor
  const index = Number(button.dataset.galleryIndex)
  const gallery = [...(state.colorGalleries[color] || [])]
  if (button.dataset.galleryAction === 'remove') gallery.splice(index, 1)
  if (button.dataset.galleryAction === 'previous' && index > 0) [gallery[index - 1], gallery[index]] = [gallery[index], gallery[index - 1]]
  if (button.dataset.galleryAction === 'next' && index < gallery.length - 1) [gallery[index + 1], gallery[index]] = [gallery[index], gallery[index + 1]]
  state.colorGalleries[color] = gallery
  renderColorGalleries()
})

$('#productForm').elements.colors.addEventListener('input', () => {
  renderColorGalleries()
  renderSizeStocks()
})

$('#detailImageGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-detail-image]')
  if (!button) return
  state.detailImages.splice(Number(button.dataset.removeDetailImage), 1)
  renderDetailImages()
})

$('#realImageGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-real-image]')
  if (!button) return
  state.realImages.splice(Number(button.dataset.removeRealImage), 1)
  renderRealImages()
})

$('#realImageGrid').addEventListener('change', event => {
  const select = event.target.closest('[data-real-category]')
  if (!select) return
  state.realImages[Number(select.dataset.realCategory)].category = select.value
})

$('#productForm').addEventListener('submit', async event => {
  event.preventDefault()
  const button = $('#saveButton')
  button.disabled = true
  $('#formMessage').textContent = ''
  try {
    const path = state.editingId ? `/api/admin/products/${state.editingId}` : '/api/admin/products'
    await api(path, { method: state.editingId ? 'PUT' : 'POST', body: JSON.stringify(formPayload(event.currentTarget)) })
    toast(state.editingId ? '商品信息已更新' : '商品已创建')
    closeDrawer()
    await loadProducts()
  } catch (error) { $('#formMessage').textContent = error.message }
  button.disabled = false
})

$('#deleteProductButton').addEventListener('click', async () => {
  if (!state.editingId || !confirm('确定删除这个商品吗？此操作不可撤销。')) return
  try {
    await api(`/api/admin/products/${state.editingId}`, { method: 'DELETE' })
    toast('商品已删除')
    closeDrawer()
    await loadProducts()
  } catch (error) { $('#formMessage').textContent = error.message }
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#editorDrawer').classList.contains('is-hidden')) closeDrawer()
})

loadPublicBrand()
loadProducts()
