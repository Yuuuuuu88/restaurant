require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Client } = require("pg");

const app = express();

// 讓前端可以呼叫 API（如果你之後用同一個 server serve 前端，其實不一定需要 cors）
app.use(cors());
app.use(express.json());

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

// 單一連線 MVP 版
const pg = new Client({ connectionString: DATABASE_URL });

/**
 * ✅ 讓後端也能 serve 你專案根目錄的靜態檔
 * 你的結構是：
 *   F00D/
 *     index.html, detail.html, app.js
 *     backend/server.js
 * 所以靜態檔路徑是 backend 的上一層（..）
 */
const FRONTEND_DIR = path.join(__dirname, "..");
app.use(express.static(FRONTEND_DIR));

// 直接打 http://localhost:3001 會回 index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

/**
 * GET /api/restaurants
 * Query params:
 *  - q: 關鍵字（店名）
 *  - open: true/false（只看現在營業）
 *  - limit: 筆數（預設 30）
 *  - sort: rating | reviews | price（預設 rating）
 */
app.get("/api/restaurants", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const open = req.query.open === "true";
    const limit = Math.min(parseInt(req.query.limit || "30", 10), 100);
    const sort = req.query.sort || "rating";

    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(`r.name ILIKE $${i++}`);
      params.push(`%${q}%`);
    }

    if (open) {
      where.push(`r.opening_now = true`);
    }

    const orderBy =
      sort === "reviews"
        ? "r.user_ratings_total DESC NULLS LAST"
        : sort === "price"
        ? "r.price_level ASC NULLS LAST"
        : "r.rating DESC NULLS LAST";

    const sql = `
      SELECT
        r.id,
        r.google_place_id,
        r.name,
        r.address,
        r.lat,
        r.lng,
        r.rating,
        r.user_ratings_total,
        r.price_level,
        r.opening_now,
        r.business_status,
        r.phone,
        r.website,
        r.google_maps_url,
        r.delivery,
        r.dine_in,
        r.takeout,
        r.reservable,
        r.wheelchair_accessible_entrance,
        r.details_fetched_at,
        (
          SELECT p.photo_reference
          FROM restaurant_photos p
          WHERE p.restaurant_id = r.id
          ORDER BY p.id ASC
          LIMIT 1
        ) AS photo_reference
      FROM restaurants r
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${i++}
    `;
    params.push(limit);

    const result = await pg.query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error("GET /api/restaurants error:", err);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// 取得單一餐廳
app.get("/api/restaurants/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pg.query(
      `SELECT *
       FROM restaurants
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ ok: false, error: "NOT_FOUND" });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error("GET /api/restaurants/:id error:", err);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// 健康檢查
app.get("/api/health", async (req, res) => {
  try {
    const r = await pg.query("SELECT NOW() as now");
    res.json({ ok: true, db_time: r.rows[0].now });
  } catch (e) {
    console.error("DB health check failed:", e);
    res.status(500).json({ ok: false, error: "DB_NOT_CONNECTED" });
  }
});

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await pg.connect();
    console.log("✅ Connected to PostgreSQL");
  } catch (e) {
    console.error("❌ Failed to connect PostgreSQL. Check DATABASE_URL:", e.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running: http://localhost:${PORT}`);
    console.log(`✅ API health:     http://localhost:${PORT}/api/health`);
    console.log(`✅ Restaurants:    http://localhost:${PORT}/api/restaurants`);
  });
}

start();