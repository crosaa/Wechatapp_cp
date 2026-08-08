import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import XLSX from 'xlsx'

const detailHeaders = [
  '来源类型', '来源行号', '货位', '款号', '商品名称', '颜色', '尺码/型号', '库存数量',
  '来源内部编码', '未匹配原因', '候选款号', '候选商品', '商品现有颜色', '商品现有尺码'
]

function safeText(value) {
  return String(value ?? '').trim().slice(0, 500)
}

function safeStem(value) {
  return safeText(value || '库存表').replace(/\.xlsx$/iu, '').replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_').slice(0, 48) || '库存表'
}

function timestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function createUnmatchedInventoryReport({ rows, format, sourceFileName, outputDir }) {
  if (!Array.isArray(rows) || !rows.length) return null
  mkdirSync(outputDir, { recursive: true })
  const sourceType = format === 'warehouse' ? '大库统计表' : '简洁模板'
  const fileName = `未匹配产品_${safeStem(sourceFileName)}_${timestamp()}_${randomUUID().slice(0, 6)}.xlsx`
  const workbook = XLSX.utils.book_new()
  workbook.Props = { Title: '未匹配产品另存表', Subject: '库存覆盖导入未匹配明细', Author: '普润制衣商品后台' }

  const noteSheet = XLSX.utils.aoa_to_sheet([
    ['未匹配产品另存表', ''],
    ['来源文件', safeText(sourceFileName || '未提供文件名')],
    ['来源格式', sourceType],
    ['生成时间', new Date().toLocaleString('zh-CN', { hour12: false })],
    ['未匹配明细', rows.length],
    ['处理结果', '匹配成功的商品已按覆盖规则写入；本表记录未写入的来源明细。'],
    ['说明', '请核对款号、商品名称、颜色和尺码后，修正原表再重新导入。'],
  ])
  noteSheet['!cols'] = [{ wch: 18 }, { wch: 76 }]
  XLSX.utils.book_append_sheet(workbook, noteSheet, '导入说明')

  const detailRows = rows.slice().sort((left, right) => Number(left.rowNumber || 0) - Number(right.rowNumber || 0)).map(row => [
    row.sourceFormat === 'warehouse' || format === 'warehouse' ? '大库统计表' : '简洁模板',
    Number(row.rowNumber) || '',
    safeText(row.location),
    safeText(row.code),
    safeText(row.name),
    safeText(row.color),
    safeText(row.size),
    Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : safeText(row.quantity),
    safeText(row.internalCode),
    safeText(row.reason),
    safeText(row.candidateCode),
    safeText(row.candidateName),
    Array.isArray(row.productColors) ? row.productColors.join('、') : safeText(row.productColors),
    Array.isArray(row.productSizes) ? row.productSizes.join('、') : safeText(row.productSizes),
  ])
  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows])
  detailSheet['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 42 }, { wch: 22 }, { wch: 18 },
    { wch: 14 }, { wch: 22 }, { wch: 34 }, { wch: 20 }, { wch: 40 }, { wch: 44 }, { wch: 44 }
  ]
  detailSheet['!autofilter'] = { ref: `A1:N${detailRows.length + 1}` }
  XLSX.utils.book_append_sheet(workbook, detailSheet, '未匹配产品')

  writeFileSync(join(outputDir, fileName), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }))
  return { count: rows.length, fileName }
}

export { detailHeaders }
