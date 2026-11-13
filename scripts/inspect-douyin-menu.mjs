// Read-only browser diagnosis against a copied login profile; never submits stock changes.
import { cpSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { chromium } from 'playwright-core'
const liveData = process.env.DATA_DIR
if (!liveData) throw new Error('DATA_DIR required')
const scratch = mkdtempSync(join(dirname(liveData), 'douyin-menu-check-'))
const profile = join(scratch, 'profile')
cpSync(join(liveData, 'douyin-browser'), profile, { recursive: true, filter: source => !/Singleton/.test(source) && !source.split(/[\\/]/).some(part => ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'Crashpad', 'BrowserMetrics'].includes(part)) })
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.DOUYIN_CHROME_PATH ? { executablePath: process.env.DOUYIN_CHROME_PATH } : { channel: 'chromium' }),
    headless: true, chromiumSandbox: false, viewport: { width: 1400, height: 900 },
    locale: 'zh-CN', args: ['--disable-dev-shm-usage'], env: { ...process.env, HOME: profile }
  })
  const page = context.pages()[0] || await context.newPage()
  page.on('dialog', dialog => dialog.accept().catch(() => {}))
  await page.goto('https://fxg.jinritemai.com/ffa/g/list?tab=all', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByText('更多操作', { exact: true }).last().waitFor({ timeout: 90000 })
  console.log('BUTTON_COUNT', await page.getByRole('button', { name: '更多操作' }).count())
  console.log('ELEMENTS', JSON.stringify(await page.getByText('更多操作', { exact: true }).evaluateAll(es => es.map(e => ({
    tag: e.tagName, role: e.getAttribute('role'), cls: e.className,
    parent: e.parentElement.outerHTML.slice(0, 1800), box: e.getBoundingClientRect().toJSON()
  })))))
  try {
    await page.getByRole('button', { name: '更多操作' }).locator('visible=true').first().hover({ timeout: 15000 })
    console.log('ORIGINAL_HOVER_OK')
  } catch (error) { console.log('ORIGINAL_HOVER_ERROR', error.message) }
  console.log('MENUS', JSON.stringify(await page.getByText('Excel导入', { exact: true }).evaluateAll(es => es.map(e => ({
    tag: e.tagName, role: e.getAttribute('role'), parent: e.parentElement.outerHTML.slice(0, 1800), visible: !!e.getClientRects().length
  })))))
  // Locating by visible text also works for component wrappers that have no button role.
  await page.getByText('更多操作', { exact: true }).locator('visible=true').first().hover({ timeout: 15000 })
  await page.getByText('Excel导入', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10000 })
  console.log('TEXT_HOVER_OK')
  mkdirSync(join(liveData, 'douyin-sync'), { recursive: true })
  await page.screenshot({ path: join(liveData, 'douyin-sync/menu-check.png') })
} finally {
  await context?.close()
  rmSync(scratch, { recursive: true, force: true })
}
