// Scroll handle of a scroll-view marked `enhanced`. Its scrollTo is applied right away, unlike
// scroll-top and scroll-into-view, which wait for the next drawn frames; a section reset while it
// is out of sight is then already at the top when it shows again. The handle belongs to the page
// that is in front when it is looked up, so look it up from there (e.g. in a ready lifetime).
function findScrollHandle(page, selector, done) {
  page.createSelectorQuery().select(selector).node().exec(results => done(results?.[0]?.node || null))
}

// Puts a scroll-view back at the top at once (see findScrollHandle).
function scrollToTopNow(handle) {
  handle?.scrollTo({ top: 0, animated: false })
}

module.exports = { findScrollHandle, scrollToTopNow }
