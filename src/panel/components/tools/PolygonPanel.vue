<template>
  <div class="polygon-panel">
    <div class="polygon-hint">
      点击地图选点，或直接在下方输入坐标
    </div>
    <textarea
      class="coords-input"
      v-model="localCoords"
      placeholder="[[lat,lng],[lat,lng],...]
或 lat,lng;lat,lng;..."
      rows="4"
      spellcheck="false"
    />
    <div class="polygon-actions">
      <button class="poly-btn draw-btn" @click="onDraw" :disabled="!localCoords.trim()">
        绘制
      </button>
      <button class="poly-btn clear-btn" @click="onClearInput" :disabled="!localCoords.trim()">
        清空输入
      </button>
      <button class="poly-btn delete-btn" @click="onDelete" :disabled="!selectedPolygonId">
        删除选中
      </button>
    </div>
    <div v-if="polygonCount > 0" class="polygon-count">
      已绘制 {{ polygonCount }} 个多边形
      <span v-if="selectedPolygonId" class="selected-hint">（已选中）</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  /** 来自 hook 层的实时坐标文本（打点时更新），外部变化时同步到本地 textarea。 */
  coordsText: string
  /** 当前选中的多边形 id，null 表示未选中，用于控制删除按钮的可用状态。 */
  selectedPolygonId: string | null
  /** 已绘制的多边形总数，用于显示计数提示。 */
  polygonCount: number
}>()

const emit = defineEmits<{
  draw: [input: string]
  delete: []
}>()

/** textarea 本地状态，与 coordsText prop 单向同步（prop 变化时更新 textarea，用户编辑不反向传递）。 */
const localCoords = ref(props.coordsText)

// 当 hook 层打点更新坐标时，同步到本地 textarea
watch(() => props.coordsText, (val) => {
  localCoords.value = val
})

/** 提交当前 textarea 内容，发起绘制多边形请求。 */
function onDraw() {
  emit('draw', localCoords.value)
}

/** 仅清空 textarea 本地内容，不影响 hook 层状态（不发送任何命令）。 */
function onClearInput() {
  localCoords.value = ''
}

/** 发起删除当前选中多边形的请求。 */
function onDelete() {
  emit('delete')
}
</script>
