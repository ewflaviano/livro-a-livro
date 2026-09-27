/** Never accept a provider-supplied URL or append personal metadata. */
export function openLibraryCoverUrl(coverId: number): string | null {
  return Number.isSafeInteger(coverId) && coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false` : null;
}
