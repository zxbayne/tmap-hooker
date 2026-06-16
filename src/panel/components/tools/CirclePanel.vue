<template>
  <div class="circle-panel">
    <!-- idle：未开始绘制 -->
    <div v-if="circleMode === 'idle'" class="circle-idle">
      <div class="circle-hint">点击下方按钮开始绘制圆形</div>
      <button class="circle-start-btn" @click="$emit('startDrawing')">
        ⭕ 开始绘制圆形
      </button>
    </div>

    <!-- drawing：点击放置圆心 -->
    <div v-else-if="circleMode === 'drawing'" class="circle-drawing">
      <div class="circle-drawing-badge">点击地图放置圆心</div>
      <button class="poly-btn cancel-btn" @click="$emit('cancelDrawing')">
        取消
      </button>
    </div>

    <!-- placed / 预览：圆心已放，等待调参完成 -->
    <div v-else-if="circleMode === 'placed' && circlePreview" class="circle-preview">
      <div class="circle-center-info">
        <span class="circle-label">圆心</span>
        <span class="circle-coords">{{ circlePreview.lng.toFixed(6) }}, {{ circlePreview.lat.toFixed(6) }}</span>
      </div>

      <div class="circle-param">
        <label class="circle-param-label">半径</label>
        <div class="circle-param-row">
          <input type="range" :min="50" :max="10000" :step="10"
            :value="radius" class="circle-slider" @input="onRadiusSlider" />
          <input type="number" :value="radius" class="circle-number"
            @change="onRadiusInput" />
          <span class="circle-unit">m</span>
        </div>
      </div>

      <div class="circle-param">
        <label class="circle-param-label">拟合点数</label>
        <div class="circle-param-row">
          <select :value="nPoints" class="circle-select" @change="onNPointsChange">
            <option :value="16">16</option><option :value="32">32</option>
            <option :value="64">64（推荐）</option><option :value="128">128</option>
          </select>
        </div>
      </div>

      <div v-if="previewGeometry" class="circle-geometry-info">
        <span>面积 {{ formatArea(previewGeometry.area) }}</span>
        <span>周长 {{ formatDistance(previewGeometry.perimeter) }}</span>
      </div>

      <div class="circle-actions">
        <button class="circle-finish-btn" @click="$emit('finishCircle')">✓ 完成</button>
        <button class="poly-btn cancel-btn" @click="$emit('cancelDrawing')">取消</button>
      </div>
    </div>

    <!-- editing：编辑模式 -->
    <div v-else-if="circleMode === 'editing'" class="circle-preview">
      <div class="circle-edit-hint">拖动地图上的圆形调整圆心 / 调整下方参数</div>

      <div class="circle-param">
        <label class="circle-param-label">半径</label>
        <div class="circle-param-row">
          <input type="range" :min="50" :max="10000" :step="10"
            :value="radius" class="circle-slider" @input="onRadiusSlider" />
          <input type="number" :value="radius" class="circle-number"
            @change="onRadiusInput" />
          <span class="circle-unit">m</span>
        </div>
      </div>

      <div class="circle-param">
        <label class="circle-param-label">拟合点数</label>
        <div class="circle-param-row">
          <select :value="nPoints" class="circle-select" @change="onNPointsChange">
            <option :value="16">16</option><option :value="32">32</option>
            <option :value="64">64（推荐）</option><option :value="128">128</option>
          </select>
        </div>
      </div>

      <div v-if="previewGeometry" class="circle-geometry-info">
        <span>面积 {{ formatArea(previewGeometry.area) }}</span>
        <span>周长 {{ formatDistance(previewGeometry.perimeter) }}</span>
      </div>

      <div class="circle-actions">
        <button class="circle-finish-btn" @click="$emit('commitEdit')">✓ 完成</button>
        <button class="poly-btn cancel-btn" @click="$emit('cancelEdit')">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { formatDistance, formatArea } from '../../../shared/utils/distance'

export interface CirclePreview {
  id: string; lat: number; lng: number
  radius: number; nPoints: number
}
export interface CircleGeometry {
  area: number; perimeter: number
}

const props = defineProps<{
  circleMode: 'idle' | 'drawing' | 'placed' | 'editing'
  circlePreview: CirclePreview | null
  previewGeometry: CircleGeometry | null
}>()

const emit = defineEmits<{
  startDrawing: []
  cancelDrawing: []
  updateCircle: [id: string, radius: number, nPoints: number]
  finishCircle: []
  commitEdit: []
  cancelEdit: []
}>()

const radius = ref(props.circlePreview?.radius ?? 500)
const nPoints = ref(props.circlePreview?.nPoints ?? 64)

watch(() => props.circlePreview, (p) => {
  if (p) { radius.value = p.radius; nPoints.value = p.nPoints }
})

function sendUpdate() {
  if (props.circlePreview) {
    emit('updateCircle', props.circlePreview.id, radius.value, nPoints.value)
  }
}

function onRadiusSlider(e: Event) {
  radius.value = Number((e.target as HTMLInputElement).value)
  sendUpdate()
}

function onRadiusInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (!isNaN(val) && val > 0) {
    radius.value = Math.max(10, Math.min(50000, val))
    sendUpdate()
  }
}

function onNPointsChange(e: Event) {
  nPoints.value = Number((e.target as HTMLSelectElement).value)
  sendUpdate()
}
</script>
