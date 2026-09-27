import { DomainError } from '../../domain/errors';

export function storageError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return new DomainError('QuotaExceeded');
  if (name === 'VersionError') return new DomainError('UnsupportedVersion');
  return new DomainError('StorageUnavailable');
}
