import { z } from 'zod';
import { instantSchema } from '../domain/book';
import type { LibraryExport } from '../backup/schema';

export const bindingSchema = z.strictObject({ connectionId: z.string().min(1).max(200), generation: z.number().int().nonnegative() });
export type Binding = z.infer<typeof bindingSchema>;
export const sameBinding = (a: Binding | null, b: Binding) => a?.connectionId === b.connectionId && a.generation === b.generation;
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const fields = { format: z.literal('livro-a-livro-sync'), snapshotId: z.uuid(), operationId: z.uuid(), parentSnapshotId: z.uuid().nullable(),
  resolvedSnapshotIds: z.array(z.uuid()).max(1000), hash: hashSchema, createdAt: instantSchema };
// Field order deliberately matches the historical V1 serializer.
export const headerV1Schema = z.strictObject({ format: fields.format, protocolVersion: z.literal(1), snapshotId: fields.snapshotId,
  operationId: fields.operationId, parentSnapshotId: fields.parentSnapshotId, resolvedSnapshotIds: fields.resolvedSnapshotIds, hash: fields.hash, createdAt: fields.createdAt });
export const headerV2Schema = headerV1Schema.extend({ protocolVersion: z.literal(2) });
export const headerSchema = z.discriminatedUnion('protocolVersion', [headerV1Schema, headerV2Schema]);
export type SnapshotHeader = z.infer<typeof headerSchema>;
export type SyncSnapshotV1 = z.infer<typeof headerV1Schema> & { library: LibraryExport };
export type SyncSnapshotV2 = z.infer<typeof headerV2Schema> & { library: LibraryExport };
export type SyncSnapshot = SyncSnapshotV1 | SyncSnapshotV2;
export const binaryCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort(binaryCompare).map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const headerOf = ({ library: _, ...header }: SyncSnapshot): SnapshotHeader => header;
export const sameHeader = (a: SnapshotHeader, b: SnapshotHeader) => canonicalJson(a) === canonicalJson(b);
