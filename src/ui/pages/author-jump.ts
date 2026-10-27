export type AuthorJump = { sourceBookId: string; authorKey: string; sourceReturnTo: string };

const returnDestinations = ['/estante', '/lendo', '/quero-ler', '/autores', '/notas', '/duplicatas', '/revisar-fichas'];

export function readAuthorJump(value: unknown): AuthorJump | null {
  if (!value || typeof value !== 'object') return null;
  const jump = value as Record<string, unknown>;
  if (typeof jump.sourceBookId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(jump.sourceBookId) ||
    typeof jump.authorKey !== 'string' || !jump.authorKey || jump.authorKey.length > 200 ||
    typeof jump.sourceReturnTo !== 'string' || !returnDestinations.includes(jump.sourceReturnTo)) return null;
  return { sourceBookId: jump.sourceBookId, authorKey: jump.authorKey, sourceReturnTo: jump.sourceReturnTo };
}
