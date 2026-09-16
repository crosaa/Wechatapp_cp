import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as sqlite from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { buildWarehouseInventoryPlan } from './warehouse-inventory.mjs'

const { DatabaseSync } = sqlite
const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)))
const dbPath = resolve(dataDir, 'catalog.db')
mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

export async function backupCatalogDatabase(destination) {
  const target = resolve(destination)
  if (typeof sqlite.backup === 'function') return sqlite.backup(db, target)
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  return target
}
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '未分类',
    display_category TEXT NOT NULL DEFAULT '',
    categories_json TEXT NOT NULL DEFAULT '[]',
    price REAL NOT NULL DEFAULT 0,
    special_size_prices_json TEXT NOT NULL DEFAULT '[]',
    stock INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '件',
    fabric TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL DEFAULT '',
    fit TEXT NOT NULL DEFAULT '',
    colors_json TEXT NOT NULL DEFAULT '[]',
    sizes_json TEXT NOT NULL DEFAULT '[]',
    size_stocks_json TEXT NOT NULL DEFAULT '{}',
    color_size_stocks_json TEXT NOT NULL DEFAULT '{}',
    images_json TEXT NOT NULL DEFAULT '[]',
    poster_image TEXT NOT NULL DEFAULT '',
    color_images_json TEXT NOT NULL DEFAULT '{}',
    color_galleries_json TEXT NOT NULL DEFAULT '{}',
    detail_text TEXT NOT NULL DEFAULT '',
    detail_images_json TEXT NOT NULL DEFAULT '[]',
    real_images_json TEXT NOT NULL DEFAULT '[]',
    badge TEXT NOT NULL DEFAULT '',
    seasonal_new INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS catalog_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'normal' CHECK(type IN ('normal', 'seasonal')),
    image_url TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '#8fa594',
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS category_product_order (
    category_id INTEGER NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (category_id, product_id)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_product_mappings (
    source_name TEXT NOT NULL,
    source_internal_code TEXT NOT NULL DEFAULT '',
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    target_color TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source_name, source_internal_code, product_id)
  )
`)

let inventoryMappingTableInfo = db.prepare('PRAGMA table_info(inventory_product_mappings)').all()
const inventoryMappingColumns = inventoryMappingTableInfo.map(column => column.name)
if (!inventoryMappingColumns.includes('target_color')) {
  db.exec("ALTER TABLE inventory_product_mappings ADD COLUMN target_color TEXT NOT NULL DEFAULT ''")
}

inventoryMappingTableInfo = db.prepare('PRAGMA table_info(inventory_product_mappings)').all()
const inventoryMappingPrimaryKey = inventoryMappingTableInfo
  .filter(column => Number(column.pk) > 0)
  .sort((left, right) => Number(left.pk) - Number(right.pk))
  .map(column => column.name)
if (inventoryMappingPrimaryKey.join(',') !== 'source_name,source_internal_code,product_id') {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE inventory_product_mappings_next (
      source_name TEXT NOT NULL,
      source_internal_code TEXT NOT NULL DEFAULT '',
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      target_color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_name, source_internal_code, product_id)
    );
    INSERT OR IGNORE INTO inventory_product_mappings_next (
      source_name, source_internal_code, product_id, target_color, created_at, updated_at
    )
    SELECT source_name, source_internal_code, product_id, target_color, created_at, updated_at
    FROM inventory_product_mappings;
    DROP TABLE inventory_product_mappings;
    ALTER TABLE inventory_product_mappings_next RENAME TO inventory_product_mappings;
    COMMIT;
  `)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_import_matches (
    source_name TEXT NOT NULL,
    source_internal_code TEXT NOT NULL DEFAULT '',
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    match_method TEXT NOT NULL DEFAULT 'automatic' CHECK(match_method IN ('automatic', 'manual')),
    source_file_name TEXT NOT NULL DEFAULT '',
    matched_rows INTEGER NOT NULL DEFAULT 0,
    matched_quantity INTEGER NOT NULL DEFAULT 0,
    source_rows INTEGER NOT NULL DEFAULT 0,
    source_quantity INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL,
    PRIMARY KEY (source_name, source_internal_code, product_id)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('owner', 'admin')),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT ''
  )
`)

db.exec(`
  DROP TABLE IF EXISTS miniapp_favorites;
  DROP TABLE IF EXISTS miniapp_sessions;
  DROP TABLE IF EXISTS miniapp_users;
`)

db.exec(`
  UPDATE inventory_product_mappings
  SET target_color = (
    SELECT source_match.color
    FROM inventory_import_matches AS source_match
    WHERE source_match.source_name = inventory_product_mappings.source_name
      AND source_match.source_internal_code = inventory_product_mappings.source_internal_code
      AND source_match.product_id = inventory_product_mappings.product_id
      AND source_match.color <> ''
    LIMIT 1
  )
  WHERE target_color = ''
    AND EXISTS (
      SELECT 1
      FROM inventory_import_matches AS source_match
      WHERE source_match.source_name = inventory_product_mappings.source_name
        AND source_match.source_internal_code = inventory_product_mappings.source_internal_code
        AND source_match.product_id = inventory_product_mappings.product_id
        AND source_match.color <> ''
    )
`)

const productColumns = db.prepare('PRAGMA table_info(products)').all().map(column => column.name)
const stockWasAdded = !productColumns.includes('stock')
if (stockWasAdded) {
  db.exec('ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0')
}
const sizeStocksWasAdded = !productColumns.includes('size_stocks_json')
if (sizeStocksWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN size_stocks_json TEXT NOT NULL DEFAULT '{}'")
}
const colorSizeStocksWasAdded = !productColumns.includes('color_size_stocks_json')
if (colorSizeStocksWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN color_size_stocks_json TEXT NOT NULL DEFAULT '{}'")
}
const detailTextWasAdded = !productColumns.includes('detail_text')
if (detailTextWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN detail_text TEXT NOT NULL DEFAULT ''")
}
const detailImagesWasAdded = !productColumns.includes('detail_images_json')
if (detailImagesWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN detail_images_json TEXT NOT NULL DEFAULT '[]'")
}
const realImagesWasAdded = !productColumns.includes('real_images_json')
if (realImagesWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN real_images_json TEXT NOT NULL DEFAULT '[]'")
}
const colorImagesWasAdded = !productColumns.includes('color_images_json')
if (colorImagesWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN color_images_json TEXT NOT NULL DEFAULT '{}'")
}
const posterImageWasAdded = !productColumns.includes('poster_image')
if (posterImageWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN poster_image TEXT NOT NULL DEFAULT ''")
}
const colorGalleriesWasAdded = !productColumns.includes('color_galleries_json')
if (colorGalleriesWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN color_galleries_json TEXT NOT NULL DEFAULT '{}'")
}
const displayCategoryWasAdded = !productColumns.includes('display_category')
if (displayCategoryWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN display_category TEXT NOT NULL DEFAULT ''")
  db.exec("UPDATE products SET display_category = category WHERE display_category = ''")
}
const seasonalNewWasAdded = !productColumns.includes('seasonal_new')
if (seasonalNewWasAdded) {
  db.exec('ALTER TABLE products ADD COLUMN seasonal_new INTEGER NOT NULL DEFAULT 1')
}
const categoriesJsonWasAdded = !productColumns.includes('categories_json')
if (categoriesJsonWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'")
}
const fitWasAdded = !productColumns.includes('fit')
if (fitWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN fit TEXT NOT NULL DEFAULT ''")
}
const specialSizePricesWasAdded = !productColumns.includes('special_size_prices_json')
if (specialSizePricesWasAdded) {
  db.exec("ALTER TABLE products ADD COLUMN special_size_prices_json TEXT NOT NULL DEFAULT '[]'")
}

const toJson = value => JSON.stringify(Array.isArray(value) ? value : [])
const fromJson = value => {
  try { return JSON.parse(value || '[]') } catch { return [] }
}
const fromObject = value => {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

function mapAdminUser(row, includePassword = false) {
  if (!row) return null
  const user = {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  }
  if (includePassword) {
    user.passwordHash = row.password_hash
    user.passwordSalt = row.password_salt
  }
  return user
}

export function ensureBootstrapAdmin({ username, passwordHash, passwordSalt }) {
  const existing = db.prepare('SELECT * FROM admin_users ORDER BY id ASC LIMIT 1').get()
  if (existing) return mapAdminUser(existing)
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO admin_users (username, password_hash, password_salt, role, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'owner', 'system', ?, ?)
  `).run(username, passwordHash, passwordSalt, now, now)
  return mapAdminUser(db.prepare('SELECT * FROM admin_users WHERE id = ?').get(Number(result.lastInsertRowid)))
}

export function getAdminUserByUsername(username) {
  return mapAdminUser(db.prepare('SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim()), true)
}

export function getAdminUserById(id) {
  return mapAdminUser(db.prepare('SELECT * FROM admin_users WHERE id = ?').get(Number(id)), true)
}

export function listAdminUsers() {
  return db.prepare("SELECT * FROM admin_users ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, username COLLATE NOCASE").all().map(row => mapAdminUser(row))
}

export function createAdminUser({ username, passwordHash, passwordSalt, createdBy = '' }) {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO admin_users (username, password_hash, password_salt, role, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', ?, ?, ?)
  `).run(username, passwordHash, passwordSalt, createdBy, now, now)
  return mapAdminUser(db.prepare('SELECT * FROM admin_users WHERE id = ?').get(Number(result.lastInsertRowid)))
}

export function updateAdminUserPassword(id, passwordHash, passwordSalt) {
  const now = new Date().toISOString()
  const result = db.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(passwordHash, passwordSalt, now, Number(id))
  return result.changes ? mapAdminUser(db.prepare('SELECT * FROM admin_users WHERE id = ?').get(Number(id))) : null
}

export function deleteAdminUser(id) {
  const current = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(Number(id))
  if (!current) return null
  if (current.role === 'owner') throw new Error('主管理员账号不能删除')
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(Number(id))
  return mapAdminUser(current)
}

export function recordAdminUserLogin(id) {
  const now = new Date().toISOString()
  db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(now, Number(id))
}

const DEFAULT_STORE_SETTINGS = {
  storeName: '普润制衣团购仓',
  storeIcon: '',
  homeHeroImage: '',
  homeHeroImages: [],
  homeHeroImageMode: 'aspectFill',
  homeEyebrow: 'WHOLESALE · CUSTOM',
  homeSubtitle: '企业团购与服装定制',
  searchPlaceholder: '搜索款号、品类或面料',
  heroNote: '现货供应 · 多色可选',
  categoryTitle: '热门分类',
  categorySubtitle: 'SHOP BY CATEGORY',
  categoryMoreText: '查看全部 →',
  homeServices: ['支持小单起订', '免费设计效果图', '企业专属报价'],
  profileLayout: 'member',
  profilePageTitle: '我的',
  profileTitle: '普润制衣服务中心',
  profileSubtitle: '企业团购与服装定制',
  serviceTitle: '常用服务',
  services: ['设计草稿', '个人资料', '原创精品', '企业认证'],
  profileAboutTitle: '关于店铺',
  productFeatures: ['团体定制', '透气亲肤', '可绣可印', '品质检验'],
  aboutText: '专注企业团购、团队服装与个性化定制服务。',
  footerText: '品质团购 · 专业定制'
}

const DEFAULT_CATEGORIES = [
  { key: 'new-2026', name: '2026新品', type: 'normal', icon: 'NEW', tone: '#f1b742' },
  { key: 'business-shirt', name: '商务衬衫', type: 'normal', icon: '衫', tone: '#9ab7a2' },
  { key: 'workwear-premium', name: '高端工服', type: 'normal', icon: '工', tone: '#667b8b' },
  { key: 'spring-autumn', name: '春秋款', type: 'normal', icon: '春', tone: '#c78870' },
  { key: 'quick-dry', name: '夏季速干', type: 'normal', icon: '夏', tone: '#7db9c7' },
  { key: 'polo', name: '翻领T恤', type: 'normal', icon: 'POLO', tone: '#dca14e' },
  { key: 'crew-neck', name: '圆领T恤', type: 'normal', icon: 'T', tone: '#92b87d' },
  { key: 'long-sleeve', name: '长袖T恤', type: 'normal', icon: '长', tone: '#b59a86' },
  { key: 'sun-protection', name: '防晒衣', type: 'normal', icon: 'UPF', tone: '#75a6bb' },
  { key: 'work-jacket', name: '工装外套', type: 'normal', icon: '服', tone: '#5d7387' },
  { key: 'hoodie', name: '卫衣系列', type: 'normal', icon: '卫', tone: '#aa8268' },
  { key: 'business-suit', name: '职业套装', type: 'normal', icon: '职', tone: '#7d7b86' },
  { key: 'seasonal', name: '当季上新', type: 'normal', icon: 'NEW', tone: '#d9a13b' }
]

if (!db.prepare('SELECT id FROM catalog_categories LIMIT 1').get()) {
  const insertCategory = db.prepare('INSERT INTO catalog_categories (category_key, name, type, image_url, icon, tone, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const now = new Date().toISOString()
  DEFAULT_CATEGORIES.forEach((category, index) => insertCategory.run(category.key, category.name, category.type, '', category.icon, category.tone, (DEFAULT_CATEGORIES.length - index) * 10, now))
}

// 旧版“当季上新”是固定展示类型；新版将它转成普通分类，并把旧标记商品迁入分类。
const legacySeasonalCategories = db.prepare("SELECT * FROM catalog_categories WHERE type = 'seasonal' ORDER BY sort_order DESC, id ASC").all()
if (legacySeasonalCategories.length) {
  const now = new Date().toISOString()
  const minimum = db.prepare("SELECT MIN(sort_order) AS value FROM catalog_categories WHERE type = 'normal'").get().value || 0
  const markedProducts = db.prepare('SELECT id, category, categories_json FROM products WHERE seasonal_new = 1').all()
  const updateProductCategories = db.prepare('UPDATE products SET categories_json = ?, seasonal_new = 0, updated_at = ? WHERE id = ?')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const category of legacySeasonalCategories) {
      for (const product of markedProducts) {
        const saved = fromJson(product.categories_json)
        const categories = saved.length ? saved : (product.category ? [product.category] : [])
        updateProductCategories.run(JSON.stringify([...new Set([...categories, category.name])]), now, product.id)
      }
      db.prepare("UPDATE catalog_categories SET type = 'normal', sort_order = ?, updated_at = ? WHERE id = ?").run(
        minimum - (legacySeasonalCategories.indexOf(category) + 1) * 10, now, category.id
      )
    }
    db.prepare('UPDATE products SET seasonal_new = 0, updated_at = ? WHERE seasonal_new = 1').run(now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function mapCategory(row) {
  return row ? {
    id: row.id,
    key: row.category_key,
    name: row.name,
    category: row.name,
    type: row.type,
    image: row.image_url,
    icon: row.icon,
    tone: row.tone,
    sortOrder: row.sort_order,
    count: Number(row.count) || 0
  } : null
}

function ensureCatalogCategory(name) {
  const cleanName = String(name || '').trim()
  if (!cleanName || db.prepare('SELECT id FROM catalog_categories WHERE name = ?').get(cleanName)) return
  const minimum = db.prepare('SELECT MIN(sort_order) AS value FROM catalog_categories').get().value || 0
  const key = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  db.prepare('INSERT INTO catalog_categories (category_key, name, type, image_url, icon, tone, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    key, cleanName, 'normal', '', cleanName.slice(0, 2), '#8fa594', minimum - 10, new Date().toISOString()
  )
}

function cleanSetting(value, fallback = '', maxLength = 200) {
  return String(value ?? fallback).trim().slice(0, maxLength)
}

function cleanImageReference(value, label = '图片') {
  const image = String(value || '').trim().slice(0, 1000)
  if (!image) return ''
  if (/^\/(?:uploads|images)\//u.test(image)) return image
  throw new Error(`${label}必须先保存到本服务器，不能直接保存外部图片网址`)
}

function normaliseStoreSettings(input = {}, current = DEFAULT_STORE_SETTINGS) {
  const serviceSource = Array.isArray(input.services) ? input.services : current.services
  const services = [...new Set(serviceSource.map(item => cleanSetting(item, '', 20)).filter(Boolean))].slice(0, 8)
  const homeServiceSource = Array.isArray(input.homeServices) ? input.homeServices : current.homeServices
  const homeServices = [...new Set(homeServiceSource.map(item => cleanSetting(item, '', 30)).filter(Boolean))].slice(0, 6)
  const productFeatureSource = Array.isArray(input.productFeatures) ? input.productFeatures : current.productFeatures
  const productFeatures = [...new Set(productFeatureSource.map(item => cleanSetting(item, '', 20)).filter(Boolean))].slice(0, 8)
  const legacyHeroImage = cleanImageReference(input.homeHeroImage ?? current.homeHeroImage, '首页轮播图')
  const heroSource = Array.isArray(input.homeHeroImages)
    ? input.homeHeroImages
    : (Array.isArray(current.homeHeroImages) ? current.homeHeroImages : [])
  const homeHeroImages = [...new Set(heroSource.map(item => cleanImageReference(item, '首页轮播图')).filter(Boolean))].slice(0, 11)
  if (!homeHeroImages.length && legacyHeroImage) homeHeroImages.push(legacyHeroImage)
  return {
    storeName: cleanSetting(input.storeName, current.storeName, 40) || DEFAULT_STORE_SETTINGS.storeName,
    storeIcon: cleanImageReference(input.storeIcon ?? current.storeIcon, '店铺图标'),
    homeHeroImage: homeHeroImages[0] || legacyHeroImage,
    homeHeroImages,
    homeHeroImageMode: (input.homeHeroImageMode ?? current.homeHeroImageMode) === 'aspectFit' ? 'aspectFit' : 'aspectFill',
    homeEyebrow: cleanSetting(input.homeEyebrow, current.homeEyebrow, 40),
    homeSubtitle: cleanSetting(input.homeSubtitle, current.homeSubtitle, 50),
    searchPlaceholder: cleanSetting(input.searchPlaceholder, current.searchPlaceholder, 40),
    heroNote: cleanSetting(input.heroNote, current.heroNote, 50),
    categoryTitle: cleanSetting(input.categoryTitle, current.categoryTitle, 20),
    categorySubtitle: cleanSetting(input.categorySubtitle, current.categorySubtitle, 40),
    categoryMoreText: cleanSetting(input.categoryMoreText, current.categoryMoreText, 20),
    homeServices,
    profileLayout: (input.profileLayout ?? current.profileLayout) === 'brand' ? 'brand' : 'member',
    profilePageTitle: cleanSetting(input.profilePageTitle, current.profilePageTitle, 12) || '我的',
    profileTitle: cleanSetting(input.profileTitle, current.profileTitle, 40) || DEFAULT_STORE_SETTINGS.profileTitle,
    profileSubtitle: cleanSetting(input.profileSubtitle, current.profileSubtitle, 80),
    serviceTitle: cleanSetting(input.serviceTitle, current.serviceTitle, 20) || '常用服务',
    services,
    profileAboutTitle: cleanSetting(input.profileAboutTitle, current.profileAboutTitle, 20) || DEFAULT_STORE_SETTINGS.profileAboutTitle,
    productFeatures,
    aboutText: cleanSetting(input.aboutText, current.aboutText, 500),
    footerText: cleanSetting(input.footerText, current.footerText, 80)
  }
}

if (!db.prepare('SELECT id FROM store_settings WHERE id = 1').get()) {
  db.prepare('INSERT INTO store_settings (id, settings_json, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(DEFAULT_STORE_SETTINGS), new Date().toISOString())
}

export function getStoreSettings() {
  const row = db.prepare('SELECT settings_json, updated_at FROM store_settings WHERE id = 1').get()
  const saved = fromObject(row?.settings_json)
  return { ...normaliseStoreSettings({ ...DEFAULT_STORE_SETTINGS, ...saved }), updatedAt: row?.updated_at || '' }
}

export function updateStoreSettings(input) {
  const current = getStoreSettings()
  const settings = normaliseStoreSettings(input, current)
  const updatedAt = new Date().toISOString()
  db.prepare('UPDATE store_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(JSON.stringify(settings), updatedAt)
  return { ...settings, updatedAt }
}

function distributeStock(total, sizes) {
  const result = {}
  if (!sizes.length) return result
  const safeTotal = Math.max(0, Math.trunc(Number(total) || 0))
  const base = Math.floor(safeTotal / sizes.length)
  let remainder = safeTotal % sizes.length
  for (const size of sizes) {
    result[size] = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder -= 1
  }
  return result
}

function normaliseSizeStocks(sizes, value, fallbackTotal = 0) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!source) return distributeStock(fallbackTotal, sizes)
  return Object.fromEntries(sizes.map(size => [size, Math.max(0, Math.trunc(Number(source[size]) || 0))]))
}

function normaliseColorSizeStocks(colors, sizes, value, fallbackSizeStocks = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (source && Object.keys(source).length) {
    return Object.fromEntries(colors.map(color => {
      const colorSource = source[color] && typeof source[color] === 'object' && !Array.isArray(source[color]) ? source[color] : {}
      return [color, Object.fromEntries(sizes.map(size => [size, Math.max(0, Math.trunc(Number(colorSource[size]) || 0))]))]
    }))
  }
  const result = Object.fromEntries(colors.map(color => [color, Object.fromEntries(sizes.map(size => [size, 0]))]))
  if (!colors.length) return result
  for (const size of sizes) {
    const total = Math.max(0, Math.trunc(Number(fallbackSizeStocks[size]) || 0))
    const base = Math.floor(total / colors.length)
    let remainder = total % colors.length
    for (const color of colors) {
      result[color][size] = base + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder -= 1
    }
  }
  return result
}

function aggregateColorSizeStocks(colors, sizes, colorSizeStocks) {
  return Object.fromEntries(sizes.map(size => [size, colors.reduce((total, color) => total + (Number(colorSizeStocks?.[color]?.[size]) || 0), 0)]))
}

function mapProduct(row) {
  if (!row) return null
  const colors = fromJson(row.colors_json)
  const images = fromJson(row.images_json)
  const storedColorImages = normaliseColorImages(colors, fromObject(row.color_images_json))
  const colorGalleries = normaliseColorGalleries(colors, fromObject(row.color_galleries_json), storedColorImages)
  const colorImages = Object.fromEntries(Object.entries(colorGalleries).filter(([, gallery]) => gallery.length).map(([color, gallery]) => [color, gallery[0]]))
  const sizes = fromJson(row.sizes_json)
  const storedSizeStocks = normaliseSizeStocks(sizes, fromObject(row.size_stocks_json), row.stock)
  const colorSizeStocks = normaliseColorSizeStocks(colors, sizes, fromObject(row.color_size_stocks_json), storedSizeStocks)
  const sizeStocks = aggregateColorSizeStocks(colors, sizes, colorSizeStocks)
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subtitle: row.subtitle,
    category: row.category,
    categories: (fromJson(row.categories_json).length ? fromJson(row.categories_json) : (row.category ? [row.category] : [])),
    displayCategory: row.display_category || row.category,
    price: row.price,
    specialSizePrices: fromJson(row.special_size_prices_json),
    stock: row.stock,
    unit: row.unit,
    fabric: row.fabric,
    style: row.style,
    fit: row.fit || '',
    colors,
    sizes,
    sizeStocks,
    colorSizeStocks,
    images,
    posterImage: row.poster_image || '',
    colorImages,
    colorGalleries,
    detailText: row.detail_text,
    detailImages: fromJson(row.detail_images_json),
    realImages: fromJson(row.real_images_json),
    badge: row.badge,
    seasonalNew: row.seasonal_new === 1,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const insertStmt = db.prepare(`
  INSERT INTO products (
    code, name, subtitle, category, display_category, categories_json, price, special_size_prices_json, stock, unit, fabric, style, fit,
    colors_json, sizes_json, size_stocks_json, color_size_stocks_json, images_json, poster_image, detail_text, detail_images_json,
    real_images_json, color_images_json, color_galleries_json, badge, seasonal_new, status, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateStmt = db.prepare(`
  UPDATE products SET
    code = ?, name = ?, subtitle = ?, category = ?, display_category = ?, categories_json = ?, price = ?, special_size_prices_json = ?, stock = ?, unit = ?,
    fabric = ?, style = ?, fit = ?, colors_json = ?, sizes_json = ?, size_stocks_json = ?, color_size_stocks_json = ?, images_json = ?, poster_image = ?,
    detail_text = ?, detail_images_json = ?, real_images_json = ?, color_images_json = ?, color_galleries_json = ?, badge = ?, seasonal_new = ?, status = ?, sort_order = ?, updated_at = ?
  WHERE id = ?
`)

function normaliseColorImages(colors, source) {
  const sourceMap = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  return Object.fromEntries(colors.map(color => {
    const url = cleanImageReference(sourceMap[color], `${color}颜色图片`)
    return url ? [color, url] : null
  }).filter(Boolean))
}

function normaliseColorGalleries(colors, source, colorImages) {
  const sourceMap = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  return Object.fromEntries(colors.map(color => {
    const hasExplicitGallery = Object.prototype.hasOwnProperty.call(sourceMap, color)
    const gallery = Array.isArray(sourceMap[color])
      ? [...new Set(sourceMap[color].map(item => cleanImageReference(item, `${color}颜色图片`)).filter(Boolean))]
      : []
    if (hasExplicitGallery) return [color, gallery]
    const fallback = cleanImageReference(colorImages[color], `${color}颜色图片`)
    return [color, gallery.length ? gallery : (fallback ? [fallback] : [])]
  }))
}

function normaliseSpecialSizePrices(source) {
  if (!Array.isArray(source)) return []
  return source.map(item => ({
    fromSize: String(item?.fromSize ?? '').trim(),
    toSize: String(item?.toSize ?? '').trim(),
    price: item?.price === '' || item?.price === null || item?.price === undefined ? Number.NaN : Number(item.price)
  })).filter(item => item.fromSize || item.toSize || Number.isFinite(item.price))
}

function normalise(input, current = {}) {
  const category = String(input.category ?? current.category ?? '未分类').trim() || '未分类'
  const rawCategories = Array.isArray(input.categories) ? input.categories : (current.categories || [])
  const categories = [...new Set([category, ...rawCategories.map(String).map(item => item.trim()).filter(Boolean)])]
  const colors = Array.isArray(input.colors)
    ? [...new Set(input.colors.map(String).map(item => item.trim()).filter(Boolean))]
    : (current.colors || [])
  const sizes = Array.isArray(input.sizes) ? [...new Set(input.sizes.map(String).map(item => item.trim()).filter(Boolean))] : (current.sizes || [])
  const sourceSizeStocks = input.sizeStocks !== undefined ? input.sizeStocks : (Object.keys(current.sizeStocks || {}).length ? current.sizeStocks : null)
  const legacySizeStocks = normaliseSizeStocks(sizes, sourceSizeStocks, input.stock ?? current.stock ?? 0)
  const sourceColorSizeStocks = input.colorSizeStocks !== undefined
    ? input.colorSizeStocks
    : (input.sizeStocks !== undefined ? null : (Object.keys(current.colorSizeStocks || {}).length ? current.colorSizeStocks : null))
  const colorSizeStocks = normaliseColorSizeStocks(colors, sizes, sourceColorSizeStocks, legacySizeStocks)
  const sizeStocks = aggregateColorSizeStocks(colors, sizes, colorSizeStocks)
  const stock = Object.values(sizeStocks).reduce((total, quantity) => total + quantity, 0)
  const images = Array.isArray(input.images) ? input.images.map(item => cleanImageReference(item, '商品主图')).filter(Boolean) : (current.images || [])
  const colorImageSource = input.colorImages !== undefined ? input.colorImages : (current.colorImages || {})
  const colorImages = normaliseColorImages(colors, colorImageSource)
  const colorGallerySource = input.colorGalleries !== undefined ? input.colorGalleries : (current.colorGalleries || {})
  const colorGalleries = normaliseColorGalleries(colors, colorGallerySource, colorImages)
  const specialSizePrices = normaliseSpecialSizePrices(
    input.specialSizePrices !== undefined ? input.specialSizePrices : (current.specialSizePrices || [])
  )
  return {
    code: String(input.code ?? current.code ?? '').trim(),
    name: String(input.name ?? current.name ?? '').trim(),
    subtitle: String(input.subtitle ?? current.subtitle ?? '').trim(),
    category,
    categories,
    displayCategory: String(input.displayCategory ?? current.displayCategory ?? category).trim() || category,
    price: Number(input.price ?? current.price ?? 0),
    specialSizePrices,
    stock,
    unit: String(input.unit ?? current.unit ?? '件').trim() || '件',
    fabric: String(input.fabric ?? current.fabric ?? '').trim(),
    style: String(input.style ?? current.style ?? '').trim(),
    fit: String(input.fit ?? current.fit ?? '').trim(),
    colors,
    sizes,
    sizeStocks,
    colorSizeStocks,
    images,
    posterImage: cleanImageReference(input.posterImage ?? current.posterImage, '商品海报'),
    colorImages: Object.fromEntries(Object.entries(colorGalleries).filter(([, gallery]) => gallery.length).map(([color, gallery]) => [color, gallery[0]])),
    colorGalleries,
    detailText: String(input.detailText ?? current.detailText ?? '').trim(),
    detailImages: Array.isArray(input.detailImages) ? input.detailImages.map(item => cleanImageReference(item, '详情图')).filter(Boolean) : (current.detailImages || []),
    realImages: Array.isArray(input.realImages)
      ? input.realImages.map(item => ({ url: cleanImageReference(item?.url, '实拍图'), category: String(item?.category || '实物展示').trim() || '实物展示' })).filter(item => item.url)
      : (current.realImages || []),
    badge: String(input.badge ?? current.badge ?? '').trim(),
    seasonalNew: input.seasonalNew !== undefined ? Boolean(input.seasonalNew) : Boolean(current.seasonalNew),
    status: (input.status ?? current.status) === 'published' ? 'published' : 'draft',
    sortOrder: Number(input.sortOrder ?? current.sortOrder ?? 0) || 0
  }
}

function validate(product) {
  if (!product.code) throw new Error('款号不能为空')
  if (!product.name) throw new Error('商品名称不能为空')
  if (!Number.isFinite(product.price) || product.price < 0) throw new Error('价格格式不正确')
  if (!Number.isFinite(product.stock) || product.stock < 0) throw new Error('库存必须是大于等于 0 的整数')
  if (!product.sizes.length) throw new Error('请至少填写一个尺码')
  const occupiedSizeIndexes = new Set()
  for (const range of product.specialSizePrices) {
    const fromIndex = product.sizes.indexOf(range.fromSize)
    const toIndex = product.sizes.indexOf(range.toSize)
    if (fromIndex < 0 || toIndex < 0) throw new Error('特殊尺码区间必须使用商品已有尺码')
    if (fromIndex > toIndex) throw new Error(`特殊尺码区间“${range.fromSize} 至 ${range.toSize}”顺序不正确`)
    if (!Number.isFinite(range.price) || range.price < 0) throw new Error('特殊尺码区间价格格式不正确')
    for (let index = fromIndex; index <= toIndex; index += 1) {
      if (occupiedSizeIndexes.has(index)) throw new Error('特殊尺码价格区间不能重叠')
      occupiedSizeIndexes.add(index)
    }
  }
}

export function listProducts({ status, q, category } = {}) {
  const rows = db.prepare('SELECT * FROM products ORDER BY sort_order DESC, id DESC').all()
  const keyword = String(q || '').trim().toLowerCase()
  return rows.map(mapProduct).filter(item => {
    if (status && item.status !== status) return false
    if (category && !(item.categories && item.categories.length ? item.categories : [item.category]).includes(category)) return false
    if (keyword && !`${item.code} ${item.name} ${item.subtitle} ${item.category} ${item.displayCategory} ${item.fabric} ${item.style} ${item.fit}`.toLowerCase().includes(keyword)) return false
    return true
  })
}

export function getProduct(id) {
  return mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id)))
}

export function createProduct(input) {
  const product = normalise(input)
  validate(product)
  ensureCatalogCategory(product.category)
  const now = new Date().toISOString()
  const result = insertStmt.run(
    product.code, product.name, product.subtitle, product.category, product.displayCategory, toJson(product.categories), product.price,
    toJson(product.specialSizePrices), product.stock, product.unit, product.fabric, product.style, product.fit, toJson(product.colors),
    toJson(product.sizes), JSON.stringify(product.sizeStocks), JSON.stringify(product.colorSizeStocks), toJson(product.images), product.posterImage, product.detailText,
    toJson(product.detailImages), toJson(product.realImages), JSON.stringify(product.colorImages), JSON.stringify(product.colorGalleries), product.badge, product.seasonalNew ? 1 : 0, product.status,
    product.sortOrder, now, now
  )
  return getProduct(Number(result.lastInsertRowid))
}

export function updateProduct(id, input) {
  const current = getProduct(id)
  if (!current) return null
  const product = normalise(input, current)
  validate(product)
  ensureCatalogCategory(product.category)
  updateStmt.run(
    product.code, product.name, product.subtitle, product.category, product.displayCategory, toJson(product.categories), product.price,
    toJson(product.specialSizePrices), product.stock, product.unit, product.fabric, product.style, product.fit, toJson(product.colors),
    toJson(product.sizes), JSON.stringify(product.sizeStocks), JSON.stringify(product.colorSizeStocks), toJson(product.images), product.posterImage, product.detailText,
    toJson(product.detailImages), toJson(product.realImages), JSON.stringify(product.colorImages), JSON.stringify(product.colorGalleries), product.badge, product.seasonalNew ? 1 : 0, product.status,
    product.sortOrder, new Date().toISOString(), Number(id)
  )
  return getProduct(id)
}

export function importProductsBatch(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('没有可导入的商品数据')
  db.exec('BEGIN IMMEDIATE')
  try {
    const products = entries.map(entry => {
      const id = Number(entry?.id) || 0
      return id ? updateProduct(id, entry.input || {}) : createProduct(entry.input || {})
    })
    db.exec('COMMIT')
    return products
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function importInventory(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Excel 中没有可导入的库存数据')
  const products = listProducts()
  const productByCode = new Map(products.map(product => [product.code.toLowerCase(), product]))
  const changes = new Map(products.map(product => [product.id, {
    product,
    colorSizeStocks: Object.fromEntries(product.colors.map(color => [color, Object.fromEntries(product.sizes.map(size => [size, 0]))])),
    location: ''
  }]))
  const seen = new Set()
  const errors = []
  const unmatchedRows = []
  let matchedRows = 0

  for (const row of rows) {
    const code = String(row.code || '').trim()
    const location = String(row.location || '').trim()
    const requestedColor = String(row.color || '').trim()
    const requestedSize = String(row.size || '').trim()
    const quantity = Number(row.quantity)
    if (!code) {
      errors.push(`第 ${row.rowNumber} 行：款号不能为空`)
      continue
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      errors.push(`第 ${row.rowNumber} 行：库存数量必须是大于等于 0 的整数`)
      continue
    }
    const product = productByCode.get(code.toLowerCase())
    if (!product) {
      unmatchedRows.push({
        sourceFormat: 'template',
        rowNumber: row.rowNumber,
        location,
        code,
        color: requestedColor,
        size: requestedSize,
        quantity,
        reason: '款号不存在，未匹配到商品',
      })
      continue
    }
    const size = product.sizes.find(item => item.toLowerCase() === requestedSize.toLowerCase())
    if (!size) {
      errors.push(`第 ${row.rowNumber} 行：${product.code} 没有尺码 ${requestedSize || '（空）'}`)
      continue
    }
    const colorKey = value => String(value || '').normalize('NFKC').toLowerCase().replaceAll('桔', '橘').replaceAll('兰', '蓝').replaceAll('丈青', '藏蓝').replaceAll('藏青', '藏蓝').replace(/色|\s|[+＋/、,.。·_-]/gu, '')
    const color = requestedColor
      ? product.colors.find(item => colorKey(item) === colorKey(requestedColor))
      : (product.colors.length === 1 ? product.colors[0] : '')
    if (!color) {
      errors.push(`第 ${row.rowNumber} 行：${product.code} ${requestedColor ? `没有颜色 ${requestedColor}` : '有多个颜色，必须填写颜色'}`)
      continue
    }
    const key = `${product.id}:${colorKey(color)}:${size.toLowerCase()}`
    if (seen.has(key)) {
      errors.push(`第 ${row.rowNumber} 行：${product.code} 的 ${color} / ${size} 码重复填写`)
      continue
    }
    seen.add(key)
    const change = changes.get(product.id)
    if (location) {
      if (change.location && change.location !== location) {
        errors.push(`第 ${row.rowNumber} 行：${product.code} 的货位与前面填写不一致`)
        continue
      }
      change.location = location
    }
    change.colorSizeStocks[color][size] = quantity
    matchedRows += 1
  }

  if (errors.length) throw new Error(errors.slice(0, 12).join('；'))

  const applied = matchedRows > 0
  if (applied) {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const { product, colorSizeStocks, location } of changes.values()) updateProduct(product.id, { colorSizeStocks, subtitle: location })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    format: 'template',
    applied,
    rowsRead: rows.length,
    rowsUpdated: matchedRows,
    unmatchedRowsCount: unmatchedRows.length,
    unmatchedRows,
    productsUpdated: applied ? changes.size : 0,
    locationsUpdated: applied ? [...changes.values()].filter(change => change.location).length : 0,
    locationsCleared: applied ? [...changes.values()].filter(change => !change.location).length : 0,
    products: [...changes.values()].map(({ product }) => getProduct(product.id))
  }
}

export function importWarehouseInventory(rows, options = {}) {
  const { changes, summary, diagnostics } = buildWarehouseInventoryPlan(rows, listProducts(), {
    productMappings: listInventoryProductMappings()
  })
  const applied = summary.matchedProducts > 0
  db.exec('BEGIN IMMEDIATE')
  try {
    if (applied) {
      for (const change of changes) updateProduct(change.product.id, { colorSizeStocks: change.colorSizeStocks })
    }
    replaceInventoryImportMatchesUnsafe(diagnostics.matchedGroups, {
      sourceFileName: options.sourceFileName
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    ...summary,
    applied,
    matchedSourceGroups: diagnostics.matchedGroups.length,
    unmatchedRows: diagnostics.unmatchedRows
  }
}

function cleanInventoryMappingText(value, maximum = 300) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum)
}

export function listInventoryProductMappings() {
  return db.prepare(`
    SELECT
      mapping.source_name,
      mapping.source_internal_code,
      mapping.product_id,
      mapping.target_color,
      mapping.created_at,
      mapping.updated_at,
      product.code AS product_code,
      product.name AS product_name,
      product.status AS product_status
    FROM inventory_product_mappings AS mapping
    JOIN products AS product ON product.id = mapping.product_id
    ORDER BY mapping.updated_at DESC, mapping.source_name COLLATE NOCASE ASC, product.code COLLATE NOCASE ASC
  `).all().map(row => ({
    sourceName: row.source_name,
    sourceInternalCode: row.source_internal_code,
    productId: Number(row.product_id),
    targetColor: row.target_color,
    productCode: row.product_code,
    productName: row.product_name,
    productStatus: row.product_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

export function listInventoryImportMatches() {
  return db.prepare(`
    SELECT
      match.source_name,
      match.source_internal_code,
      match.product_id,
      match.match_method,
      match.source_file_name,
      match.matched_rows,
      match.matched_quantity,
      match.source_rows,
      match.source_quantity,
      match.color,
      match.imported_at,
      product.code AS product_code,
      product.name AS product_name,
      product.status AS product_status
    FROM inventory_import_matches AS match
    JOIN products AS product ON product.id = match.product_id
    ORDER BY match.source_name COLLATE NOCASE ASC, product.code COLLATE NOCASE ASC
  `).all().map(row => ({
    sourceName: row.source_name,
    sourceInternalCode: row.source_internal_code,
    productId: Number(row.product_id),
    productCode: row.product_code,
    productName: row.product_name,
    productStatus: row.product_status,
    matchMethod: row.match_method,
    sourceFileName: row.source_file_name,
    matchedRows: Number(row.matched_rows),
    matchedQuantity: Number(row.matched_quantity),
    sourceRows: Number(row.source_rows),
    sourceQuantity: Number(row.source_quantity),
    color: row.color,
    importedAt: row.imported_at
  }))
}

function replaceInventoryImportMatchesUnsafe(matches = [], options = {}) {
  const sourceFileName = cleanInventoryMappingText(options.sourceFileName, 300)
  const importedAt = cleanInventoryMappingText(options.importedAt, 60) || new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO inventory_import_matches (
      source_name, source_internal_code, product_id, match_method, source_file_name,
      matched_rows, matched_quantity, source_rows, source_quantity, color, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.prepare('DELETE FROM inventory_import_matches').run()
  for (const match of Array.isArray(matches) ? matches : []) {
    const sourceName = cleanInventoryMappingText(match.sourceName)
    const sourceInternalCode = cleanInventoryMappingText(match.sourceInternalCode, 120)
    const productId = Number(match.productId)
    if (!sourceName || !Number.isInteger(productId) || productId <= 0) continue
    insert.run(
      sourceName,
      sourceInternalCode,
      productId,
      match.matchMethod === 'manual' ? 'manual' : 'automatic',
      sourceFileName,
      Math.max(0, Math.round(Number(match.matchedRows) || 0)),
      Math.round(Number(match.matchedQuantity) || 0),
      Math.max(0, Math.round(Number(match.sourceRows) || 0)),
      Math.round(Number(match.sourceQuantity) || 0),
      cleanInventoryMappingText(match.color, 120),
      importedAt
    )
  }
}

export function replaceInventoryImportMatches(matches = [], options = {}) {
  db.exec('BEGIN IMMEDIATE')
  try {
    replaceInventoryImportMatchesUnsafe(matches, options)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listInventoryImportMatches()
}

export function upsertInventoryProductMapping(input = {}) {
  return replaceInventoryProductMappings({
    sourceName: input.sourceName,
    sourceInternalCode: input.sourceInternalCode,
    mappings: [{ productId: input.productId, targetColor: input.targetColor }]
  })[0]
}

export function replaceInventoryProductMappings(input = {}) {
  const sourceName = cleanInventoryMappingText(input.sourceName)
  const sourceInternalCode = cleanInventoryMappingText(input.sourceInternalCode, 120)
  if (!sourceName) throw new Error('来源商品名称不能为空')
  const requestedMappings = Array.isArray(input.mappings) ? input.mappings : []
  if (!requestedMappings.length) throw new Error('请至少选择一个要对应的数据库商品')
  if (requestedMappings.length > 2) throw new Error('一个 Excel 库存名称最多对应两个小程序商品')

  const seenProductIds = new Set()
  const mappings = requestedMappings.map((mapping, index) => {
    const productId = Number(mapping?.productId)
    if (!Number.isInteger(productId) || productId <= 0) throw new Error(`第 ${index + 1} 个对应商品无效，请重新选择`)
    if (seenProductIds.has(productId)) throw new Error('两个对应位置不能选择同一个小程序商品')
    seenProductIds.add(productId)
    const product = getProduct(productId)
    if (!product) throw new Error(`第 ${index + 1} 个小程序商品不存在`)
    let targetColor = cleanInventoryMappingText(mapping?.targetColor, 120)
    if (product.colors.length === 1 && !targetColor) targetColor = product.colors[0]
    if (product.colors.length > 1 && !targetColor) throw new Error(`第 ${index + 1} 个商品有多个颜色，请选择具体颜色`)
    if (targetColor && !product.colors.includes(targetColor)) throw new Error(`第 ${index + 1} 个商品所选颜色不存在，请重新选择`)
    return { productId, targetColor }
  })

  const existingCreatedAt = new Map(db.prepare(`
    SELECT product_id, created_at
    FROM inventory_product_mappings
    WHERE source_name = ? AND source_internal_code = ?
  `).all(sourceName, sourceInternalCode).map(row => [Number(row.product_id), row.created_at]))
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO inventory_product_mappings (
      source_name, source_internal_code, product_id, target_color, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      DELETE FROM inventory_product_mappings
      WHERE source_name = ? AND source_internal_code = ?
    `).run(sourceName, sourceInternalCode)
    for (const mapping of mappings) {
      insert.run(
        sourceName,
        sourceInternalCode,
        mapping.productId,
        mapping.targetColor,
        existingCreatedAt.get(mapping.productId) || now,
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listInventoryProductMappings().filter(item => item.sourceName === sourceName && item.sourceInternalCode === sourceInternalCode)
}

export function deleteInventoryProductMapping(input = {}) {
  const sourceName = cleanInventoryMappingText(input.sourceName)
  const sourceInternalCode = cleanInventoryMappingText(input.sourceInternalCode, 120)
  if (!sourceName) throw new Error('来源商品名称不能为空')
  return db.prepare(`
    DELETE FROM inventory_product_mappings
    WHERE source_name = ? AND source_internal_code = ?
  `).run(sourceName, sourceInternalCode).changes > 0
}

export function deleteProduct(id) {
  return db.prepare('DELETE FROM products WHERE id = ?').run(Number(id)).changes > 0
}

export function reorderProducts(ids) {
  const orderedIds = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : []
  const existingIds = db.prepare('SELECT id FROM products').all().map(row => row.id)
  if (
    orderedIds.length !== existingIds.length
    || new Set(orderedIds).size !== existingIds.length
    || existingIds.some(id => !orderedIds.includes(id))
  ) throw new Error('商品排序数据不完整，请刷新后台后重试')

  const update = db.prepare('UPDATE products SET sort_order = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    orderedIds.forEach((id, index) => update.run((orderedIds.length - index) * 10, now, id))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listProducts()
}

export function listCategories() {
  const categories = db.prepare(`
    SELECT category.*, (SELECT COUNT(*) FROM products WHERE status = 'published' AND products.category = category.name) AS count
    FROM catalog_categories AS category
    ORDER BY category.sort_order DESC, category.id ASC
  `).all().map(mapCategory)
  const published = listProducts({ status: 'published' })
  const savedOrders = db.prepare('SELECT category_id, product_id, sort_order FROM category_product_order ORDER BY sort_order DESC, product_id DESC').all()
  return categories.map(category => {
    const products = published.filter(product => (product.categories && product.categories.length ? product.categories : [product.category]).includes(category.name))
    const validIds = new Set(products.map(product => product.id))
    const savedIds = savedOrders.filter(item => item.category_id === category.id && validIds.has(item.product_id)).map(item => item.product_id)
    const savedSet = new Set(savedIds)
    const productIds = savedIds.concat(products.filter(product => !savedSet.has(product.id)).map(product => product.id))
    return { ...category, count: productIds.length, productIds }
  })
}

export function createCategory(input = {}) {
  const name = String(input.name || '').trim().slice(0, 30)
  if (!name) throw new Error('请填写新分类名称')
  const image = cleanImageReference(input.image, '分类图片')
  const icon = String(input.icon || name.slice(0, 2)).trim().slice(0, 8) || name.slice(0, 2)
  const tone = String(input.tone || '#8fa594').trim().slice(0, 20) || '#8fa594'
  const minimum = db.prepare('SELECT MIN(sort_order) AS value FROM catalog_categories').get().value || 0
  const key = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const result = db.prepare('INSERT INTO catalog_categories (category_key, name, type, image_url, icon, tone, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    key, name, 'normal', image, icon, tone, minimum - 10, new Date().toISOString()
  )
  return listCategories().find(category => category.id === Number(result.lastInsertRowid))
}

export function updateCategory(id, input = {}) {
  const currentRow = db.prepare('SELECT * FROM catalog_categories WHERE id = ?').get(Number(id))
  const current = mapCategory(currentRow)
  if (!current) return null
  const name = String(input.name ?? current.name).trim().slice(0, 30)
  if (!name) throw new Error('分类名称不能为空')
  const image = cleanImageReference(input.image ?? current.image, '分类图片')
  const icon = String(input.icon ?? current.icon ?? name.slice(0, 2)).trim().slice(0, 8) || name.slice(0, 2)
  const tone = String(input.tone ?? current.tone ?? '#8fa594').trim().slice(0, 20) || '#8fa594'
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    if (current.type === 'normal' && name !== current.name) {
      db.prepare('UPDATE products SET category = ?, updated_at = ? WHERE category = ?').run(name, now, current.name)
      for (const productRow of db.prepare('SELECT id, categories_json FROM products WHERE categories_json LIKE ?').all(`%"${current.name}"%`)) {
        const list = fromJson(productRow.categories_json)
        if (list.includes(current.name)) db.prepare('UPDATE products SET categories_json = ? WHERE id = ?').run(JSON.stringify([...new Set(list.map(item => item === current.name ? name : item))]), productRow.id)
      }
    }
    db.prepare('UPDATE catalog_categories SET name = ?, image_url = ?, icon = ?, tone = ?, updated_at = ? WHERE id = ?').run(name, image, icon, tone, now, Number(id))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listCategories().find(category => category.id === Number(id)) || null
}

export function deleteCategory(id) {
  const currentRow = db.prepare('SELECT * FROM catalog_categories WHERE id = ?').get(Number(id))
  const current = mapCategory(currentRow)
  if (!current) return null
  const productRows = db.prepare('SELECT id, category, categories_json FROM products').all()
  const updateProductCategories = db.prepare('UPDATE products SET category = ?, categories_json = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  let affectedProducts = 0

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const product of productRows) {
      const savedCategories = fromJson(product.categories_json)
      const categories = savedCategories.length ? savedCategories : (product.category ? [product.category] : [])
      if (product.category !== current.name && !categories.includes(current.name)) continue

      const remaining = categories.filter(name => name !== current.name)
      const primary = product.category === current.name ? (remaining[0] || '未分类') : product.category
      const nextCategories = [...new Set([primary, ...remaining].filter(Boolean))]
      updateProductCategories.run(primary || '未分类', JSON.stringify(nextCategories.length ? nextCategories : ['未分类']), now, product.id)
      affectedProducts += 1
    }
    db.prepare('DELETE FROM catalog_categories WHERE id = ?').run(Number(id))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { id: current.id, name: current.name, affectedProducts }
}

export function reorderCategories(ids) {
  const orderedIds = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : []
  const existing = db.prepare('SELECT id FROM catalog_categories').all().map(row => row.id)
  if (orderedIds.length !== existing.length || new Set(orderedIds).size !== existing.length || existing.some(id => !orderedIds.includes(id))) throw new Error('分类排序数据不完整')
  const update = db.prepare('UPDATE catalog_categories SET sort_order = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    orderedIds.forEach((id, index) => update.run((orderedIds.length - index) * 10, now, id))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listCategories()
}

export function reorderCategoryProducts(categoryId, ids) {
  const category = listCategories().find(item => item.id === Number(categoryId))
  if (!category) return null
  const orderedIds = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : []
  if (orderedIds.length !== category.productIds.length || new Set(orderedIds).size !== category.productIds.length || category.productIds.some(id => !orderedIds.includes(id))) throw new Error('分类商品排序数据不完整')
  const clear = db.prepare('DELETE FROM category_product_order WHERE category_id = ?')
  const insert = db.prepare('INSERT INTO category_product_order (category_id, product_id, sort_order) VALUES (?, ?, ?)')
  db.exec('BEGIN')
  try {
    clear.run(category.id)
    orderedIds.forEach((productId, index) => insert.run(category.id, productId, (orderedIds.length - index) * 10))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listCategories().find(item => item.id === category.id)
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count
  if (count) return
  const shared = {
    images: ['/images/polo-grid.jpg'],
    detailText: '精选团体服装面料，版型利落，支持企业标识刺绣、印花及多尺码团购定制。图片为商品实物展示，颜色以实际到货为准。',
    detailImages: ['/images/polo-grid.jpg'],
    realImages: [{ url: '/images/polo-grid.jpg', category: '实物展示' }],
    colors: ['藏青', '浅绿', '珊瑚橙', '米白'],
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    status: 'published',
    seasonalNew: false
  }
  createProduct({ ...shared, code: 'YZ2601', name: '精梳棉商务翻领 POLO 衫', subtitle: '企业团体定制 · 男女同款', category: '2026新品', categories: ['2026新品', '当季上新'], price: 69, sizeStocks: { S: 18, M: 22, L: 26, XL: 28, '2XL': 20, '3XL': 14 }, unit: '件', fabric: '珠地精梳棉', style: '通勤 / 团体', badge: '新品', sortOrder: 40 })
  createProduct({ ...shared, code: 'YZ2598', name: '冰感速干轻商务 POLO 衫', subtitle: '吸湿排汗 · 夏季推荐', category: '夏季速干', price: 58, sizeStocks: { S: 0, M: 1, L: 2, XL: 3, '2XL': 2, '3XL': 0 }, unit: '件', fabric: '冰感速干纤维', style: '运动 / 通勤', badge: '热销', sortOrder: 30 })
  createProduct({ ...shared, code: 'YZ2516', name: '企业活动纯棉圆领 T 恤', subtitle: '柔软亲肤 · 团体文化衫', category: '圆领T恤', price: 36, sizeStocks: { S: 30, M: 46, L: 58, XL: 52, '2XL': 34, '3XL': 16 }, unit: '件', fabric: '220g精梳棉', style: '休闲 / 活动', badge: '定制', sortOrder: 20 })
  createProduct({ ...shared, code: 'YZ2488', name: '行政职业装短袖套装', subtitle: '挺括有型 · 支持绣标', category: '职业套装', price: 188, sizeStocks: { S: 0, M: 0, L: 0, XL: 0, '2XL': 0, '3XL': 0 }, unit: '套', fabric: '高密抗皱面料', style: '行政 / 商务', badge: '精选', sortOrder: 10 })
}

seed()
for (const row of db.prepare('SELECT DISTINCT category FROM products').all()) ensureCatalogCategory(row.category)

const seedStock = new Map([['YZ2601', 128], ['YZ2598', 8], ['YZ2516', 236], ['YZ2488', 0]])
if (stockWasAdded) {
  for (const [code, stock] of seedStock) {
    db.prepare('UPDATE products SET stock = ? WHERE code = ?').run(stock, code)
  }
}

if (sizeStocksWasAdded) {
  const demoSizeStocks = new Map([
    ['YZ2601', { S: 18, M: 22, L: 26, XL: 28, '2XL': 20, '3XL': 14 }],
    ['YZ2598', { S: 0, M: 1, L: 2, XL: 3, '2XL': 2, '3XL': 0 }],
    ['YZ2516', { S: 30, M: 46, L: 58, XL: 52, '2XL': 34, '3XL': 16 }],
    ['YZ2488', { S: 0, M: 0, L: 0, XL: 0, '2XL': 0, '3XL': 0 }]
  ])
  for (const row of db.prepare('SELECT id, code, stock, sizes_json FROM products').all()) {
    const sizes = fromJson(row.sizes_json)
    const sizeStocks = demoSizeStocks.get(row.code) || distributeStock(row.stock, sizes)
    db.prepare('UPDATE products SET size_stocks_json = ?, stock = ? WHERE id = ?').run(
      JSON.stringify(sizeStocks),
      Object.values(sizeStocks).reduce((total, quantity) => total + quantity, 0),
      row.id
    )
  }
}

if (detailTextWasAdded || detailImagesWasAdded || realImagesWasAdded) {
  for (const row of db.prepare('SELECT id, subtitle, images_json, detail_text, detail_images_json, real_images_json FROM products').all()) {
    const images = fromJson(row.images_json)
    const detailText = row.detail_text || `${row.subtitle || '团体服装定制'}。支持企业标识刺绣、印花及多尺码团购。`
    const detailImages = fromJson(row.detail_images_json).length ? fromJson(row.detail_images_json) : images
    const realImages = fromJson(row.real_images_json).length ? fromJson(row.real_images_json) : images.map(url => ({ url, category: '实物展示' }))
    db.prepare('UPDATE products SET detail_text = ?, detail_images_json = ?, real_images_json = ? WHERE id = ?').run(
      detailText, toJson(detailImages), toJson(realImages), row.id
    )
  }
}
