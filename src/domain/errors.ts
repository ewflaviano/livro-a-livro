import { z } from 'zod';

export const domainErrorCodeSchema = z.enum([
  'InvalidBook',
  'InvalidLibrary',
  'StorageUnavailable',
  'QuotaExceeded',
  'StaleRevision',
  'UnsupportedVersion',
  'InvalidBackup',
  'ImportTooLarge',
]);

export type DomainErrorCode = z.infer<typeof domainErrorCodeSchema>;
export type ValidationIssue = {
  code: z.core.$ZodIssue['code'];
  path: readonly (string | number)[];
};

// Only codes and schema paths cross the boundary, never input, Zod messages or causes.
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly issues: readonly ValidationIssue[];

  constructor(code: DomainErrorCode, issues: readonly ValidationIssue[] = []) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.issues = issues;
  }
}

export function parseDomain<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: DomainErrorCode = 'InvalidBook',
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new DomainError(code, result.error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.filter((part): part is string | number =>
      typeof part === 'string' || typeof part === 'number'),
  })));
}
