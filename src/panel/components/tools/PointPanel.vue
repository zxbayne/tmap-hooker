<template>
  <div class="point-panel">
    <!-- 提示栏 -->
    <div class="point-hint">点击地图添加点位</div>

    <!-- 坐标导入（折叠） -->
    <div>
      <div class="poly-import-toggle" @click="importExpanded = !importExpanded">
        <span class="toggle-arrow" :class="{ open: importExpanded }">▶</span>
        坐标导入
      </div>
      <div v-show="importExpanded" class="poly-import-body">
        <textarea
          class="coords-input"
          v-model="localCoords"
          placeholder="[lng,lat]
[[lng,lat],[lng,lat],...]
或 lng,lat;lng,lat;..."
          rows="3"
          spellcheck="false"
        />
        <div class="polygon-actions">
          <button class="poly-btn draw-btn" :disabled="!localCoords.trim()" @click="onImport">导入</button>
          <button class="poly-btn clear-btn" :disabled="!localCoords.trim()" @click="localCoords = ''">清空</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  importPoints: [input: string]
}>()

const importExpanded = ref(false)
const localCoords = ref('')

function onImport() {
  const text = localCoords.value.trim()
  if (!text) return
  emit('importPoints', text)
  localCoords.value = ''
}
</script>
