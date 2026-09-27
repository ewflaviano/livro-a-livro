import { z } from 'zod';
import { parseExportV1, type LibraryExport } from '../backup/schema';
import { serializeBackup } from '../backup/serialize';
import { utf8ByteLength } from '../domain/library';
import { COVER_LIMITS } from '../media/cover';
import { binaryCompare, canonicalJson } from './protocol';

export type EncodedCover = LibraryExport['coverMedia'][number];
export type MergeSource = { id: string; label?: string; library: LibraryExport };
export type ResolutionSource = MergeSource;
export type ResolutionVariant = { sourceId: string; book: LibraryExport['books'][number]; media?: EncodedCover };
export type ResolutionBook = { id: string; variants: ResolutionVariant[]; requiresChoice: boolean; defaultSourceId?: string; removed: boolean; unbasedAbsence: boolean };
export type PreparedMergePreview = { id: string; sources: { id: string; label: string; count: number; preferences: LibraryExport['preferences'] }[]; books: ResolutionBook[]; preferencesDiffer: boolean; defaultPreferencesSourceId: string; sourceBytes: number };
export type ResolutionChoices = { books: { bookId: string; sourceId: string | null }[]; preferencesSourceId: string; includeUnbased: boolean };
export type PreparedMerge = { preview: PreparedMergePreview; sources: MergeSource[]; mediaIds: Map<string, string> };
const key = (value: string) => value.toLowerCase();
const provenance = (source: string, id: string) => `${source}:${key(id)}`;
const mediaValue = ({ id: _, ...media }: EncodedCover) => canonicalJson(media);
function validate(source: LibraryExport) {
  const library = parseExportV1(source); const ids = new Set<string>(); let bytes = 0;
  for (const media of library.coverMedia) {
    if (ids.has(key(media.id))) throw new Error('Mídias duplicadas na fonte.');
    ids.add(key(media.id));
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(media.bytes) || btoa(atob(media.bytes)) !== media.bytes) throw new Error('Capa inválida.');
    const size = atob(media.bytes).length; bytes += size;
    if (size > COVER_LIMITS.bytes) throw new Error('Capa excede o limite.');
  }
  if (bytes > COVER_LIMITS.totalBytes) throw new Error('Capas excedem o limite.');
  for (const book of library.books) if (book.cover?.provider === 'local' && !ids.has(key(book.cover.mediaId))) throw new Error('Capa ausente.');
  serializeBackup(library);
  return library;
}
function variantValue(variant: ResolutionVariant) {
  const book = { ...variant.book, id: key(variant.book.id), cover: variant.book.cover?.provider === 'local' ? { ...variant.book.cover, mediaId: key(variant.book.cover.mediaId) } : variant.book.cover };
  return canonicalJson(book);
}
/** Inputs have already passed image decoding in the coordinator. No I/O occurs here. */
export function prepareMerge(input: { id: string; sources: MergeSource[]; base?: LibraryExport; baseSourceId?: string; newId?: () => string }): PreparedMerge {
  if (!input.sources.length || new Set(input.sources.map(source => key(source.id))).size !== input.sources.length) throw new Error('Fontes inválidas.');
  const sources = input.sources.map(source => ({ ...source, library: validate(source.library) })).sort((a, b) => binaryCompare(key(a.id), key(b.id)));
  const base = input.base ? validate(input.base) : undefined;
  const sourceBytes = sources.reduce((sum, source) => sum + utf8ByteLength(JSON.stringify(source.library)), 0) + (base && !sources.some(source => key(source.id) === input.baseSourceId?.toLowerCase()) ? utf8ByteLength(JSON.stringify(base)) : 0);
  if (sourceBytes > 100 * 1024 * 1024) throw new Error('As fontes excedem o limite de 100 MiB para juntar.');
  const reserved = new Set([...sources.flatMap(source => source.library.coverMedia.map(media => key(media.id))), ...(base?.coverMedia.map(media => key(media.id)) ?? [])]);
  const mediaIds = new Map<string, string>(); const versions = new Map<string, Map<string, string>>();
  for (const source of sources) for (const media of [...source.library.coverMedia].sort((a, b) => binaryCompare(key(a.id), key(b.id)))) {
    const id = key(media.id); const value = mediaValue(media); const variants = versions.get(id) ?? new Map<string, string>();
    let assigned = variants.get(value);
    if (!assigned) {
      assigned = id;
      if (variants.size) {
        let attempts = 0;
        do { if (++attempts > 1000) throw new Error('Não foi possível reservar a capa.'); assigned = key((input.newId ?? (() => crypto.randomUUID()))()); z.uuid().parse(assigned); } while (reserved.has(assigned));
      }
      reserved.add(assigned); variants.set(value, assigned); versions.set(id, variants);
    }
    mediaIds.set(provenance(source.id, id), assigned);
  }
  const groups = new Map<string, ResolutionVariant[]>();
  for (const source of sources) for (const book of source.library.books) {
    const variants = groups.get(key(book.id)) ?? [];
    const cover = book.cover;
    const media = cover?.provider === 'local' ? source.library.coverMedia.find(item => key(item.id) === key(cover.mediaId)) : undefined;
    variants.push({ sourceId: source.id, book, ...(media ? { media } : {}) });
    groups.set(key(book.id), variants);
  }
  const mediaValues = new Map(sources.flatMap(source => source.library.coverMedia.map(media => [media, mediaValue(media)] as const)));
  const baseIds = new Set(base?.books.map(book => key(book.id)));
  const books = [...groups].sort(([a], [b]) => binaryCompare(a, b)).map(([id, variants]): ResolutionBook => {
    const absent = variants.length < sources.length; const removed = !!base && baseIds.has(id) && absent;
    const requiresChoice = removed || new Set(variants.map(variantValue)).size > 1 || variants.some(variant => (variant.media ? mediaValues.get(variant.media) : null) !== (variants[0].media ? mediaValues.get(variants[0].media) : null));
    return { id, variants, requiresChoice, ...(requiresChoice ? {} : { defaultSourceId: variants[0].sourceId }), removed, unbasedAbsence: !base && absent };
  });
  const defaultPreferencesSourceId = sources.find(source => source.id === 'local')?.id ?? sources[0].id;
  return { sources, mediaIds, preview: { id: input.id, sources: sources.map(source => ({ id: source.id, label: source.label ?? (source.id === 'local' ? 'Este dispositivo' : `Versão do Drive ${sources.indexOf(source) + 1}`), count: source.library.books.length, preferences: source.library.preferences })), books, preferencesDiffer: new Set(sources.map(source => canonicalJson(source.library.preferences))).size > 1, defaultPreferencesSourceId, sourceBytes } };
}
export function materializeMerge(plan: PreparedMerge, choices: ResolutionChoices): LibraryExport {
  const schema = z.strictObject({ books: z.array(z.strictObject({ bookId: z.string(), sourceId: z.string().nullable() })), preferencesSourceId: z.string(), includeUnbased: z.boolean() });
  const decision = schema.parse(choices);
  if (decision.books.length !== plan.preview.books.length || new Set(decision.books.map(row => row.bookId)).size !== decision.books.length) throw new Error('Escolhas incompletas ou duplicadas.');
  const prefs = plan.sources.find(source => source.id === decision.preferencesSourceId);
  if (!prefs) throw new Error('Escolha as preferências.');
  const books: LibraryExport['books'] = []; const media = new Map<string, EncodedCover>();
  const rows = new Map(plan.preview.books.map(book => [book.id, book]));
  for (const choice of decision.books) {
    const row = rows.get(choice.bookId);
    if (!row) throw new Error('Livro desconhecido.');
    if (choice.sourceId === null) continue;
    if (row.unbasedAbsence && !decision.includeUnbased) throw new Error('Confirme os livros presentes só em algumas versões.');
    const variant = row.variants.find(item => item.sourceId === choice.sourceId);
    if (!variant) throw new Error('Versão desconhecida.');
    const book = structuredClone(variant.book);
    if (variant.media && book.cover?.provider === 'local') {
      const id = plan.mediaIds.get(provenance(variant.sourceId, variant.media.id))!;
      book.cover.mediaId = id; media.set(id, { ...variant.media, id });
    }
    books.push(book);
  }
  return validate({ format: 'livro-a-livro', schemaVersion: 1, exportedAt: prefs.library.exportedAt, books, preferences: { ...prefs.library.preferences }, coverMedia: [...media.values()] });
}

/** Public summary contains no library content; the service retains all choices. */
export type ResolutionPreview = { id: string; totalCount: number; addedCount: number; divergentCount: number; remoteOnlyDivergentCount: number; remoteSourceCount: number };
export function unionPolicy(plan: PreparedMerge): { preview: ResolutionPreview; choices: ResolutionChoices } {
  if (!plan.sources.some(source => source.id === 'local')) throw new Error('Biblioteca local ausente.');
  const mediaValues = new Map(plan.sources.flatMap(source => source.library.coverMedia.map(media => [media, mediaValue(media)] as const)));
  let addedCount = 0, divergentCount = 0, remoteOnlyDivergentCount = 0;
  const books = plan.preview.books.map(group => {
    const local = group.variants.find(variant => variant.sourceId === 'local');
    const first = group.variants[0];
    const divergent = group.variants.some(variant => variantValue(variant) !== variantValue(first) || (variant.media ? mediaValues.get(variant.media) : null) !== (first.media ? mediaValues.get(first.media) : null));
    if (!local) addedCount++;
    if (divergent) { divergentCount++; if (!local) remoteOnlyDivergentCount++; }
    const winner = local ?? [...group.variants].sort((a, b) => binaryCompare(key(a.sourceId), key(b.sourceId)))[0];
    return { bookId: group.id, sourceId: winner.sourceId };
  });
  return { preview: { id: plan.preview.id, totalCount: books.length, addedCount, divergentCount, remoteOnlyDivergentCount, remoteSourceCount: plan.sources.length - 1 }, choices: { books, preferencesSourceId: 'local', includeUnbased: true } };
}
export function materializeUnion(plan: PreparedMerge): LibraryExport {
  return materializeMerge(plan, unionPolicy(plan).choices);
}
