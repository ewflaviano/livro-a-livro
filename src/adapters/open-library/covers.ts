/** Never accept a provider-supplied URL or append personal metadata. */
export function openLibraryCoverUrl(coverId: number, size: 'S' | 'M' = 'M'): string | null {
  return Number.isSafeInteger(coverId) && coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg?default=false` : null;
}
