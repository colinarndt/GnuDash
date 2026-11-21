/**
 * Serve a GnuCash book that lives on the server (e.g. a Syncthing-synced
 * copy), so every browser opens the same up-to-date file without uploading.
 *
 * Enabled by GNUDASH_BOOK_PATH. When it is unset this route 404s and the app
 * behaves exactly as before. When it is set the client opens the book
 * read-only and locks editing: the server copy is a mirror of the book you
 * edit in GnuCash desktop, never a place to write.
 *
 *   HEAD /api/book  -> 200 + ETag/Last-Modified (cheap change check)
 *   GET  /api/book  -> the file bytes (304 when If-None-Match matches)
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BookInfo = { file: string; etag: string; modified: Date; size: number };

async function bookInfo(): Promise<BookInfo | null | "missing"> {
  const file = process.env.GNUDASH_BOOK_PATH;
  if (!file) return null;
  try {
    const s = await stat(file);
    if (!s.isFile()) return "missing";
    // Syncthing replaces the file on every change, so size + mtime is a
    // reliable, cheap version tag; no need to hash a multi-MB book.
    const etag = `"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;
    return { file, etag, modified: s.mtime, size: s.size };
  } catch {
    return "missing";
  }
}

function headers(info: BookInfo): HeadersInit {
  return {
    ETag: info.etag,
    "Last-Modified": info.modified.toUTCString(),
    "Cache-Control": "no-store",
    "X-Book-Name": encodeURIComponent(path.basename(info.file)),
  };
}

async function respond(request: Request, withBody: boolean): Promise<Response> {
  const info = await bookInfo();
  if (info === null) return new Response(null, { status: 404 });
  if (info === "missing") {
    return new Response(withBody ? "Synced GnuCash book not found on the server" : null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (request.headers.get("If-None-Match") === info.etag) {
    return new Response(null, { status: 304, headers: headers(info) });
  }
  if (!withBody) {
    return new Response(null, {
      status: 200,
      headers: { ...headers(info), "Content-Length": String(info.size) },
    });
  }
  const body = await readFile(info.file);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { ...headers(info), "Content-Type": "application/x-sqlite3" },
  });
}

export async function HEAD(request: Request) {
  return respond(request, false);
}

export async function GET(request: Request) {
  return respond(request, true);
}
