// Shared by every "Download" button so saved files sort together in a folder
// and carry the course they came from.
export function downloadTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

export function courseSlug(courseCode: string) {
  return courseCode.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
}

export function downloadFileName(courseCode: string, suffix: string, extension: string) {
  return `${courseSlug(courseCode)}-${suffix}-${downloadTimestamp()}.${extension}`
}
