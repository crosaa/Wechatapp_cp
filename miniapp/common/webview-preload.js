// WeChat gets a web view ready for the next page as soon as a page has opened. On Android that holds
// up the page on screen for 100-450 ms about a second after it opens, just when people start to
// scroll or pull it. So the pages ask WeChat not to ("handleWebviewPreload": "manual" in their json)
// and ask for it here instead, once a page has been showing for a while and nobody has touched it
// for a moment. iPhones ignore the request (WeChat handles it there by itself).

const SHOWN_FOR_MS = 2000
const UNTOUCHED_FOR_MS = 1200
// A finger that seems to stay down this long lost its touchend (the page was left meanwhile).
const STUCK_FINGER_MS = 8000

let ready = false // a web view for the next page is waiting
let page = null
let shownAt = 0
let touchedAt = 0
let fingerDown = false
let timer = null

function check() {
  clearTimeout(timer)
  timer = null
  if (ready || !page || getCurrentPages().slice(-1)[0] !== page) return
  const now = Date.now()
  if (fingerDown && now - touchedAt < STUCK_FINGER_MS) {
    timer = setTimeout(check, STUCK_FINGER_MS)
    return
  }
  const wait = Math.max(shownAt + SHOWN_FOR_MS, touchedAt + UNTOUCHED_FOR_MS) - now
  if (wait > 0) {
    timer = setTimeout(check, wait)
    return
  }
  ready = true
  if (typeof wx.preloadWebview === 'function') wx.preloadWebview()
}

// From a page's onShow. A page showing for the first time has taken the web view that was waiting.
function preloadNextPageWhenQuiet(shown) {
  if (!shown.nextPageWebviewTaken) {
    shown.nextPageWebviewTaken = true
    ready = false
  }
  page = shown
  shownAt = Date.now()
  fingerDown = false
  check()
}

// From the touchstart, touchend and touchcancel of a page's outermost view (capture-bind, so that
// no inner catch hides them).
function noteTouch(e) {
  touchedAt = Date.now()
  fingerDown = e.type === 'touchstart'
  check()
}

module.exports = { preloadNextPageWhenQuiet, noteTouch }
