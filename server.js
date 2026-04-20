const express = require('express')
const cron = require('node-cron')
const path = require('path')
const db = require('./db')
const { searchRank, randomDelay } = require('./crawler')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── 상품 API ──────────────────────────────────────

app.get('/api/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, COUNT(k.id) as keyword_count
    FROM products p
    LEFT JOIN keywords k ON k.product_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all()
  res.json(products)
})

app.post('/api/products', (req, res) => {
  const { name, product_id, url, image_url } = req.body
  if (!name || !product_id) return res.status(400).json({ error: '상품명과 상품ID는 필수입니다' })

  const existing = db.prepare('SELECT id FROM products WHERE product_id = ?').get(product_id)
  if (existing) return res.status(400).json({ error: '이미 등록된 상품ID입니다' })

  const result = db.prepare(
    'INSERT INTO products (name, product_id, url, image_url) VALUES (?, ?, ?, ?)'
  ).run(name, product_id, url || '', image_url || '')

  res.json({ id: result.lastInsertRowid, name, product_id })
})

app.put('/api/products/:id', (req, res) => {
  const { name, product_id, url, image_url } = req.body
  db.prepare(`
    UPDATE products SET name=?, product_id=?, url=?, image_url=?, updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(name, product_id, url || '', image_url || '', req.params.id)
  res.json({ ok: true })
})

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── 키워드 API ────────────────────────────────────

app.get('/api/products/:id/keywords', (req, res) => {
  const keywords = db.prepare('SELECT * FROM keywords WHERE product_id=? ORDER BY created_at').all(req.params.id)
  res.json(keywords)
})

app.post('/api/products/:id/keywords', (req, res) => {
  const { keyword } = req.body
  if (!keyword) return res.status(400).json({ error: '키워드를 입력하세요' })

  const count = db.prepare('SELECT COUNT(*) as c FROM keywords WHERE product_id=?').get(req.params.id)
  if (count.c >= 10) return res.status(400).json({ error: '키워드는 최대 10개까지 등록 가능합니다' })

  const dup = db.prepare('SELECT id FROM keywords WHERE product_id=? AND keyword=?').get(req.params.id, keyword)
  if (dup) return res.status(400).json({ error: '이미 등록된 키워드입니다' })

  const result = db.prepare('INSERT INTO keywords (product_id, keyword) VALUES (?, ?)').run(req.params.id, keyword)
  res.json({ id: result.lastInsertRowid, keyword })
})

app.put('/api/keywords/:id', (req, res) => {
  const { keyword } = req.body
  db.prepare('UPDATE keywords SET keyword=? WHERE id=?').run(keyword, req.params.id)
  res.json({ ok: true })
})

app.delete('/api/keywords/:id', (req, res) => {
  db.prepare('DELETE FROM keywords WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── 순위 API ──────────────────────────────────────

app.get('/api/products/:id/ranks', (req, res) => {
  const { days = 14 } = req.query
  const rows = db.prepare(`
    SELECT r.*, k.keyword
    FROM ranks r
    JOIN keywords k ON k.id = r.keyword_id
    WHERE r.product_id = ?
      AND r.date >= date('now', '-' || ? || ' days')
    ORDER BY k.keyword, r.date DESC
  `).all(req.params.id, days)
  res.json(rows)
})

// 수동 크롤링 트리거
app.post('/api/crawl/:productId', async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.productId)
  if (!product) return res.status(404).json({ error: '상품 없음' })

  res.json({ ok: true, message: '크롤링을 시작했습니다. 잠시 후 새로고침하세요.' })
  crawlProduct(product)
})

app.post('/api/crawl-all', async (req, res) => {
  res.json({ ok: true, message: '전체 크롤링을 시작했습니다.' })
  runDailyCrawl()
})

// ── 크롤링 로직 ───────────────────────────────────

async function crawlProduct(product) {
  const keywords = db.prepare('SELECT * FROM keywords WHERE product_id=?').all(product.id)
  const today = new Date().toISOString().slice(0, 10)

  console.log(`[${product.name}] 크롤링 시작 (${keywords.length}개 키워드)`)

  for (const kw of keywords) {
    console.log(`  키워드: ${kw.keyword}`)
    const result = await searchRank(kw.keyword, product.product_id)

    const adMin = result.adRanks.length > 0 ? Math.min(...result.adRanks) : null
    const adMax = result.adRanks.length > 0 ? Math.max(...result.adRanks) : null

    db.prepare(`
      INSERT INTO ranks (keyword_id, product_id, date, natural_rank, ad_rank_min, ad_rank_max, total_scanned, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(keyword_id, date) DO UPDATE SET
        natural_rank=excluded.natural_rank,
        ad_rank_min=excluded.ad_rank_min,
        ad_rank_max=excluded.ad_rank_max,
        total_scanned=excluded.total_scanned,
        error=excluded.error
    `).run(kw.id, product.id, today, result.natural, adMin, adMax, result.totalScanned, result.error || null)

    await randomDelay(3000, 7000)
  }

  console.log(`[${product.name}] 크롤링 완료`)
}

async function runDailyCrawl() {
  const products = db.prepare('SELECT * FROM products').all()
  console.log(`[일일 크롤링] 시작 - ${products.length}개 상품`)

  for (const product of products) {
    await crawlProduct(product)
    await randomDelay(5000, 10000)
  }

  console.log('[일일 크롤링] 완료')
}

// 매일 오전 7시 (KST = UTC+9, so UTC 22:00 전날)
cron.schedule('0 22 * * *', () => {
  console.log('[CRON] 일일 순위 크롤링 시작')
  runDailyCrawl()
}, { timezone: 'UTC' })

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`)
})
