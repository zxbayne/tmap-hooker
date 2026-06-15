<template>
  <div class="settings-panel">
    <div class="settings-title">设置</div>
    <label class="settings-item">
      <span class="settings-item-label">开启调试</span>
      <input type="checkbox" class="settings-checkbox" v-model="debug" @change="onDebugChange" />
    </label>

    <div class="settings-item">
      <span class="settings-item-label">主题</span>
      <select class="settings-select" :value="theme" @change="onThemeChange">
        <option value="system">跟随系统</option>
        <option value="light">亮色</option>
        <option value="dark">暗色</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { SETTINGS_KEY, THEME_KEY } from '@shared/constants'

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : { debug: false }
  } catch {
    return { debug: false }
  }
}

function saveSettings(settings: object) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const debug = ref(loadSettings().debug as boolean)
const theme = ref<'system' | 'light' | 'dark'>('system')

onMounted(async () => {
  try {
    const result = await chrome.storage.local.get(THEME_KEY)
    const stored = result[THEME_KEY]
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      theme.value = stored
    }
  } catch {
    const local = localStorage.getItem(THEME_KEY)
    if (local === 'system' || local === 'light' || local === 'dark') {
      theme.value = local
    }
  }
})

const emit = defineEmits<{
  debugChange: [enabled: boolean]
  themeChange: [theme: 'system' | 'light' | 'dark']
}>()

function onDebugChange() {
  saveSettings({ ...loadSettings(), debug: debug.value })
  emit('debugChange', debug.value)
}

function onThemeChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value as 'system' | 'light' | 'dark'
  theme.value = val
  emit('themeChange', val)
}
</script>
