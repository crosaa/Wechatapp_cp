import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import XLSX from 'xlsx'
import {
  listInventoryProductMappings,
  listProducts,
  replaceInventoryImportMatches
} from '../server/db.mjs'
import { buildWarehouseInventoryPlan } from '../server/warehouse-inventory.mjs'

const sourcePath = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('请提供大库库存 Excel 文件路径')

const workbook = XLSX.read(readFileSync(sourcePath), { type: 'buffer' })
const sheetName = workbook.SheetNames.includes('Sheet1') ? 'Sheet1' : workbook.SheetNames.find(name => {
  const firstRow = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true }).slice(0, 1)[0] || []
  const headers = new Set(firstRow.map(value => String(value).trim()))
  return ['商品名称', '型号', '数量', '产地'].every(header => headers.has(header))
})
if (!sheetName) throw new Error('无法识别大库统计表，需要“商品名称、型号、数量、产地”四列')

const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true })
const headers = new Map((matrix[0] || []).map((value, index) => [String(value).trim(), index]))
const nameColumn = headers.get('商品名称')
const sizeColumn = headers.get('型号')
const quantityColumn = headers.get('数量')
const internalCodeColumn = headers.get('产地')
if ([nameColumn, sizeColumn, quantityColumn, internalCodeColumn].some(index => index === undefined)) {
  throw new Error('大库统计表表头不正确')
}

const rows = []
for (let index = 1; index < matrix.length; index += 1) {
  const row = matrix[index]
  const name = String(row[nameColumn] ?? '').trim()
  const size = String(row[sizeColumn] ?? '').trim()
  const quantityText = String(row[quantityColumn] ?? '').trim().replace(/,/g, '')
  const internalCode = String(row[internalCodeColumn] ?? '').trim()
  if (!name && !size && !quantityText && !internalCode) continue
  rows.push({ name, size, quantity: Number(quantityText), internalCode, rowNumber: index + 1 })
}

const { diagnostics, summary } = buildWarehouseInventoryPlan(rows, listProducts(), {
  productMappings: listInventoryProductMappings()
})
const saved = replaceInventoryImportMatches(diagnostics.matchedGroups, {
  sourceFileName: basename(sourcePath)
})

console.log(JSON.stringify({
  sourceFile: basename(sourcePath),
  sourceRows: rows.length,
  sourceGroups: summary.sourceGroups,
  matchedSourceGroups: saved.length,
  matchedProducts: new Set(saved.map(item => item.productId)).size,
  unmatchedRows: diagnostics.unmatchedRows.length
}, null, 2))
