import { useEffect, useState, useSyncExternalStore } from 'react';
import { BookOpen } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import { bookCoverUrl } from '../../app/composition';
import type { Book } from '../../domain/book';
import type { CoverMedia } from '../../media/cover';
import { useLocale } from '../../i18n/context';

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener); window.addEventListener('offline', listener);
  return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener); };
};
const onlineSnapshot = () => navigator.onLine;

/** Adjacent title/author label every use; the image and typographic fallback are decorative. */
export function BookCover({ cover, title, className = '', size = 'M' }: { cover: Book['cover']; title: string; className?: string; size?: 'S' | 'M' }) {
  const { books, state } = useLibrary();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => false);
  const generation = state.status === 'ready' ? state.snapshot.version.generation : '';
  const key = cover?.provider === 'local' ? `local:${cover.mediaId.toLowerCase()}:${generation}` :
    cover?.provider === 'open_library' ? `remote:${cover.coverId}:${size}:${online}` : 'none';
  return <CoverImage key={key} cover={cover} title={title} className={className}
    remoteUrl={online && cover?.provider === 'open_library' ? bookCoverUrl(cover.coverId, size) : null} readLocal={books?.readCover} />;
}

function CoverImage({ cover, title, className, remoteUrl, readLocal }: {
  cover: Book['cover']; title: string; className: string; remoteUrl: string | null;
  readLocal?: (id: string) => Promise<CoverMedia | null>;
}) {
  const { t } = useLocale();
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const mediaId = cover?.provider === 'local' ? cover.mediaId : null;
  useEffect(() => {
    if (!mediaId || !readLocal || failed) return;
    let active = true; let ownedUrl: string | null = null;
    const revoke = URL.revokeObjectURL?.bind(URL);
    void readLocal(mediaId).then(media => {
      if (!active || !media) return;
      ownedUrl = URL.createObjectURL(media.bytes); setLocalUrl(ownedUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (ownedUrl) revoke?.(ownedUrl); };
  }, [mediaId, readLocal, failed]);
  const source = mediaId ? localUrl : remoteUrl;
  return <div className={`book-cover-frame ${className}`}>
    {source && !failed ? <img className="book-cover-image" src={source} alt="" loading="lazy" decoding="async"
      crossOrigin={mediaId ? undefined : 'anonymous'} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> :
      <div className="book-cover" aria-hidden="true"><BookOpen /><span>{t('noCover', { title })}</span></div>}
  </div>;
}
