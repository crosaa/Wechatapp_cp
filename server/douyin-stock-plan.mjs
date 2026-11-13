// 抖店 stock sync, the part without a browser: reads 抖店's 商品库存模版 export, works out how each SKU's stock must
// change to follow the mini program, and writes the file 抖店 imports.
// Rule (the same as when the products were listed): 抖店 stock = min(mini program stock of that colour and size, 20).
import AdmZip from 'adm-zip'
import XLSX from 'xlsx'

export const DOUYIN_STOCK_CAP = 20

const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').trim()
const cleanColor = value => clean(value).replace(/[.。]/g, '')
// 抖店 only takes letter sizes, so "M/170" was listed as "M".
const letterSize = value => clean(value).split('/')[0]
// The model code a listing title ends with, e.g. 716D in "…户外登山服外套716D".
const modelCode = product => ((`${product.code || ''} ${product.name || ''}`).match(/[A-Za-z]*\d{2,}[A-Za-z]?/) || [''])[0].toUpperCase()

// Rows of the template: one per SKU, with 抖店's current 现货可售.
export function readStockTemplate(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' })
  const head = rows.findIndex(row => String(row[0]).startsWith('商品id'))
  if (head < 0) throw new Error('抖店库存模板里找不到表头「商品id」')
  return rows.slice(head + 1)
    .map(([productId, title, skuId, , spec, current]) => ({ productId: String(productId), title: String(title), skuId: String(skuId), spec: String(spec), current: Number(current) || 0 }))
    .filter(row => row.productId && row.skuId)
}

// mapping: [{ douyinId, productId }] saved when the products were listed. A 抖店 product missing from it falls back to
// the mini program product whose model code its title ends with, when exactly one product has that code.
export function planDouyinStock({ rows, products, mapping = [] }) {
  const byId = new Map(products.map(product => [Number(product.id), product]))
  const mapped = new Map(mapping.map(entry => [String(entry.douyinId), Number(entry.productId)]))
  const byCode = new Map()
  for (const product of products) {
    const code = modelCode(product)
    if (code) byCode.set(code, byCode.has(code) ? null : product)
  }
  const resolve = row => {
    if (mapped.has(row.productId)) return byId.get(mapped.get(row.productId)) || { missing: `对应的小程序商品 ${mapped.get(row.productId)} 不存在` }
    const code = [...byCode.keys()].filter(c => clean(row.title).toUpperCase().endsWith(c)).sort((a, b) => b.length - a.length)[0]
    if (!code) return { missing: '没有对应的小程序商品' }
    return byCode.get(code) || { missing: `款号 ${code} 对应多个小程序商品` }
  }

  const changes = [], unmatched = []
  let same = 0
  for (const row of rows) {
    const product = resolve(row)
    // 商品规格 looks like {颜色分类:炭岩灰， 尺码大小:4XL}
    const attrs = Object.fromEntries(row.spec.replace(/[{}]/g, '').split(/[，,]/).map(part => part.split(/[:：]/).map(clean)).filter(pair => pair.length === 2))
    const color = attrs['颜色分类'] ?? Object.values(attrs)[0]
    const size = attrs['尺码大小'] ?? attrs['尺码'] ?? Object.values(attrs)[1]
    const stocks = product.colorSizeStocks || {}
    const rawColor = !product.missing && Object.keys(stocks).find(c => cleanColor(c) === cleanColor(color))
    const rawSize = rawColor && Object.keys(stocks[rawColor]).find(s => letterSize(s) === size)
    if (product.missing || rawSize === undefined) {
      unmatched.push({ ...row, reason: product.missing || (!rawColor ? `小程序没有颜色「${color}」` : `小程序没有尺码「${size}」`) })
      continue
    }
    const stock = Number(stocks[rawColor][rawSize]) || 0
    const target = Math.min(stock, DOUYIN_STOCK_CAP)
    const delta = target - row.current
    if (delta) changes.push({ ...row, miniProductId: product.id, stock, target, delta })
    else same++
  }
  return { skus: rows.length, same, changes, unmatched }
}

// 抖店's importer reads none of a workbook rebuilt by SheetJS (it writes t="str" cells), so the import file is 抖店's
// own template edited in place: changed rows get 增加/减少 + 数量, every other SKU row is dropped and the rest renumbered.
export function writeStockImport(templateBuffer, changes) {
  const zip = new AdmZip(templateBuffer)
  const entry = 'xl/worksheets/sheet1.xml'
  const xml = zip.readAsText(entry)
  const bySku = new Map(changes.map(change => [String(change.skuId), change]))
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const setCell = (row, column, value) => row.replace(new RegExp(`(<c r="${column}\\d+"[^>]*><is><t>)[^<]*(</t></is></c>)`), `$1${escape(value)}$2`)
  const skuOf = row => row.match(/<c r="C\d+"[^>]*><is><t>(\d+)<\/t>/)?.[1]
  let number = 0
  const rows = xml.match(/<sheetData>([\s\S]*)<\/sheetData>/)[1].match(/<row [\s\S]*?<\/row>/g)
    .filter((row, index) => index < 2 || bySku.has(skuOf(row))) // notes + header, then the changed SKUs
    .map(row => {
      number++
      let out = row.replace(/<row r="\d+"/, `<row r="${number}"`).replace(/(<c r="[A-Z]+)\d+"/g, `$1${number}"`)
      const change = number > 2 && bySku.get(skuOf(row))
      if (change) out = setCell(setCell(out, 'G', change.delta > 0 ? '增加' : '减少'), 'H', Math.abs(change.delta))
      return out
    })
  zip.updateFile(entry, Buffer.from(xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${rows.join('')}</sheetData>`), 'utf8'))
  return zip.toBuffer()
}
