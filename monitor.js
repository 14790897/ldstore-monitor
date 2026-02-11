const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CONFIG_PATH = path.join(__dirname, "config.json");

const DEFAULT_KEYWORDS = [
  "谷歌",
  "google",
  "gmail",
  "Google Voice",
  "GV",
  "Google Play",
  "Google One",
  "谷歌账号",
  "谷歌邮箱",
];

const API_BASE =
  "https://api2.ldspro.qzz.io/api/shop/products?pageSize=50&sortBy=updated_at&sortOrder=DESC";

// Token 过期提前提醒天数
const WARN_DAYS_BEFORE = 3;

// 已知商品状态 { id -> { stock, updated_at } }
const knownProducts = new Map();

// Token 过期已警告标记
let tokenExpireWarned = false;

/**
 * 加载配置，Token 优先环境变量，关键词和间隔从 config.json 读取
 */
function loadConfig() {
  let fileConfig = {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    fileConfig = JSON.parse(raw);
  } catch (err) {
    console.error(`  读取 config.json 失败: ${err.message}`);
  }

  return {
    token: process.env.LDSTORE_TOKEN || fileConfig.token || null,
    keywords:
      Array.isArray(fileConfig.keywords) && fileConfig.keywords.length > 0
        ? fileConfig.keywords
        : DEFAULT_KEYWORDS,
    interval: fileConfig.interval || 30,
    telegram: {
      enabled: !!fileConfig.telegram?.bot_token && !!fileConfig.telegram?.chat_id,
      bot_token: fileConfig.telegram?.bot_token || "",
      chat_id: fileConfig.telegram?.chat_id || "",
    },
  };
}

/**
 * 解码 JWT payload（不验证签名，仅提取信息）
 */
function decodeJWT(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * 检查 Token 状态，返回 { valid, daysLeft, expDate }
 */
function checkTokenStatus(token) {
  const payload = decodeJWT(token);
  if (!payload || !payload.exp) {
    return { valid: false, daysLeft: 0, expDate: null };
  }

  const now = Math.floor(Date.now() / 1000);
  const daysLeft = ((payload.exp - now) / 86400).toFixed(1);
  const expDate = new Date(payload.exp * 1000).toLocaleString("zh-CN");

  return {
    valid: now < payload.exp,
    daysLeft: parseFloat(daysLeft),
    expDate,
  };
}

function buildHeaders(token) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    origin: "https://ldst0re.qzz.io",
    referer: "https://ldst0re.qzz.io/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  };
}

function matchKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function fetchPage(page, headers) {
  const url = `${API_BASE}&page=${page}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function sendTelegram(text) {
  const config = loadConfig();
  if (!config.telegram.enabled) return;

  const url = `https://api.telegram.org/bot${config.telegram.bot_token}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.chat_id,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error(`  Telegram 通知失败: ${err.message}`);
  }
}

function notify(title, body) {
  // Telegram 通知
  sendTelegram(`<b>${title}</b>\n${body}`);

  // Windows 系统通知
  try {
    const psCmd = `
      [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
      $notify = New-Object System.Windows.Forms.NotifyIcon;
      $notify.Icon = [System.Drawing.SystemIcons]::Information;
      $notify.BalloonTipTitle = '${title.replace(/'/g, "''")}';
      $notify.BalloonTipText = '${body.replace(/'/g, "''")}';
      $notify.Visible = $true;
      $notify.ShowBalloonTip(10000);
      Start-Sleep -Seconds 5;
      $notify.Dispose();
    `;
    execSync(`powershell -Command "${psCmd.replace(/\n/g, " ")}"`, {
      stdio: "ignore",
      timeout: 10000,
    });
  } catch {
    // 通知失败不影响主流程
  }

  // 蜂鸣声
  try {
    execSync("powershell -Command [Console]::Beep(1000, 500)", {
      stdio: "ignore",
      timeout: 3000,
    });
  } catch {
    // ignore
  }
}

async function checkAllProducts() {
  const timestamp = new Date().toLocaleString("zh-CN");
  console.log(`\n[${timestamp}] 开始检查商品列表...`);

  // 每次检查重新读取配置（支持热更新）
  const config = loadConfig();
  if (!config.token) {
    console.log("  Token 为空，请设置环境变量 LDSTORE_TOKEN 或在 config.json 中填入 token");
    return;
  }

  // 检查 Token 过期状态
  const status = checkTokenStatus(config.token);
  if (!status.valid) {
    console.log("  ⚠️  Token 已过期！请重新登录 https://ldst0re.qzz.io/ 获取新 Token");
    console.log("  更新方法：将新 Token 粘贴到 config.json 的 token 字段中");
    notify("Token 已过期!", "请重新登录 ldst0re 获取新 Token 并更新 config.json");
    return;
  }

  if (status.daysLeft <= WARN_DAYS_BEFORE && !tokenExpireWarned) {
    console.log(`  ⚠️  Token 将在 ${status.daysLeft} 天后过期 (${status.expDate})`);
    console.log("  请尽快重新登录 https://ldst0re.qzz.io/ 获取新 Token");
    notify("Token 即将过期!", `还剩 ${status.daysLeft} 天，请尽快更新 config.json 中的 Token`);
    tokenExpireWarned = true;
  }

  const headers = buildHeaders(config.token);

  try {
    const firstPage = await fetchPage(1, headers);
    if (!firstPage.success) {
      console.log("  API 返回失败，可能 Token 已过期，请更新 config.json 中的 token");
      return;
    }

    const { totalPages } = firstPage.data.pagination;
    const allProducts = [...firstPage.data.products];

    for (let p = 2; p <= totalPages; p++) {
      const pageData = await fetchPage(p, headers);
      if (pageData.success) {
        allProducts.push(...pageData.data.products);
      }
    }

    console.log(`  共扫描 ${allProducts.length} 个商品 | Token 剩余 ${status.daysLeft} 天`);

    const matched = allProducts.filter((p) => {
      const text = `${p.name} ${p.description} ${p.category_name}`;
      return matchKeywords(text, config.keywords);
    });

    if (matched.length === 0) {
      console.log("  未发现关键词相关商品");
      return;
    }

    let hasUpdate = false;
    for (const p of matched) {
      const hasStock = p.stock === -1 || p.stock > 0;
      const stockText =
        p.stock === -1 ? "无限" : `${p.availableStock ?? p.stock}`;
      const prev = knownProducts.get(p.id);

      // 判断是否需要通知：新商品 或 库存从无到有 或 updated_at 变化
      const isNew = !prev;
      const restocked = prev && !prev.hasStock && hasStock;
      const updated = prev && prev.updated_at !== p.updated_at;

      knownProducts.set(p.id, { hasStock, updated_at: p.updated_at });

      if (!isNew && !restocked && !updated) continue;

      hasUpdate = true;
      const reason = isNew ? "🆕 新商品" : restocked ? "📦 补货" : "🔄 已更新";

      console.log(`\n  ${reason} | ${hasStock ? "✅ 有货" : "❌ 无货"}`);
      console.log(`  商品: ${p.name}`);
      console.log(`  价格: ${p.price} LDC (${p.discount * 10}折)`);
      console.log(`  库存: ${stockText}`);
      console.log(`  卖家: ${p.seller_name}`);
      console.log(`  链接: https://ldst0re.qzz.io/#/product/${p.id}`);
      console.log(`  描述: ${p.description.slice(0, 80)}...`);

      if (hasStock) {
        notify(
          "LD士多 - 商品更新!",
          `${reason} ${p.name} | ${p.price} LDC | 库存: ${stockText}`
        );
      }
    }

    if (!hasUpdate) {
      console.log(`  发现 ${matched.length} 个相关商品，无更新`);
    }
  } catch (err) {
    console.error(`  检查出错: ${err.message}`);
  }
}

// 启动信息
const config = loadConfig();
const status = config.token ? checkTokenStatus(config.token) : null;

console.log("=".repeat(50));
console.log("LD士多 商品监控");
console.log(`关键词: ${config.keywords.join(", ")}`);
console.log(`检查间隔: ${config.interval} 秒`);
if (status && status.valid) {
  console.log(`Token 过期时间: ${status.expDate} (剩余 ${status.daysLeft} 天)`);
}
console.log("=".repeat(50));

checkAllProducts();
setInterval(checkAllProducts, config.interval * 1000);
