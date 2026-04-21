const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')
const { getDb } = require('./db')
const { searchRank, randomDelay } = require('./crawler')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

// 진행상황 브로드캐스트
function broadcast(data) {
  const msg = JSON.stringify(data)
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  })
}

wss.on('connection', ws => {
  ws.on('error', () => {})
})

// ── 상품 API ──────────────────────────────────────

app.get('/api/products', async (req, res) => {
  try {
    const db = await getDb()
    const products = await db.all(`
      SELECT p.*, COUNT(k.id) as keyword_count
      FROM products p
      LEFT JOIN keywords k ON k.product_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `)
    res.json(products)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/products', async (req, res) => {
  try {
    const { name, product_id, url, image_url } = req.body
    if (!name || !product_id) return res.status(400).json({ error: '상품명과 상품ID는 필수입니다' })
    const db = await getDb()
    const existing = await db.get('SELECT id FROM products WHERE product_id = ?', product_id)
    if (existing) return res.status(400).json({ error: '이미 등록된 상품ID입니다' })
    const result = await db.run(
      'INSERT INTO products (name, product_id, url, image_url) VALUES (?, ?, ?, ?)',
      name, product_id, url || '', image_url || ''
    )
    res.json({ id: result.lastID, name, product_id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, product_id, url } = req.body
    const db = await getDb()
    await db.run(
      `UPDATE products SET name=?, product_id=?, url=?, updated_at=datetime('now','localtime') WHERE id=?`,
      name, product_id, url || '', req.params.id
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/products/:id', async (req, res) => {
  try {
    const db = await getDb()
    await db.run('DELETE FROM products WHERE id=?', req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 키워드 API ────────────────────────────────────

app.get('/api/products/:id/keywords', async (req, res) => {
  try {
    const db = await getDb()
    const keywords = await db.all('SELECT * FROM keywords WHERE product_id=? ORDER BY created_at', req.params.id)
    res.json(keywords)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/products/:id/keywords', async (req, res) => {
  try {
    const { keyword } = req.body
    if (!keyword) return res.status(400).json({ error: '키워드를 입력하세요' })
    const db = await getDb()
    const count = await db.get('SELECT COUNT(*) as c FROM keywords WHERE product_id=?', req.params.id)
    if (count.c >= 10) return res.status(400).json({ error: '키워드는 최대 10개까지 등록 가능합니다' })
    const dup = await db.get('SELECT id FROM keywords WHERE product_id=? AND keyword=?', req.params.id, keyword)
    if (dup) return res.status(400).json({ error: '이미 등록된 키워드입니다' })
    const result = await db.run('INSERT INTO keywords (product_id, keyword) VALUES (?, ?)', req.params.id, keyword)
    res.json({ id: result.lastID, keyword })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/keywords/:id', async (req, res) => {
  try {
    const { keyword } = req.body
    const db = await getDb()
    await db.run('UPDATE keywords SET keyword=? WHERE id=?', keyword, req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/keywords/:id', async (req, res) => {
  try {
    const db = await getDb()
    await db.run('DELETE FROM keywords WHERE id=?', req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 순위 API ──────────────────────────────────────

app.get('/api/products/:id/ranks', async (req, res) => {
  try {
    const { days = 14 } = req.query
    const db = await getDb()
    const rows = await db.all(`
      SELECT r.*, k.keyword
      FROM ranks r
      JOIN keywords k ON k.id = r.keyword_id
      WHERE r.product_id = ?
        AND r.date >= date('now', '-' || ? || ' days')
      ORDER BY k.keyword, r.date DESC
    `, req.params.id, days)
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/health', (req, res) => res.json({ ok: true }))

// ── 크롤링 API ────────────────────────────────────

let crawling = false

app.post('/api/crawl/:productId', async (req, res) => {
  if (crawling) return res.status(429).json({ error: '이미 조회 중입니다. 잠시 후 다시 시도하세요.' })
  try {
    const db = await getDb()
    const product = await db.get('SELECT * FROM products WHERE id=?', req.params.productId)
    if (!product) return res.status(404).json({ error: '상품 없음' })
    res.json({ ok: true })
    crawlProduct(product)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 크롤링 로직 ───────────────────────────────────

async function crawlProduct(product) {
  if (crawling) return
  crawling = true

  const db = await getDb()
  const keywords = await db.all('SELECT * FROM keywords WHERE product_id=?', product.id)
  const today = new Date().toISOString().slice(0, 10)
  const total = keywords.length

  broadcast({ type: 'crawl_start', productName: product.name, total })

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i]

    broadcast({
      type: 'crawl_progress',
      current: i + 1,
      total,
      keyword: kw.keyword,
      status: 'searching'
    })

    const result = await searchRank(kw.keyword, product.product_id)
    const adMin = result.adRanks.length > 0 ? Math.min(...result.adRanks) : null
    const adMax = result.adRanks.length > 0 ? Math.max(...result.adRanks) : null

    await db.run(`
      INSERT INTO ranks (keyword_id, product_id, date, natural_rank, ad_rank_min, ad_rank_max, total_scanned, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(keyword_id, date) DO UPDATE SET
        natural_rank=excluded.natural_rank,
        ad_rank_min=excluded.ad_rank_min,
        ad_rank_max=excluded.ad_rank_max,
        total_scanned=excluded.total_scanned,
        error=excluded.error
    `, kw.id, product.id, today, result.natural, adMin, adMax, result.totalScanned, result.error || null)

    broadcast({
      type: 'crawl_progress',
      current: i + 1,
      total,
      keyword: kw.keyword,
      status: 'done',
      natural: result.natural,
      adMin,
      adMax,
      error: result.error || null
    })

    if (i < keywords.length - 1) {
      const delay = Math.floor(Math.random() * 10000 + 10000)
      broadcast({ type: 'crawl_waiting', keyword: kw.keyword, waitSec: Math.round(delay / 1000) })
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  broadcast({ type: 'crawl_done', productName: product.name })
  crawling = false
}

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`)
})
