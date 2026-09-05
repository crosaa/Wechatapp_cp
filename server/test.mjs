import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import XLSX from 'xlsx'
import sharp from 'sharp'
import { buildWarehouseInventoryPlan } from './warehouse-inventory.mjs'

const colorCodePlan = buildWarehouseInventoryPlan([
  { name: '8288黑色（索罗纳）-XF', size: 'S', quantity: 1, internalCode: '', rowNumber: 2 },
  { name: '8288白色（索罗纳）-XF', size: 'S', quantity: 2, internalCode: '', rowNumber: 3 },
  { name: '8288青蓝（索罗纳）-XF', size: 'S', quantity: 3, internalCode: '', rowNumber: 4 },
  { name: '8288铁灰（索罗纳）-XF', size: 'S', quantity: 4, internalCode: '', rowNumber: 5 }
], [{
  id: 8288,
  code: '8288-XF',
  name: '8288索罗纳（凉感）',
  colors: ['黑色', '白色', '青蓝色', '铁灰色'],
  sizes: ['S', 'M']
}])
const colorCodeChange = colorCodePlan.changes[0]
assert.equal(colorCodePlan.summary.matchedProducts, 1)
assert.equal(colorCodePlan.summary.unmatchedRowsCount, 0)
assert.equal(colorCodeChange.colorSizeStocks.黑色.S, 1)
assert.equal(colorCodeChange.colorSizeStocks.白色.S, 2)
assert.equal(colorCodeChange.colorSizeStocks.青蓝色.S, 3)
assert.equal(colorCodeChange.colorSizeStocks.铁灰色.S, 4)

const manualMappingProducts = [{
  id: 9001,
  code: 'MANUAL-9001',
  name: '数据库标准商品',
  colors: ['黑色'],
  sizes: ['M', 'L']
}]
const manualMappingRows = [
  { name: '仓库专用别名', size: 'M', quantity: 7, internalCode: '内部-01', rowNumber: 2 }
]
const withoutManualMapping = buildWarehouseInventoryPlan(manualMappingRows, manualMappingProducts)
assert.equal(withoutManualMapping.summary.matchedProducts, 0)
const withManualMapping = buildWarehouseInventoryPlan(manualMappingRows, manualMappingProducts, {
  productMappings: [{ sourceName: '仓库专用别名', sourceInternalCode: '', productId: 9001 }]
})
assert.equal(withManualMapping.summary.manualMappedGroups, 1)
assert.equal(withManualMapping.summary.matchedProducts, 1)
assert.equal(withManualMapping.summary.unmatchedRowsCount, 0)
assert.equal(withManualMapping.changes[0].colorSizeStocks.黑色.M, 7)

const sameCodeVariantProducts = [{
  id: 680011,
  code: '68001-4A3F46',
  name: '68001夏短（上衣）',
  colors: ['银灰'],
  sizes: ['L']
}, {
  id: 680012,
  code: '68001-9A0C9C',
  name: '68001夏短套装',
  colors: ['银灰'],
  sizes: ['L']
}]
const sameCodeVariantPlan = buildWarehouseInventoryPlan([
  { name: '68001夏短（上衣）银灰', size: 'L', quantity: 7, internalCode: 'A-01', rowNumber: 2 },
  { name: '68001夏短套装银灰', size: 'L', quantity: 11, internalCode: 'A-02', rowNumber: 3 }
], sameCodeVariantProducts)
const upperVariantChange = sameCodeVariantPlan.changes.find(change => change.product.id === 680011)
const regularVariantChange = sameCodeVariantPlan.changes.find(change => change.product.id === 680012)
assert.equal(sameCodeVariantPlan.summary.matchedProducts, 2)
assert.equal(sameCodeVariantPlan.summary.unmatchedRowsCount, 0)
assert.equal(upperVariantChange.colorSizeStocks.银灰.L, 7)
assert.equal(regularVariantChange.colorSizeStocks.银灰.L, 11)
assert.equal(sameCodeVariantPlan.diagnostics.matchedGroups.filter(group => group.sourceName.includes('上衣')).length, 1)
assert.equal(sameCodeVariantPlan.diagnostics.matchedGroups.filter(group => group.sourceName.includes('套装')).length, 1)

const manualSameCodeVariantPlan = buildWarehouseInventoryPlan([
  { name: '68001仓库旧名称银灰', size: 'L', quantity: 9, internalCode: 'A-03', rowNumber: 2 }
], sameCodeVariantProducts, {
  productMappings: [{
    sourceName: '68001仓库旧名称银灰',
    sourceInternalCode: 'A-03',
    productId: 680011,
    targetColor: '银灰'
  }]
})
assert.equal(manualSameCodeVariantPlan.summary.matchedProducts, 1)
assert.equal(manualSameCodeVariantPlan.summary.manualMappedGroups, 1)
assert.equal(manualSameCodeVariantPlan.changes.find(change => change.product.id === 680011).colorSizeStocks.银灰.L, 9)
assert.equal(manualSameCodeVariantPlan.changes.find(change => change.product.id === 680012).colorSizeStocks.银灰.L, 0)

const workspace = mkdtempSync(join(tmpdir(), 'purun-api-'))
const port = 3187
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
    NODE_ENV: 'test'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('测试服务未能启动')
}

async function request(path, options = {}, cookie = '') {
  const response = await fetch(`${base}${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {})
    },
    ...options
  })
  const body = await response.json()
  return { response, body }
}

async function readReport(report, cookie) {
  assert.ok(report?.url)
  const denied = await fetch(`${base}${report.url}`)
  assert.equal(denied.status, 401)
  const response = await fetch(`${base}${report.url}`, { headers: { cookie } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /spreadsheetml/)
  assert.match(response.headers.get('content-disposition'), /attachment/)
  return XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' })
}

try {
  await waitForServer()

  const health = await request('/api/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.body.ok, true)

  const initialDataVersion = await request('/api/data-version')
  assert.equal(initialDataVersion.response.status, 200)
  assert.ok(initialDataVersion.body.data.version)
  assert.match(initialDataVersion.response.headers.get('cache-control'), /no-store/)

  const publicList = await request('/api/products')
  assert.equal(publicList.response.status, 200)
  assert.ok(publicList.body.data.length >= 4)

  const publicSummaryList = await request('/api/products?view=summary')
  assert.equal(publicSummaryList.response.status, 200)
  assert.equal(publicSummaryList.body.data.length, publicList.body.data.length)
  assert.ok(publicSummaryList.body.data[0].image)
  assert.ok(publicSummaryList.body.data[0].previewImage)
  assert.equal('posterImage' in publicSummaryList.body.data[0], true)
  assert.equal('detailImages' in publicSummaryList.body.data[0], false)
  assert.equal('colorSizeStocks' in publicSummaryList.body.data[0], false)

  const removedLogin = await request('/api/miniapp/login', {
    method: 'POST',
    body: JSON.stringify({ code: 'unused' })
  })
  assert.equal(removedLogin.response.status, 404)
  const removedFavorites = await request('/api/miniapp/favorites')
  assert.equal(removedFavorites.response.status, 404)

  const templateResponse = await fetch(`${base}/admin/templates/product-inventory-template.xlsx`)
  assert.equal(templateResponse.status, 200)
  assert.match(templateResponse.headers.get('content-type'), /spreadsheetml/)
  const templateBuffer = Buffer.from(await templateResponse.arrayBuffer())
  assert.ok(templateBuffer.byteLength > 1000)
  const templateWorkbook = XLSX.read(templateBuffer, { type: 'buffer' })
  assert.deepEqual(templateWorkbook.SheetNames, ['库存导入'])
  const templateRows = XLSX.utils.sheet_to_json(templateWorkbook.Sheets['库存导入'], { header: 1, defval: '' })
  assert.deepEqual(templateRows[0], ['货位', '款号*', '颜色*', '尺码*', '库存数量*'])

  const denied = await request('/api/admin/products')
  assert.equal(denied.response.status, 401)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ username: 'rate-limit-test', password: 'wrong-password' })
    })
    assert.equal(failedLogin.response.status, 401)
  }
  const blockedLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.77' },
    body: JSON.stringify({ username: 'rate-limit-test', password: 'wrong-password' })
  })
  assert.equal(blockedLogin.response.status, 429)
  assert.ok(Number(blockedLogin.response.headers.get('retry-after')) > 0)

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'test-owner', password: 'test-password' })
  })
  assert.equal(login.response.status, 200)
  assert.equal(login.body.data.username, 'test-owner')
  assert.equal(login.body.data.role, 'owner')
  const cookie = login.response.headers.get('set-cookie').split(';')[0]

  const currentAdmin = await request('/api/auth/me', {}, cookie)
  assert.equal(currentAdmin.response.status, 200)
  assert.deepEqual(currentAdmin.body.data, {
    id: login.body.data.id,
    username: 'test-owner',
    role: 'owner'
  })

  const initialAdminUsers = await request('/api/admin/users', {}, cookie)
  assert.equal(initialAdminUsers.response.status, 200)
  assert.equal(initialAdminUsers.body.data.length, 1)
  assert.equal(initialAdminUsers.body.data[0].role, 'owner')
  assert.equal('passwordHash' in initialAdminUsers.body.data[0], false)
  assert.equal('passwordSalt' in initialAdminUsers.body.data[0], false)

  const tooShortAdminPassword = await request('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'too_short', password: '12345' })
  }, cookie)
  assert.equal(tooShortAdminPassword.response.status, 400)
  assert.match(tooShortAdminPassword.body.error, /至少需要6位/)

  const createdAdmin = await request('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'warehouse01', password: 'simplepw' })
  }, cookie)
  assert.equal(createdAdmin.response.status, 201)
  assert.equal(createdAdmin.body.data.username, 'warehouse01')
  assert.equal(createdAdmin.body.data.role, 'admin')
  assert.equal('passwordHash' in createdAdmin.body.data, false)

  const duplicateAdmin = await request('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'WAREHOUSE01', password: 'simplepw' })
  }, cookie)
  assert.equal(duplicateAdmin.response.status, 409)

  const chineseNameAdmin = await request('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: '张三', password: '123456' })
  }, cookie)
  assert.equal(chineseNameAdmin.response.status, 201)
  assert.equal(chineseNameAdmin.body.data.username, '张三')
  const chineseNameLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: '张三', password: '123456' })
  })
  assert.equal(chineseNameLogin.response.status, 200)
  const removedChineseNameAdmin = await request(`/api/admin/users/${chineseNameAdmin.body.data.id}`, { method: 'DELETE' }, cookie)
  assert.equal(removedChineseNameAdmin.response.status, 200)

  const normalLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'warehouse01', password: 'simplepw' })
  })
  assert.equal(normalLogin.response.status, 200)
  const normalCookie = normalLogin.response.headers.get('set-cookie').split(';')[0]
  const normalProducts = await request('/api/admin/products', {}, normalCookie)
  assert.equal(normalProducts.response.status, 200)
  const normalInventoryAccess = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({})
  }, normalCookie)
  assert.equal(normalInventoryAccess.response.status, 400)
  const forbiddenAccountManagement = await request('/api/admin/users', {}, normalCookie)
  assert.equal(forbiddenAccountManagement.response.status, 403)

  const resetAdminPassword = await request(`/api/admin/users/${createdAdmin.body.data.id}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password: '123456' })
  }, cookie)
  assert.equal(resetAdminPassword.response.status, 200)
  const revokedNormalSession = await request('/api/admin/products', {}, normalCookie)
  assert.equal(revokedNormalSession.response.status, 401)
  const oldPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'warehouse01', password: 'simplepw' })
  })
  assert.equal(oldPasswordLogin.response.status, 401)
  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'warehouse01', password: '123456' })
  })
  assert.equal(newPasswordLogin.response.status, 200)
  const newNormalCookie = newPasswordLogin.response.headers.get('set-cookie').split(';')[0]

  const cannotDeleteOwner = await request(`/api/admin/users/${login.body.data.id}`, { method: 'DELETE' }, cookie)
  assert.equal(cannotDeleteOwner.response.status, 400)
  const removedAdmin = await request(`/api/admin/users/${createdAdmin.body.data.id}`, { method: 'DELETE' }, cookie)
  assert.equal(removedAdmin.response.status, 200)
  const removedAdminSession = await request('/api/admin/products', {}, newNormalCookie)
  assert.equal(removedAdminSession.response.status, 401)
  const removedAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'warehouse01', password: '123456' })
  })
  assert.equal(removedAdminLogin.response.status, 401)

  const noLatestReport = await request('/api/admin/inventory/reports/latest', {}, cookie)
  assert.equal(noLatestReport.response.status, 404)
  assert.match(noLatestReport.body.error, /暂无未匹配表格/)
  const noLatestDetails = await request('/api/admin/inventory/reports/latest/details', {}, cookie)
  assert.equal(noLatestDetails.response.status, 404)

  const created = await request('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      code: 'TEST-001',
      name: '接口测试商品',
      category: '测试分类',
      categories: ['测试分类', '圆领T恤'],
      displayCategory: '独立测试品类',
      price: 99,
      unit: '件',
      fit: '标准版型',
      status: 'draft',
      colors: ['黑色', '白色'],
      sizes: ['M', 'L'],
      specialSizePrices: [{ fromSize: 'L', toSize: 'L', price: 109 }],
      colorSizeStocks: { 黑色: { M: 5, L: 1 }, 白色: { M: 0, L: 6 } },
      detailText: '测试商品详情文案'
    })
  }, cookie)
  assert.equal(created.response.status, 201)
  assert.equal(created.body.data.status, 'draft')
  assert.equal(created.body.data.stock, 12)
  assert.deepEqual(created.body.data.sizeStocks, { M: 5, L: 7 })
  assert.deepEqual(created.body.data.colorSizeStocks, { 黑色: { M: 5, L: 1 }, 白色: { M: 0, L: 6 } })
  assert.equal(created.body.data.detailText, '测试商品详情文案')
  assert.equal(created.body.data.displayCategory, '独立测试品类')
  assert.equal(created.body.data.fit, '标准版型')
  assert.deepEqual(created.body.data.categories, ['测试分类', '圆领T恤'])
  assert.deepEqual(created.body.data.specialSizePrices, [{ fromSize: 'L', toSize: 'L', price: 109 }])

  const productsBeforeGlobalReorder = await request('/api/admin/products', {}, cookie)
  const originalProductOrder = productsBeforeGlobalReorder.body.data.map(product => product.id)
  const reversedProductOrder = [...originalProductOrder].reverse()
  const globallyReorderedProducts = await request('/api/admin/products/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids: reversedProductOrder })
  }, cookie)
  assert.equal(globallyReorderedProducts.response.status, 200)
  assert.deepEqual(globallyReorderedProducts.body.data.map(product => product.id), reversedProductOrder)
  const restoredGlobalProductOrder = await request('/api/admin/products/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids: originalProductOrder })
  }, cookie)
  assert.equal(restoredGlobalProductOrder.response.status, 200)
  assert.deepEqual(restoredGlobalProductOrder.body.data.map(product => product.id), originalProductOrder)

  const uploaded = await request('/api/admin/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'pixel.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    })
  }, cookie)
  assert.equal(uploaded.response.status, 201)
  assert.match(uploaded.body.url, /^\/uploads\/.+\.png$/)
  assert.equal(uploaded.body.optimization.width, 1)
  assert.equal(uploaded.body.optimization.height, 1)

  const uploadedMetadata = await request(`/api/admin/image-metadata?url=${encodeURIComponent(uploaded.body.url)}`, {}, cookie)
  assert.equal(uploadedMetadata.response.status, 200)
  assert.equal(uploadedMetadata.body.data.width, 1)
  assert.equal(uploadedMetadata.body.data.height, 1)
  assert.ok(uploadedMetadata.body.data.bytes > 0)

  const oversizedImage = await sharp({
    create: {
      width: 2400,
      height: 300,
      channels: 3,
      background: { r: 90, g: 140, b: 190 }
    }
  }).jpeg({ quality: 95 }).toBuffer()
  const optimizedUpload = await request('/api/admin/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'oversized.jpg',
      dataUrl: `data:image/jpeg;base64,${oversizedImage.toString('base64')}`
    })
  }, cookie)
  assert.equal(optimizedUpload.response.status, 201)
  assert.equal(optimizedUpload.body.optimization.sourceWidth, 2400)
  assert.equal(optimizedUpload.body.optimization.width, 2000)
  assert.equal(optimizedUpload.body.optimization.height, 250)
  assert.equal(optimizedUpload.body.optimization.changed, true)

  const categoryUpload = await request('/api/admin/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'category.jpg',
      purpose: 'category',
      mode: 'auto',
      dataUrl: `data:image/jpeg;base64,${oversizedImage.toString('base64')}`
    })
  }, cookie)
  assert.equal(categoryUpload.response.status, 201)
  assert.match(categoryUpload.body.url, /^\/uploads\/.+\.webp$/)
  assert.equal(categoryUpload.body.optimization.width, 640)
  assert.equal(categoryUpload.body.optimization.purpose, 'category')

  const originalUpload = await request('/api/admin/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'original.jpg',
      purpose: 'product',
      mode: 'original',
      dataUrl: `data:image/jpeg;base64,${oversizedImage.toString('base64')}`
    })
  }, cookie)
  assert.equal(originalUpload.response.status, 201)
  assert.equal(originalUpload.body.optimization.width, 2400)
  assert.equal(originalUpload.body.optimization.height, 300)
  assert.equal(originalUpload.body.optimization.mode, 'original')
  assert.equal(originalUpload.body.optimization.changed, false)
  const originalImageResponse = await fetch(`${base}${originalUpload.body.url}`)
  assert.equal(originalImageResponse.status, 200)
  assert.match(originalImageResponse.headers.get('cache-control'), /max-age=2592000/)
  assert.match(originalImageResponse.headers.get('cache-control'), /immutable/)

  const categoryThumbnailResponse = await fetch(`${base}/api/product-thumbnail?src=${encodeURIComponent(categoryUpload.body.url)}&size=200`)
  assert.equal(categoryThumbnailResponse.status, 200)
  const categoryThumbnailMetadata = await sharp(Buffer.from(await categoryThumbnailResponse.arrayBuffer())).metadata()
  assert.equal(categoryThumbnailMetadata.width, 200)
  assert.equal(categoryThumbnailMetadata.format, 'webp')

  const displayThumbnailResponse = await fetch(`${base}/api/product-thumbnail?src=${encodeURIComponent(originalUpload.body.url)}&size=1200&fit=width`)
  assert.equal(displayThumbnailResponse.status, 200)
  const displayThumbnailMetadata = await sharp(Buffer.from(await displayThumbnailResponse.arrayBuffer())).metadata()
  assert.equal(displayThumbnailMetadata.width, 1200)
  assert.equal(displayThumbnailMetadata.height, 150)
  assert.equal(displayThumbnailMetadata.format, 'webp')

  const previewThumbnailResponse = await fetch(`${base}/api/product-thumbnail?src=${encodeURIComponent(originalUpload.body.url)}&size=2000&fit=width`)
  assert.equal(previewThumbnailResponse.status, 200)
  assert.match(previewThumbnailResponse.headers.get('cache-control'), /immutable/)
  const previewThumbnailMetadata = await sharp(Buffer.from(await previewThumbnailResponse.arrayBuffer())).metadata()
  assert.equal(previewThumbnailMetadata.width, 2000)
  assert.equal(previewThumbnailMetadata.height, 250)
  assert.equal(previewThumbnailMetadata.format, 'webp')

  const cleanupUpload = await request('/api/admin/uploads', {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'cleanup.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    })
  }, cookie)
  assert.equal(cleanupUpload.response.status, 201)
  const cleanupProduct = await request('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      code: 'CLEANUP-001',
      name: '待删除图片测试商品',
      category: '圆领T恤',
      price: 1,
      status: 'draft',
      colors: ['黑色'],
      sizes: ['M'],
      images: [cleanupUpload.body.url]
    })
  }, cookie)
  assert.equal(cleanupProduct.response.status, 201)
  assert.equal((await fetch(`${base}${cleanupUpload.body.url}`)).status, 200)
  const cleanupProductRemoved = await request(`/api/admin/products/${cleanupProduct.body.data.id}`, { method: 'DELETE' }, cookie)
  assert.equal(cleanupProductRemoved.response.status, 200)
  assert.equal((await fetch(`${base}${cleanupUpload.body.url}`)).status, 404)

  const categoryList = await request('/api/admin/categories', {}, cookie)
  assert.equal(categoryList.response.status, 200)
  const testCategory = categoryList.body.data.find(category => category.name === '测试分类')
  assert.ok(testCategory)
  const renamedCategory = await request(`/api/admin/categories/${testCategory.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '测试分类改名', image: uploaded.body.url })
  }, cookie)
  assert.equal(renamedCategory.response.status, 200)
  assert.equal(renamedCategory.body.data.name, '测试分类改名')
  assert.equal(renamedCategory.body.data.image, uploaded.body.url)

  const reorderedIds = categoryList.body.data.map(category => category.id).reverse()
  const reorderedCategories = await request('/api/admin/categories/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids: reorderedIds })
  }, cookie)
  assert.equal(reorderedCategories.response.status, 200)
  assert.equal(reorderedCategories.body.data[0].id, reorderedIds[0])

  const arrivalCategory = reorderedCategories.body.data.find(category => category.name === '当季上新')
  assert.equal(arrivalCategory.type, 'normal')
  const arrivalProductIds = arrivalCategory.productIds.slice().reverse()
  const reorderedProducts = await request(`/api/admin/categories/${arrivalCategory.id}/products/reorder`, {
    method: 'POST',
    body: JSON.stringify({ ids: arrivalProductIds })
  }, cookie)
  assert.equal(reorderedProducts.response.status, 200)
  assert.deepEqual(reorderedProducts.body.data.productIds, arrivalProductIds)

  const newCategory = await request('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify({ name: '新增测试分类' })
  }, cookie)
  assert.equal(newCategory.response.status, 201)
  assert.equal(newCategory.body.data.name, '新增测试分类')
  assert.deepEqual(newCategory.body.data.productIds, [])

  const deletedEmptyCategory = await request(`/api/admin/categories/${newCategory.body.data.id}`, { method: 'DELETE' }, cookie)
  assert.equal(deletedEmptyCategory.response.status, 200)
  assert.equal(deletedEmptyCategory.body.data.name, '新增测试分类')
  assert.equal(deletedEmptyCategory.body.data.affectedProducts, 0)

  const renamedArrivalCategory = await request(`/api/admin/categories/${arrivalCategory.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '测试当季名称' })
  }, cookie)
  assert.equal(renamedArrivalCategory.response.status, 200)
  assert.equal(renamedArrivalCategory.body.data.name, '测试当季名称')
  assert.equal(renamedArrivalCategory.body.data.type, 'normal')
  const publicCategoriesAfterArrivalRename = await request('/api/categories')
  assert.equal(publicCategoriesAfterArrivalRename.body.data.find(category => category.key === 'seasonal').name, '测试当季名称')

  const deletedArrivalCategory = await request(`/api/admin/categories/${arrivalCategory.id}`, { method: 'DELETE' }, cookie)
  assert.equal(deletedArrivalCategory.response.status, 200)
  assert.equal(deletedArrivalCategory.body.data.name, '测试当季名称')
  assert.ok(deletedArrivalCategory.body.data.affectedProducts >= 1)

  const renamedProducts = await request('/api/admin/products', {}, cookie)
  const renamedProduct = renamedProducts.body.data.find(product => product.id === created.body.data.id)
  assert.equal(renamedProduct.category, '测试分类改名')
  assert.equal(renamedProduct.displayCategory, '独立测试品类')
  assert.deepEqual(renamedProduct.categories, ['测试分类改名', '圆领T恤'])

  const storeSettings = await request('/api/admin/store-settings', {
    method: 'PUT',
    body: JSON.stringify({
      storeName: '测试店铺',
      storeIcon: uploaded.body.url,
      homeHeroImage: uploaded.body.url,
      homeHeroImages: [uploaded.body.url, ...Array.from({ length: 10 }, (_, index) => `/images/hero-${index + 1}.jpg`)],
      homeHeroImageMode: 'aspectFill',
      homeEyebrow: 'B2B WHOLESALE',
      homeSubtitle: '测试首页说明',
      searchPlaceholder: '搜索测试商品',
      heroNote: '测试轮播说明',
      categoryTitle: '测试分类标题',
      categorySubtitle: 'TEST CATEGORY',
      categoryMoreText: '全部商品 →',
      homeServices: ['测试服务一', '测试服务二'],
      profileLayout: 'brand',
      profilePageTitle: '服务中心',
      profileTitle: '测试品牌服务中心',
      profileSubtitle: '团购与定制',
      serviceTitle: '特色服务',
      services: ['团购咨询', '图案设计'],
      profileAboutTitle: '测试关于标题',
      productFeatures: ['测试卖点一', '测试卖点二'],
      aboutText: '测试店铺介绍',
      footerText: '测试页脚'
    })
  }, cookie)
  assert.equal(storeSettings.response.status, 200)
  assert.equal(storeSettings.body.data.storeName, '测试店铺')
  assert.equal(storeSettings.body.data.profileLayout, 'brand')
  assert.deepEqual(storeSettings.body.data.services, ['团购咨询', '图案设计'])
  assert.deepEqual(storeSettings.body.data.homeServices, ['测试服务一', '测试服务二'])
  assert.deepEqual(storeSettings.body.data.productFeatures, ['测试卖点一', '测试卖点二'])
  assert.equal(storeSettings.body.data.categoryTitle, '测试分类标题')
  assert.equal(storeSettings.body.data.homeHeroImages.length, 11)
  assert.equal(storeSettings.body.data.homeHeroImages[0], uploaded.body.url)
  assert.equal(storeSettings.body.data.homeHeroImageMode, 'aspectFill')

  const invalidImageLink = await request('/api/admin/store-settings', {
    method: 'PUT',
    body: JSON.stringify({ storeIcon: 'http://example.com/insecure.png' })
  }, cookie)
  assert.equal(invalidImageLink.response.status, 400)
  assert.match(invalidImageLink.body.error, /本服务器|外部图片网址/)

  const directExternalImageLink = await request('/api/admin/store-settings', {
    method: 'PUT',
    body: JSON.stringify({ storeIcon: 'https://example.com/external.png' })
  }, cookie)
  assert.equal(directExternalImageLink.response.status, 400)
  assert.match(directExternalImageLink.body.error, /本服务器|外部图片网址/)

  const unsafeImageImport = await request('/api/admin/uploads/from-url', {
    method: 'POST',
    body: JSON.stringify({ url: 'http://example.com/insecure.png' })
  }, cookie)
  assert.equal(unsafeImageImport.response.status, 400)
  assert.match(unsafeImageImport.body.error, /HTTPS/)

  const publicSettings = await request('/api/store-settings')
  assert.equal(publicSettings.response.status, 200)
  assert.equal(publicSettings.body.data.storeIcon, `/api/product-thumbnail?src=${encodeURIComponent(uploaded.body.url)}&size=200`)
  assert.equal(publicSettings.body.data.homeHeroImage, `/api/product-thumbnail?src=${encodeURIComponent(uploaded.body.url)}&size=1200`)
  assert.equal(publicSettings.body.data.homeHeroImages.length, 11)
  assert.equal(publicSettings.body.data.homeHeroImages[0], `/api/product-thumbnail?src=${encodeURIComponent(uploaded.body.url)}&size=1200`)
  assert.equal(publicSettings.body.data.aboutText, '测试店铺介绍')

  const homeContent = await request('/api/home-content')
  assert.equal(homeContent.response.status, 200)
  assert.equal(homeContent.body.data.version, (await request('/api/data-version')).body.data.version)
  assert.ok(Array.isArray(homeContent.body.data.categories))
  assert.equal(homeContent.body.data.storeSettings.storeName, publicSettings.body.data.storeName)
  assert.equal(homeContent.body.data.storeSettings.homeHeroImages.length, 11)

  const catalogContent = await request('/api/catalog-content')
  assert.equal(catalogContent.response.status, 200)
  assert.equal(catalogContent.body.data.version, homeContent.body.data.version)
  assert.ok(Array.isArray(catalogContent.body.data.products))
  assert.ok(Array.isArray(catalogContent.body.data.categories))
  assert.equal(catalogContent.body.data.storeSettings.storeName, publicSettings.body.data.storeName)
  assert.ok(catalogContent.body.data.products.every(product => !Object.hasOwn(product, 'detailImages')))

  const draftPublicProduct = await request(`/api/products/${created.body.data.id}`)
  assert.equal(draftPublicProduct.response.status, 404)

  const updated = await request(`/api/admin/products/${created.body.data.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'published',
      colorSizeStocks: { 黑色: { M: 1, L: 3 }, 白色: { M: 0, L: 0 } },
      images: [uploaded.body.url],
      posterImage: uploaded.body.url,
      colorImages: { 黑色: uploaded.body.url },
      colorGalleries: { 黑色: [uploaded.body.url, '/images/polo-grid.jpg'] },
      detailImages: [uploaded.body.url],
      realImages: [{ url: uploaded.body.url, category: '细节特写' }],
      specialSizePrices: [{ fromSize: 'M', toSize: 'L', price: 119 }],
      displayCategory: '独立修改品类',
      name: '已上架测试商品'
    })
  }, cookie)
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.data.status, 'published')
  assert.equal(updated.body.data.stock, 4)
  assert.deepEqual(updated.body.data.sizeStocks, { M: 1, L: 3 })
  assert.deepEqual(updated.body.data.colorSizeStocks, { 黑色: { M: 1, L: 3 }, 白色: { M: 0, L: 0 } })
  assert.deepEqual(updated.body.data.specialSizePrices, [{ fromSize: 'M', toSize: 'L', price: 119 }])
  assert.equal(updated.body.data.images[0], uploaded.body.url)
  assert.equal(updated.body.data.posterImage, uploaded.body.url)
  assert.equal(updated.body.data.colorImages.黑色, uploaded.body.url)
  assert.deepEqual(updated.body.data.colorGalleries.黑色, [uploaded.body.url, '/images/polo-grid.jpg'])
  assert.equal(updated.body.data.colorImages.白色, undefined)
  assert.deepEqual(updated.body.data.colorGalleries.白色, [])
  assert.equal(updated.body.data.detailImages[0], uploaded.body.url)
  assert.deepEqual(updated.body.data.realImages[0], { url: uploaded.body.url, category: '细节特写' })
  assert.equal(updated.body.data.displayCategory, '独立修改品类')
  assert.equal(updated.body.data.category, '测试分类改名')
  assert.deepEqual(updated.body.data.categories, ['测试分类改名', '圆领T恤'])
  const cachedPublicProductAfterUpdate = await request(`/api/products/${created.body.data.id}`)
  assert.equal(cachedPublicProductAfterUpdate.response.status, 200)
  assert.equal(cachedPublicProductAfterUpdate.body.data.name, '已上架测试商品')

  const overlappingSpecialPrices = await request(`/api/admin/products/${created.body.data.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      specialSizePrices: [
        { fromSize: 'M', toSize: 'L', price: 119 },
        { fromSize: 'L', toSize: 'L', price: 129 }
      ]
    })
  }, cookie)
  assert.equal(overlappingSpecialPrices.response.status, 400)
  assert.match(overlappingSpecialPrices.body.error, /区间不能重叠/)

  const updatedDataVersion = await request('/api/data-version')
  assert.notEqual(updatedDataVersion.body.data.version, initialDataVersion.body.data.version)

  const recognized = await request('/api/products/recognize', {
    method: 'POST',
    body: JSON.stringify({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      limit: 5
    })
  })
  assert.equal(recognized.response.status, 200)
  assert.equal(recognized.body.data[0].id, created.body.data.id)
  assert.ok(recognized.body.data[0].confidence >= 99)

  const inventoryWorkbook = XLSX.utils.book_new()
  const inventorySheet = XLSX.utils.aoa_to_sheet([
    ['货位', '款号*', '颜色*', '尺码*', '库存数量*'],
    ['A区-01-03', 'TEST-001', '黑色', 'M', 6],
    ['Z区-99-99', 'NOT-FOUND-001', '黑色', 'L', 3]
  ])
  XLSX.utils.book_append_sheet(inventoryWorkbook, inventorySheet, '库存导入')
  const inventoryBuffer = XLSX.write(inventoryWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const imported = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ fileName: '简洁库存测试.xlsx', dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(inventoryBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(imported.response.status, 200)
  assert.equal(imported.body.data.applied, true)
  assert.equal(imported.body.data.rowsUpdated, 1)
  assert.equal(imported.body.data.unmatchedRowsCount, 1)
  assert.equal(imported.body.data.productsUpdated, publicList.body.data.length + 1)
  assert.equal(imported.body.data.locationsUpdated, 1)
  assert.equal(imported.body.data.locationsCleared, publicList.body.data.length)
  const templateReport = await readReport(imported.body.data.unmatchedReport, cookie)
  assert.deepEqual(templateReport.SheetNames, ['导入说明', '未匹配产品'])
  const templateReportRows = XLSX.utils.sheet_to_json(templateReport.Sheets['未匹配产品'], { header: 1, defval: '' })
  assert.equal(templateReportRows[0][3], '款号')
  assert.equal(templateReportRows[1][3], 'NOT-FOUND-001')
  assert.match(templateReportRows[1][9], /款号不存在/)
  const latestTemplateReportResponse = await fetch(`${base}/api/admin/inventory/reports/latest`, { headers: { cookie } })
  assert.equal(latestTemplateReportResponse.status, 200)
  const latestTemplateReport = XLSX.read(Buffer.from(await latestTemplateReportResponse.arrayBuffer()), { type: 'buffer' })
  const latestTemplateRows = XLSX.utils.sheet_to_json(latestTemplateReport.Sheets['未匹配产品'], { header: 1, defval: '' })
  assert.equal(latestTemplateRows[1][3], 'NOT-FOUND-001')
  const latestTemplateDetails = await request('/api/admin/inventory/reports/latest/details', {}, cookie)
  assert.equal(latestTemplateDetails.response.status, 200)
  assert.equal(latestTemplateDetails.body.data.total, 1)
  assert.equal(latestTemplateDetails.body.data.rows[0].code, 'NOT-FOUND-001')
  assert.match(latestTemplateDetails.body.data.rows[0].reason, /款号不存在/)
  const importedTestProduct = imported.body.data.products.find(product => product.code === 'TEST-001')
  assert.equal(importedTestProduct.stock, 6)
  assert.equal(importedTestProduct.subtitle, 'A区-01-03')
  assert.deepEqual(importedTestProduct.sizeStocks, { M: 6, L: 0 })
  assert.deepEqual(importedTestProduct.colorSizeStocks, { 黑色: { M: 6, L: 0 }, 白色: { M: 0, L: 0 } })
  const clearedProduct = imported.body.data.products.find(product => product.code !== 'TEST-001')
  assert.equal(clearedProduct.stock, 0)
  assert.equal(clearedProduct.subtitle, '')
  assert.ok(Object.values(clearedProduct.sizeStocks).every(quantity => quantity === 0))

  const invalidWorkbook = XLSX.utils.book_new()
  const invalidSheet = XLSX.utils.aoa_to_sheet([
    ['货位', '款号*', '颜色*', '尺码*', '库存数量*'],
    ['B区-01-01', 'TEST-001', '黑色', 'M', 99],
    ['C区-02-02', 'TEST-001', '黑色', 'L', 1]
  ])
  XLSX.utils.book_append_sheet(invalidWorkbook, invalidSheet, '库存导入')
  const invalidBuffer = XLSX.write(invalidWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const invalidImport = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(invalidBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(invalidImport.response.status, 400)
  assert.match(invalidImport.body.error, /第 3 行.*货位.*不一致/)

  const legacyWorkbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([
    ['款号*', '尺码*', '库存数量*'],
    ['TEST-001', 'M', 20]
  ]), '库存导入')
  const legacyBuffer = XLSX.write(legacyWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const legacyImport = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(legacyBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(legacyImport.response.status, 400)
  assert.match(legacyImport.body.error, /模板表头不正确.*货位/)

  const afterInvalidImport = await request('/api/admin/products', {}, cookie)
  const testProductAfterInvalid = afterInvalidImport.body.data.find(product => product.code === 'TEST-001')
  assert.deepEqual(testProductAfterInvalid.sizeStocks, { M: 6, L: 0 })
  assert.equal(testProductAfterInvalid.subtitle, 'A区-01-03')

  const visible = await request('/api/products?q=TEST-001')
  assert.equal(visible.body.data.length, 1)
  assert.equal(visible.body.data[0].name, '已上架测试商品')
  assert.equal(visible.body.data[0].stock, 6)
  assert.equal(visible.body.data[0].sizeStocks.L, 0)
  assert.equal(visible.body.data[0].detailText, '测试商品详情文案')
  assert.equal(visible.body.data[0].displayCategory, '独立修改品类')
  assert.equal(visible.body.data[0].posterImage, uploaded.body.url)
  assert.equal(visible.body.data[0].colorImages.黑色, uploaded.body.url)
  assert.deepEqual(visible.body.data[0].colorGalleries.黑色, [uploaded.body.url, '/images/polo-grid.jpg'])
  assert.equal(visible.body.data[0].colorImages.白色, undefined)
  assert.deepEqual(visible.body.data[0].colorGalleries.白色, [])
  assert.equal(visible.body.data[0].realImages[0].category, '细节特写')

  const visibleInSecondaryCategory = await request(`/api/products?category=${encodeURIComponent('圆领T恤')}`)
  assert.ok(visibleInSecondaryCategory.body.data.some(product => product.id === created.body.data.id))

  const warehouseWorkbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(warehouseWorkbook, XLSX.utils.aoa_to_sheet([
    ['商品名称', '型号', '数量', '产地'],
    ['已上架测试商品黑色', 'M', 9, '测试内部编码'],
    ['完全不存在的库存商品XYZ', 'M', 4, '未知内部编码']
  ]), 'Sheet1')
  const warehouseBuffer = XLSX.write(warehouseWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const warehouseImport = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ fileName: '大库库存测试.xlsx', dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(warehouseBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(warehouseImport.response.status, 200)
  assert.equal(warehouseImport.body.data.format, 'warehouse')
  assert.equal(warehouseImport.body.data.applied, true)
  assert.equal(warehouseImport.body.data.matchedProducts, 1)
  assert.equal(warehouseImport.body.data.unmatchedRowsCount, 1)
  const warehouseReport = await readReport(warehouseImport.body.data.unmatchedReport, cookie)
  const warehouseReportRows = XLSX.utils.sheet_to_json(warehouseReport.Sheets['未匹配产品'], { header: 1, defval: '' })
  assert.equal(warehouseReportRows[1][4], '完全不存在的库存商品XYZ')
  assert.match(warehouseReportRows[1][9], /未匹配到唯一商品/)
  const afterWarehouseImport = await request('/api/admin/products', {}, cookie)
  const warehouseTestProduct = afterWarehouseImport.body.data.find(product => product.code === 'TEST-001')
  assert.deepEqual(warehouseTestProduct.sizeStocks, { M: 9, L: 0 })
  assert.deepEqual(warehouseTestProduct.colorSizeStocks, { 黑色: { M: 9, L: 0 }, 白色: { M: 0, L: 0 } })
  assert.equal(warehouseTestProduct.stock, 9)
  assert.equal(warehouseTestProduct.subtitle, 'A区-01-03')
  const automaticMappingList = await request('/api/admin/inventory/mappings', {}, cookie)
  const automaticSource = automaticMappingList.body.data.sources.find(source => source.sourceName === '已上架测试商品黑色')
  assert.ok(automaticSource)
  assert.equal(automaticSource.mapping, null)
  assert.equal(automaticSource.matches.length, 1)
  assert.equal(automaticSource.matches[0].matchMethod, 'automatic')
  assert.equal(automaticSource.matches[0].productId, created.body.data.id)
  assert.equal(automaticSource.matches[0].matchedRows, 1)
  assert.equal(automaticSource.matches[0].color, '黑色')
  assert.equal(automaticSource.fromLatestImport, true)

  const unmatchedOnlyWorkbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(unmatchedOnlyWorkbook, XLSX.utils.aoa_to_sheet([
    ['商品名称', '型号', '数量', '产地'],
    ['人工库存别名黑色ABC', 'M', 12, '无匹配编码']
  ]), 'Sheet1')
  const unmatchedOnlyBuffer = XLSX.write(unmatchedOnlyWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const unmatchedOnlyImport = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ fileName: '全部未匹配.xlsx', dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(unmatchedOnlyBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(unmatchedOnlyImport.response.status, 200)
  assert.equal(unmatchedOnlyImport.body.data.applied, false)
  assert.equal(unmatchedOnlyImport.body.data.matchedProducts, 0)
  assert.equal(unmatchedOnlyImport.body.data.unmatchedRowsCount, 1)
  assert.equal(unmatchedOnlyImport.body.data.unmatchedSourceCount, 1)
  await readReport(unmatchedOnlyImport.body.data.unmatchedReport, cookie)
  const afterUnmatchedOnly = await request('/api/admin/products', {}, cookie)
  assert.equal(afterUnmatchedOnly.body.data.find(product => product.code === 'TEST-001').stock, 9)

  const mappingList = await request('/api/admin/inventory/mappings', {}, cookie)
  assert.equal(mappingList.response.status, 200)
  assert.ok(mappingList.body.data.products.some(product => product.id === created.body.data.id))
  const unmatchedSource = mappingList.body.data.sources.find(source => source.sourceName === '人工库存别名黑色ABC')
  assert.ok(unmatchedSource)
  assert.equal(unmatchedSource.mapping, null)
  assert.equal(unmatchedSource.rowCount, 1)

  const savedMapping = await request('/api/admin/inventory/mappings', {
    method: 'PUT',
    body: JSON.stringify({
      sourceName: '人工库存别名黑色ABC',
      sourceInternalCode: '无匹配编码',
      productId: created.body.data.id,
      targetColor: '黑色'
    })
  }, cookie)
  assert.equal(savedMapping.response.status, 200)
  assert.equal(savedMapping.body.data.productCode, 'TEST-001')
  assert.equal(savedMapping.body.data.targetColor, '黑色')

  const savedHistoricalMapping = await request('/api/admin/inventory/mappings', {
    method: 'PUT',
    body: JSON.stringify({
      sourceName: '历史库存名称（已不在最新未匹配表）',
      sourceInternalCode: '',
      productId: created.body.data.id,
      targetColor: '黑色'
    })
  }, cookie)
  assert.equal(savedHistoricalMapping.response.status, 200)
  const mappingsWithHistory = await request('/api/admin/inventory/mappings', {}, cookie)
  const historicalSource = mappingsWithHistory.body.data.sources.find(source => source.sourceName === '历史库存名称(已不在最新未匹配表)')
  assert.ok(historicalSource)
  assert.equal(historicalSource.fromLatestReport, false)
  assert.equal(historicalSource.mapping.productId, created.body.data.id)

  const mappedWarehouseImport = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ fileName: '人工对应后导入.xlsx', dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(unmatchedOnlyBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(mappedWarehouseImport.response.status, 200)
  assert.equal(mappedWarehouseImport.body.data.applied, true)
  assert.equal(mappedWarehouseImport.body.data.manualMappedGroups, 1)
  assert.equal(mappedWarehouseImport.body.data.matchedProducts, 1)
  assert.equal(mappedWarehouseImport.body.data.unmatchedRowsCount, 0)
  assert.equal(mappedWarehouseImport.body.data.unmatchedSourceCount, 0)
  const noStaleUnmatchedDetails = await request('/api/admin/inventory/reports/latest/details', {}, cookie)
  assert.equal(noStaleUnmatchedDetails.response.status, 404)
  assert.match(noStaleUnmatchedDetails.body.error, /最近一次.*没有未匹配/)
  const noStaleUnmatchedDownload = await fetch(`${base}/api/admin/inventory/reports/latest`, { headers: { cookie } })
  assert.equal(noStaleUnmatchedDownload.status, 404)
  const mappingsAfterMappedImport = await request('/api/admin/inventory/mappings', {}, cookie)
  assert.equal(mappingsAfterMappedImport.body.data.report.sourceFileName, '人工对应后导入.xlsx')
  assert.equal(mappingsAfterMappedImport.body.data.report.totalRows, 0)
  assert.equal(mappingsAfterMappedImport.body.data.latestPendingSourceCount, 0)
  const afterMappedImport = await request('/api/admin/products', {}, cookie)
  const manuallyMappedProduct = afterMappedImport.body.data.find(product => product.code === 'TEST-001')
  assert.equal(manuallyMappedProduct.colorSizeStocks.黑色.M, 12)
  assert.equal(manuallyMappedProduct.stock, 12)

  const savedSecondColorMapping = await request('/api/admin/inventory/mappings', {
    method: 'PUT',
    body: JSON.stringify({
      sourceName: '人工库存别名第二组ABC',
      sourceInternalCode: '另一匹配编码',
      productId: created.body.data.id,
      targetColor: '白色'
    })
  }, cookie)
  assert.equal(savedSecondColorMapping.response.status, 200)
  assert.equal(savedSecondColorMapping.body.data.targetColor, '白色')
  const twoColorWorkbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(twoColorWorkbook, XLSX.utils.aoa_to_sheet([
    ['商品名称', '型号', '数量', '产地'],
    ['人工库存别名黑色ABC', 'M', 12, '无匹配编码'],
    ['人工库存别名第二组ABC', 'M', 5, '另一匹配编码']
  ]), 'Sheet1')
  const twoColorBuffer = XLSX.write(twoColorWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const twoColorImport = await request('/api/admin/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ fileName: '同款分颜色导入.xlsx', dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(twoColorBuffer).toString('base64')}` })
  }, cookie)
  assert.equal(twoColorImport.response.status, 200)
  assert.equal(twoColorImport.body.data.manualMappedGroups, 2)
  const afterTwoColorImport = await request('/api/admin/products', {}, cookie)
  const twoColorProduct = afterTwoColorImport.body.data.find(product => product.code === 'TEST-001')
  assert.equal(twoColorProduct.colorSizeStocks.黑色.M, 12)
  assert.equal(twoColorProduct.colorSizeStocks.白色.M, 5)
  assert.equal(twoColorProduct.stock, 17)

  const deletedMapping = await request('/api/admin/inventory/mappings', {
    method: 'DELETE',
    body: JSON.stringify({ sourceName: '人工库存别名黑色ABC', sourceInternalCode: '无匹配编码' })
  }, cookie)
  assert.equal(deletedMapping.response.status, 200)
  assert.equal(deletedMapping.body.ok, true)
  const deletedSecondColorMapping = await request('/api/admin/inventory/mappings', {
    method: 'DELETE',
    body: JSON.stringify({ sourceName: '人工库存别名第二组ABC', sourceInternalCode: '另一匹配编码' })
  }, cookie)
  assert.equal(deletedSecondColorMapping.response.status, 200)
  const deletedHistoricalMapping = await request('/api/admin/inventory/mappings', {
    method: 'DELETE',
    body: JSON.stringify({ sourceName: '历史库存名称（已不在最新未匹配表）', sourceInternalCode: '' })
  }, cookie)
  assert.equal(deletedHistoricalMapping.response.status, 200)

  const deletedAssignedCategory = await request(`/api/admin/categories/${testCategory.id}`, { method: 'DELETE' }, cookie)
  assert.equal(deletedAssignedCategory.response.status, 200)
  assert.equal(deletedAssignedCategory.body.data.name, '测试分类改名')
  assert.equal(deletedAssignedCategory.body.data.affectedProducts, 1)
  const afterCategoryDelete = await request('/api/admin/products', {}, cookie)
  const productAfterCategoryDelete = afterCategoryDelete.body.data.find(product => product.code === 'TEST-001')
  assert.equal(productAfterCategoryDelete.category, '圆领T恤')
  assert.deepEqual(productAfterCategoryDelete.categories, ['圆领T恤'])
  assert.equal(productAfterCategoryDelete.displayCategory, '独立修改品类')

  const clearedColor = productAfterCategoryDelete.colors[0]
  const clearedColorGalleries = {
    ...productAfterCategoryDelete.colorGalleries,
    [clearedColor]: []
  }
  const clearedGallery = await request(`/api/admin/products/${created.body.data.id}`, {
    method: 'PUT',
    body: JSON.stringify({ colorGalleries: clearedColorGalleries })
  }, cookie)
  assert.equal(clearedGallery.response.status, 200)
  assert.deepEqual(clearedGallery.body.data.colorGalleries[clearedColor], [])
  assert.equal(clearedGallery.body.data.colorImages[clearedColor], undefined)
  const clearedGalleryReloaded = await request('/api/admin/products', {}, cookie)
  const reloadedClearedProduct = clearedGalleryReloaded.body.data.find(product => product.id === created.body.data.id)
  assert.deepEqual(reloadedClearedProduct.colorGalleries[clearedColor], [])
  assert.equal(reloadedClearedProduct.colorImages[clearedColor], undefined)

  const removed = await request(`/api/admin/products/${created.body.data.id}`, { method: 'DELETE' }, cookie)
  assert.equal(removed.response.status, 200)
  assert.equal((await fetch(`${base}${uploaded.body.url}`)).status, 200)

  console.log('后端验证通过：登录限速、主管理员/普通管理员权限、库存上传、无引用图片清理、商品管理、库存名称人工对应、批量导入和错误回滚均正常')
} finally {
  child.kill()
  await new Promise(resolve => child.once('exit', resolve))
  rmSync(workspace, { recursive: true, force: true })
}
