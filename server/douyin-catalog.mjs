// Short-lived read-only connection: never run the API's schema migrations or acquire a write lock.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const object = text => {
  try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
const array = text => { try { const value = JSON.parse(text || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
const quantity = value => Math.max(0, Math.trunc(Number(value) || 0))

export function listDouyinCatalogProducts() {
  const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)))
  const db = new DatabaseSync(resolve(dataDir, 'catalog.db'), { readOnly: true })
  try {
    return db.prepare('SELECT id, code, name, colors_json, sizes_json, size_stocks_json, color_size_stocks_json FROM products').all().map(row => {
      const colors = array(row.colors_json), sizes = array(row.sizes_json)
      const matrix = object(row.color_size_stocks_json), legacy = object(row.size_stocks_json)
      const hasMatrix = Object.keys(matrix).length > 0
      const colorSizeStocks = Object.fromEntries(colors.map((color, index) => {
        const source = matrix[color] && typeof matrix[color] === 'object' && !Array.isArray(matrix[color]) ? matrix[color] : {}
        return [color,
        Object.fromEntries(sizes.map(size => {
          const total = quantity(legacy[size])
          const amount = hasMatrix ? quantity(source[size])
            : Math.floor(total / colors.length) + (index < total % colors.length ? 1 : 0)
          return [size, amount]
        }))
      ] }))
      return { id: row.id, code: row.code, name: row.name, colorSizeStocks }
    })
  } finally { db.close() }
}
