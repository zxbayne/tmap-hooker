<template>
  <div class="settings-panel">
    <div class="settings-title">设置</div>
    <label class="settings-item">
      <span class="settings-item-label">开启调试</span>
      <input type="checkbox" class="settings-checkbox" v-model="debug" @change="onDebugChange" />
    </label>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { SETTINGS_KEY } from '@shared/constants'

/** 从 localStorage 读取扩展设置，解析失败时返回默认值。 */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : { debug: false }
  } catch {
    return { debug: false }
  }
}

/** 将设置对象序列化并写入 localStorage。 */
function saveSettings(settings: object) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const debug = ref(loadSettings().debug as boolean)

const emit = defineEmits<{
  debugChange: [enabled: boolean]
}>()

/** 复选框状态变更时持久化设置并通知父组件（App.vue）向 hook 层发送 SET_DEBUG 命令。 */
function onDebugChange() {
  saveSettings({ ...loadSettings(), debug: debug.value })
  emit('debugChange', debug.value)
}
</script>
