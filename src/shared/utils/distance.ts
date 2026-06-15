/** 地球半径（米），用于 haversine 公式计算球面距离。 */
const R = 6371000

/**
 * 使用 haversine 公式计算两点之间的球面距离（大圆距离）。
 * @param lat1 第一个点的纬度（十进制度数）
 * @param lng1 第一个点的经度（十进制度数）
 * @param lat2 第二个点的纬度（十进制度数）
 * @param lng2 第二个点的经度（十进制度数）
 * @returns 两点之间的距离，单位：米
 */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180
  const φ1 = lat1 * toRad
  const φ2 = lat2 * toRad
  const Δφ = (lat2 - lat1) * toRad
  const Δλ = (lng2 - lng1) * toRad
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

/**
 * 将距离（米）格式化为人类可读的字符串。
 * 1000m 以上显示为 km（保留两位小数），以下显示为 m（取整）。
 * @param meters 距离，单位：米
 * @returns 格式化字符串，如 "1.23 km" 或 "456 m"
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${Math.round(meters)} m`
}

/** 根据线段方向返回标签样式 id，确保标签始终偏移到线段的垂直方向（不重叠）。 */
export function getLabelStyleId(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  const dLng = b.lng - a.lng
  const dLat = b.lat - a.lat
  let angle = Math.atan2(dLat, dLng) * 180 / Math.PI
  angle = ((angle % 180) + 180) % 180
  if (angle < 22.5 || angle >= 157.5) return 'label-up'
  if (angle < 67.5)                   return 'label-up-left'
  if (angle < 112.5)                  return 'label-right'
  return                                     'label-up-right'
}

/**
 * 将面积（平方米）格式化为人类可读的字符串。
 * ≥ 1,000,000 m² → km²；≥ 1000 m² → 公顷系统过渡；< 1000 m² → m²。
 */
export function formatArea(sqMeters: number): string {
  if (sqMeters >= 1_000_000) {
    return `${(sqMeters / 1_000_000).toFixed(2)} km²`
  }
  if (sqMeters >= 1000) {
    return `${(sqMeters / 1_000_000).toFixed(4)} km² (${Math.round(sqMeters).toLocaleString()} m²)`
  }
  return `${Math.round(sqMeters)} m²`
}
