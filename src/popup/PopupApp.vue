<template>
  <div class="popup-root" :class="'theme-' + effectiveTheme">
    <div class="popup-header">
      <span class="popup-title">📍 TMap工具</span>
    </div>

    <div class="popup-section">
      <div class="section-label">启用网站白名单</div>
      <div class="section-desc">
        {{ whitelist.length === 0 ? '列表为空：插件不在任何网站启用' : '直接输入 URL 即可，协议和路径会自动去除' }}
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { THEME_KEY } from '@shared/constants'

const DEFAULT_WHITELIST = ['lbs.qq.com']

const whitelist = ref<string[]>([])
const newDomain = ref('')
const saved = ref(false)
const saveHint = ref('')

// 主题 — 初始值 system，挂载后从 chrome.storage 加载
const theme = ref<'system' | 'light' | 'dark'>('system')
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
/** systemDark.matches 不是 Vue 响应式；用 counter 强制 computed 重算。 */
const systemChangeCounter = ref(0)

const effectiveTheme = computed<'light' | 'dark'>(() => {
  void systemChangeCounter.value // 触摸以建立响应式依赖
  if (theme.value === 'system') return systemDark.matches ? 'dark' : 'light'
  return theme.value
})

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(THEME_KEY)
    const stored = result[THEME_KEY]
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      theme.value = stored
    }
  } catch {
    // fallback to localStorage migration
    const local = localStorage.getItem(THEME_KEY)
    if (local === 'system' || local === 'light' || local === 'dark') {
      theme.value = local
    }
  }
}

/** 跨上下文同步：popup/panel 任一方改主题，另一方实时跟随。 */
function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== 'local') return
  const c = changes[THEME_KEY]
  if (!c) return
  const v = c.newValue
  if (v === 'system' || v === 'light' || v === 'dark') {
    theme.value = v
  }
}

function onSystemChange() {
  systemChangeCounter.value++
}

onMounted(async () => {
  await loadTheme()
  systemDark.addEventListener('change', onSystemChange)
  chrome.storage.onChanged.addListener(onStorageChanged)
})

onUnmounted(() => {
  systemDark.removeEventListener('change', onSystemChange)
  chrome.storage.onChanged.removeListener(onStorageChanged)
})

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
    return false
  }
}

onMounted(async () => {
  const result = await chrome.storage.local.get('whitelist')
  whitelist.value = Array.isArray(result.whitelist) ? result.whitelist : DEFAULT_WHITELIST
  ensureContentScripts()
})

async function save() {
  await chrome.storage.local.set({ whitelist: [...whitelist.value] })
  const ok = await ensureContentScripts()
  saveHint.value = ok ? '已保存并立即生效' : '已保存'
  saved.value = true
  setTimeout(() => { saved.value = false }, 2500)
}

function cleanDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/\/.*$/, '')
  d = d.replace(/:\d+$/, '')
  return d
}

function addDomain() {
  const d = cleanDomain(newDomain.value)
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
  --c-bg: #1a1a2e;
  --c-bg-alt: #16213e;
  --c-bg-input: #12122a;
  --c-border: #2d2d5e;
  --c-text: #e8e8f0;
  --c-text-dim: #b0b0d0;
  --c-text-muted: #888;
  --c-accent: #FF6B35;
  --c-green: #4caf80;
  --c-red: #e06060;

  display: flex;
  flex-direction: column;
  background: var(--c-bg);
  color: var(--c-text);
}

.popup-root.theme-light {
  --c-bg: #f0f2f5;
  --c-bg-alt: #ffffff;
  --c-bg-input: #ffffff;
  --c-border: #d0d5dd;
  --c-text: #1a1a2e;
  --c-text-dim: #555;
  --c-text-muted: #999;
  --c-accent: #e05520;
  --c-green: #16a34a;
  --c-red: #dc2626;
}

.popup-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--c-bg-alt);
  border-bottom: 1px solid var(--c-border);
}

.popup-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.popup-section {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  color: var(--c-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-desc {
  font-size: 11px;
  color: var(--c-text-dim);
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
  color: var(--c-text-muted);
  text-align: center;
  padding: 8px 0;
}

.whitelist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--c-bg-alt);
  border: 1px solid var(--c-border);
  border-radius: 5px;
  padding: 5px 8px;
}

.domain-text {
  font-size: 12px;
  color: var(--c-text-dim);
  font-family: 'Courier New', monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-btn {
  background: none;
  border: none;
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  flex-shrink: 0;
  transition: color 0.12s;
}

.remove-btn:hover { color: var(--c-red); }

.add-row { display: flex; gap: 6px; }

.domain-input {
  flex: 1;
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  border-radius: 5px;
  color: var(--c-text);
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
  transition: border-color 0.12s;
}

.domain-input:focus { border-color: var(--c-accent); }
.domain-input::placeholder { color: var(--c-text-muted); }

.add-btn {
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid var(--c-accent);
  background: transparent;
  color: var(--c-accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.add-btn:hover:not(:disabled) { background: rgba(255, 107, 53, 0.15); }
.add-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.save-hint {
  font-size: 11px;
  color: var(--c-green);
  text-align: center;
}

.theme-select {
  background: var(--c-bg-alt);
  border: 1px solid var(--c-border);
  border-radius: 5px;
  color: var(--c-text);
  font-size: 12px;
  padding: 4px 6px;
  outline: none;
  cursor: pointer;
}

.theme-select:focus { border-color: var(--c-accent); }
</style>
