/**
 * Адреса картинок из IndexedDB для рендера.
 *
 * В сторе лежат ключи (`chatlist:abc`), а `<img>` и `background-image` хотят
 * URL. Собственный хук, потому что и галерея в настройках, и сам сайдбар
 * подгружают одни и те же ключи — и оба должны одинаково переживать отмену и
 * не грузить одно и то же дважды.
 *
 * `loadPhotoBgUrl` уже кэширует object URL и переиспользует незавершённый
 * промис, поэтому здесь достаточно развести mount/unmount.
 */
import { useEffect, useState } from 'react';
import { loadPhotoBgUrl } from '../services/chatBgPhotoStorage';

/** URL одной картинки по ключу; null, пока не загрузилась (или ключа нет). */
export function usePhotoBgUrl(key?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) { setUrl(null); return; }
    let cancelled = false;
    void loadPhotoBgUrl(key).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => { cancelled = true; };
  }, [key]);
  return url;
}

/** URL пачки картинок: { [ключ]: url }. Удобно для галереи. */
export function usePhotoBgUrls(keys: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Ключи приходят новым массивом каждый рендер — зависимость по содержимому.
  const signature = keys.join('|');
  useEffect(() => {
    let cancelled = false;
    for (const key of keys) {
      void loadPhotoBgUrl(key).then((url) => {
        if (cancelled || !url) return;
        setUrls((prev) => (prev[key] ? prev : { ...prev, [key]: url }));
      });
    }
    return () => { cancelled = true; };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  // Объект и так стабилен — это state, а не новый литерал на каждый рендер.
  return urls;
}