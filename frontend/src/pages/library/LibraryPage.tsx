import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useI18n,
  apiGet,
  apiUploadWithProgress,
  apiDelete,
  apiPatch,
  type LibraryBook,
  type LibraryStats,
} from '@/shared/lib';
import { Container, PageTransition, Card } from '@/shared/ui';
import { extractCover } from './extractCover';
import { Header, Footer } from '@/widgets';
import styles from './LibraryPage.module.css';

const MB = 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function LibraryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [rightsOk, setRightsOk] = useState(
    () => localStorage.getItem('pb.libraryRightsAck') === '1'
  );
  const [askRights, setAskRights] = useState(false);

  const load = useCallback(async () => {
    const [{ data: list }, { data: s }] = await Promise.all([
      apiGet<LibraryBook[]>('/library/books', { requireAuth: true }),
      apiGet<LibraryStats>('/library/stats', { requireAuth: true }),
    ]);
    if (list) setBooks(list);
    if (s) setStats(s);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startUpload = () => {
    if (!rightsOk) {
      setAskRights(true);
      return;
    }
    fileInput.current?.click();
  };

  const acceptRights = () => {
    localStorage.setItem('pb.libraryRightsAck', '1');
    setRightsOk(true);
    setAskRights(false);
    fileInput.current?.click();
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // A cancelled picker fires change with no file — nothing to do.
    if (!file) return;

    // Validated here rather than by the input's accept attribute: iOS refuses
    // to open the picker for some accept values (epub's MIME type among them)
    // and the app just appears to hang. Better to let anything be chosen and
    // explain the problem afterwards.
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'epub') {
      setError(t('library.wrongFormat'));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    setError(null);
    setUploadPct(0);
    setIsUploading(true);

    const form = new FormData();
    form.append('file', file);
    // Filename minus extension is a better first guess than "Untitled"; the
    // reader can rename it afterwards.
    form.append('title', file.name.replace(/\.[^.]+$/, ''));

    const { data: created, error: err } = await apiUploadWithProgress<LibraryBook>(
      '/library/books', form, setUploadPct
    );
    if (err) {
      setError(err);
    } else {
      if (created) {
        const cover = await extractCover(file);
        if (cover) {
          await apiPatch(`/library/books/${created.id}`, { cover_data: cover }, { requireAuth: true });
        }
      }
      await load();
    }

    setIsUploading(false);
    setUploadPct(0);
    // Reset so picking the same file again still fires a change event.
    if (fileInput.current) fileInput.current.value = '';
  };

  const onDelete = async (book: LibraryBook) => {
    if (!window.confirm(t('library.confirmDelete', { title: book.title }))) return;
    setMenuFor(null);
    await apiDelete(`/library/books/${book.id}`, { requireAuth: true });
    await load();
  };

  const onToggleVisible = async (book: LibraryBook) => {
    setMenuFor(null);
    await apiPatch(
      `/library/books/${book.id}`,
      { is_visible_to_buddies: !book.is_visible_to_buddies },
      { requireAuth: true }
    );
    await load();
  };

  const usedPct = stats && stats.storage_quota_bytes > 0
    ? Math.min(100, Math.round((stats.storage_used_bytes / stats.storage_quota_bytes) * 100))
    : 0;

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.titleRow}>
              <div>
                <h1 className={styles.title}>{t('library.title')}</h1>
                <p className={styles.subtitle}>{t('library.subtitle')}</p>
              </div>
              <button
                className={styles.uploadBtn}
                onClick={startUpload}
                disabled={isUploading}
              >
                {isUploading ? t('library.uploadingPct', { percent: uploadPct }) : t('library.upload')}
              </button>
              <input
                ref={fileInput}
                type="file"
                onChange={onPickFile}
                hidden
              />
            </div>

            {askRights && (
              <div className={styles.rightsBox}>
                <div className={styles.rightsTitle}>{t('library.rightsTitle')}</div>
                <p className={styles.rightsText}>{t('library.rightsText')}</p>
                <div className={styles.rightsActions}>
                  <button className={styles.rightsCancel} onClick={() => setAskRights(false)}>
                    {t('library.rightsCancel')}
                  </button>
                  <button className={styles.uploadBtn} onClick={acceptRights}>
                    {t('library.rightsAccept')}
                  </button>
                </div>
              </div>
            )}

            {isUploading && (
              <div className={styles.uploadProgress}>
                <div className={styles.uploadBar}>
                  <div className={styles.uploadFill} style={{ width: `${uploadPct}%` }} />
                </div>
                <div className={styles.uploadHint}>{t('library.uploadingHint')}</div>
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            {stats && stats.total_books > 0 && (
              <div className={styles.statGrid}>
                <div className={styles.statTile}>
                  <div className={styles.statValue}>{stats.total_books}</div>
                  <div className={styles.statLabel}>{t('library.statBooks')}</div>
                </div>
                <div className={styles.statTile}>
                  <div className={styles.statValue}>{stats.finished_books}</div>
                  <div className={styles.statLabel}>{t('library.statFinished')}</div>
                </div>
                <div className={styles.statTile}>
                  <div className={styles.statValue}>{stats.in_progress_books}</div>
                  <div className={styles.statLabel}>{t('library.statReading')}</div>
                </div>
                <div className={styles.statTile}>
                  <div className={styles.statValue}>{stats.average_percent}%</div>
                  <div className={styles.statLabel}>{t('library.statAverage')}</div>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : books.length === 0 ? (
              <Card variant="default" padding="lg">
                <div className={styles.empty}>
                  <div className={styles.emptyIcon} aria-hidden="true">📚</div>
                  <div className={styles.emptyTitle}>{t('library.emptyTitle')}</div>
                  <p className={styles.emptyText}>{t('library.emptyText')}</p>
                  <button className={styles.uploadBtn} onClick={startUpload}>
                    {t('library.upload')}
                  </button>
                </div>
              </Card>
            ) : (
              <div className={styles.grid}>
                {books.map((book) => (
                  <div key={book.id} className={styles.bookCard}>
                    <button
                      className={styles.bookMain}
                      onClick={() => navigate(`/library/${book.id}`)}
                    >
                      <div className={styles.cover}>
                        {book.cover_data ? (
                          <img src={book.cover_data} alt="" className={styles.coverImg} />
                        ) : (
                          <span className={styles.coverFallback}>
                            {book.file_format.toUpperCase()}
                          </span>
                        )}
                        {book.progress_percent > 0 && (
                          <div className={styles.progressBar}>
                            <div
                              className={styles.progressFill}
                              style={{ width: `${book.progress_percent}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <div className={styles.bookTitle}>{book.title}</div>
                      {book.author && <div className={styles.bookAuthor}>{book.author}</div>}
                      <div className={styles.bookMeta}>
                        {book.progress_percent > 0
                          ? t('library.percentRead', { percent: book.progress_percent })
                          : formatSize(book.file_size)}
                        {!book.is_visible_to_buddies && ` · ${t('library.hidden')}`}
                      </div>
                    </button>

                    <button
                      className={styles.menuBtn}
                      aria-label={t('library.bookMenu')}
                      onClick={() => setMenuFor(menuFor === book.id ? null : book.id)}
                    >
                      ⋯
                    </button>

                    {menuFor === book.id && (
                      <div className={styles.menu}>
                        <button className={styles.menuItem} onClick={() => onToggleVisible(book)}>
                          {book.is_visible_to_buddies ? t('library.hideFromBuddies') : t('library.showToBuddies')}
                        </button>
                        <button
                          className={`${styles.menuItem} ${styles.menuItemDanger}`}
                          onClick={() => onDelete(book)}
                        >
                          {t('library.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {stats && stats.total_books > 0 && (
              <div className={styles.storage}>
                <div className={styles.storageText}>
                  {t('library.storageUsed', {
                    used: formatSize(stats.storage_used_bytes),
                    total: formatSize(stats.storage_quota_bytes),
                  })}
                </div>
                <div className={styles.storageBar}>
                  <div className={styles.storageFill} style={{ width: `${usedPct}%` }} />
                </div>
              </div>
            )}
          </Container>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}
