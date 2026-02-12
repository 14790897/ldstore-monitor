<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['back', 'updated'])

const tokenInput = ref('')
const tokenStatus = ref(null)
const tokenLoading = ref(false)

async function fetchTokenStatus() {
  try {
    const res = await fetch('/api/token')
    tokenStatus.value = await res.json()
  } catch {}
}

async function submitToken() {
  const token = tokenInput.value.trim()
  if (!token) return
  tokenLoading.value = true
  try {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json()
    if (data.ok) {
      tokenInput.value = ''
      await fetchTokenStatus()
      emit('updated')
    } else {
      alert(data.error || 'Token 无效')
    }
  } catch (err) {
    alert('提交失败: ' + err.message)
  } finally {
    tokenLoading.value = false
  }
}

async function removeToken() {
  tokenLoading.value = true
  try {
    await fetch('/api/token', { method: 'DELETE' })
    tokenStatus.value = { hasToken: false }
    emit('updated')
  } catch {} finally {
    tokenLoading.value = false
  }
}

function tokenExpired() {
  if (!tokenStatus.value?.exp) return false
  return tokenStatus.value.exp * 1000 < Date.now()
}

function formatTokenExp() {
  if (!tokenStatus.value?.exp) return ''
  return new Date(tokenStatus.value.exp * 1000).toLocaleString('zh-CN')
}

function tokenRemaining() {
  if (!tokenStatus.value?.exp) return ''
  const diff = tokenStatus.value.exp * 1000 - Date.now()
  if (diff <= 0) return ''
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  if (days > 0) return `${days}天${hours}小时`
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hours > 0) return `${hours}小时${mins}分`
  return `${mins}分钟`
}

onMounted(() => {
  fetchTokenStatus()
})
</script>

<template>
  <div class="max-w-2xl mx-auto px-3 py-4">
    <div class="flex items-center mb-4">
      <button
        class="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded"
        @click="$emit('back')"
      >&larr; 返回</button>
      <h1 class="text-lg font-bold text-center flex-1">Token 管理</h1>
      <div class="w-12"></div>
    </div>

    <!-- 说明 -->
    <div class="bg-white border border-gray-200 rounded-lg p-4 mb-3">
      <h2 class="text-sm font-semibold mb-2">什么是 Token？</h2>
      <p class="text-xs text-gray-600 mb-3">
        LD士多 API 在未登录时只返回部分商品。提供有效的登录 Token 后，可以获取完整的商品列表，监控范围更全面。
      </p>

      <h2 class="text-sm font-semibold mb-2">如何获取 Token？</h2>
      <ol class="text-xs text-gray-600 space-y-1.5 mb-3 list-decimal pl-4">
        <li>打开 <a href="https://ldst0re.qzz.io" target="_blank" class="text-indigo-600 hover:underline">LD士多网站</a> 并登录</li>
        <li>按 <kbd class="px-1 py-0.5 bg-gray-100 rounded text-[10px] font-mono">F12</kbd> 打开开发者工具</li>
        <li>切换到 <strong>Network</strong>（网络）标签页</li>
        <li>刷新页面，点击任意一个 <code class="px-1 py-0.5 bg-gray-100 rounded text-[10px]">api/shop</code> 开头的请求</li>
        <li>在请求头中找到 <code class="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Authorization: Bearer xxx...</code></li>
        <li>复制 <code class="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Bearer</code> 后面的整段字符串</li>
      </ol>

      <h2 class="text-sm font-semibold mb-2">注意事项</h2>
      <ul class="text-xs text-gray-600 space-y-1 list-disc pl-4">
        <li>Token 有效期约 <strong>30 天</strong>，过期后需重新获取</li>
        <li>提交的 Token 会被所有访问者共享使用</li>
        <li>系统会验证 Token 有效性：带 Token 返回的商品数量必须多于不带 Token 的</li>
        <li>已有 Token 时，新 Token 的过期时间必须晚于当前 Token 才能替换</li>
      </ul>
    </div>

    <!-- 当前状态 -->
    <div class="bg-white border border-gray-200 rounded-lg p-4 mb-3">
      <h2 class="text-sm font-semibold mb-2">当前状态</h2>
      <div v-if="tokenStatus?.hasToken">
        <div class="flex items-center gap-2 mb-3">
          <span v-if="tokenExpired()" class="text-xs text-red-500 font-medium">Token 已过期</span>
          <span v-else class="text-xs text-green-600 font-medium">Token 有效</span>
        </div>
        <div class="text-xs text-gray-500 space-y-1">
          <div v-if="tokenStatus.exp && !tokenExpired()">剩余时间: <strong>{{ tokenRemaining() }}</strong></div>
          <div v-if="tokenStatus.exp">过期时间: {{ formatTokenExp() }}</div>
        </div>
        <button
          class="mt-3 px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded hover:bg-red-50 disabled:opacity-50"
          :disabled="tokenLoading"
          @click="removeToken"
        >{{ tokenLoading ? '处理中...' : '移除 Token' }}</button>
      </div>
      <div v-else class="text-xs text-gray-400">
        尚未设置 Token，使用未登录模式获取商品
      </div>
    </div>

    <!-- 提交 Token -->
    <div class="bg-white border border-gray-200 rounded-lg p-4">
      <h2 class="text-sm font-semibold mb-2">{{ tokenStatus?.hasToken ? '更新 Token' : '提交 Token' }}</h2>
      <div class="flex gap-2">
        <input
          v-model="tokenInput"
          type="password"
          placeholder="粘贴 JWT Token"
          class="flex-1 px-3 py-2 border border-gray-200 rounded text-xs outline-none focus:border-indigo-500"
          @keyup.enter="submitToken"
        />
        <button
          class="px-4 py-2 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          :disabled="tokenLoading || !tokenInput.trim()"
          @click="submitToken"
        >{{ tokenLoading ? '验证中...' : '验证并保存' }}</button>
      </div>
    </div>
  </div>
</template>
