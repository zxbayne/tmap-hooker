/** 与 hook 层 LatLng 相同的纯数据坐标类型，在 shared 层单独定义以避免循环依赖。 */
export interface LatLng {
  lat: number
  lng: number
}

/**
 * 解析用户在 textarea 中输入的坐标字符串，支持两种格式：
 * - **格式一**：JSON 数组 `[[lng,lat],[lng,lat],...]`，以 `[[` 开头识别
 * - **格式二**：分号分隔的键值对 `lng,lat;lng,lat;...`
 *
 * 要求至少 3 个点（构成最小多边形），任一格式解析失败或坐标包含 NaN 时返回 null。
 *
 * @param input 用户输入的坐标字符串
 * @returns 解析后的坐标数组，或 null（解析失败/点数不足）
 */
export function parseCoords(input: string): LatLng[] | null {
  const s = input.trim()
  if (!s) return null

  // 格式一：JSON 数组 [[lng,lat],...] 或带换行/缩进的变体
  // 不用 startsWith('[[') 判断——用户粘贴的 JSON 可能带换行符
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (!Array.isArray(arr) || arr.length < 3) return null
      // 确保是二维数组 [[lng,lat],...]
      if (!Array.isArray(arr[0])) return null
      const result = arr.map(([lng, lat]: [number, number]) => ({ lat, lng }))
      if (result.some((p) => isNaN(p.lat) || isNaN(p.lng))) return null
      return result
    } catch {
      // JSON 解析失败，继续尝试分号格式
    }
  }

  // 格式二：lng,lat;lng,lat;...
  if (s.includes(';')) {
    const pairs = s
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
    if (pairs.length < 3) return null
    const result = pairs.map((p) => {
      const parts = p.split(',').map(Number)
      return { lat: parts[1], lng: parts[0] }
    })
    if (result.some((p) => isNaN(p.lat) || isNaN(p.lng))) return null
    return result
  }

  return null
}

/**
 * 将坐标数组序列化为格式一的 JSON 字符串 `[[lng,lat],...]`，
 * 用于在绘制点时实时更新 panel 的 textarea 显示内容。
 */
export function coordsToText(points: LatLng[]): string {
  return JSON.stringify(points.map((p) => [p.lng, p.lat]))
}

/**
 * 解析打点标记的坐标字符串，支持三种格式（最少 1 个点）：
 * - **一维数组**：`[lng, lat]` → 1 个点
 * - **二维数组**：`[[lng,lat],[lng,lat],...]` → 多个点
 * - **分号格式**：`lng,lat;lng,lat;...` → 多个点
 */
export function parsePointCoords(input: string): LatLng[] | null {
  const s = input.trim()
  if (!s) return null

  // 二维数组 [[lng,lat],...]（含换行变体，靠 JSON.parse 而非 startsWith 判断）
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (!Array.isArray(arr) || arr.length === 0) return null
      // 判断是 [[lng,lat],...] 还是 [lng,lat]
      if (Array.isArray(arr[0])) {
        // 二维数组
        const result = arr.map(([lng, lat]: [number, number]) => ({ lat, lng }))
        if (result.some((p) => isNaN(p.lat) || isNaN(p.lng))) return null
        return result
      }
      // 一维数组 [lng,lat]
      if (arr.length < 2) return null
      const lng = Number(arr[0])
      const lat = Number(arr[1])
      if (isNaN(lat) || isNaN(lng)) return null
      return [{ lat, lng }]
    } catch {
      // 不是合法 JSON，继续尝试分号格式
    }
  }

  // 分号格式 lng,lat;lng,lat;...
  if (s.includes(';')) {
    const pairs = s.split(';').map((p) => p.trim()).filter(Boolean)
    if (pairs.length === 0) return null
    const result = pairs.map((p) => {
      const parts = p.split(',').map(Number)
      return { lat: parts[1], lng: parts[0] }
    })
    if (result.some((p) => isNaN(p.lat) || isNaN(p.lng))) return null
    return result
  }

  return null
}
