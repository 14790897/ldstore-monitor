<script setup>
import { ref, computed, onMounted } from 'vue'
import TokenPage from './TokenPage.vue'

// --- State ---
const currentPage = ref('main')
const keywords = ref([])
const excludeKeywords = ref([])
const newKeyword = ref('')
const newExclude = ref('')
const targetPrice = ref(null)
const priceInput = ref('')
const products = ref([])
const loading = ref(false)
const pushEnabled = ref(false)
const pushLoading = ref(false)
const lastCheck = ref(null)
const tokenStatus = ref(null)

// --- LocalStorage ---
function loadConfig() {
  try {
    const raw = localStorage.getItem('ldstore-config')
    if (raw) {
      const config = JSON.parse(raw)
      keywords.value = config.keywords || []
      excludeKeywords.value = config.excludeKeywords || []
      targetPrice.value = config.targetPrice ?? null
      priceInput.value = targetPrice.value != null ? String(targetPrice.value) : ''
    }
  } catch {}
}

function saveConfig() {
  localStorage.setItem('ldstore-config', JSON.stringify({
    keywords: keywords.value,
    excludeKeywords: excludeKeywords.value,
    targetPrice: targetPrice.value,
  }))
  syncKeywordsToServer()
}

// --- Keywords ---
function addKeyword() {
  const kw = newKeyword.value.trim()
  if (kw && !keywords.value.includes(kw)) {
    keywords.value.push(kw)
    saveConfig()
  }
  newKeyword.value = ''
}

function removeKeyword(kw) {
  keywords.value = keywords.value.filter(k => k !== kw)
  saveConfig()
}

function addExclude() {
  const kw = newExclude.value.trim()
  if (kw && !excludeKeywords.value.includes(kw)) {
    excludeKeywords.value.push(kw)
    saveConfig()
  }
  newExclude.value = ''
}

function removeExclude(kw) {
  excludeKeywords.value = excludeKeywords.value.filter(k => k !== kw)
  saveConfig()
}

// --- Price alert ---
function setPrice() {
  const val = parseFloat(priceInput.value)
  if (!priceInput.value || isNaN(val) || val <= 0) {
    targetPrice.value = null
    priceInput.value = ''
  } else {
    targetPrice.value = val
  }
  saveConfig()
}

function clearPrice() {
  targetPrice.value = null
  priceInput.value = ''
  saveConfig()
}

// --- Filtered products ---
const filteredProducts = computed(() => {
  if (keywords.value.length === 0) return products.value
  return products.value.filter(p => {
    const text = `${p.name} ${p.description} ${p.category_name}`.toLowerCase()
    const matchKeyword = keywords.value.some(kw => text.includes(kw.toLowerCase()))
    const matchExclude = excludeKeywords.value.some(kw => text.includes(kw.toLowerCase()))
    return matchKeyword && !matchExclude
  })
})

// --- Fetch products ---
async function fetchProducts() {
  loading.value = true
  try {
    const res = await fetch('/api/products')
    const data = await res.json()
    if (data.success) {
      products.value = data.products
    }
  } catch (err) {
    console.error('Failed to fetch products:', err)
  } finally {
    loading.value = false
  }
}

// --- Fetch status ---
async function fetchStatus() {
  try {
    const res = await fetch('/api/status')
    const data = await res.json()
    if (data.timestamp) {
      lastCheck.value = data
    }
  } catch {}
}

// --- Token status (lightweight, for main page display) ---
async function fetchTokenStatus() {
  try {
    const res = await fetch('/api/token')
    tokenStatus.value = await res.json()
  } catch {}
}

function tokenExpired() {
  if (!tokenStatus.value?.exp) return false
  return tokenStatus.value.exp * 1000 < Date.now()
}

function onTokenUpdated() {
  fetchTokenStatus()
  fetchProducts()
}

// --- Sync keywords to server ---
async function syncKeywordsToServer() {
  if (!pushEnabled.value) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await fetch('/api/subscribe', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keywords: keywords.value,
        excludeKeywords: excludeKeywords.value,
        targetPrice: targetPrice.value,
      }),
    })
  } catch (err) {
    console.error('Failed to sync keywords:', err)
  }
}

// --- Push notifications ---
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

async function checkPushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      const sub = await reg.pushManager.getSubscription()
      pushEnabled.value = !!sub
    }
  } catch {}
}

async function togglePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Your browser does not support push notifications')
    return
  }

  pushLoading.value = true
  try {
    if (pushEnabled.value) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch('/api/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await sub.unsubscribe()
        }
      }
      pushEnabled.value = false
    } else {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        alert('Notification permission denied')
        return
      }

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const vapidRes = await fetch('/api/vapid-public-key')
      const { key: vapidPublicKey } = await vapidRes.json()
      if (!vapidPublicKey) {
        alert('VAPID public key not configured on server')
        return
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })

      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          keywords: keywords.value,
          excludeKeywords: excludeKeywords.value,
          targetPrice: targetPrice.value,
        }),
      })

      pushEnabled.value = true
    }
  } catch (err) {
    console.error('Push toggle failed:', err)
    alert('Operation failed: ' + err.message)
  } finally {
    pushLoading.value = false
  }
}

// --- Helpers ---
function stockText(product) {
  if (product.stock === -1) return 'Unlimited'
  return `${product.availableStock ?? product.stock}`
}

function hasStock(product) {
  return product.stock === -1 || product.stock > 0
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

// --- Init ---
onMounted(() => {
  loadConfig()
  fetchProducts()
  fetchStatus()
  checkPushStatus()
  fetchTokenStatus()
})
</script>

<template>
  <!-- Token Page -->
  <TokenPage
    v-if="currentPage === 'token'"
    @back="currentPage = 'main'"
    @updated="onTokenUpdated"
  />

  <!-- Main Page -->
  <div v-else class="max-w-2xl mx-auto px-3 py-4">
    <h1 class="text-lg font-bold text-center mb-3">
      LD士多 商品监控
      <a href="https://github.com/14790897/ldstore-monitor" target="_blank" class="inline-block align-middle ml-1 text-gray-400 hover:text-gray-700">
        <svg class="inline w-5 h-5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
      <a href="https://t.me/ldstore_monitor_bot" target="_blank" class="inline-block align-middle ml-1 text-gray-400 hover:text-[#26A5E4]">
        <svg class="inline w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
      </a>
    </h1>

    <!-- Keywords + Exclude in one card -->
    <div class="bg-white border border-gray-200 rounded-lg p-3 mb-2">
      <div class="flex gap-2 mb-1.5">
        <input
          v-model="newKeyword"
          placeholder="匹配关键词，回车添加"
          class="flex-1 px-2 py-1 border border-gray-200 rounded text-xs outline-none focus:border-indigo-500"
          @keyup.enter="addKeyword"
        />
        <button class="px-2.5 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700" @click="addKeyword">添加</button>
      </div>
      <div class="flex flex-wrap gap-1 mb-2 min-h-5">
        <span v-for="kw in keywords" :key="kw" class="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[11px] font-medium">
          {{ kw }}<button class="opacity-50 hover:opacity-100 text-sm leading-none" @click="removeKeyword(kw)">&times;</button>
        </span>
        <span v-if="keywords.length === 0" class="text-gray-400 text-[11px]">未设置，显示全部</span>
      </div>
      <div class="flex gap-2 mb-1.5">
        <input
          v-model="newExclude"
          placeholder="排除关键词，回车添加"
          class="flex-1 px-2 py-1 border border-gray-200 rounded text-xs outline-none focus:border-red-400"
          @keyup.enter="addExclude"
        />
        <button class="px-2.5 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600" @click="addExclude">排除</button>
      </div>
      <div class="flex flex-wrap gap-1 min-h-5">
        <span v-for="kw in excludeKeywords" :key="kw" class="inline-flex items-center gap-0.5 px-2 py-0.5 bg-red-50 text-red-500 rounded-full text-[11px] font-medium">
          {{ kw }}<button class="opacity-50 hover:opacity-100 text-sm leading-none" @click="removeExclude(kw)">&times;</button>
        </span>
      </div>
      <div class="flex gap-2 mt-2">
        <input
          v-model="priceInput"
          type="number"
          placeholder="价格提醒阈值 (LDC)"
          class="flex-1 px-2 py-1 border border-gray-200 rounded text-xs outline-none focus:border-amber-500"
          @keyup.enter="setPrice"
        />
        <button class="px-2.5 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600" @click="setPrice">设置</button>
        <button v-if="targetPrice != null" class="px-2.5 py-1 border border-gray-200 text-gray-500 text-xs rounded hover:bg-gray-50" @click="clearPrice">清除</button>
      </div>
      <div class="text-[11px] mt-1" :class="targetPrice != null ? 'text-amber-600' : 'text-gray-400'">
        {{ targetPrice != null ? `匹配商品 ≤ ${targetPrice} LDC 时通知` : '未设置价格提醒' }}
      </div>
    </div>

    <!-- Push + Status + Token in one row -->
    <div class="bg-white border border-gray-200 rounded-lg p-3 mb-2 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-[11px] text-gray-500 min-w-0 flex-1">
        <span v-if="lastCheck" class="truncate">
          {{ formatTime(lastCheck.timestamp) }} | {{ lastCheck.totalProducts }}件
          <template v-if="lastCheck.updates?.length"> | {{ lastCheck.updates.length }}变更</template>
        </span>
        <span v-else>尚未检查</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          class="px-2 py-1 border rounded text-xs disabled:opacity-50"
          :class="tokenStatus?.hasToken
            ? (tokenExpired() ? 'border-red-300 text-red-500 hover:bg-red-50' : 'border-green-300 text-green-600 hover:bg-green-50')
            : 'border-gray-200 text-gray-500 hover:bg-gray-50'"
          @click="currentPage = 'token'"
        >Token</button>
        <button
          class="px-2 py-1 border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          :disabled="loading"
          @click="fetchProducts(); fetchStatus()"
        >{{ loading ? '...' : '刷新' }}</button>
        <button
          class="px-2 py-1 text-xs rounded text-white disabled:opacity-50"
          :class="pushEnabled ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'"
          :disabled="pushLoading"
          @click="togglePush"
        >{{ pushLoading ? '...' : pushEnabled ? '关闭通知' : '开启通知' }}</button>
      </div>
    </div>

    <!-- Product List -->
    <div class="bg-white border border-gray-200 rounded-lg p-3">
      <h2 class="text-xs font-semibold mb-2">商品 ({{ filteredProducts.length }})</h2>

      <div v-if="loading" class="text-center py-4 text-gray-400 text-xs">加载中...</div>

      <div v-else-if="filteredProducts.length === 0" class="text-center py-6 text-gray-400 text-xs">
        {{ products.length === 0 ? '暂无数据，点击刷新' : '没有匹配的商品' }}
      </div>

      <div v-else class="flex flex-col gap-1">
        <a
          v-for="p in filteredProducts"
          :key="p.id"
          :href="'https://ldst0re.qzz.io/product/' + p.id"
          target="_blank"
          class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors no-underline text-inherit"
        >
          <img :src="p.image_url || p.seller_avatar" :alt="p.name" class="w-8 h-8 rounded object-cover shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium truncate">{{ p.name }}</div>
            <div class="text-[10px] text-gray-400">{{ p.category_name }} · {{ p.seller_name }}</div>
          </div>
          <div class="text-xs font-bold text-indigo-600 shrink-0">{{ p.price }}</div>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" :class="hasStock(p) ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'">
            {{ hasStock(p) ? stockText(p) : '缺货' }}
          </span>
        </a>
      </div>
    </div>
  </div>
</template>
