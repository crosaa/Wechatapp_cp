// 抖店 stock sync, the browser part. A headless Chromium with its own profile (DATA_DIR/douyin-browser) is logged in to
// 抖店 once by scanning a 抖店App QR code shown in the admin page; each sync then exports 抖店's 商品库存模版, plans the
// changes (douyin-stock-plan.mjs) and imports them through 商品管理 → 更多操作 → Excel导入 → 库存.
// The isolated worker starts one attempt per day at 21:00 Beijing time; login only renews the session.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listDouyinCatalogProducts } from './douyin-catalog.mjs'
import { scheduledSyncDay } from './douyin-schedule.mjs'
import { planDouyinStock, readStockTemplate, writeStockImport } from './douyin-stock-plan.mjs'

const dataDir = resolve(process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url)))
const profileDir = join(dataDir, 'douyin-browser')
const workDir = join(dataDir, 'douyin-sync')
const statePath = join(dataDir, 'douyin-sync.json')
// [{ douyinId, productId, title }]: which mini program product each listed 抖店 product is.
const mappingPath = join(dataDir, 'douyin-products.json')
const shopName = process.env.DOUYIN_SHOP_NAME || '普润户外服饰店'
const LOGIN = 'https://fxg.jinritemai.com/login/common'
const LIST = 'https://fxg.jinritemai.com/ffa/g/list?tab=all'
const RECORDS = 'https://fxg.jinritemai.com/ffa/g/batch-edit-record'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
const saveState = () => {
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 1))
  renameSync(`${statePath}.tmp`, statePath)
}
let task = null // { kind: 'login' | 'sync', startedAt }
let login = null // { status, qr, qrLeft, message, at }
// While a QR login runs: its page, and when it gives up (each action from the admin page extends it).
let loginPage = null
let loginDeadline = 0
let loginHoldUntil = 0 // the message shown after an action stays a few seconds while 抖店 works on it
let qrRefreshWanted = false // the admin page asked for a new code: the login loop reloads the login page
// 抖店's login code is good for about a minute; the login page then shows 二维码已过期 + 刷新, and the loop takes a new
// one. The whole QR login gives up after LOGIN_WINDOW without a scan.
const QR_LIFETIME = 60e3
const LOGIN_WINDOW = 10 * 60e3
const QR_STATUS = { 1: '等待扫码', 2: '已扫码', 3: '已确认', 4: '已取消', 5: '已过期' }
let syncTimer = null
let syncReason = ''
let pendingReason = ''

// Chromium's disk caches only hold copies of 抖店's scripts and pages. Left to grow (500 MB by 2026-11-10) they made a
// page hang now and then, and a hung page fails every retry (the login page "never answered"). They are emptied before
// each launch and kept small; cookies and the rest of the profile stay, so the login survives.
const CACHE_DIRS = [join('Default', 'Cache'), join('Default', 'Code Cache')]

async function launch() {
  const { chromium } = await import('playwright-core')
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  for (const dir of CACHE_DIRS) rmSync(join(profileDir, dir), { recursive: true, force: true })
  return chromium.launchPersistentContext(profileDir, {
    ...(process.env.DOUYIN_CHROME_PATH ? { executablePath: process.env.DOUYIN_CHROME_PATH } : { channel: 'chromium' }),
    headless: true,
    chromiumSandbox: false,
    acceptDownloads: true,
    locale: 'zh-CN',
    viewport: { width: 1400, height: 900 },
    args: ['--disable-dev-shm-usage', `--disk-cache-size=${64 * 1024 * 1024}`],
    env: { ...process.env, HOME: profileDir },
    // Playwright's own signal handlers would keep Node alive on SIGTERM; systemd stops the browser with the service.
    handleSIGTERM: false,
    handleSIGINT: false,
    handleSIGHUP: false
  })
}

// 抖店 now and then puts a notice over the page (a new-device reminder, a feature tour): close it the safe way —
// its close icon or a dismissing button, or its only button when that is all it has — and log what it said.
async function clearPopups(page) {
  for (let i = 0; i < 4; i++) {
    const modal = page.locator('.auxo-modal-wrap, .ecom-g-modal-wrap').locator('visible=true').first()
    if (!(await modal.count())) return
    console.log(`抖店弹窗：${(await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`)
    const close = modal.locator('.auxo-modal-close, .ecom-g-modal-close').locator('visible=true').first()
    const dismiss = modal.getByRole('button', { name: /我知道了|知道了|关闭|稍后|取消|跳过|暂不|以后再说/ }).locator('visible=true').first()
    const buttons = modal.getByRole('button').locator('visible=true')
    // The button's own click event: a mouse click can time out on the busy worker browser (see watchNotices).
    if (await close.count()) await close.dispatchEvent('click').catch(() => {})
    else if (await dismiss.count()) await dismiss.dispatchEvent('click').catch(() => {})
    else if (await buttons.count() === 1) await buttons.first().dispatchEvent('click').catch(() => {})
    else await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {})
  }
}

// 抖店 also raises notices on its own timer, minutes after a page opened: on 2026-11-10 a 商品质量分优化预警
// (知道了 / 去处理) came up seconds after the import file was picked and covered the drawer's 确定. Playwright runs
// this handler before any click or wait while such a notice shows. It only closes notices that offer a 知道了-type
// button and say nothing about the import, so the import's own 确定/取消 confirmation is never touched.
const NOTICE_BUTTON = /我知道了|知道了|已知晓|关闭|稍后|跳过|暂不|以后再说/
async function watchNotices(page) {
  const notice = page.locator('.auxo-modal-wrap:visible, .ecom-g-modal-wrap:visible')
    .filter({ has: page.getByRole('button', { name: NOTICE_BUTTON }) })
    .filter({ hasNotText: /导入|上传|提交|确定要/ })
    .first()
  await page.addLocatorHandler(notice, async modal => {
    console.log(`抖店弹窗（自动关闭）：${(await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`)
    const close = modal.locator('.auxo-modal-close:visible, .ecom-g-modal-close:visible').first()
    const target = await close.count() ? close : modal.getByRole('button', { name: NOTICE_BUTTON }).first()
    // A plain click on 知道了 kept timing out while the import drawer was open (2026-11-10). Firing the button's own
    // click closes it (1 s on a quiet page, longer while 抖店 exports); Escape and a forced click are the fallbacks.
    const ways = [[() => target.dispatchEvent('click'), 15000], [() => page.keyboard.press('Escape'), 5000], [() => target.click({ force: true, timeout: 10000 }), 5000]]
    for (const [attempt, wait] of ways) {
      await attempt().catch(error => console.warn(`抖店弹窗关闭失败：${error.message.split('\n')[0]}`))
      if (await modal.waitFor({ state: 'hidden', timeout: wait }).then(() => true, () => false)) return
    }
  })
}

// What any pop-up still on the page says, for the failure message.
async function popupText(page) {
  const texts = await page.locator('.auxo-modal-wrap:visible, .ecom-g-modal-wrap:visible').allInnerTexts().catch(() => [])
  return texts.map(text => text.replace(/\s+/g, ' ').slice(0, 120)).join('｜')
}

// 抖店's pages keep loading things for a long time (the login page after a redirect never fires load), so a page counts
// as open once its document is there; callers then wait for what they need. One retry for a slow network.
async function open(page, url) {
  const started = Date.now()
  const where = value => value.split('?')[0]
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 45000 })
  } catch (error) {
    console.warn(`抖店页面打开慢，重试：${where(url)}（${error.message.split('\n')[0]}，当时在 ${where(page.url())}）`)
    await page.goto(url, { waitUntil: 'commit', timeout: 45000 }).catch(retryError => {
      throw new Error(`打不开抖店页面 ${where(url)}（${Math.round((Date.now() - started) / 1000)} 秒）：${retryError.message.split('\n')[0]}`)
    })
  }
}

const bodyText = async page => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
const onLoginPage = page => /\/login/.test(page.url())

// The shop's day (Beijing time), whatever the server's clock zone is.
const shopDay = value => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })

export function douyinSyncStatus() {
  let mappingCount = 0
  try { mappingCount = JSON.parse(readFileSync(mappingPath, 'utf8')).length } catch {}
  return {
    shopName,
    syncedToday: Boolean(state.lastSuccessAt) && shopDay(state.lastSuccessAt) === shopDay(Date.now()),
    loggedIn: state.loggedIn ?? null,
    loginCheckedAt: state.loginCheckedAt || null,
    running: task?.kind || null,
    runningSince: task?.startedAt || null,
    scheduled: syncTimer ? syncReason : (pendingReason || null),
    login,
    lastRun: state.history?.[0] || null,
    lastSuccessAt: state.lastSuccessAt || null,
    history: (state.history || []).slice(0, 10),
    mappingCount
  }
}

function markLogin(loggedIn) {
  state.loggedIn = loggedIn
  state.loginCheckedAt = new Date().toISOString()
  saveState()
}

// Opens the QR login and returns once the code is shown (or the profile turns out to be logged in already).
// Waiting for the scan continues in the background for up to LOGIN_WINDOW, with a new code each minute.
export async function startDouyinLogin() {
  if (task?.kind === 'login') return douyinSyncStatus()
  if (task) throw new Error('正在同步抖店库存，请等同步结束后再扫码')
  task = { kind: 'login', startedAt: new Date().toISOString() }
  login = { status: 'starting', qr: null, message: '正在打开抖店登录页…', at: Date.now() }
  qrRefreshWanted = false
  let shown
  const ready = new Promise(resolve => { shown = resolve })
  ;(async () => {
    let context, page
    try {
      context = await launch()
      page = context.pages()[0] || await context.newPage()
      page.setDefaultTimeout(20000)
      loginPage = page
      // Maybe still logged in: then no QR code is needed. A logged-out profile is sent on to the login page by the list
      // page's own scripts, which can take a few seconds: wait for the login page or the shop name rather than a fixed
      // time. Skipped when the last check already found the login gone (the usual case for a QR login) - it only costs
      // time then; a login page that turns out to lead into the shop is still caught below.
      if (state.loggedIn !== false) {
        await open(page, LIST)
        await waitForShop(page)
        if (!onLoginPage(page) && (await bodyText(page)).includes(shopName)) return await finishLogin(page)
      }
      // What 抖店's own scan check says (1 waiting, 2 scanned, 3 confirmed, 5 expired), logged when it changes: shows
      // whether a scan reached 抖店 at all when a login does not finish.
      let qrStatus = ''
      page.on('response', response => {
        if (!response.url().includes('/check_qrconnect')) return
        response.json().then(body => {
          const status = String(body?.data?.status ?? '')
          if (status && status !== qrStatus) console.log(`抖店扫码状态：${QR_STATUS[status] || status}`)
          if (status) qrStatus = status
        }).catch(() => {})
      })
      const box = page.locator('.account-center-qrcode-image-container').first()
      // The code arrives as a data-URL background image of .account-center-image-content; it is passed on as it is
      // (element screenshots wait for the box to stop moving and time out on the busy server).
      const codeImage = () => page.evaluate(() => (document.querySelector('.account-center-image-content')?.style.backgroundImage.match(/url\("?(data:[^")]+)"?\)/) || [])[1] || null)
      // Brings up the code, checking every half second instead of fixed waits. 抖店 remembers the last login method and
      // the server's profile opens on 手机/邮箱登录 (no QR panel in the page, the corner switch .login-switcher--cell
      // shown): switch over. A QR panel whose code does not arrive is loaded once more. Returns once the code is there,
      // or the page left the login page (the profile was logged in after all).
      const showQr = async () => {
        const started = Date.now()
        let switchedAt = 0, reloaded = false
        while (Date.now() - started < 40000) {
          if (!onLoginPage(page) || await codeImage().catch(() => null)) return
          const panel = await box.count().catch(() => 0)
          if (!reloaded && Date.now() - started > 15000) {
            reloaded = true
            console.log('抖店扫码登录：二维码 15 秒没出来，重新打开登录页')
            await open(page, LOGIN)
            switchedAt = 0
          } else if (!panel && Date.now() - switchedAt > 4000 && await page.locator('.login-switcher--cell').first().isVisible().catch(() => false)) {
            await page.locator('.login-switcher--cell').first().click({ timeout: 3000 }).catch(() => {})
            switchedAt = Date.now()
          }
          await sleep(500)
        }
        throw new Error('抖店登录页 40 秒没出二维码')
      }
      const opening = Date.now()
      await open(page, LOGIN)
      // Other steps are passed on as a picture of the login box, taken by position.
      const cardShot = async () => {
        const area = await page.locator('.loginEntryContainer').first().boundingBox().catch(() => null)
        const shot = area && await page.screenshot({ clip: area, timeout: 15000 }).catch(() => null)
        return shot && `data:image/png;base64,${shot.toString('base64')}`
      }
      await showQr()
      console.log(`抖店扫码登录：登录页 ${((Date.now() - opening) / 1000).toFixed(1)} 秒出二维码（从开始共 ${((Date.now() - Date.parse(task.startedAt)) / 1000).toFixed(1)} 秒）`)
      loginDeadline = Date.now() + LOGIN_WINDOW
      let lastStep = ''
      let codeSeen = '', codeSince = 0, expiredTries = 0
      while (Date.now() < loginDeadline) {
        if (!onLoginPage(page)) return await finishLogin(page)
        // A new code asked for from the admin page, or 刷新 did not bring one: load the login page again.
        if (qrRefreshWanted) {
          qrRefreshWanted = false
          expiredTries = 0
          login = { status: 'waiting', qr: null, qrLeft: null, message: '正在换一张新的二维码…', at: Date.now() }
          console.log('抖店扫码登录：重新打开登录页换二维码')
          await open(page, LOGIN)
          await showQr().catch(error => console.warn(`抖店扫码登录：换二维码没成功：${error.message.split('\n')[0]}`))
          continue
        }
        // The QR panel's own text is empty; "expired" and "scanned" notices show up elsewhere on the page.
        const text = await bodyText(page)
        // An expired code is taken off the admin page at once (scanning it only gets 抖店 App's "二维码已过期"), then
        // replaced with the page's 刷新.
        if (/二维码已?(失效|过期)/.test(text)) {
          if (login.qr) console.log('抖店扫码登录：二维码过期，换新码')
          login = { status: 'waiting', qr: null, qrLeft: null, message: '这张二维码过期了，正在换新的…', at: Date.now() }
          await page.getByText(/刷新/).locator('visible=true').first().click({ timeout: 5000 }).catch(() => {})
          if (++expiredTries >= 4) qrRefreshWanted = true
          await sleep(1500)
          continue
        }
        expiredTries = 0
        const scanned = /扫码成功|手机上确认|确认登录|已扫码/.test(text)
        const code = !scanned && await box.isVisible() ? await codeImage() : null
        const codeShown = Boolean(code)
        if (code && code !== codeSeen) { codeSeen = code; codeSince = Date.now() }
        // An account with several shops is asked which one to enter (请选择店铺).
        if (!scanned && !codeShown && /请选择店铺/.test(text)) { await clickShop(page); continue }
        const shot = code || (scanned ? null : await cardShot())
        // A new device (the server) gets 抖店's 安全验证: an SMS code to the shop's phone, relayed by douyinLoginAction().
        const verifying = !scanned && !codeShown && /安全验证|身份验证/.test(text)
        const phone = verifying ? (await page.locator('input').evaluateAll(inputs => inputs.map(input => input.value).find(value => value.includes('*'))).catch(() => '')) || '' : ''
        const step = scanned ? 'scanned' : codeShown ? 'waiting' : verifying ? 'verify' : 'other'
        if (step !== lastStep) console.log(`抖店扫码登录：${step}｜${page.url()}｜${text.slice(0, 160)}`)
        // What the 安全验证 form is made of, for when relaying it fails.
        if (step === 'verify' && lastStep !== 'verify') {
          const parts = await page.locator('.loginEntryContainer input, .loginEntryContainer button, .loginEntryContainer [class*=btn], .loginEntryContainer [class*=button]').evaluateAll(es => es.map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}[${e.type || ''}|${e.placeholder || ''}|${e.readOnly ? 'ro' : ''}|${e.disabled ? 'off' : ''}|${(e.value || e.innerText || '').replace(/\d/g, '#').slice(0, 20)}|${e.offsetWidth ? 'shown' : 'hidden'}]`)).catch(() => [])
          console.log(`抖店安全验证表单：${parts.join(' ')}`)
        }
        lastStep = step
        if (Date.now() < loginHoldUntil) { await sleep(1500); continue }
        login = {
          status: step,
          qr: shot || (scanned ? null : login.qr),
          // Seconds this code can still be scanned (抖店 replaces it about a minute after it appears).
          qrLeft: codeShown ? Math.max(0, Math.round((codeSince + QR_LIFETIME - Date.now()) / 1000)) : null,
          message: scanned ? '已扫码，请在手机上点“确认登录”' : codeShown ? `打开抖店 App 扫一扫，登录「${shopName}」`
            : verifying ? `抖店要做安全验证：点“发送验证码”，把手机 ${phone || '（店铺登录手机）'} 收到的验证码填在下面，再点“验证”。`
              : '抖店还要再确认一步：直接在图片上点按钮或拖动，服务器会照着点。',
          at: Date.now()
        }
        shown()
        await sleep(1500)
      }
      login = { status: 'expired', qr: null, message: `${LOGIN_WINDOW / 60e3} 分钟内没有扫码，已停止。请点“重新获取二维码”再扫。`, at: Date.now() }
    } catch (error) {
      login = { status: 'error', qr: null, message: `打开抖店登录失败：${error.message.split('\n')[0]}`, at: Date.now() }
    } finally {
      // A login that did not finish leaves a picture of the page behind for diagnosis.
      if (login.status !== 'done' && page) {
        mkdirSync(workDir, { recursive: true })
        await page.screenshot({ path: join(workDir, 'login-last.png') }).catch(() => {})
        console.warn(`抖店扫码登录没有完成：${login.message}｜${page.url()}｜${(await bodyText(page)).slice(0, 200)}`)
      }
      shown()
      loginPage = null
      await context?.close().catch(() => {})
      task = null
      runPendingSync()
    }
  })()
  await Promise.race([ready, sleep(45000)])
  return douyinSyncStatus()
}

// Picks this shop on 抖店's 请选择店铺 step: only a visible entry, with a short wait (hidden copies of the name exist).
async function clickShop(page) {
  login = { status: 'entering', qr: null, message: `正在进入「${shopName}」…`, at: Date.now() }
  await page.getByText(shopName, { exact: true }).locator('visible=true').last().click({ timeout: 3000 }).catch(() => {})
  await sleep(3000)
}

// Ends a QR login that is still waiting (its browser closes within a couple of seconds).
export function stopDouyinLogin() {
  loginDeadline = 0
}

// The admin page's hands on the login page: 抖店's 安全验证 (send the SMS code, enter the code the owner typed) or any
// other step, clicked or dragged at the same spot as on the picture of the login box. Each action adds five minutes.
export async function douyinLoginAction({ action, code, x, y, toX, toY } = {}) {
  const page = loginPage
  if (task?.kind !== 'login' || !page) throw new Error('扫码登录已经结束，请重新扫码')
  loginDeadline = Math.max(loginDeadline, Date.now() + 5 * 60e3)
  const card = page.locator('.loginEntryContainer').first()
  // The hidden phone-login form stays in the page with its own 验证码 box and button: only visible ones count.
  const visible = locator => locator.locator('visible=true').first()
  console.log(`抖店扫码登录操作：${action}`)
  if (action === 'refresh') {
    // A new code: the login loop reloads the login page (it alone drives the page, so the two never collide).
    qrRefreshWanted = true
    login = { status: 'waiting', qr: null, qrLeft: null, message: '正在换一张新的二维码…', at: Date.now() }
    await sleep(500)
    return douyinSyncStatus()
  } else if (action === 'send-code') {
    await visible(page.getByText('发送验证码', { exact: true })).click({ timeout: 8000 })
  } else if (action === 'submit-code') {
    const digits = String(code || '').trim()
    if (!/^\d{4,8}$/.test(digits)) throw new Error('请填写短信里的数字验证码')
    // The code box: the last visible, editable input of the login box that is not the masked phone number
    // (its "验证码" may be a label drawn over it rather than a placeholder).
    const inputs = card.locator('input:not([type=hidden]):not([type=checkbox])').locator('visible=true')
    let input = null
    for (let i = 0; i < await inputs.count(); i++) {
      const candidate = inputs.nth(i)
      if (await candidate.isEditable().catch(() => false) && !(await candidate.inputValue().catch(() => '')).includes('*')) input = candidate
    }
    if (input) {
      await input.click({ timeout: 8000 })
      await input.fill('')
      await page.keyboard.type(digits, { delay: 60 })
    } else {
      // No recognisable box: type into whatever is focused (the owner can click the box on the picture first).
      await page.keyboard.type(digits, { delay: 60 })
    }
    await sleep(300)
    await visible(page.getByRole('button', { name: /^验\s*证$/ }).or(page.getByText(/^验\s*证$/))).click({ timeout: 8000 })
      .catch(() => page.keyboard.press('Enter'))
    login = { status: 'entering', qr: null, message: '已提交验证码，抖店正在登录，请稍等…', at: Date.now() }
    loginHoldUntil = Date.now() + 8000
  } else if (action === 'click' || action === 'drag') {
    const box = await card.boundingBox()
    const spot = (fx, fy) => {
      if (!Number.isFinite(Number(fx)) || !Number.isFinite(Number(fy))) throw new Error('点击位置不对')
      return [box.x + Math.min(Math.max(Number(fx), 0), 1) * box.width, box.y + Math.min(Math.max(Number(fy), 0), 1) * box.height]
    }
    if (!box) throw new Error('抖店登录框不见了，请重新扫码')
    const [sx, sy] = spot(x, y)
    if (action === 'click') {
      await page.mouse.click(sx, sy)
    } else {
      const [ex, ey] = spot(toX, toY)
      await page.mouse.move(sx, sy)
      await page.mouse.down()
      for (let i = 1; i <= 20; i++) { await page.mouse.move(sx + (ex - sx) * i / 20, sy + (ey - sy) * i / 20); await sleep(25) }
      await page.mouse.up()
    }
  } else {
    throw new Error('不认识的操作')
  }
  await sleep(1500)
  return douyinSyncStatus()
}

// The shop name in 抖店's top bar is drawn well after the rest of the page (sometimes 10 s and more): wait for it,
// or for the login page, before judging which shop (if any) the profile is in.
async function waitForShop(page) {
  for (let i = 0; i < 60; i++) {
    if (onLoginPage(page) || (await bodyText(page)).includes(shopName)) return
    await sleep(500)
  }
}

// After the scan: make sure the profile is in the right shop (an account can own several).
async function finishLogin(page) {
  login = { status: 'entering', qr: null, message: `正在进入「${shopName}」…`, at: Date.now() }
  await open(page, LIST)
  await waitForShop(page)
  let text = await bodyText(page)
  // A 请选择店铺 step (an account with several shops) is answered with this shop.
  if (!text.includes(shopName) || /请选择店铺/.test(text)) {
    await clickShop(page)
    await open(page, LIST)
    await waitForShop(page)
    text = await bodyText(page)
  }
  console.log(`抖店扫码登录后：${page.url()}｜${text.slice(0, 160)}`)
  if (onLoginPage(page)) {
    markLogin(false)
    login = { status: 'error', qr: null, message: '登录没有完成，请重新扫码', at: Date.now() }
  } else if (!text.includes(shopName)) {
    markLogin(false)
    login = { status: 'error', qr: null, message: `扫码登录的不是「${shopName}」，请在抖店 App 切换到这个店铺后重新扫码`, at: Date.now() }
  } else {
    markLogin(true)
    login = { status: 'done', qr: null, message: `已登录「${shopName}」，库存将在每天北京时间 21:00 同步`, at: Date.now() }
    // Login never starts an inventory sync.
  }
}

// Queues a sync. Automatic ones (after an import, the daily check) only run once the shop has been logged in.
export function requestDouyinSync(reason, delayMs = 0, { automatic = false } = {}) {
  if (automatic && state.loggedIn !== true) return douyinSyncStatus()
  if (task) { pendingReason = reason; return douyinSyncStatus() }
  clearTimeout(syncTimer)
  syncReason = reason
  syncTimer = setTimeout(() => { syncTimer = null; runSync(reason) }, delayMs)
  syncTimer.unref?.()
  return douyinSyncStatus()
}

function runPendingSync() {
  if (!pendingReason) return
  const reason = pendingReason
  pendingReason = ''
  requestDouyinSync(reason, 5000)
}

// Claim before starting, so failures and worker restarts cannot cause another daily attempt.
export function runScheduledDouyinSync(now = new Date()) {
  const day = scheduledSyncDay(now, state.lastScheduledDay)
  if (!day) return douyinSyncStatus()
  state.lastScheduledDay = day
  saveState()
  if (task) {
    state.history = [{ at: now.toISOString(), finishedAt: now.toISOString(), reason: '每日21点同步',
      status: 'error', message: '扫码登录尚未结束，今日同步跳过，请完成登录后等待明晚21点' }, ...(state.history || [])].slice(0, 30)
    saveState()
  } else {
    // runSync checks login itself and records a failure if login has expired. No automatic retries.
    void runSync('每日21点同步')
  }
  return douyinSyncStatus()
}

// Rows of 批量操作记录, e.g. "2026-10-23 11:36:58 ID:792671108385946917 商品库存模版导出 已完成 - - - 下载".
async function records(page) {
  await open(page, RECORDS)
  // The table fills in after the page; read too early, every old record would look new. It took 29–36 s on a quiet
  // afternoon and over 90 s during the 21:00 syncs of 2026-11-11 and 11-12, so it gets three minutes.
  await page.locator('tbody tr').filter({ hasText: 'ID:' }).first().waitFor({ timeout: 180000 })
  await sleep(1000)
  await clearPopups(page)
  return page.locator('tbody tr').evaluateAll(rows => rows.map(row => {
    const m = row.innerText.replace(/\s+/g, ' ').match(/(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) ID:(\d+) (\S+) (\S+) (\S+) (\S+) (\S+)/)
    return m && { id: m[2], time: m[1], type: m[3], status: m[4], total: m[5], ok: m[6], failed: m[7] }
  }).filter(Boolean))
}

// The worker's browser holds one 抖店 page at a time, each step in a new tab. Two pages (the product list about 550 MB
// and the records about 400 MB) overran the worker's 900 MB and the browser stalled on memory, so pages took minutes
// to load (the failed 21:00 syncs of 2026-11-10 to 11-12); one tab reused for everything still grew to 740 MB.
async function freshPage(context) {
  const old = context.pages()
  const page = await context.newPage()
  for (const other of old) await other.close().catch(() => {})
  page.setDefaultTimeout(20000)
  // A "leave this page?" prompt would be dismissed by Playwright, which cancels the navigation: accept it.
  page.on('dialog', dialog => dialog.accept().catch(() => {}))
  await watchNotices(page)
  return page
}

// Clicks something that sends a request to 抖店 (下载模版, the import's 确定) and waits until the requests it started
// have answered, so closing the tab for the next step cannot cut one off.
async function clickAndSettle(page, click, timeout = 60000) {
  const pending = new Set()
  let watching = true
  const onRequest = request => { if (watching && ['xhr', 'fetch'].includes(request.resourceType())) pending.add(request) }
  const onEnd = request => pending.delete(request)
  page.on('request', onRequest)
  page.on('requestfinished', onEnd)
  page.on('requestfailed', onEnd)
  try {
    await click()
    await sleep(3000)
    watching = false
    const deadline = Date.now() + timeout
    while (pending.size && Date.now() < deadline) await sleep(500)
    if (pending.size) console.warn(`抖店还有 ${pending.size} 个请求 ${timeout / 1000} 秒没回：${[...pending].map(r => new URL(r.url()).pathname).join('、')}`)
  } finally {
    page.off('request', onRequest)
    page.off('requestfinished', onEnd)
    page.off('requestfailed', onEnd)
  }
}

// The IDs already in the records, read before an export or import (up to three tries on the slow server).
async function recordIds(context) {
  for (let attempt = 1; ; attempt++) {
    try {
      return new Set((await records(await freshPage(context))).map(r => r.id))
    } catch (error) {
      if (attempt >= 3) throw error
      console.warn(`抖店批量操作记录没打开（第 ${attempt} 次），再试：${error.message.split('\n')[0]}`)
      await sleep(10000)
    }
  }
}

// Waits for a record that was not there before, until it is finished; gives back the record and the tab showing it.
// One slow load of the records page no longer ends the sync: it is logged and the next look tries again. Each look
// loads the whole 抖店 page, which keeps the CPU-limited browser busy, so looks are 20 s apart.
async function waitRecord(context, before, type, minutes = 15) {
  const deadline = Date.now() + minutes * 60e3
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const page = await freshPage(context)
      const row = (await records(page)).find(r => !before.has(r.id) && type.test(r.type))
      if (row && /已完成|失败|部分/.test(row.status)) return { row, page }
    } catch (error) {
      lastError = error
      console.warn(`抖店批量操作记录这次没打开，20 秒后再看：${error.message.split('\n')[0]}`)
    }
    await sleep(20000)
  }
  throw new Error(`等了 ${minutes} 分钟，抖店批量操作记录里还没有完成的「${type.source}」${lastError ? `（记录页最后一次：${lastError.message.split('\n')[0]}）` : ''}`)
}

// Opens 商品管理 in a new tab and its Excel导入 drawer set to 库存.
async function openStockImport(context) {
  const page = await freshPage(context)
  await open(page, LIST)
  // The shop header can be ready long before the product toolbar, especially in the CPU-limited worker.
  // Wait for the actual control instead of assuming a fixed five-second delay is enough.
  const more = page.locator('#batchOperation:visible')
  await more.waitFor({ state: 'visible', timeout: 150000 })
  await clearPopups(page)
  await more.hover({ timeout: 60000 })
  const excel = page.getByText('Excel导入', { exact: true }).locator('visible=true').first()
  await excel.waitFor({ state: 'visible', timeout: 30000 })
  await excel.click({ timeout: 30000 })
  const drawer = page.locator('.ecom-g-drawer-open:visible').filter({ hasText: 'Excel导入' }).last()
  await drawer.waitFor({ state: 'visible', timeout: 45000 })
  await drawer.locator('.ecom-g-select').first().click({ timeout: 30000 })
  await sleep(1000)
  await page.locator('.ecom-g-select-dropdown').locator('visible=true').last().locator('.ecom-g-select-item-option').filter({ hasText: /^库存$/ }).first().click({ timeout: 60000 })
  await sleep(1200)
  return { page, drawer }
}

async function runSync(reason) {
  if (task) { pendingReason = reason; return }
  task = { kind: 'sync', startedAt: new Date().toISOString() }
  const entry = { at: task.startedAt, reason, status: 'error', message: '' }
  let context
  let stage = '打开商品页并检查登录'
  const step = name => console.log(`抖店同步步骤：${name}（${Math.round((Date.now() - Date.parse(entry.at)) / 1000)} 秒）`)
  // Two record waits of up to 15 minutes each fit in, with the export, upload and slow page loads around them.
  const timeout = setTimeout(() => context?.close().catch(() => {}), 45 * 60e3)
  try {
    mkdirSync(workDir, { recursive: true })
    context = await launch()
    // Product photos and media are unnecessary for stock operations and inflate browser memory.
    await context.route('**/*', route => ['image', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue())
    const page = await freshPage(context)
    await open(page, LIST)
    await waitForShop(page)
    if (onLoginPage(page)) { markLogin(false); throw new Error('抖店登录已失效，请在后台「抖店同步」重新扫码登录') }
    if (!(await bodyText(page)).includes(shopName)) throw new Error(`现在登录的不是「${shopName}」，已停止同步`)
    markLogin(true)
    step('已登录，开始导出库存模板')

    // A fresh template, so the 增加/减少 amounts start from 抖店's current stock.
    const tag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    stage = '读取导出记录'
    const before = await recordIds(context)
    stage = '打开库存模板导出窗口'
    const { page: exportPage, drawer: exportDrawer } = await openStockImport(context)
    await clickAndSettle(exportPage, () => exportDrawer.getByText('下载模版', { exact: true }).click({ timeout: 60000 }))
    stage = '等待库存模板导出完成'
    const { row: exported, page: recordsPage } = await waitRecord(context, before, /库存模版导出/)
    stage = '下载库存模板'
    const download = recordsPage.waitForEvent('download', { timeout: 120000 }) // the click itself may take up to 60 s
    await recordsPage.locator('tbody tr').filter({ hasText: exported.id }).getByText('下载', { exact: true }).click({ timeout: 60000 })
    const templatePath = join(workDir, `${tag}-template.xlsx`)
    await (await download).saveAs(templatePath)
    step('模板已下载')

    let mapping = []
    try { mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) } catch {}
    const template = readFileSync(templatePath)
    stage = '计算库存差异'
    const plan = planDouyinStock({ rows: readStockTemplate(template), products: listDouyinCatalogProducts(), mapping })
    Object.assign(entry, { skus: plan.skus, changed: plan.changes.length, unmatched: plan.unmatched.length })
    entry.unmatchedSample = plan.unmatched.slice(0, 5).map(row => `${row.title.slice(-10)} ${row.spec}：${row.reason}`)

    if (process.env.DOUYIN_SYNC_DRY_RUN) {
      // Back to the product list and its stock drawer, as an import goes; never upload or submit in a check.
      stage = '验证库存导入窗口（不上传、不提交）'
      const { drawer } = await openStockImport(context)
      await drawer.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30000 })
      writeStockImport(template, plan.changes) // validate generation without submitting it
      entry.message = `试算：${plan.changes.length} 个 SKU 要改，${plan.same} 个一致（没有导入）`
    } else if (plan.changes.length) {
      const importPath = join(workDir, `${tag}-import.xlsx`)
      writeFileSync(importPath, writeStockImport(template, plan.changes))
      stage = '读取导入记录'
      const before2 = await recordIds(context)
      stage = '打开库存导入窗口'
      const { page: importPage, drawer } = await openStockImport(context)
      stage = '上传并提交库存文件'
      // Longer limits than the page default: closing a notice that pops up first (watchNotices) counts against them.
      await drawer.locator('input[type=file]').setInputFiles(importPath, { timeout: 60000 })
      await sleep(3000)
      await clearPopups(importPage)
      await clickAndSettle(importPage, () => drawer.getByRole('button', { name: /确\s*定/ }).click({ timeout: 60000 }))
      const confirm = importPage.locator('.ecom-g-modal, .auxo-modal').locator('visible=true').getByRole('button', { name: /确\s*定|确\s*认|继\s*续/ })
      if (await confirm.count()) await clickAndSettle(importPage, () => confirm.last().click({ timeout: 60000 }))
      step(`已提交导入 ${plan.changes.length} 个 SKU`)
      stage = '确认抖店导入结果'
      const { row: done } = await waitRecord(context, before2, /库存导入/)
      entry.recordId = done.id
      if (!/已完成/.test(done.status) || Number(done.failed) > 0) throw new Error(`抖店导入结果：${done.status}，成功 ${done.ok}，失败 ${done.failed}`)
      entry.message = `改了 ${plan.changes.length} 个 SKU（${new Set(plan.changes.map(c => c.productId)).size} 个商品）`
    } else {
      entry.message = `${plan.skus} 个 SKU 都和小程序一致`
    }
    if (plan.unmatched.length) entry.message += `；${plan.unmatched.length} 个 SKU 对不上小程序，没改`
    entry.status = 'ok'
    state.lastSuccessAt = new Date().toISOString()
    console.log(`抖店库存同步完成（${reason}）：${entry.message}`)
  } catch (error) {
    entry.stage = stage
    entry.message = `${stage}：${error.message.split('\n')[0]}`
    const page = context?.pages().at(-1)
    const popups = page ? await popupText(page) : ''
    if (popups) entry.message += `（页面上的弹窗：${popups}）`
    console.warn(`抖店库存同步失败：${entry.message}｜${page?.url() || ''}\n${error.message.slice(0, 3000)}`)
    // A failed sync leaves a picture of the page behind, like a failed login (the busy server can take a while).
    if (page) await page.screenshot({ path: join(workDir, 'sync-last.png'), timeout: 30000, animations: 'disabled' }).catch(() => {})
  } finally {
    clearTimeout(timeout)
    await context?.close().catch(() => {})
    entry.finishedAt = new Date().toISOString()
    state.history = [entry, ...(state.history || [])].slice(0, 30)
    saveState()
    pruneWorkFiles()
    task = null
    runPendingSync()
  }
}

// Keeps the files of the last 20 runs.
function pruneWorkFiles() {
  try {
    const files = readdirSync(workDir).map(name => join(workDir, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const file of files.slice(40)) unlinkSync(file)
  } catch {}
}
