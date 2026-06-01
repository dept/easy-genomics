/** Human-readable byte size (binary units), e.g. 1536 → "1.50 KB". */
export function formatFileSize(value?: number | null): string {
  if (value == null || value < 0) return '';
  let v = value;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  while (v >= 1024 && unitIndex < units.length - 1) {
    v /= 1024;
    unitIndex++;
  }
  return `${v.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}
