import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { createShelfService } from '../services/shelf-service';

export async function openShelfService() {
  let service: ReturnType<typeof createShelfService> | undefined;
  const repository = await openLibraryRepository({
    onDatabaseEvent: () => { void service?.refresh(); },
    onObservationError: () => { void service?.refresh(); },
  });
  service = createShelfService(repository);
  return service;
}
