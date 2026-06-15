export interface ToolConfig {
  id: string
  name: string
  icon: string
  description: string
}

export const TOOL_CONFIGS: ToolConfig[] = [
  {
    id: 'multi-point',
    name: '多点测距',
    icon: '📐',
    description: '连续点击测量折线总距离',
  },
  {
    id: 'polygon',
    name: '绘制多边形',
    icon: '⬡',
    description: '在地图上点击选点绘制多边形',
  },
  {
    id: 'point-marker',
    name: '打点标记',
    icon: '📍',
    description: '在地图上点击标记位置点',
  },
]

export const TOOL_IDS = {
  MULTI_POINT: 'multi-point',
  POLYGON: 'polygon',
  POINT_MARKER: 'point-marker',
} as const
