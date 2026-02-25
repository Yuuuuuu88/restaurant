let stores = [];
let likedStores = JSON.parse(localStorage.getItem("likedStores")) || [];

const priceMap = {
  1: "NT$100~200",
  2: "NT$200~400",
  3: "NT$400~600",
  4: "NT$600以上",
};

// ⚠️ 先用前端直連 Places Photo（key 會暴露在前端）
// 你如果不想暴露 key，下一步我會幫你改成後端 /api/photo proxy
const GOOGLE_MAPS_API_KEY = ""; // 先留空也沒關係，會回退 placeholder
function photoUrl(photo_reference) {
  if (!photo_reference) return null;
  if (!GOOGLE_MAPS_API_KEY) return null;

  const maxwidth = 800;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${encodeURIComponent(
    photo_reference
  )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
}

function render() {
  const keyword = (document.getElementById("search")?.value || "").trim();
  const container = document.getElementById("cards");
  if (!container) return;

  container.innerHTML = "";

  stores
    // 先依愛心排序（有愛心在前）
    .sort((a, b) => {
      const aLiked = likedStores.includes(a.id) ? 1 : 0;
      const bLiked = likedStores.includes(b.id) ? 1 : 0;
      return bLiked - aLiked;
    })
    // 搜尋：name/address
    .filter((s) => {
      if (!keyword) return true;
      const name = s.name || "";
      const address = s.address || "";
      return name.includes(keyword) || address.includes(keyword);
    })
    .forEach((store) => {
      const card = document.createElement("div");
      card.className = "card";

      card.onclick = () => {
        window.location.href = `detail.html?id=${store.id}`;
      };

      const isLiked = likedStores.includes(store.id);
      const img =
        photoUrl(store.photo_reference) ||
        "https://via.placeholder.com/220x150";

      card.innerHTML = `
        <div class="heart">${isLiked ? "❤️" : "🤍"}</div>
        <img src="${img}" alt="${store.name || ""}">
        <div class="card-info">
          <h3>${store.name || "(未命名)"}</h3>
          ${store.address ? `<p>📍 ${store.address}</p>` : ""}
          ${
            store.rating != null
              ? `<p>⭐ ${store.rating} (${store.user_ratings_total || 0}人評分)</p>`
              : ""
          }
          ${
            store.price_level != null
              ? `<p>💲 ${priceMap[store.price_level] || store.price_level}</p>`
              : ""
          }
          ${
            store.opening_now !== undefined && store.opening_now !== null
              ? `<p>營業中: ${store.opening_now ? "是" : "否"}</p>`
              : ""
          }
        </div>
      `;

      card.querySelector(".heart").onclick = (e) => {
        e.stopPropagation();
        if (likedStores.includes(store.id)) {
          likedStores = likedStores.filter((id) => id !== store.id);
        } else {
          likedStores.push(store.id);
        }
        localStorage.setItem("likedStores", JSON.stringify(likedStores));
        render();
      };

      container.appendChild(card);
    });
}

async function loadStores() {
  try {
    // ✅ 改成同源 API（搭配我們後端 server.js）
    const res = await fetch("/api/restaurants?limit=60&sort=rating");
    const payload = await res.json();

    if (!payload.ok) throw new Error(payload.error || "API_ERROR");

    stores = payload.data || [];
    render();
  } catch (err) {
    console.error("後端連接失敗", err);
    render();
  }
}

document.getElementById("search")?.addEventListener("input", render);

// 啟動
loadStores();