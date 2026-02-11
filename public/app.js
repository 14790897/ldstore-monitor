// --- State ---
let config = { keywords: [], excludeKeywords: [], telegram: { bot_token: "", chat_id: "" } };
let vapidPublicKey = "";

// --- Init ---
document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();
  await loadStatus();
  await loadVapidKey();
  checkPushStatus();
  bindEvents();
});

// --- API Helpers ---
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// --- Config ---
async function loadConfig() {
  config = await api("/api/config");
  renderTags("kw-tags", config.keywords, false);
  renderTags("ex-tags", config.excludeKeywords, true);
  document.getElementById("tg-token").value = config.telegram.bot_token || "";
  document.getElementById("tg-chatid").value = config.telegram.chat_id || "";
}

async function saveConfig() {
  config.telegram.bot_token = document.getElementById("tg-token").value.trim();
  config.telegram.chat_id = document.getElementById("tg-chatid").value.trim();
  await api("/api/config", "PUT", config);
  showToast("配置已保存");
}

// --- Tags ---
function renderTags(containerId, list, isExclude) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  list.forEach((kw, i) => {
    const tag = document.createElement("span");
    tag.className = `tag${isExclude ? " exclude" : ""}`;
    tag.innerHTML = `${escapeHtml(kw)}<button data-idx="${i}">&times;</button>`;
    tag.querySelector("button").addEventListener("click", () => {
      list.splice(i, 1);
      renderTags(containerId, list, isExclude);
    });
    container.appendChild(tag);
  });
}

function addKeyword(inputId, list, containerId, isExclude) {
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val || list.includes(val)) return;
  list.push(val);
  renderTags(containerId, list, isExclude);
  input.value = "";
}

// --- Push Notifications ---
async function loadVapidKey() {
  const data = await api("/api/vapid-public-key");
  vapidPublicKey = data.key || "";
}

function checkPushStatus() {
  const statusEl = document.getElementById("push-status");
  const btnEl = document.getElementById("btn-push");

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusEl.textContent = "浏览器不支持推送";
    btnEl.disabled = true;
    return;
  }

  navigator.serviceWorker.getRegistration().then(async (reg) => {
    if (!reg) { statusEl.textContent = "未订阅"; return; }
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      statusEl.textContent = "已订阅";
      btnEl.textContent = "关闭浏览器通知";
    } else {
      statusEl.textContent = "未订阅";
      btnEl.textContent = "开启浏览器通知";
    }
  });
}

async function togglePush() {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await api("/api/subscribe", "DELETE", { endpoint: existing.endpoint });
    await existing.unsubscribe();
    checkPushStatus();
    showToast("已关闭浏览器通知");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast("通知权限被拒绝");
    return;
  }

  if (!vapidPublicKey) {
    showToast("VAPID 公钥未配置");
    return;
  }

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await api("/api/subscribe", "POST", subscription.toJSON());
  checkPushStatus();
  showToast("已开启浏览器通知");
}

// --- Status ---
async function loadStatus() {
  const data = await api("/api/status");
  const infoEl = document.getElementById("status-info");
  const listEl = document.getElementById("updates-list");

  if (!data.timestamp) {
    infoEl.textContent = "尚未执行过检查";
    listEl.innerHTML = "";
    return;
  }

  const time = new Date(data.timestamp).toLocaleString("zh-CN");
  infoEl.textContent = `上次检查: ${time} | 扫描 ${data.totalProducts} 个商品 | 匹配 ${data.matchedCount} 个`;

  if (!data.updates || data.updates.length === 0) {
    listEl.innerHTML = '<div class="update-item"><div class="detail">暂无更新</div></div>';
    return;
  }

  listEl.innerHTML = data.updates.map((u) => `
    <div class="update-item">
      <div class="reason">${escapeHtml(u.reason)} | ${u.hasStock ? "有货" : "无货"}</div>
      <div class="detail">
        <strong>${escapeHtml(u.product.name)}</strong><br>
        价格: ${u.product.price} LDC (${u.product.discount * 10}折) | 库存: ${escapeHtml(u.stockText)}<br>
        卖家: ${escapeHtml(u.product.seller_name)}<br>
        <a href="https://ldst0re.qzz.io/product/${u.product.id}" target="_blank">查看商品</a>
      </div>
    </div>
  `).join("");
}

async function manualCheck() {
  const btn = document.getElementById("btn-check");
  btn.classList.add("loading");
  btn.textContent = "检查中...";
  try {
    await api("/api/check", "POST");
    await loadStatus();
    showToast("检查完成");
  } catch {
    showToast("检查失败");
  } finally {
    btn.classList.remove("loading");
    btn.textContent = "手动检查";
  }
}

// --- Events ---
function bindEvents() {
  document.getElementById("btn-push").addEventListener("click", togglePush);
  document.getElementById("btn-save").addEventListener("click", saveConfig);
  document.getElementById("btn-check").addEventListener("click", manualCheck);

  document.getElementById("btn-add-kw").addEventListener("click", () => {
    addKeyword("kw-input", config.keywords, "kw-tags", false);
  });
  document.getElementById("kw-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addKeyword("kw-input", config.keywords, "kw-tags", false);
  });

  document.getElementById("btn-add-ex").addEventListener("click", () => {
    addKeyword("ex-input", config.excludeKeywords, "ex-tags", true);
  });
  document.getElementById("ex-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addKeyword("ex-input", config.excludeKeywords, "ex-tags", true);
  });
}

// --- Utils ---
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:9999;transition:opacity 0.3s;";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 2000);
}
