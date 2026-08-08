const DEFAULT_APP_NAME = '普润制衣团购仓'

function appName() {
  try {
    return getApp().globalData.brandName || DEFAULT_APP_NAME
  } catch {
    return DEFAULT_APP_NAME
  }
}

function firstImage(source) {
  if (!source) return ''
  if (typeof source === 'string') return source
  const colors = Array.isArray(source.colors) ? source.colors : []
  const firstColor = colors[0] || ''
  const gallery = firstColor && Array.isArray(source.colorGalleries?.[firstColor])
    ? source.colorGalleries[firstColor]
    : []
  return source.posterImage
    || gallery[0]
    || source.colorImages?.[firstColor]
    || source.image
    || source.images?.[0]
    || ''
}

function safeTitle(title) {
  return String(title || appName()).trim() || DEFAULT_APP_NAME
}

function appShare({ title, path = '/pages/home/home', imageUrl = '' } = {}) {
  const result = { title: safeTitle(title), path }
  if (imageUrl) result.imageUrl = imageUrl
  return result
}

function timelineShare({ title, query = '', imageUrl = '' } = {}) {
  const result = { title: safeTitle(title), query }
  if (imageUrl) result.imageUrl = imageUrl
  return result
}

function favoriteShare({ title, query = '', imageUrl = '' } = {}) {
  const result = { title: safeTitle(title), query }
  if (imageUrl) result.imageUrl = imageUrl
  return result
}

function productTitle(product) {
  const name = String(product?.name || '').trim()
  return name ? `${name}｜${appName()}` : appName()
}

function productQuery(product) {
  const id = Number(product?.id)
  return id > 0 ? `id=${id}` : ''
}

module.exports = {
  appName,
  firstImage,
  appShare,
  timelineShare,
  favoriteShare,
  productTitle,
  productQuery
}
