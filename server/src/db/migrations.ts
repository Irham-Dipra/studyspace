/**
 * Ordered, append-only schema migrations. Never edit a migration that has shipped;
 * add a new one with the next version number instead.
 */
export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: `
      CREATE TABLE directories (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        path            TEXT NOT NULL UNIQUE,
        label           TEXT NOT NULL,
        excludes        TEXT NOT NULL DEFAULT '[]',
        enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_scanned_at TEXT
      );

      CREATE TABLE documents (
        id                TEXT PRIMARY KEY,
        directory_id      INTEGER REFERENCES directories(id) ON DELETE SET NULL,
        path              TEXT NOT NULL UNIQUE,
        rel_path          TEXT NOT NULL,
        title             TEXT NOT NULL,
        fingerprint       TEXT NOT NULL,
        size              INTEGER NOT NULL,
        mtime_ms          INTEGER NOT NULL,
        page_count        INTEGER,
        missing           INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
        annotations_dirty INTEGER NOT NULL DEFAULT 0 CHECK (annotations_dirty IN (0, 1)),
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_seen_at      TEXT
      );
      CREATE INDEX idx_documents_fingerprint ON documents(fingerprint);
      CREATE INDEX idx_documents_directory ON documents(directory_id);

      CREATE TABLE resources (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        type        TEXT NOT NULL CHECK (type IN ('note', 'ai_explanation', 'summary', 'pyq', 'link')),
        scope       TEXT NOT NULL CHECK (scope IN ('page', 'range', 'document')),
        title       TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        url         TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_resources_document ON resources(document_id);

      CREATE TABLE resource_pages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        page_start  INTEGER NOT NULL CHECK (page_start >= 1),
        page_end    INTEGER NOT NULL,
        CHECK (page_end >= page_start)
      );
      CREATE INDEX idx_resource_pages_resource ON resource_pages(resource_id);
      CREATE INDEX idx_resource_pages_range ON resource_pages(page_start, page_end);

      CREATE TABLE reading_progress (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        page        INTEGER NOT NULL DEFAULT 1,
        zoom        REAL NOT NULL DEFAULT 1,
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE annotations (
        id           TEXT PRIMARY KEY,
        document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page         INTEGER NOT NULL CHECK (page >= 1),
        kind         TEXT NOT NULL CHECK (kind IN ('highlight', 'area', 'ink')),
        color        TEXT NOT NULL,
        opacity      REAL NOT NULL DEFAULT 0.4,
        rects        TEXT NOT NULL DEFAULT '[]',
        paths        TEXT NOT NULL DEFAULT '[]',
        stroke_width REAL NOT NULL DEFAULT 0.003,
        text         TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_annotations_document_page ON annotations(document_id, page);
    `,
  },
  {
    version: 2,
    name: "document_history",
    up: `
      -- One row per undoable file edit (page insert/delete, saving annotations into the PDF).
      -- file_path holds the PDF as it was before the edit; snapshot holds the document's notes,
      -- page associations, annotations and progress before the edit.
      CREATE TABLE document_history (
        id                TEXT PRIMARY KEY,
        document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        kind              TEXT NOT NULL CHECK (kind IN ('insert', 'delete', 'save')),
        label             TEXT NOT NULL,
        params            TEXT NOT NULL DEFAULT '{}',
        snapshot          TEXT NOT NULL,
        file_path         TEXT NOT NULL,
        page_count_before INTEGER NOT NULL,
        fingerprint_after TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_document_history_document ON document_history(document_id, created_at);
    `,
  },
  {
    version: 3,
    name: "note_highlights",
    up: `
      -- Highlights (with optional comments) made on the rendered text of a note/resource.
      -- Anchored by quote + surrounding context rather than character offsets, so they survive edits
      -- to the note's Markdown and the note content itself is never modified.
      CREATE TABLE note_highlights (
        id          TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        color       TEXT NOT NULL,
        quote       TEXT NOT NULL CHECK (length(quote) > 0),
        prefix      TEXT NOT NULL DEFAULT '',
        suffix      TEXT NOT NULL DEFAULT '',
        comment     TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_note_highlights_resource ON note_highlights(resource_id);
    `,
  },
  {
    version: 4,
    name: "history_replace_kind",
    up: `
      -- Allow 'replace' (swap pages for pages of another PDF) in the undo history. SQLite can't
      -- alter a CHECK constraint, so the table is rebuilt; nothing references it.
      CREATE TABLE document_history_new (
        id                TEXT PRIMARY KEY,
        document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        kind              TEXT NOT NULL CHECK (kind IN ('insert', 'delete', 'replace', 'save')),
        label             TEXT NOT NULL,
        params            TEXT NOT NULL DEFAULT '{}',
        snapshot          TEXT NOT NULL,
        file_path         TEXT NOT NULL,
        page_count_before INTEGER NOT NULL,
        fingerprint_after TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO document_history_new SELECT id, document_id, kind, label, params, snapshot, file_path,
        page_count_before, fingerprint_after, created_at FROM document_history;
      DROP TABLE document_history;
      ALTER TABLE document_history_new RENAME TO document_history;
      CREATE INDEX idx_document_history_document ON document_history(document_id, created_at);
    `,
  },
  {
    version: 5,
    name: "history_ocr_kind",
    up: `
      -- Allow 'ocr' (adding an OCR text layer to pages) in the undo history; rebuilt like v4.
      CREATE TABLE document_history_new (
        id                TEXT PRIMARY KEY,
        document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        kind              TEXT NOT NULL CHECK (kind IN ('insert', 'delete', 'replace', 'ocr', 'save')),
        label             TEXT NOT NULL,
        params            TEXT NOT NULL DEFAULT '{}',
        snapshot          TEXT NOT NULL,
        file_path         TEXT NOT NULL,
        page_count_before INTEGER NOT NULL,
        fingerprint_after TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO document_history_new SELECT id, document_id, kind, label, params, snapshot, file_path,
        page_count_before, fingerprint_after, created_at FROM document_history;
      DROP TABLE document_history;
      ALTER TABLE document_history_new RENAME TO document_history;
      CREATE INDEX idx_document_history_document ON document_history(document_id, created_at);
    `,
  },
  {
    version: 6,
    name: "bookmarks",
    up: `
      -- PDF bookmarks (the outline / table of contents). Imported once from the PDF's own outline
      -- (outline_imported), edited in StudySpace, and written back into the file on "Save to PDF".
      -- top: position on the page, 0 = top edge (normalised display coordinates); NULL = page start.
      CREATE TABLE bookmarks (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        parent_id   TEXT REFERENCES bookmarks(id) ON DELETE CASCADE,
        position    REAL NOT NULL DEFAULT 0,
        title       TEXT NOT NULL CHECK (length(title) > 0),
        page        INTEGER NOT NULL CHECK (page >= 1),
        top         REAL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_bookmarks_document ON bookmarks(document_id, parent_id, position);
      ALTER TABLE documents ADD COLUMN bookmarks_dirty INTEGER NOT NULL DEFAULT 0 CHECK (bookmarks_dirty IN (0, 1));
      ALTER TABLE documents ADD COLUMN outline_imported INTEGER NOT NULL DEFAULT 0 CHECK (outline_imported IN (0, 1));
    `,
  },
  {
    version: 7,
    name: "history_rotate_move_kinds",
    up: `
      -- Allow 'rotate' (turning pages) and 'move' (reordering pages) in the undo history; rebuilt like v4.
      CREATE TABLE document_history_new (
        id                TEXT PRIMARY KEY,
        document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        kind              TEXT NOT NULL CHECK (kind IN ('insert', 'delete', 'replace', 'ocr', 'save', 'rotate', 'move')),
        label             TEXT NOT NULL,
        params            TEXT NOT NULL DEFAULT '{}',
        snapshot          TEXT NOT NULL,
        file_path         TEXT NOT NULL,
        page_count_before INTEGER NOT NULL,
        fingerprint_after TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO document_history_new SELECT id, document_id, kind, label, params, snapshot, file_path,
        page_count_before, fingerprint_after, created_at FROM document_history;
      DROP TABLE document_history;
      ALTER TABLE document_history_new RENAME TO document_history;
      CREATE INDEX idx_document_history_document ON document_history(document_id, created_at);
    `,
  },
  {
    version: 8,
    name: "sessions_text_highlights_scroll",
    up: `
      -- Logins from other devices (a phone over Wi-Fi or Tailscale). Only a hash of each cookie's
      -- token is kept, so the database alone can't be used to log in.
      CREATE TABLE sessions (
        token_hash   TEXT PRIMARY KEY,
        user_agent   TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        expires_at   TEXT NOT NULL
      );
      -- Highlights on the text of HTML and Markdown documents. They have no pages, and their text
      -- reflows, so they are anchored like note highlights: quote + surrounding context.
      CREATE TABLE document_highlights (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        color       TEXT NOT NULL,
        quote       TEXT NOT NULL CHECK (length(quote) > 0),
        prefix      TEXT NOT NULL DEFAULT '',
        suffix      TEXT NOT NULL DEFAULT '',
        comment     TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_document_highlights_document ON document_highlights(document_id);
      -- Where you were in a document without pages: 0 = top, 1 = bottom.
      ALTER TABLE reading_progress ADD COLUMN top REAL;
    `,
  },
  {
    version: 9,
    name: "resource_styles",
    up: `
      -- Colours the user picked for single headings, labels or marks of a note, replacing their
      -- default highlighter colour: JSON {"<element key>": "#rrggbb" | "none"} (see web rehypeNoteStyles).
      ALTER TABLE resources ADD COLUMN styles TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 10,
    name: "text_boxes_note_markers",
    up: `
      -- Text boxes typed on a page: a new annotation kind. SQLite can't change a CHECK, so the
      -- table is rebuilt (nothing references annotations).
      CREATE TABLE annotations_new (
        id           TEXT PRIMARY KEY,
        document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page         INTEGER NOT NULL CHECK (page >= 1),
        kind         TEXT NOT NULL CHECK (kind IN ('highlight', 'area', 'ink', 'text')),
        color        TEXT NOT NULL,
        opacity      REAL NOT NULL DEFAULT 0.4,
        rects        TEXT NOT NULL DEFAULT '[]',
        paths        TEXT NOT NULL DEFAULT '[]',
        stroke_width REAL NOT NULL DEFAULT 0.003,
        text         TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO annotations_new SELECT id, document_id, page, kind, color, opacity, rects, paths, stroke_width, text,
        created_at, updated_at FROM annotations;
      DROP TABLE annotations;
      ALTER TABLE annotations_new RENAME TO annotations;
      CREATE INDEX idx_annotations_document_page ON annotations(document_id, page);
      -- A note's marker on its (first) page: clicking it opens the note. Normalised display coordinates.
      ALTER TABLE resources ADD COLUMN marker_x REAL;
      ALTER TABLE resources ADD COLUMN marker_y REAL;
    `,
  },
  {
    version: 11,
    name: "note_markers",
    up: `
      -- Markers on pages that open a note, possibly at a passage of it (quote + context, anchored
      -- like note highlights; empty quote = the whole note). A note can have several. They replace
      -- v10's single marker per note (resources.marker_x/y), which are moved here.
      CREATE TABLE note_markers (
        id          TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        page        INTEGER NOT NULL CHECK (page >= 1),
        x           REAL NOT NULL,
        y           REAL NOT NULL,
        quote       TEXT NOT NULL DEFAULT '',
        prefix      TEXT NOT NULL DEFAULT '',
        suffix      TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_note_markers_resource ON note_markers(resource_id);
      -- Version-4 UUIDs, so undo/redo can recreate these with the same id like any other.
      INSERT INTO note_markers (id, resource_id, page, x, y)
        SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
               || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
               r.id, rp.page_start, r.marker_x, r.marker_y
        FROM resources r JOIN resource_pages rp ON rp.resource_id = r.id
        WHERE r.marker_x IS NOT NULL AND r.marker_y IS NOT NULL;
      ALTER TABLE resources DROP COLUMN marker_x;
      ALTER TABLE resources DROP COLUMN marker_y;
    `,
  },
  {
    version: 12,
    name: "documents_hidden",
    up: `
      -- Files the user hid from the library list (picked by hand; rules in directories.excludes
      -- are separate). The file and its notes stay; the list in the app unhides them.
      ALTER TABLE documents ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 13,
    name: "documents_favorite",
    up: `
      -- Favourite files: their place in the Favourites list (smaller first); NULL = not a favourite.
      -- REAL, so a file can be moved between two others without renumbering the rest.
      ALTER TABLE documents ADD COLUMN favorite REAL;
    `,
  },
];
