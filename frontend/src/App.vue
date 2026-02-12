<script setup>
import { ref, computed, onMounted } from 'vue'

// --- State ---
const keywords = ref([])
const excludeKeywords = ref([])
const newKeyword = ref('')
const newExclude = ref('')
const products = ref([])
const loading = ref(false)
const pushEnabled = ref(false)
const pushLoading = ref(false)
const lastCheck = ref(null)

// --- LocalStorage ---
function loadConfig() {
  try {
    const raw = localStorage.getItem('ldstore-config')
    if (raw) {
      const config = JSON.parse(raw)
      keywords.value = config.keywords || []
      excludeKeywords.value = config.excludeKeywords || []
    }
  } catch {}
}

function saveConfig() {
  localStorage.setItem('ldstore-config', JSON.stringify({
    keywords: keywords.value,
    excludeKeywords: excludeKeywords.value,
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
})
</script>

<template>
  <div class="max-w-2xl mx-auto px-3 py-4">
    <h1 class="text-lg font-bold text-center mb-3">LD士多 商品监控</h1>

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
    </div>

    <!-- Push + Status in one row -->
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
