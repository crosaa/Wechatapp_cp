// 库存以系统（ERPNext 总仓）为准（用户 2026-11-20）：/api/erp/stock with ERP_STOCK_SYNC_TOKEN set — token checked, stock
// applied per 颜色/尺码 (partial and full), the 库存表 upload refused, and the product editor neither writes stock back
// nor fails its revision check because the ERP changed stock meanwhile.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const token = 'erp-sync-test-token-0123456789abcdef'
const workspace = mkdtempSync(join(tmpdir(), 'purun-erp-stock-'))
const port = 3189
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server/server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: join(workspace, 'data'),
    UPLOADS_DIR: join(workspace, 'uploads'),
    INVENTORY_REPORTS_DIR: join(workspace, 'inventory-reports'),
    ADMIN_USERNAME: 'test-owner',
    ADMIN_PASSWORD: 'test-password',
    SESSION_SECRET: 'test-session-secret',
    ERP_STOCK_SYNC_TOKEN: token,
    IMAGE_RERANK_BASE_URL: '',
    IMAGE_RERANK_API_KEY: '',
    VISUAL_EMBEDDING_API_KEY: '',
    NODE_ENV: 'test'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

async function request(path, options = {}, cookie = '') {
  const response = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    ...options
  })
  return { response, body: await response.json() }
}

const erp = (body, supplied = token) => request('/api/erp/stock', {
  method: 'POST', headers: { 'x-erp-token': supplied }, body: JSON.stringify(body)
})

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'test-owner', password: 'test-password' }) })
  const cookie = login.response.headers.get('set-cookie').split(';')[0]
  const created = await request('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({ code: 'ERP-001', name: '同步测试', category: '测试分类', price: 99, status: 'published',
      colors: ['黑色', '藏蓝色'], sizes: ['M', 'L'], colorSizeStocks: { 黑色: { M: 5, L: 5 }, 藏蓝色: { M: 5, L: 5 } } })
  }, cookie)
  assert.equal(created.response.status, 201)
  const id = created.body.data.id
  const stockOf = async () => (await request(`/api/admin/products/${id}`, {}, cookie)).body.data

  assert.equal((await erp({ cells: [] }, 'wrong-token')).response.status, 401)

  const partial = await erp({ cells: [{ productId: id, color: '黑色', size: 'M', qty: 2 }, { productId: id, color: '红色', size: 'M', qty: 9 }] })
  assert.equal(partial.response.status, 200)
  assert.equal(partial.body.data.productsUpdated, 1)
  assert.equal(partial.body.data.cellsUpdated, 1)
  assert.deepEqual(partial.body.data.unknownCells, ['ERP-001 红色/M'])
  let product = await stockOf()
  assert.deepEqual(product.colorSizeStocks, { 黑色: { M: 2, L: 5 }, 藏蓝色: { M: 5, L: 5 } })
  assert.equal(product.stock, 17)
  // the public catalogue shows it at once
  const publicProduct = (await request(`/api/products/${id}`)).body.data
  assert.equal(publicProduct.colorSizeStocks.黑色.M, 2)

  const full = await erp({ full: true, cells: [{ productId: id, color: '藏蓝色', size: 'L', qty: 7 }, { productId: id, color: '黑色', size: 'L', qty: -3 }] })
  assert.equal(full.body.data.productsUpdated, 1)
  product = await stockOf()
  assert.deepEqual(product.colorSizeStocks, { 黑色: { M: 0, L: 0 }, 藏蓝色: { M: 0, L: 7 } })
  assert.equal((await erp({ cells: [{ productId: id, color: '藏蓝色', size: 'L', qty: 7 }] })).body.data.productsUpdated, 0)
  assert.deepEqual((await erp({ cells: [{ productId: 999999, color: '黑色', size: 'M', qty: 1 }] })).body.data.unknownProducts, [999999])

  const upload = await request('/api/admin/inventory/import', { method: 'POST', body: JSON.stringify({ fileName: 'x.xlsx', file: '' }) }, cookie)
  assert.equal(upload.response.status, 409)
  assert.match(upload.body.error, /不再上传库存表/)

  // an editor opened before the ERP's last change still saves, and its stale stock is not written back
  const opened = await stockOf()
  await erp({ cells: [{ productId: id, color: '黑色', size: 'M', qty: 4 }] })
  const saved = await request(`/api/admin/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...opened, name: '同步测试（改名）', expectedRevision: opened.revision, colorSizeStocks: { 黑色: { M: 100, L: 100 }, 藏蓝色: { M: 100, L: 100 } } })
  }, cookie)
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.data.name, '同步测试（改名）')
  assert.deepEqual(saved.body.data.colorSizeStocks, { 黑色: { M: 4, L: 0 }, 藏蓝色: { M: 0, L: 7 } })

  // 货位 from the ERP; the editor sees the product as ERP-managed and cannot write 货位 or stock back
  const located = await erp({ locations: [{ productId: id, location: 'F区11-1/2' }, { productId: 999999, location: 'x' }] })
  assert.equal(located.body.data.locations.productsUpdated, 1)
  assert.deepEqual(located.body.data.locations.unknownProducts, [999999])
  const managed = await stockOf()
  assert.equal(managed.subtitle, 'F区11-1/2')
  assert.equal(managed.erpManaged, true)
  assert.equal((await request(`/api/products/${id}`)).body.data.subtitle, 'F区11-1/2')
  const editorSave = await request(`/api/admin/products/${id}`, {
    method: 'PUT', body: JSON.stringify({ ...managed, subtitle: '手改货位', expectedRevision: managed.revision })
  }, cookie)
  assert.equal(editorSave.response.status, 200)
  assert.equal(editorSave.body.data.subtitle, 'F区11-1/2')

  // a product only the mini program has stays editable: stock and 货位 as before
  const own = await request('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({ code: 'MINI-ONLY', name: '只在小程序', category: '测试分类', price: 1, status: 'draft',
      colors: ['黑色'], sizes: ['M'], colorSizeStocks: { 黑色: { M: 1 } } })
  }, cookie)
  const ownProduct = (await request(`/api/admin/products/${own.body.data.id}`, {}, cookie)).body.data
  assert.equal(ownProduct.erpManaged, undefined)
  const ownSave = await request(`/api/admin/products/${own.body.data.id}`, {
    method: 'PUT', body: JSON.stringify({ ...ownProduct, subtitle: 'Z1', colorSizeStocks: { 黑色: { M: 8 } }, expectedRevision: ownProduct.revision })
  }, cookie)
  assert.equal(ownSave.body.data.subtitle, 'Z1')
  assert.equal(ownSave.body.data.colorSizeStocks.黑色.M, 8)

  console.log('ERP 库存同步验证通过：令牌校验、按颜色尺码更新（部分/全量）、货位同步、公开目录即时可见、库存表上传已关闭、ERP 商品的库存和货位不能在后台改、只在小程序的商品照常可改')
} finally {
  child.kill()
  await new Promise(resolve => child.once('exit', resolve))
  rmSync(workspace, { recursive: true, force: true })
}
