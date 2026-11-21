import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET, HEAD } from "../route";

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/book", { headers });

function book(contents = "SQLite format 3\0fake") {
  const dir = mkdtempSync(path.join(tmpdir(), "gnudash-book-"));
  const file = path.join(dir, "Books.gnucash");
  writeFileSync(file, contents);
  return file;
}

describe("/api/book", () => {
  afterEach(() => {
    delete process.env.GNUDASH_BOOK_PATH;
  });

  it("is off unless GNUDASH_BOOK_PATH is set", async () => {
    expect((await HEAD(req())).status).toBe(404);
    expect((await GET(req())).status).toBe(404);
  });

  it("reports a configured but missing book as unavailable", async () => {
    process.env.GNUDASH_BOOK_PATH = "/nonexistent/Books.gnucash";
    expect((await HEAD(req())).status).toBe(503);
  });

  it("serves the book with a version tag and its file name", async () => {
    process.env.GNUDASH_BOOK_PATH = book("hello");
    const head = await HEAD(req());
    expect(head.status).toBe(200);
    expect(head.headers.get("X-Book-Name")).toBe("Books.gnucash");
    const res = await GET(req());
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("ETag")).toBe(head.headers.get("ETag"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 304 for an unchanged book and a new tag after it changes", async () => {
    const file = book("v1");
    process.env.GNUDASH_BOOK_PATH = file;
    const etag = (await HEAD(req())).headers.get("ETag")!;
    expect((await GET(req({ "If-None-Match": etag }))).status).toBe(304);

    writeFileSync(file, "version two");
    const later = new Date(Date.now() + 60_000);
    utimesSync(file, later, later);
    const changed = await GET(req({ "If-None-Match": etag }));
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
  });
});
