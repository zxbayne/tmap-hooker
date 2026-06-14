<template>
  <div class="popup-root">
    <div class="popup-header">
      <span class="popup-title">📍 TMap工具</span>
    </div>

    <div class="popup-section">
      <div class="section-label">启用网站白名单</div>
      <div class="section-desc">
        {{ whitelist.length === 0 ? '列表为空：插件不在任何网站启用' : '仅在以下网站启用插件' }}
      </div>

      <div class="whitelist-items">
        <div v-for="(domain, idx) in whitelist" :key="domain" class="whitelist-item">
          <span class="domain-text">{{ domain }}</span>
          <button class="remove-btn" @click="removeDomain(idx)" title="删除">✕</button>
        </div>
        <div v-if="whitelist.length === 0" class="whitelist-empty">暂无条目，插件已禁用</div>
      </div>

      <div class="add-row">
        <input
          v-model="newDomain"
          class="domain-input"
          placeholder="如 lbs.qq.com"
          @keydown.enter="addDomain"
        />
        <button class="add-btn" @click="addDomain" :disabled="!newDomain.trim()">添加</button>
      </div>

      <div v-if="saved" class="save-hint">{{ saveHint }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const DEFAULT_WHITELIST = ['lbs.qq.com']

const whitelist = ref<string[]>([])
const newDomain = ref('')
const saved = ref(false)
const saveHint = ref('')

// 探测当前 tab 内容脚本是否存活，若未注入则动态注入
async function ensureContentScripts(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return false
    let alive = false
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'PING' })
      alive = resp?.type === 'PONG'
    } catch { alive = false }
    if (!alive) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['hook.iife.js'], world: 'MAIN' })
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['panel.iife.js'] })
    }
    return true
  } catch {
    // chrome:// 等特权页无法注入，静默失败
    return false
  }
}

onMounted(async () => {
  const result = await chrome.storage.local.get('whitelist')
  whitelist.value = Array.isArray(result.whitelist) ? result.whitelist : DEFAULT_WHITELIST
  ensureContentScripts()  // 后台静默注入，不阻塞 UI 渲染
})

async function save() {
  await chrome.storage.local.set({ whitelist: [...whitelist.value] })
  // storage.onChanged 通知所有存活 tab；ensureContentScripts 处理当前未注入的 tab
  const ok = await ensureContentScripts()
  saveHint.value = ok ? '已保存并立即生效' : '已保存'
  saved.value = true
  setTimeout(() => { saved.value = false }, 2500)
}

function addDomain() {
  const d = newDomain.value.trim().toLowerCase()
  if (!d || whitelist.value.includes(d)) return
  whitelist.value.push(d)
  newDomain.value = ''
  save()
}

function removeDomain(idx: number) {
  whitelist.value.splice(idx, 1)
  save()
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

.popup-root {
  display: flex;
  flex-direction: column;
}

.popup-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: #16213e;
  border-bottom: 1px solid #2d2d5e;
}

.popup-title {
  font-size: 13px;
  font-weight: 600;
  color: #e8e8f0;
}

.popup-section {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-desc {
  font-size: 11px;
  color: #555;
}

.whitelist-items {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 160px;
  overflow-y: auto;
}

.whitelist-empty {
  font-size: 11px;
  color: #444;
  text-align: center;
  padding: 8px 0;
}

.whitelist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #16213e;
  border: 1px solid #2d2d5e;
  border-radius: 5px;
  padding: 5px 8px;
}

.domain-text {
  font-size: 12px;
  color: #b0b0d0;
  font-family: 'Courier New', monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-btn {
  background: none;
  border: none;
  color: #444;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  flex-shrink: 0;
  transition: color 0.12s;
}

.remove-btn:hover {
  color: #e06060;
}

.add-row {
  display: flex;
  gap: 6px;
}

.domain-input {
  flex: 1;
  background: #12122a;
  border: 1px solid #2d2d5e;
  border-radius: 5px;
  color: #e8e8f0;
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
  transition: border-color 0.12s;
}

.domain-input:focus {
  border-color: #FF6B35;
}

.domain-input::placeholder {
  color: #444;
}

.add-btn {
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid #FF6B35;
  background: transparent;
  color: #FF6B35;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.add-btn:hover:not(:disabled) {
  background: rgba(255, 107, 53, 0.15);
}

.add-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.save-hint {
  font-size: 11px;
  color: #4caf80;
  text-align: center;
}
</style>
