/** 与 hook 层 LatLng 相同的纯数据坐标类型，在 shared 层单独定义以避免循环依赖。 */
export interface LatLng {
  lat: number
  lng: number
}

/**
 * 解析用户在 textarea 中输入的坐标字符串，支持两种格式：
 * - **格式一**：JSON 数组 `[[lat,lng],[lat,lng],...]`，以 `[[` 开头识别
 * - **格式二**：分号分隔的键值对 `lat,lng;lat,lng;...`
 *
 * 要求至少 3 个点（构成最小多边形），任一格式解析失败或坐标包含 NaN 时返回 null。
 *
 * @param input 用户输入的坐标字符串
 * @returns 解析后的坐标数组，或 null（解析失败/点数不足）
 */
export function parseCoords(input: string): LatLng[] | null {
  const s = input.trim()
  if (!s) return null

  // 格式一：[[lat,lng],[lat,lng],...]
  if (s.startsWith('[[')) {
    try {
      const arr = JSON.parse(s)
      if (!Array.isArray(arr) || arr.length < 3) return null
      const result = arr.map(([lat, lng]: [number, number]) => ({ lat, lng }))
      if (result.some((p) => isNaN(p.lat) || isNaN(p.lng))) return null
      return result
    } catch {
      return null
    }
  }

  // 格式二：lat,lng;lat,lng;...
  if (s.includes(';')) {
    const pairs = s
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
    if (pairs.length < 3) return null
    const result = pairs.map((p) => {
      const parts = p.split(',').map(Number)
      return { lat: parts[0], lng: parts[1] }
    })
    if (result.some((p) => isNaN(p.lat) || isNaN(p.lng))) return null
    return result
  }

  return null
}

/**
 * 将坐标数组序列化为格式一的 JSON 字符串 `[[lat,lng],...]`，
 * 用于在绘制点时实时更新 panel 的 textarea 显示内容。
 */
export function coordsToText(points: LatLng[]): string {
  return JSON.stringify(points.map((p) => [p.lat, p.lng]))
}
