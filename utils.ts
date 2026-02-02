
/**
 * Normalizes attendee names into 'Last.First' format.
 * Replicates the logic from the Python script.
 */
export function normalizeName(fullName: string): string {
  let name = (fullName || '').trim();
  let first = '';
  let last = '';

  if (name.includes(',')) {
    const parts = name.split(',').map(p => p.trim());
    last = parts[0];
    first = parts[1] || '';
  } else {
    const parts = name.split(/\s+/);
    if (parts.length < 2) {
      return name.replace(/\W+/g, '') || "Unknown.Unknown";
    }
    first = parts[0];
    last = parts[parts.length - 1];
  }

  const safeLast = last.replace(/\W+/g, '') || "Unknown";
  const safeFirst = first.replace(/\W+/g, '') || "Unknown";

  return `${safeLast}.${safeFirst}`;
}

/**
 * Formats bytes into human readable string
 */
export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
