const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()

const compactCache = new Map()
function compact(value) {
  const key = clean(value)
  if (!compactCache.has(key)) compactCache.set(key, key.toUpperCase().replace(/[\s·•,，。:：;；'"“”‘’()（）【】\[\]{}<>《》/\\_—–-]+/g, ''))
  return compactCache.get(key)
}

const colorWords = [
  '藏蓝色', '藏蓝', '丈青色', '丈青', '深蓝色', '深蓝', '宝蓝色', '宝蓝', '艳蓝色', '艳蓝', '湖蓝色', '湖蓝', '水蓝色', '水蓝', '天蓝色', '天蓝', '孔蓝', '浅蓝', '蓝色',
  '中国红', '大红色', '大红', '桔红色', '桔红', '橘红', '红色', '酒红', '粉红色', '粉红', '深粉', '浅粉', '粉色', '玫红', '紫色', '清华紫',
  '墨绿色', '墨绿', '军绿色', '军绿', '草绿色', '草绿', '浅军绿', '理想绿', '浅灰绿', '迪桑绿', '绿色', '荧光绿', '果绿', '蟹绿', '翠绿',
  '深灰色', '深灰', '浅灰色', '浅灰', '中灰色', '中灰', '高级灰', '灰杏', '银灰', '灰色', '驼灰', '水灰', '黑色', '纯黑', '黑',
  '米白色', '米白', '纯白', '白色', '雅黄', '柠檬黄', '黄色', '桔色', '橘色', '卡其色', '卡其', '咖色', '棕色', '香槟色', '冰川蓝'
]
const noiseWords = ['主推', '新款', '老款', '款式', '款', '系列', '展厅', '双码', '乔', '工', '闪鹰', '天行健', '亚麻桑蚕丝', '舒弹棉莫代尔', '凉感液氨', '轻量速干', '加厚', '纯色']
const normalizeColorText = value => compact(value).replaceAll('桔', '橘').replaceAll('兰', '蓝').replaceAll('丈青', '藏蓝').replaceAll('藏青', '藏蓝')
const colorSignals = colorWords.map(color => normalizeColorText(color).replace(/色$/u, ''))
const removalTokens = [...colorWords, ...noiseWords].sort((a, b) => b.length - a.length).map(compact)
const coreCache = new Map()
function nameCore(value) {
  const key = clean(value)
  if (coreCache.has(key)) return coreCache.get(key)
  let result = compact(key)
  for (const word of removalTokens) result = result.replaceAll(word, '')
  coreCache.set(key, result)
  return result
}

function codeBase(code) {
  const value = clean(code).toUpperCase()
  if (!value || value.startsWith('SRC-')) return ''
  return value.replace(/-([0-9A-F]{6})$/, '')
}

function codeAliases(product) {
  const aliases = new Set()
  const base = codeBase(product.code)
  const cleanBase = clean(base).toUpperCase()
  const baseIsPlainCode = /^[A-Z0-9-]+$/.test(cleanBase) && /[0-9]/.test(cleanBase)
  if (baseIsPlainCode) {
    aliases.add(compact(cleanBase))
    for (const part of cleanBase.split(/[^A-Z0-9]+/u)) {
      if (part.length >= 3 && /[0-9]/u.test(part)) aliases.add(compact(part))
    }
  }
  const source = clean(product.name).toUpperCase()
  if (!baseIsPlainCode) {
    for (const match of source.matchAll(/[A-Z]{0,8}[-_]?\d{2,}[A-Z0-9-]*/g)) aliases.add(compact(match[0]))
    if (clean(product.code).toUpperCase().startsWith('SRC-')) {
      const prefix = source.match(/^([A-Z]{3,})(?=[^A-Z]|$)/)?.[1]
      if (prefix) aliases.add(compact(prefix))
    }
  }
  return [...aliases].filter(alias => alias.length >= 3 || /^[A-Z]\d$/u.test(alias)).sort((a, b) => b.length - a.length)
}

function boundedIndex(source, token, start = 0) {
  let index = source.indexOf(token, start)
  while (index >= 0) {
    const before = source[index - 1] || ''
    const after = source[index + token.length] || ''
    const invalidDigitBoundary = (/^\d/u.test(token) && /\d/u.test(before)) || (/\d$/u.test(token) && /\d/u.test(after))
    if (!invalidDigitBoundary) return index
    index = source.indexOf(token, index + 1)
  }
  return -1
}

function splitCodeParts(code) {
  return clean(codeBase(code)).toUpperCase().split(/[^A-Z0-9]+/u).map(compact).filter(Boolean)
}

function interleavedCodeEvidence(group, product) {
  const source = compact(group.name)
  const base = compact(codeBase(product.code))
  if (!source || !base) return 0
  if (boundedIndex(source, base) >= 0) return 260

  const parts = splitCodeParts(product.code).filter(part => part.length >= 2)
  if (parts.length < 2 || !parts.some(part => part.length >= 3 && /\d/u.test(part))) return 0
  let offset = 0
  for (const part of parts) {
    const index = boundedIndex(source, part, offset)
    if (index < 0) return 0
    offset = index + part.length
  }
  return 230
}

function variantTypes(value) {
  const text = compact(value)
  const types = new Set()
  if (/短袖|夏短|短T|短上衣|短款|短(?:乔|忠|领|黑|工|YK|KY|YPS|$)/u.test(text) && !/短裤/u.test(text)) types.add('short')
  if (/夏长|长袖|长T|长上衣|长(?:乔|忠|领|黑|工|YK|KY|YPS|$)/u.test(text) && !/中长|加长|长裤/u.test(text)) types.add('long')
  if (/春秋|单层/u.test(text)) types.add('spring')
  if (/上衣/u.test(text)) types.add('upper')
  if (/套装|组装/u.test(text)) types.add('suit')
  if (/裤子|长裤|短裤|速干裤|登山裤/u.test(text)) types.add('pants')
  if (/棉衣|棉服/u.test(text)) types.add('coat')
  if (/马甲/u.test(text)) types.add('vest')
  if (/鞋/u.test(text)) types.add('shoe')
  if (/大褂/u.test(text)) types.add('gown')
  if (/雨衣/u.test(text)) types.add('rain')
  if (/冲锋衣/u.test(text)) types.add('jacket')
  if (/围裙/u.test(text)) types.add('apron')
  if (/帽/u.test(text)) types.add('hat')
  if (/手套/u.test(text)) types.add('glove')
  if (/眼镜|眼睛|防雾片/u.test(text)) types.add('eyewear')
  if (/POLO/u.test(text)) types.add('polo')
  if (/T恤/u.test(text)) types.add('tshirt')
  if (/衬衫/u.test(text)) types.add('shirt')
  if (/男款|男装|^男/u.test(text)) types.add('male')
  if (/女款|女装|^女/u.test(text)) types.add('female')
  return types
}

const exclusiveTypeGroups = [
  ['short', 'long', 'spring'],
  ['upper', 'suit', 'pants', 'coat', 'vest', 'shoe', 'gown', 'rain', 'jacket', 'apron', 'hat', 'glove', 'eyewear', 'polo', 'tshirt', 'shirt'],
  ['male', 'female']
]

function typeEvidence(group, product) {
  const sourceTypes = variantTypes(group.name)
  const productTypes = variantTypes(product.name)
  let score = 0
  const reasons = []
  for (const type of sourceTypes) {
    if (productTypes.has(type)) {
      score += 28
      reasons.push(`type:${type}`)
    }
  }
  for (const family of exclusiveTypeGroups) {
    const sourceFamily = family.filter(type => sourceTypes.has(type))
    const productFamily = family.filter(type => productTypes.has(type))
    if (sourceFamily.length && productFamily.length && !sourceFamily.some(type => productTypes.has(type))) {
      score -= 85
      reasons.push(`type-conflict:${sourceFamily.join('+')}/${productFamily.join('+')}`)
    } else if (sourceFamily.includes('pants') && !productFamily.length) {
      score -= 35
      reasons.push('type-missing:pants')
    }
  }
  const sourceUpper = /上衣/u.test(compact(group.name)) && !/无上衣|不含上衣|不带上衣/u.test(compact(group.name))
  const productUpper = /上衣/u.test(compact(product.name)) && !/无上衣|不含上衣|不带上衣/u.test(compact(product.name))
  if (sourceUpper !== productUpper) {
    score -= 140
    reasons.push(`variant-conflict:upper/${productUpper ? 'upper' : 'regular'}`)
  } else if (sourceUpper) {
    score += 35
    reasons.push('variant:upper')
  }
  return { score, reasons }
}

const traitWords = ['防静电', '三防', '中长', '加长', '防晒', '纯棉', '全棉', '涤棉', '涤丝', 'CVC', '网眼', '反光', '高端', '立领', '翻领', '连帽', '防砸', '防穿刺', '绝缘', '医师', '环卫', '冲锋衣']
function traitEvidence(group, product) {
  const sourceName = compact(group.name)
  const productName = compact(product.name)
  const hits = traitWords.filter(word => sourceName.includes(compact(word)) && productName.includes(compact(word)))
  return { score: Math.min(36, hits.length * 12), reasons: hits.map(hit => `trait:${hit}`) }
}

function dice(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const counts = new Map()
  for (let index = 0; index < a.length - 1; index += 1) {
    const gram = a.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }
  let overlap = 0
  for (let index = 0; index < b.length - 1; index += 1) {
    const gram = b.slice(index, index + 2)
    const count = counts.get(gram) || 0
    if (count > 0) {
      overlap += 1
      counts.set(gram, count - 1)
    }
  }
  return (2 * overlap) / (a.length + b.length - 2)
}

function normalizeSize(value) {
  let result = clean(value).toUpperCase().replace(/\s+/g, '').replace(/Ⅹ/g, 'X').replace(/码$/u, '')
  result = result.replace(/^XXXL$/, '3XL').replace(/^XXL$/, '2XL').replace(/^XXXXL$/, '4XL').replace(/^([2-9])X$/, '$1XL').replaceAll('XK', 'XL')
  result = result.replace(/^A小$/u, 'A').replace(/^B中$/u, 'B').replace(/^C大$/u, 'C').replace(/^D特$/u, 'D')
  return result
}

function sizeTokens(value) {
  const normalized = normalizeSize(value)
  const tokens = new Set([normalized])
  for (const token of normalized.split(/[\/-]/u).filter(Boolean)) tokens.add(token)
  const letter = normalized.match(/[（(]([A-D])[）)]/u)?.[1]
  if (letter) tokens.add(letter)
  if (/小码|号小/u.test(normalized)) tokens.add('A')
  if (/中码|号中/u.test(normalized)) tokens.add('B')
  if (/大码|号大/u.test(normalized)) tokens.add('C')
  if (/特码|D特/u.test(normalized)) tokens.add('D')
  return tokens
}

function mapSourceSize(product, sourceSize) {
  const productSizes = product.sizes || []
  if (productSizes.length === 1) return productSizes[0]
  const sourceTokens = sizeTokens(sourceSize)
  const exact = productSizes.find(size => normalizeSize(size) === normalizeSize(sourceSize))
  if (exact) return exact
  const matching = productSizes.filter(size => [...sizeTokens(size)].some(token => sourceTokens.has(token)))
  if (matching.length === 1) return matching[0]
  const sourceSpecial = [...sourceTokens].find(token => /^[A-D]$/u.test(token))
  if (sourceSpecial) {
    const specialWords = { A: /小/u, B: /中/u, C: /大/u, D: /特/u }
    const fallback = productSizes.filter(size => specialWords[sourceSpecial].test(clean(size)))
    if (fallback.length === 1) return fallback[0]
  }
  const defaultAlphaByNumber = new Map([
    ['155', 'XS'], ['160', 'S'], ['165', 'M'], ['170', 'L'], ['175', 'XL'], ['180', '2XL'], ['185', '3XL'],
    ['190', '4XL'], ['195', '5XL'], ['200', '6XL'], ['205', '7XL'], ['210', '8XL'], ['215', '9XL']
  ])
  const normalized = normalizeSize(sourceSize)
  if (/^\d{3}$/u.test(normalized)) {
    const alpha = defaultAlphaByNumber.get(normalized)
    const fallback = productSizes.filter(size => alpha && sizeTokens(size).has(alpha))
    if (fallback.length === 1) return fallback[0]
  }
  if (/^(?:XS|S|M|L|[2-9]?XL)$/u.test(normalized)) {
    const numeric = [...defaultAlphaByNumber.entries()].find(([, alpha]) => alpha === normalized)?.[0]
    const fallback = productSizes.filter(size => numeric && sizeTokens(size).has(numeric))
    if (fallback.length === 1) return fallback[0]
  }
  return ''
}

function colorFamily(value) {
  const text = normalizeColorText(value).replaceAll('色', '')
  if (/藏蓝|深蓝|海军蓝/u.test(text)) return '藏蓝'
  if (/桔|橘/u.test(text)) return '橘'
  if (/大红|中国红|正红|红$/u.test(text)) return '红'
  if (/银灰|银霜灰|银色/u.test(text)) return '银'
  if (/宝蓝|艳蓝/u.test(text)) return '宝蓝'
  if (/湖蓝/u.test(text)) return '湖蓝'
  if (/浅灰/u.test(text)) return '浅灰'
  if (/深灰/u.test(text)) return '深灰'
  if (/中灰/u.test(text)) return '中灰'
  if (/黑/u.test(text)) return '黑'
  if (/白/u.test(text)) return '白'
  if (/粉/u.test(text)) return '粉'
  if (/紫/u.test(text)) return '紫'
  if (/绿/u.test(text)) return '绿'
  if (/黄/u.test(text)) return '黄'
  if (/灰/u.test(text)) return '灰'
  if (/蓝/u.test(text)) return '蓝'
  return text
}

function colorTokens(value) {
  const text = normalizeColorText(value).replaceAll('色', '')
  const matches = [...new Set(colorSignals.filter(signal => signal && text.includes(signal)).sort((a, b) => b.length - a.length))]
  return matches.filter((signal, index) => !matches.slice(0, index).some(longer => longer.includes(signal)))
}

function colorKey(value) {
  return normalizeColorText(value).replaceAll('色', '').replace(/[+＋/、,.。·\s]/gu, '').replace(/拼|子/g, '').replace(/[A-Z0-9]+/gu, '')
}

function colorFamiliesMatch(left, right) {
  if (left === right) return true
  for (const generic of ['蓝', '红', '绿', '黄', '灰', '紫', '粉', '橘', '黑', '白']) {
    if ((left === generic && right.includes(generic)) || (right === generic && left.includes(generic))) return true
  }
  return false
}

function mapSourceColor(product, sourceName) {
  const colors = product.colors || []
  if (!colors.length) return ''
  const sourceText = colorKey(sourceName)
  const primarySource = clean(sourceName).split(/[（(]/u)[0]
  const primaryText = colorKey(primarySource)
  const allSourceTokens = colorTokens(sourceName)
  const primaryTokens = colorTokens(primarySource)
  const sourceTokens = primaryTokens.length ? primaryTokens : allSourceTokens
  const sourceHasColor = allSourceTokens.length > 0
  const ranked = colors.map(color => {
    const key = colorKey(color)
    const tokens = colorTokens(color)
    let score = key && primaryText.includes(key) ? 180 + key.length : (key && sourceText.includes(key) ? 100 + key.length : 0)
    if (key.includes('牛仔') && sourceText.includes('牛仔')) score += 120
    for (const token of tokens) {
      if (primaryText.includes(token)) score += 40 + token.length
      else if (sourceText.includes(token)) score += 24 + token.length
      else if (sourceTokens.some(sourceToken => colorFamiliesMatch(colorFamily(sourceToken), colorFamily(token)))) score += 12
    }
    if (!tokens.length && key && sourceText.includes(key)) score += 20
    return { color, score }
  }).sort((a, b) => b.score - a.score)
  if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score || 0)) return ranked[0].color
  if (colors.length === 1 && !sourceHasColor) return colors[0]
  return ''
}

function codeEvidence(group, product) {
  const sourceName = compact(group.name)
  let best = interleavedCodeEvidence(group, product)
  for (const code of codeAliases(product)) {
    const index = sourceName.indexOf(code)
    if (index < 0) continue
    if (/\d/.test(code)) {
      const before = sourceName[index - 1] || ''
      const after = sourceName[index + code.length] || ''
      if ((/^\d/.test(code) && /\d/.test(before)) || (/\d$/.test(code) && /\d/.test(after))) continue
    }
    best = Math.max(best, index === 0 ? 115 : 92)
  }
  return best
}

function hasCodeEvidence(reasons, minimum = 115) {
  return reasons.some(reason => {
    const match = reason.match(/^code:(\d+)$/u)
    return match && Number(match[1]) >= minimum
  })
}

function scoreGroupProduct(group, product) {
  const sourceName = compact(group.name)
  const productName = compact(product.name)
  const sourceCore = nameCore(group.name)
  const productCore = nameCore(product.name)
  let score = codeEvidence(group, product)
  const reasons = score ? [`code:${score}`] : []
  if (sourceName === productName) { score += 150; reasons.push('name:exact') } else if (sourceName.length >= 4 && productName.length >= 4 && (sourceName.includes(productName) || productName.includes(sourceName))) { score += 82; reasons.push('name:contains') }
  if (sourceCore && productCore && sourceCore === productCore) { score += 105; reasons.push('core:exact') } else if (sourceCore.length >= 4 && productCore.length >= 4 && (sourceCore.includes(productCore) || productCore.includes(sourceCore))) { score += 60; reasons.push('core:contains') }
  const similarity = Math.max(dice(sourceName, productName), dice(sourceCore, productCore))
  score += Math.round(similarity * 55)
  const productSizes = new Set((product.sizes || []).map(normalizeSize))
  const overlap = group.sizes.filter(size => productSizes.has(size)).length
  if (overlap) { score += Math.min(18, 6 + overlap * 3); reasons.push(`sizes:${overlap}`) }
  const sourceColor = normalizeColorText(group.name)
  const productColors = (product.colors || []).map(color => normalizeColorText(color).replace(/色$/u, '')).filter(Boolean)
  const colorHits = productColors.filter(color => sourceColor.includes(color)).length
  if (colorHits) { score += Math.min(15, colorHits * 5); reasons.push(`colors:${colorHits}`) }
  else if (colorSignals.some(color => sourceColor.includes(color)) && productColors.length) { score -= 18; reasons.push('color-conflict') }
  const type = typeEvidence(group, product)
  score += type.score
  reasons.push(...type.reasons)
  const traits = traitEvidence(group, product)
  score += traits.score
  reasons.push(...traits.reasons)
  return { score, reasons }
}

const pseudoPattern = /订单|另加.*费|运费|绣字费|印字费|打样费|加工费|补差价/u

export function buildWarehouseInventoryPlan(rows, products, options = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('大库统计表中没有库存明细')
  const errors = []
  const groupsByKey = new Map()
  for (const row of rows) {
    const name = clean(row.name)
    const size = clean(row.size)
    const internalCode = clean(row.internalCode)
    const quantity = Number(row.quantity)
    if (!name) { errors.push(`第 ${row.rowNumber} 行：商品名称不能为空`); continue }
    if (!Number.isInteger(quantity)) { errors.push(`第 ${row.rowNumber} 行：数量必须是整数`); continue }
    const key = `${name}\u0000${internalCode}`
    if (!groupsByKey.has(key)) groupsByKey.set(key, { key, name, internalCode, rows: [], sizes: new Set(), quantity: 0 })
    const group = groupsByKey.get(key)
    group.rows.push({ ...row, name, size, internalCode, quantity })
    if (size) group.sizes.add(normalizeSize(size))
    group.quantity += quantity
  }
  if (errors.length) throw new Error(errors.slice(0, 12).join('；'))
  const groups = [...groupsByKey.values()].map(group => ({ ...group, sizes: [...group.sizes] }))
  const productById = new Map(products.map(product => [Number(product.id), product]))
  const productMappings = new Map((Array.isArray(options.productMappings) ? options.productMappings : []).map(mapping => [
    `${clean(mapping.sourceName)}\u0000${clean(mapping.sourceInternalCode)}`,
    { productId: Number(mapping.productId), targetColor: clean(mapping.targetColor) }
  ]))
  const productMappingsByName = new Map()
  for (const mapping of Array.isArray(options.productMappings) ? options.productMappings : []) {
    const sourceName = clean(mapping.sourceName)
    if (!sourceName) continue
    if (!productMappingsByName.has(sourceName)) productMappingsByName.set(sourceName, [])
    productMappingsByName.get(sourceName).push({
      productId: Number(mapping.productId),
      targetColor: clean(mapping.targetColor)
    })
  }
  const plans = new Map(products.map(product => [product.id, {
    product,
    colorSizeStocks: Object.fromEntries(product.colors.map(color => [color, Object.fromEntries(product.sizes.map(size => [size, 0]))])),
    matchedGroups: 0,
    mappedRows: 0
  }]))
  let acceptedGroups = 0
  let ignoredGroups = 0
  let excludedFeeGroups = 0
  let unmappedRows = 0
  let unmappedColorRows = 0
  let negativeAdjusted = 0
  let manualMappedGroups = 0
  const unmappedColorDetails = []
  const unmatchedRows = []
  const matchedGroups = []

  for (const group of groups) {
    if (pseudoPattern.test(group.name)) { excludedFeeGroups += 1; continue }
    const ranked = products.map(product => ({ product, ...scoreGroupProduct(group, product) })).sort((a, b) => b.score - a.score).slice(0, 5)
    const best = ranked[0]
    const fullCodeMatches = ranked.filter(item => hasCodeEvidence(item.reasons, 230))
    const nameOnlyMappings = productMappingsByName.get(group.name) || []
    const nameOnlyProductIds = new Set(nameOnlyMappings.map(mapping => mapping.productId))
    const nameOnlyTargetColors = new Set(nameOnlyMappings.map(mapping => mapping.targetColor).filter(Boolean))
    const manualMapping = productMappings.get(group.key) || (
      nameOnlyProductIds.size === 1
        ? {
            productId: [...nameOnlyProductIds][0],
            targetColor: nameOnlyTargetColors.size === 1 ? [...nameOnlyTargetColors][0] : ''
          }
        : null
    )
    const mappedProductId = manualMapping?.productId || 0
    const manuallyMappedProduct = productById.get(mappedProductId)
    const selected = manuallyMappedProduct
      ? [{ product: manuallyMappedProduct, score: Number.MAX_SAFE_INTEGER, reasons: ['manual:mapping'] }]
      : [best]
    const selectedIds = new Set(selected.map(item => item.product.id))
    const next = ranked.find(item => !selectedIds.has(item.product.id))
    const margin = next ? best.score - next.score : best.score
    const strongCode = hasCodeEvidence(best.reasons)
    const hasConflict = best.reasons.some(reason => reason.startsWith('type-conflict:') || reason.startsWith('variant-conflict:'))
    const selectedIncludesIndependent = selected.some(item => item.reasons.includes('name:exact') || item.reasons.includes('core:exact') || (item.score >= 180 && hasCodeEvidence(item.reasons)))
    const compatibleFullCodeMatches = fullCodeMatches.filter(item => !item.reasons.some(reason => reason.startsWith('type-conflict:') || reason.startsWith('variant-conflict:')))
    const decisiveName = best.reasons.some(reason => reason === 'name:exact' || reason === 'core:exact' || reason === 'name:contains' || reason === 'core:contains')
    const ambiguousSameCode = compatibleFullCodeMatches.length > 1 && !decisiveName && margin < 18
    const automatic = Boolean(manuallyMappedProduct) || (!hasConflict && !ambiguousSameCode && (compatibleFullCodeMatches.length === 1 || (best.score >= 128 && (margin >= 18 || best.score >= 230)) || (strongCode && best.score >= 135 && margin >= 6) || selectedIncludesIndependent))
    if (!automatic) {
      ignoredGroups += 1
      for (const row of group.rows) {
        unmatchedRows.push({
          sourceFormat: 'warehouse',
          rowNumber: row.rowNumber,
          name: row.name,
          size: row.size,
          quantity: row.quantity,
          internalCode: row.internalCode,
          reason: '未匹配到唯一商品',
          candidateCode: best?.product?.code || '',
          candidateName: best?.product?.name || '',
          productColors: best?.product?.colors || [],
          productSizes: best?.product?.sizes || [],
        })
      }
      continue
    }
    if (manuallyMappedProduct) manualMappedGroups += 1
    acceptedGroups += 1
    for (const productId of selectedIds) {
      const plan = plans.get(productId)
      plan.matchedGroups += 1
      const manualTargetColor = manuallyMappedProduct ? clean(manualMapping?.targetColor) : ''
      const color = manualTargetColor
        ? (plan.product.colors.includes(manualTargetColor) ? manualTargetColor : '')
        : mapSourceColor(plan.product, group.name)
      if (!color) {
        unmappedColorRows += group.rows.length
        unmappedColorDetails.push({ sourceName: group.name, internalCode: group.internalCode, quantity: group.quantity, productId: plan.product.id, productCode: plan.product.code, productName: plan.product.name, colors: plan.product.colors })
        for (const row of group.rows) {
          unmatchedRows.push({
            sourceFormat: 'warehouse',
            rowNumber: row.rowNumber,
            name: row.name,
            size: row.size,
            quantity: row.quantity,
            internalCode: row.internalCode,
            reason: manualTargetColor
              ? '人工对应的目标颜色已不存在，请在库存对应页重新选择颜色'
              : '来源颜色无法唯一对应商品现有颜色',
            candidateCode: plan.product.code,
            candidateName: plan.product.name,
            productColors: plan.product.colors,
            productSizes: plan.product.sizes,
          })
        }
        continue
      }
      let matchedRows = 0
      let matchedQuantity = 0
      for (const row of group.rows) {
        const size = mapSourceSize(plan.product, row.size)
        if (!size) {
          unmappedRows += 1
          unmatchedRows.push({
            sourceFormat: 'warehouse',
            rowNumber: row.rowNumber,
            name: row.name,
            color,
            size: row.size,
            quantity: row.quantity,
            internalCode: row.internalCode,
            reason: '来源尺码无法唯一对应商品现有尺码',
            candidateCode: plan.product.code,
            candidateName: plan.product.name,
            productColors: plan.product.colors,
            productSizes: plan.product.sizes,
          })
          continue
        }
        plan.colorSizeStocks[color][size] += row.quantity
        plan.mappedRows += 1
        matchedRows += 1
        matchedQuantity += row.quantity
      }
      if (matchedRows > 0) {
        matchedGroups.push({
          sourceName: group.name,
          sourceInternalCode: group.internalCode,
          productId: plan.product.id,
          productCode: plan.product.code,
          productName: plan.product.name,
          matchMethod: manuallyMappedProduct ? 'manual' : 'automatic',
          matchedRows,
          matchedQuantity,
          sourceRows: group.rows.length,
          sourceQuantity: group.quantity,
          color
        })
      }
    }
  }

  for (const plan of plans.values()) {
    for (const color of plan.product.colors) {
      for (const [size, quantity] of Object.entries(plan.colorSizeStocks[color])) {
        if (quantity < 0) { plan.colorSizeStocks[color][size] = 0; negativeAdjusted += 1 } else plan.colorSizeStocks[color][size] = Math.round(quantity)
      }
    }
    plan.sizeStocks = Object.fromEntries(plan.product.sizes.map(size => [size, plan.product.colors.reduce((sum, color) => sum + (plan.colorSizeStocks[color]?.[size] || 0), 0)]))
    plan.stock = Object.values(plan.sizeStocks).reduce((sum, quantity) => sum + quantity, 0)
  }
  const changes = [...plans.values()]
  return {
    changes,
    diagnostics: { unmappedColorDetails, unmatchedRows, matchedGroups },
    summary: {
      format: 'warehouse',
      sourceRows: rows.length,
      sourceGroups: groups.length,
      acceptedGroups,
      ignoredGroups,
      excludedFeeGroups,
      manualMappedGroups,
      unmappedRows,
      unmappedColorRows,
      unmatchedRowsCount: unmatchedRows.length,
      negativeAdjusted,
      productsUpdated: changes.length,
      matchedProducts: changes.filter(change => change.mappedRows > 0).length,
      zeroStockProducts: changes.filter(change => change.stock === 0).length,
      totalStock: changes.reduce((sum, change) => sum + change.stock, 0)
    }
  }
}
