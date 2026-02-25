/**
 * scripts/enrich_place_details.js
 *
 * 目的：
 *  - 從 restaurants 取出需要補 details 的店（details_fetched_at is null 或太久）
 *  - 用 Place Details API 抓更多細節
 *  - 更新 restaurants + 寫入 restaurant_photos
 *
 * 執行：
 *  node scripts/enrich_place_details.js
 */

require("dotenv").config();
const axios = require("axios");
const { Client } = require("pg");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!API_KEY) {
  console.error("Missing GOOGLE_MAPS_API_KEY in .env");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

// 只抓你用得到的 fields（省配額、省時間）
const DETAILS_FIELDS = [
  "place_id",
  "formatted_phone_number",
  "international_phone_number",
  "website",
  "url",
  "opening_hours",
  "utc_offset_minutes",
  "delivery",
  "dine_in",
  "takeout",
  "reservable",
  "wheelchair_accessible_entrance",
  "photos",
].join(",");

// 你可以調整：一次補幾家、每筆間隔幾 ms
const BATCH_LIMIT = 50;
const SLEEP_MS = 200;

// details 多少天更新一次（避免每次都重抓）
const REFRESH_DAYS = 14;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPlaceDetails(placeId) {
  const resp = await axios.get(DETAILS_URL, {
    params: {
      key: API_KEY,
      place_id: placeId,
      fields: DETAILS_FIELDS,
      language: "zh-TW",
    },
    timeout: 15000,
  });

  const data = resp.data;
  if (data.status !== "OK") {
    // 常見：NOT_FOUND / REQUEST_DENIED / OVER_QUERY_LIMIT
    throw new Error(`Details API error: ${data.status} ${data.error_message || ""}`);
  }
  return data.result;
}

async function pickTargets(pg) {
  const sql = `
    SELECT google_place_id
    FROM restaurants
    WHERE google_place_id IS NOT NULL
      AND (
        details_fetched_at IS NULL
        OR details_fetched_at < NOW() - INTERVAL '${REFRESH_DAYS} days'
      )
    ORDER BY details_fetched_at NULLS FIRST, updated_at DESC
    LIMIT $1
  `;
  const res = await pg.query(sql, [BATCH_LIMIT]);
  return res.rows.map((r) => r.google_place_id);
}

async function updateRestaurantDetails(pg, details) {
  const placeId = details.place_id;

  const phone = details.formatted_phone_number || null;
  const website = details.website || null;
  const googleMapsUrl = details.url || null;
  const utcOffset = details.utc_offset_minutes ?? null;

  const delivery = details.delivery ?? null;
  const dineIn = details.dine_in ?? null;
  const takeout = details.takeout ?? null;
  const reservable = details.reservable ?? null;
  const wheelchair = details.wheelchair_accessible_entrance ?? null;

  const openingHoursJson = details.opening_hours ? JSON.stringify(details.opening_hours) : null;

  const sql = `
    UPDATE restaurants
    SET
      phone = $1,
      website = $2,
      google_maps_url = $3,
      utc_offset_minutes = $4,
      delivery = $5,
      dine_in = $6,
      takeout = $7,
      reservable = $8,
      wheelchair_accessible_entrance = $9,
      opening_hours_json = $10,
      details_fetched_at = NOW(),
      updated_at = NOW()
    WHERE google_place_id = $11
  `;

  await pg.query(sql, [
    phone,
    website,
    googleMapsUrl,
    utcOffset,
    delivery,
    dineIn,
    takeout,
    reservable,
    wheelchair,
    openingHoursJson,
    placeId,
  ]);
}

async function upsertPhotos(pg, placeId, photos) {
  // 找 restaurant_id
  const r = await pg.query(`SELECT id FROM restaurants WHERE google_place_id = $1`, [placeId]);
  if (r.rowCount === 0) return;
  const restaurantId = r.rows[0].id;

  // 簡單版：先清空再重建（資料一致、邏輯簡單）
  await pg.query(`DELETE FROM restaurant_photos WHERE restaurant_id = $1`, [restaurantId]);

  if (!Array.isArray(photos) || photos.length === 0) return;

  const sql = `
    INSERT INTO restaurant_photos (restaurant_id, photo_reference, width, height)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (restaurant_id, photo_reference) DO NOTHING
  `;

  for (const p of photos) {
    if (!p.photo_reference) continue;
    await pg.query(sql, [
      restaurantId,
      p.photo_reference,
      p.width || null,
      p.height || null,
    ]);
  }
}

async function main() {
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  try {
    const targets = await pickTargets(pg);
    console.log(`Targets: ${targets.length}`);

    let ok = 0;
    let fail = 0;

    for (const placeId of targets) {
      try {
        const details = await fetchPlaceDetails(placeId);

        // 寫入：用 transaction 確保 restaurant + photos 同步
        await pg.query("BEGIN");
        await updateRestaurantDetails(pg, details);
        await upsertPhotos(pg, placeId, details.photos);
        await pg.query("COMMIT");

        ok++;
        console.log(`[OK] ${placeId}`);
      } catch (e) {
        fail++;
        try { await pg.query("ROLLBACK"); } catch (_) {}
        console.error(`[FAIL] ${placeId}: ${e.message}`);
      }

      await sleep(SLEEP_MS); // ✅ 限流
    }

    console.log(`Done. OK=${ok}, FAIL=${fail}`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
