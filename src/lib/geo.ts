// Distance thresholds are generous on purpose. Indoor GPS in a concrete
// academic block is routinely off by 50-100m, so this is tuned to catch someone
// marking from the hostel, not someone sitting in the back row.
export const OUTLIER_METRES = 150
export const IMPRECISE_ACCURACY_METRES = 100

export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
