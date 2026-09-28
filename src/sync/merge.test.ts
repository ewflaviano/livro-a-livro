import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import type { LibraryExport } from '../backup/schema';
import { encodedCover } from '../../test/fixtures/covers/helpers';
import { materializeMerge, materializeUnion, unionPolicy, prepareMerge, type PreparedMerge, type ResolutionChoices } from './merge';
const now = '2026-09-26T12:00:00Z';
const uuid = (n: number) => `abcdef00-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const book = (n: number, note = '') => createBook({ title: `Livro ${n}`, authors: ['Autoria sintética'], status: 'read', note }, { id: uuid(n), now, shelfYear: 2026 });
const library = (books = [book(1)]): LibraryExport => ({ format: 'livro-a-livro', schemaVersion: 1, exportedAt: now, books, preferences: { shelfYear: null, mode: 'grid', filter: 'all' }, coverMedia: [] });
const choices = (plan: PreparedMerge): ResolutionChoices => ({ books: plan.preview.books.map(row => ({ bookId: row.id, sourceId: row.defaultSourceId ?? row.variants[0].sourceId })), preferencesSourceId: 'local', includeUnbased: true });
describe('explicit library union', () => {
  it('counts distinct source identities even for equal content, reusing the exact base only once', () => {
    const sources = [{ id: 'local', library: library() }, { id: 'remote', library: library() }];
    const shared = prepareMerge({ id: 'p', sources, base: library(), baseSourceId: 'remote' });
    const distinct = prepareMerge({ id: 'p', sources, base: library(), baseSourceId: 'older' });
    expect(distinct.preview.sourceBytes).toBe(shared.preview.sourceBytes * 1.5);
  });
  it('joins every source by casefold UUID, preserving distinct IDs with equal titles', () => {
    const same = { ...book(1), id: uuid(1).toUpperCase() };
    const plan = prepareMerge({ id: 'preview', sources: [{ id: 'local', library: library() }, { id: 'b', library: library([same, { ...book(2), title: book(1).title }]) }, { id: 'c', library: library([book(3)]) }] });
    expect(plan.preview.books).toHaveLength(3); expect(plan.preview.books[0].requiresChoice).toBe(false);
    expect(materializeMerge(plan, choices(plan)).books.map(row => row.id.toLowerCase())).toEqual([uuid(1), uuid(2), uuid(3)]);
  });
  it('requires whole-book decisions for divergence and rejects duplicate/unknown/incomplete choices', () => {
    const plan = prepareMerge({ id: 'preview', sources: [{ id: 'local', library: library() }, { id: 'remote', library: library([book(1, 'Nota alternativa')]) }] });
    expect(plan.preview.books[0].requiresChoice).toBe(true); expect(plan.preview.books[0].defaultSourceId).toBeUndefined();
    expect(() => materializeMerge(plan, { ...choices(plan), books: [] })).toThrow();
    expect(() => materializeMerge(plan, { ...choices(plan), books: [...choices(plan).books, ...choices(plan).books] })).toThrow();
    expect(() => materializeMerge(plan, { ...choices(plan), books: [{ bookId: uuid(99), sourceId: 'local' }] })).toThrow();
    expect(() => materializeMerge(plan, { ...choices(plan), books: [{ bookId: uuid(1), sourceId: 'unknown' }] })).toThrow();
    const result = materializeMerge(plan, { ...choices(plan), books: [{ bookId: uuid(1), sourceId: 'remote' }] });
    expect(result.books[0]).toEqual(book(1, 'Nota alternativa'));
  });
  it('requires acknowledgement of unbased absence or explicit exclusion', () => {
    const plan = prepareMerge({ id: 'p', sources: [{ id: 'local', library: library() }, { id: 'remote', library: library([]) }] });
    expect(plan.preview.books[0].unbasedAbsence).toBe(true);
    expect(() => materializeMerge(plan, { ...choices(plan), includeUnbased: false })).toThrow();
    expect(materializeMerge(plan, { ...choices(plan), includeUnbased: false, books: [{ bookId: uuid(1), sourceId: null }] }).books).toEqual([]);
  });
  it('explains removal relative to base without deleting surviving version or resurrecting absent everywhere', () => {
    const plan = prepareMerge({ id: 'p', base: library([book(1), book(2)]), sources: [{ id: 'local', library: library() }, { id: 'remote', library: library([]) }] });
    expect(plan.preview.books).toHaveLength(1); expect(plan.preview.books[0]).toMatchObject({ removed: true, requiresChoice: true, unbasedAbsence: false });
    expect(materializeMerge(plan, choices(plan)).books).toEqual([book(1)]);
  });
  it('chooses portable preferences as a whole tuple', () => {
    const remote = library(); remote.preferences = { shelfYear: 2024, mode: 'list', filter: 'reading' };
    const plan = prepareMerge({ id: 'p', sources: [{ id: 'local', library: library() }, { id: 'remote', library: remote }] });
    expect(plan.preview.preferencesDiffer).toBe(true);
    expect(materializeMerge(plan, { ...choices(plan), preferencesSourceId: 'remote' }).preferences).toEqual({ shelfYear: 2024, filter: 'reading' });
    expect(() => materializeMerge(plan, { ...choices(plan), preferencesSourceId: '' })).toThrow();
  });
  it('rejects casefold aliases inside a source before grouping', () => {
    expect(() => prepareMerge({ id: 'p', sources: [{ id: 'local', library: library([book(1), { ...book(1), id: uuid(1).toUpperCase() }]) }] })).toThrow();
    const data = library([]); data.coverMedia = [encodedCover(), { ...encodedCover(), id: encodedCover().id.toUpperCase() }];
    expect(() => prepareMerge({ id: 'p', sources: [{ id: 'local', library: data }] })).toThrow();
  });
  it('compares effective media, reserves collision IDs once, preserves provenance and removes orphans', () => {
    const a = library([book(1), book(2)]); const b = library([book(1), book(3)]);
    for (const data of [a,b]) { data.books.forEach(row => { row.cover = { provider: 'local', mediaId: encodedCover().id }; }); data.coverMedia = [encodedCover()]; }
    b.coverMedia[0] = { ...encodedCover('image/jpeg'), id: encodedCover().id };
    const reserved = uuid(99); b.coverMedia.push({ ...encodedCover(), id: reserved });
    const base = library([]); base.coverMedia = [{ ...encodedCover(), id: uuid(98) }];
    const generated = [encodedCover().id.toUpperCase(), reserved.toUpperCase(), uuid(98).toUpperCase(), uuid(100)]; let calls = 0;
    const plan = prepareMerge({ id: 'p', base, sources: [{ id: 'local', library: a }, { id: 'remote', library: b }], newId: () => generated[calls++] });
    expect(plan.preview.books[0].requiresChoice).toBe(true); expect(calls).toBe(4);
    const decision = choices(plan); decision.books[0].sourceId = 'remote';
    const result = materializeMerge(plan, decision);
    expect(result.coverMedia).toHaveLength(2); expect(result.coverMedia.some(row => row.id === reserved)).toBe(false);
    expect(result.books[0].cover).toEqual(result.books[2].cover); expect(result.books[1].cover).not.toEqual(result.books[0].cover);
    expect(materializeMerge(plan, decision)).toEqual(result); expect(calls).toBe(4);
    expect(result.coverMedia.map(row => row.bytes).sort()).toEqual([a.coverMedia[0].bytes, b.coverMedia[0].bytes].sort());
  });
  it('shares identical same-ID media but retains different media IDs with identical bytes', () => {
    const a = library([book(1)]), b = library([book(2), book(3)]);
    a.coverMedia = [encodedCover()]; b.coverMedia = [encodedCover(), { ...encodedCover(), id: uuid(100) }];
    a.books[0].cover = { provider: 'local', mediaId: encodedCover().id };
    b.books[0].cover = { provider: 'local', mediaId: encodedCover().id.toUpperCase() };
    b.books[1].cover = { provider: 'local', mediaId: uuid(100) };
    const plan = prepareMerge({ id: 'p', sources: [{ id: 'remote', library: b }, { id: 'local', library: a }], newId: () => { throw new Error('No allocation needed'); } });
    const result = materializeMerge(plan, choices(plan));
    expect(result.coverMedia).toHaveLength(2); expect(result.books[0].cover).toEqual(result.books[1].cover);
  });
  it('does not equate media with matching bytes but different creation metadata', () => {
    const a = library(), b = library();
    for (const data of [a,b]) { data.books[0].cover = { provider: 'local', mediaId: encodedCover().id }; data.coverMedia = [encodedCover()]; }
    b.coverMedia[0].createdAt = '2026-09-27T12:00:00Z';
    expect(prepareMerge({ id: 'p', sources: [{ id: 'local', library: a }, { id: 'remote', library: b }] }).preview.books[0].requiresChoice).toBe(true);
  });
  it('blocks an oversized result while keeping sources and choices untouched', () => {
    const a = library([]), b = library([]);
    for (let n = 1; n <= 101; n++) { const data = n <= 51 ? a : b; const row = book(n); row.cover = { provider: 'local', mediaId: uuid(n + 1000) }; data.books.push(row); data.coverMedia.push({ ...encodedCover(), id: uuid(n + 1000) }); }
    const plan = prepareMerge({ id: 'p', sources: [{ id: 'local', library: a }, { id: 'remote', library: b }] });
    const decision = choices(plan); expect(() => materializeMerge(plan, decision)).toThrow();
    expect(a.books).toHaveLength(51); decision.books[0].sourceId = null;
    expect(materializeMerge(plan, decision).coverMedia).toHaveLength(100);
  });
});

describe('fixed union policy', () => {
  it('uses the entire local book and local preferences, with every head and deterministic remote-only priority', () => {
    const local = library([{ ...book(1, 'Nota local'), id: uuid(1).toUpperCase(), title: 'Título local' }]);
    local.preferences = { shelfYear: 2025, mode: 'list', filter: 'reading' };
    const sources = [
      { id: 'local', library: local },
      { id: uuid(30), library: library([book(1, 'Remota'), book(2, 'Terceira'), { ...book(4), title: 'Mesmo título', isbn: '9788535914849' }]) },
      { id: uuid(10).toUpperCase(), library: library([book(2, 'Primeira'), { ...book(3), title: 'Mesmo título', isbn: '9788535914849' }]) },
      { id: uuid(20), library: library([book(2, 'Segunda'), book(5)]) },
    ];
    let previous: LibraryExport | undefined;
    for (const ordered of [sources, [...sources].reverse(), [sources[2], sources[0], sources[3], sources[1]]]) {
      const plan = prepareMerge({ id: 'p', sources: ordered }); const result = materializeUnion(plan);
      expect(result.books).toHaveLength(5); expect(result.books[0]).toEqual(local.books[0]);
      expect(result.books[1]).toEqual(book(2, 'Primeira')); expect(result.preferences).toEqual({ shelfYear: local.preferences.shelfYear, filter: local.preferences.filter });
      expect(unionPolicy(plan).preview).toEqual({ id: 'p', totalCount: 5, addedCount: 4, divergentCount: 2, remoteOnlyDivergentCount: 1, remoteSourceCount: 3 });
      if (previous) expect(result).toEqual(previous); previous = result;
    }
  });
  it('includes surviving books even after deletion, but never restores a book absent in all heads and local', () => {
    const plan = prepareMerge({ id: 'p', base: library([book(1), book(2), book(3)]), sources: [
      { id: 'local', library: library([book(1)]) }, { id: uuid(10), library: library([book(2)]) },
    ] });
    expect(materializeUnion(plan).books.map(row => row.id)).toEqual([uuid(1), uuid(2)]);
    expect(unionPolicy(plan).preview).toMatchObject({ addedCount: 1, divergentCount: 0 });
  });
  it('retains exact cover provenance for local precedence and colliding media across three heads', () => {
    const local = library([book(1)]), a = library([book(1), book(2)]), b = library([book(2), book(3)]), c = library([book(4)]);
    for (const data of [local, a, b, c]) { data.coverMedia = [encodedCover()]; data.books.forEach(row => { row.cover = { provider: 'local', mediaId: encodedCover().id }; }); }
    a.coverMedia = [{ ...encodedCover('image/jpeg'), id: encodedCover().id }];
    b.coverMedia[0].createdAt = '2026-09-27T12:00:00Z';
    let id = 100;
    const plan = prepareMerge({ id: 'p', sources: [{ id: uuid(20), library: b }, { id: uuid(30), library: c }, { id: 'local', library: local }, { id: uuid(10), library: a }], newId: () => uuid(id++) });
    const result = materializeUnion(plan);
    const selected = result.books.map(row => result.coverMedia.find(media => row.cover?.provider === 'local' && media.id === row.cover.mediaId));
    expect(selected.map(media => media?.bytes)).toEqual([local, a, b, c].map(data => data.coverMedia[0].bytes));
    expect(selected[2]?.createdAt).toBe(b.coverMedia[0].createdAt);
    expect(selected[0]?.id).toBe(selected[3]?.id); expect(result.coverMedia).toHaveLength(3);
    expect(unionPolicy(plan).preview).toMatchObject({ divergentCount: 2, remoteOnlyDivergentCount: 1 });
    expect(materializeUnion(plan)).toEqual(result);
  });
});
