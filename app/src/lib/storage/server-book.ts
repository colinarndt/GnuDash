/**
 * Client side of /api/book: detect whether this deployment serves a synced
 * GnuCash book, and fetch it.
 */

export type ServerBookMeta =
  | { enabled: false }
  | { enabled: true; available: false }
  | { enabled: true; available: true; etag: string; name: string; modified: Date };

function metaFrom(res: Response): ServerBookMeta {
  if (res.status === 404) return { enabled: false };
  if (!res.ok) return { enabled: true, available: false };
  const name = decodeURIComponent(res.headers.get("X-Book-Name") ?? "book.gnucash");
  const lastModified = res.headers.get("Last-Modified");
  return {
    enabled: true,
    available: true,
    etag: res.headers.get("ETag") ?? "",
    name,
    modified: lastModified ? new Date(lastModified) : new Date(),
  };
}

export async function fetchServerBookMeta(): Promise<ServerBookMeta> {
  try {
    const res = await fetch("/api/book", { method: "HEAD", cache: "no-store" });
    return metaFrom(res);
  } catch {
    // Static export or no API at all: behave like a normal upload deployment.
    return { enabled: false };
  }
}

export async function fetchServerBookFile(): Promise<{ file: File; etag: string; modified: Date }> {
  const res = await fetch("/api/book", { cache: "no-store" });
  const meta = metaFrom(res);
  if (!meta.enabled || !meta.available) {
    throw new Error(`Couldn't load the synced GnuCash book (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  return {
    file: new File([blob], meta.name, { type: "application/x-sqlite3" }),
    etag: meta.etag,
    modified: meta.modified,
  };
}
