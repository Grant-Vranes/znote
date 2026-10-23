/** Format Windows extended paths for display without changing the stored path. */
export function displayPath(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\([a-z]:\\)/i, "$1");
}
