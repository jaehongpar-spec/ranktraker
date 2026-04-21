const axios = require('axios')
const cheerio = require('cheerio')

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': 'https://www.coupang.com/'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function randomDelay(min = 10000, max = 20000) {
  return sleep(Math.floor(Math.random() * (max - min) + min))
}

async function searchRank(keyword, productId) {
  const results = { natural: null, adRanks: [], totalScanned: 0 }

  try {
    const pages = 3
    let naturalRank = null
    let adRankList = []
    let overallPosition = 0

    for (let page = 1; page <= pages; page++) {
      await sleep(Math.floor(Math.random() * 2000 + 1000))

      const url = `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(keyword)}&channel=user&page=${page}`

      const res = await axios.get(url, {
        headers: HEADERS,
        timeout: 15000,
        maxRedirects: 3
      })

      const $ = cheerio.load(res.data)
      const items = $('ul.search-product-list li.search-product, ul#productList li.search-product')

      if (items.length === 0) break

      items.each((i, el) => {
        overallPosition++
        const $el = $(el)

        const isAd = $el.hasClass('search-product--ad') ||
          $el.find('.ad-badge, [class*="ad-"]').length > 0 ||
          $el.find('em.ad').length > 0

        const href = $el.find('a.search-product-link, a[href*="/vp/products/"]').attr('href') || ''
        const itemId = href.match(/\/products\/(\d+)/)?.[1] || ''

        if (itemId === String(productId)) {
          if (isAd) {
            adRankList.push(overallPosition)
          } else {
            if (naturalRank === null) naturalRank = overallPosition
          }
        }
      })

      results.totalScanned = overallPosition
    }

    results.natural = naturalRank
    results.adRanks = adRankList

  } catch (err) {
    console.error(`크롤링 오류 [${keyword}]:`, err.message)
    results.error = err.message
  }

  return results
}

module.exports = { searchRank, randomDelay }
