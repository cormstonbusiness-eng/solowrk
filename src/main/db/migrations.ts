/**
 * Schema migrations, applied in order on every app start.
 *
 * Rules: migrations are append-only and never edited once shipped — a user's
 * database has already run them. Each phase of the build adds its own, so the
 * schema history reads as the app's history.
 */
export interface Migration {
  id: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'settings',
    sql: `
      -- Single-row table (id is pinned to 1) holding the business profile.
      -- Money is integer pence; percentages are basis points.
      CREATE TABLE settings (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),

        business_name       TEXT    NOT NULL DEFAULT '',
        contact_name        TEXT    NOT NULL DEFAULT '',
        email               TEXT    NOT NULL DEFAULT '',
        phone               TEXT    NOT NULL DEFAULT '',
        address_line1       TEXT    NOT NULL DEFAULT '',
        address_line2       TEXT    NOT NULL DEFAULT '',
        city                TEXT    NOT NULL DEFAULT '',
        postcode            TEXT    NOT NULL DEFAULT '',
        country             TEXT    NOT NULL DEFAULT 'United Kingdom',

        vat_registered      INTEGER NOT NULL DEFAULT 0 CHECK (vat_registered IN (0, 1)),
        vat_number          TEXT    NOT NULL DEFAULT '',
        vat_rate            INTEGER NOT NULL DEFAULT 2000,

        currency            TEXT    NOT NULL DEFAULT 'GBP',
        default_hourly_rate INTEGER NOT NULL DEFAULT 5000,
        payment_terms_days  INTEGER NOT NULL DEFAULT 14,

        tax_set_aside_percent INTEGER NOT NULL DEFAULT 30,
        tax_year_start_day    INTEGER NOT NULL DEFAULT 6,
        tax_year_start_month  INTEGER NOT NULL DEFAULT 4,

        invoice_prefix      TEXT    NOT NULL DEFAULT 'INV-',
        next_invoice_number INTEGER NOT NULL DEFAULT 1,
        quote_prefix        TEXT    NOT NULL DEFAULT 'QTE-',
        next_quote_number   INTEGER NOT NULL DEFAULT 1,

        created_at          TEXT    NOT NULL,
        updated_at          TEXT    NOT NULL
      );

      INSERT INTO settings (id, created_at, updated_at)
      VALUES (1, datetime('now'), datetime('now'));
    `
  },
  {
    id: 2,
    name: 'app_state',
    sql: `
      -- Small key/value store for UI state that belongs to the workspace but
      -- is not business data: tour progress, last opened project, view
      -- preferences. Keeps such things out of the settings table, which is
      -- the invoice-facing business profile.
      CREATE TABLE app_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    id: 3,
    name: 'clients_projects_tasks',
    sql: `
      -- 'folder' columns hold a path relative to the workspace root, so a
      -- workspace stays portable when it moves between machines or drives.
      CREATE TABLE clients (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        name               TEXT    NOT NULL,
        contact_name       TEXT    NOT NULL DEFAULT '',
        email              TEXT    NOT NULL DEFAULT '',
        phone              TEXT    NOT NULL DEFAULT '',
        address            TEXT    NOT NULL DEFAULT '',
        vat_number         TEXT    NOT NULL DEFAULT '',
        -- NULL means "use the default from settings" rather than "free".
        default_rate       INTEGER,
        payment_terms_days INTEGER,
        notes              TEXT    NOT NULL DEFAULT '',
        colour             TEXT    NOT NULL DEFAULT '#6E56CF',
        folder             TEXT    NOT NULL,
        archived           INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at         TEXT    NOT NULL,
        updated_at         TEXT    NOT NULL
      );

      CREATE TABLE projects (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        -- Nullable: internal work belongs to no client.
        client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        name         TEXT    NOT NULL,
        description  TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
        rate         INTEGER,
        budget       INTEGER,
        starts_on    TEXT,
        due_on       TEXT,
        colour       TEXT    NOT NULL DEFAULT '#6E56CF',
        folder       TEXT    NOT NULL,
        archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      CREATE TABLE categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        colour     TEXT    NOT NULL,
        sort_order REAL    NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      CREATE TABLE tasks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        -- Subtasks die with their parent.
        parent_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        title        TEXT    NOT NULL,
        notes        TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('todo', 'doing', 'done')),
        priority     INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 3),
        due_at       TEXT,
        -- REAL so a task can be dropped between two others by averaging their
        -- orders, instead of renumbering the whole column on every move.
        sort_order   REAL    NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title      TEXT    NOT NULL,
        -- The note's body lives in this .md file, readable outside SoloWrk.
        file       TEXT    NOT NULL,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      CREATE TABLE templates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        -- JSON: folder list and task list to recreate. Shape lives in
        -- @shared/types as TemplatePayload.
        payload     TEXT    NOT NULL,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );

      CREATE INDEX idx_projects_client ON projects(client_id);
      CREATE INDEX idx_tasks_project   ON tasks(project_id);
      CREATE INDEX idx_tasks_parent    ON tasks(parent_id);
      CREATE INDEX idx_tasks_status    ON tasks(status);
      CREATE INDEX idx_tasks_due       ON tasks(due_at);
      CREATE INDEX idx_notes_project   ON notes(project_id);

      -- A starting set so colour-coding works before the user configures
      -- anything. All are editable and deletable.
      INSERT INTO categories (name, colour, sort_order, created_at, updated_at) VALUES
        ('Design',    '#6E56CF', 1, datetime('now'), datetime('now')),
        ('Build',     '#3B82F6', 2, datetime('now'), datetime('now')),
        ('Content',   '#30A46C', 3, datetime('now'), datetime('now')),
        ('Admin',     '#F5A623', 4, datetime('now'), datetime('now')),
        ('Client',    '#E5484D', 5, datetime('now'), datetime('now'));
    `
  },
  {
    id: 4,
    name: 'documents',
    sql: `
      -- Business paperwork. The file itself lives in the workspace under
      -- Documents\\<category>; this table adds the things a filesystem cannot
      -- hold: what it is, when it expires, and how to find it again.
      CREATE TABLE documents (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT    NOT NULL,
        category   TEXT    NOT NULL DEFAULT 'Business',
        file       TEXT    NOT NULL,
        -- Comma-separated, lower-cased on write. A tags table would be the
        -- textbook answer, but tags here are a search aid, not a relation.
        tags       TEXT    NOT NULL DEFAULT '',
        notes      TEXT    NOT NULL DEFAULT '',
        -- Renewal date for insurance, certificates, licences. Drives reminders.
        expiry_at  TEXT,
        client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      CREATE INDEX idx_documents_category ON documents(category);
      CREATE INDEX idx_documents_expiry   ON documents(expiry_at);
    `
  },
  {
    id: 5,
    name: 'money',
    sql: `
      -- Every amount in this migration is integer pence; every rate is basis
      -- points (2000 = 20%). Dates are 'yyyy-mm-dd' so they compare and sort
      -- as strings without timezone involvement.

      CREATE TABLE quotes (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        number               TEXT    NOT NULL UNIQUE,
        client_id            INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        project_id           INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        status               TEXT    NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','sent','accepted','declined','expired')),
        issue_date           TEXT    NOT NULL,
        valid_until          TEXT,
        net                  INTEGER NOT NULL DEFAULT 0,
        vat_rate             INTEGER NOT NULL DEFAULT 0,
        vat                  INTEGER NOT NULL DEFAULT 0,
        gross                INTEGER NOT NULL DEFAULT 0,
        notes                TEXT    NOT NULL DEFAULT '',
        accepted_at          TEXT,
        -- Set when an accepted quote is turned into work.
        converted_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        converted_invoice_id INTEGER,
        pdf_path             TEXT,
        created_at           TEXT    NOT NULL,
        updated_at           TEXT    NOT NULL
      );

      CREATE TABLE quote_lines (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        description TEXT    NOT NULL,
        quantity    REAL    NOT NULL DEFAULT 1,
        unit_price  INTEGER NOT NULL DEFAULT 0,
        amount      INTEGER NOT NULL DEFAULT 0,
        sort_order  REAL    NOT NULL DEFAULT 0
      );

      CREATE TABLE invoices (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        number            TEXT    NOT NULL UNIQUE,
        client_id         INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        -- 'overdue' is deliberately absent: it is derived from due_date and
        -- today, so it can never go stale in the database.
        status            TEXT    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','paid','cancelled')),
        issue_date        TEXT    NOT NULL,
        due_date          TEXT    NOT NULL,
        paid_at           TEXT,
        net               INTEGER NOT NULL DEFAULT 0,
        vat_rate          INTEGER NOT NULL DEFAULT 0,
        vat               INTEGER NOT NULL DEFAULT 0,
        gross             INTEGER NOT NULL DEFAULT 0,
        notes             TEXT    NOT NULL DEFAULT '',
        pdf_path          TEXT,
        -- A retainer: this invoice is the template, and next_issue_on is when
        -- the next copy is due. Generated copies carry parent_invoice_id and
        -- recurrence 'none'.
        recurrence        TEXT    NOT NULL DEFAULT 'none'
                          CHECK (recurrence IN ('none','weekly','monthly','quarterly','yearly')),
        next_issue_on     TEXT,
        parent_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE TABLE invoice_lines (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT    NOT NULL,
        quantity    REAL    NOT NULL DEFAULT 1,
        unit_price  INTEGER NOT NULL DEFAULT 0,
        amount      INTEGER NOT NULL DEFAULT 0,
        -- Where the line came from, so time and expenses can be marked billed.
        kind        TEXT    NOT NULL DEFAULT 'fixed'
                    CHECK (kind IN ('fixed','time','expense')),
        sort_order  REAL    NOT NULL DEFAULT 0
      );

      CREATE TABLE time_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        -- Full ISO timestamps: unlike dates, these are moments in time.
        started_at      TEXT    NOT NULL,
        -- NULL means the timer is still running.
        ended_at        TEXT,
        duration        INTEGER NOT NULL DEFAULT 0,
        -- Snapshot of the rate when logged, so later rate changes do not
        -- silently rewrite the value of work already done.
        rate            INTEGER NOT NULL DEFAULT 0,
        billable        INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0,1)),
        notes           TEXT    NOT NULL DEFAULT '',
        invoice_line_id INTEGER REFERENCES invoice_lines(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );

      CREATE TABLE expenses (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        date            TEXT    NOT NULL,
        vendor          TEXT    NOT NULL DEFAULT '',
        description     TEXT    NOT NULL DEFAULT '',
        category        TEXT    NOT NULL DEFAULT 'General',
        net             INTEGER NOT NULL DEFAULT 0,
        vat             INTEGER NOT NULL DEFAULT 0,
        total           INTEGER NOT NULL DEFAULT 0,
        receipt_file    TEXT,
        project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        rebillable      INTEGER NOT NULL DEFAULT 0 CHECK (rebillable IN (0,1)),
        invoice_line_id INTEGER REFERENCES invoice_lines(id) ON DELETE SET NULL,
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );

      CREATE INDEX idx_invoices_client   ON invoices(client_id);
      CREATE INDEX idx_invoices_status   ON invoices(status);
      CREATE INDEX idx_invoices_due      ON invoices(due_date);
      CREATE INDEX idx_invoice_lines_inv ON invoice_lines(invoice_id);
      CREATE INDEX idx_quote_lines_quote ON quote_lines(quote_id);
      CREATE INDEX idx_time_project      ON time_entries(project_id);
      CREATE INDEX idx_time_started      ON time_entries(started_at);
      CREATE INDEX idx_time_unbilled     ON time_entries(invoice_line_id);
      CREATE INDEX idx_expenses_date     ON expenses(date);
    `
  },

  {
    id: 6,
    name: 'calendar',
    sql: `
      -- Times are local wall-clock stamps: 'yyyy-mm-ddThh:mm', no timezone.
      -- See the reasoning in src/shared/calendar.ts. Because they sort
      -- lexicographically, a date range is a plain BETWEEN with no conversion.
      CREATE TABLE events (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        title            TEXT    NOT NULL,
        description      TEXT    NOT NULL DEFAULT '',
        location         TEXT    NOT NULL DEFAULT '',

        starts_at        TEXT    NOT NULL,
        ends_at          TEXT    NOT NULL,
        all_day          INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),

        -- Where the event came from. Everything is 'local' until phase 8 adds
        -- Google and Teams sync; external_id is that phase's join key.
        kind             TEXT    NOT NULL DEFAULT 'local'
                                 CHECK (kind IN ('local', 'google', 'teams')),
        external_id      TEXT,
        meeting_url      TEXT    NOT NULL DEFAULT '',

        project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        client_id        INTEGER REFERENCES clients(id)  ON DELETE SET NULL,
        -- Empty means "inherit the project's colour", so recolouring a project
        -- recolours its meetings instead of leaving them stale.
        colour           TEXT    NOT NULL DEFAULT '',

        -- Minutes before the start; NULL for no reminder. reminded_at is set
        -- once the notification has fired so it cannot fire twice.
        reminder_minutes INTEGER,
        reminded_at      TEXT,

        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL
      );

      CREATE INDEX idx_events_starts   ON events(starts_at);
      CREATE INDEX idx_events_project  ON events(project_id);
      CREATE INDEX idx_events_reminder ON events(reminded_at, reminder_minutes);
      CREATE UNIQUE INDEX idx_events_external ON events(kind, external_id)
        WHERE external_id IS NOT NULL;
    `
  },

  {
    id: 7,
    name: 'assistant',
    sql: `
      CREATE TABLE ai_conversations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL DEFAULT 'New chat',
        -- The Agent SDK's own session id, so a conversation can be resumed
        -- with its full context rather than replayed from our transcript.
        session_id  TEXT,
        project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );

      CREATE TABLE ai_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'error')),
        content         TEXT    NOT NULL DEFAULT '',
        -- Tool calls keep their name, input and result as JSON so the
        -- transcript can be re-rendered exactly as it happened.
        tool_name       TEXT,
        tool_input      TEXT,
        tool_result     TEXT,
        created_at      TEXT    NOT NULL
      );

      CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id, id);
    `
  },

  {
    id: 8,
    name: 'marketing',
    sql: `
      -- Connected social accounts. Deliberately holds NO tokens: credential_key
      -- points at a blob encrypted with Electron's safeStorage and kept in
      -- userData, outside the workspace, so a workspace that is zipped, synced
      -- or copied to another machine never carries access tokens with it.
      CREATE TABLE social_accounts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        platform       TEXT    NOT NULL
                               CHECK (platform IN ('linkedin','facebook','instagram',
                                                   'tiktok','pinterest')),
        handle         TEXT    NOT NULL DEFAULT '',
        display_name   TEXT    NOT NULL DEFAULT '',
        avatar_file    TEXT,
        external_id    TEXT,
        status         TEXT    NOT NULL DEFAULT 'connected'
                               CHECK (status IN ('connected','expired','disconnected')),
        scopes         TEXT    NOT NULL DEFAULT '',
        -- Page id, Instagram user id, default Pinterest board — whatever the
        -- platform needs alongside the token.
        meta           TEXT    NOT NULL DEFAULT '{}',
        credential_key TEXT,
        connected_at   TEXT,
        created_at     TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL
      );

      CREATE TABLE campaigns (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        goal        TEXT    NOT NULL DEFAULT '',
        colour      TEXT    NOT NULL DEFAULT '#6E56CF',
        starts_on   TEXT,
        ends_on     TEXT,
        status      TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('planned','active','finished','archived')),
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );

      -- Themes, with the share of output each is meant to take. Basis points,
      -- like VAT rates, so 4000 is 40% and the arithmetic stays in integers.
      CREATE TABLE content_pillars (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        description  TEXT    NOT NULL DEFAULT '',
        colour       TEXT    NOT NULL DEFAULT '#6E56CF',
        target_share INTEGER NOT NULL DEFAULT 0,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      -- scheduled_at is a local wall-clock stamp, 'yyyy-mm-ddThh:mm', exactly as
      -- events are. See src/shared/calendar.ts. Conversion to whatever UTC each
      -- API wants happens at the API boundary and nowhere else.
      CREATE TABLE posts (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id       INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
        pillar_id         INTEGER REFERENCES content_pillars(id) ON DELETE SET NULL,
        project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        title             TEXT    NOT NULL DEFAULT '',
        body              TEXT    NOT NULL DEFAULT '',
        link_url          TEXT    NOT NULL DEFAULT '',
        notes             TEXT    NOT NULL DEFAULT '',
        status            TEXT    NOT NULL DEFAULT 'idea'
                                  CHECK (status IN ('idea','draft','scheduled','published',
                                                    'failed','needs_attention')),
        scheduled_at      TEXT,
        published_at      TEXT,
        -- Evergreen posts re-appear as fresh scheduled copies on this cadence,
        -- the same mechanism as recurring invoices.
        evergreen_days    INTEGER,
        next_repeat_on    TEXT,
        parent_post_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      -- One row per post per destination. The same idea goes to LinkedIn as
      -- three paragraphs and to Instagram as a caption with fifteen hashtags,
      -- and each destination succeeds or fails on its own — which is why the
      -- status lives here and not only on the post.
      CREATE TABLE post_targets (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        account_id   INTEGER REFERENCES social_accounts(id) ON DELETE SET NULL,
        platform     TEXT    NOT NULL,
        -- Empty means "use the post's body unchanged".
        body         TEXT    NOT NULL DEFAULT '',
        title        TEXT    NOT NULL DEFAULT '',
        board_id     TEXT,
        status       TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','handed_over','published',
                                               'failed','skipped')),
        external_id  TEXT,
        external_url TEXT,
        error        TEXT    NOT NULL DEFAULT '',
        published_at TEXT,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      CREATE TABLE post_media (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        file       TEXT    NOT NULL,
        alt_text   TEXT    NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL
      );

      CREATE TABLE post_metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id   INTEGER NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
        captured_at TEXT    NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0,
        likes       INTEGER NOT NULL DEFAULT 0,
        comments    INTEGER NOT NULL DEFAULT 0,
        shares      INTEGER NOT NULL DEFAULT 0,
        clicks      INTEGER NOT NULL DEFAULT 0,
        saves       INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_posts_scheduled  ON posts(scheduled_at);
      CREATE INDEX idx_posts_status     ON posts(status);
      CREATE INDEX idx_posts_campaign   ON posts(campaign_id);
      CREATE INDEX idx_targets_post     ON post_targets(post_id);
      CREATE INDEX idx_targets_status   ON post_targets(status);
      CREATE INDEX idx_media_post       ON post_media(post_id, sort_order);
      CREATE INDEX idx_metrics_target   ON post_metrics(target_id, captured_at);
    `
  },

  {
    id: 9,
    name: 'goals_notes_personalisation',
    sql: `
      -- Per-task colour, overriding the category's. Empty means "inherit".
      ALTER TABLE tasks ADD COLUMN colour TEXT NOT NULL DEFAULT '';

      -- Business logo, shown on the dashboard and collected in the wizard.
      -- Workspace-relative, like every other file path we store.
      ALTER TABLE settings ADD COLUMN logo_file TEXT NOT NULL DEFAULT '';

      -- Whether this is a live client relationship. Distinct from 'archived',
      -- which is about hiding a record: a dormant client is still someone you
      -- want in the directory with their phone number.
      ALTER TABLE clients ADD COLUMN active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1));

      CREATE TABLE goals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        kind        TEXT    NOT NULL DEFAULT 'custom'
                            CHECK (kind IN ('revenue','profit','clients','projects',
                                            'hours','posts','custom')),
        -- Revenue and profit targets are integer pence, like all money here.
        -- Everything else is a plain count.
        target      INTEGER NOT NULL DEFAULT 0,
        -- Only used by 'custom' goals; the rest are measured from real data.
        manual      INTEGER NOT NULL DEFAULT 0,
        period      TEXT    NOT NULL DEFAULT 'year'
                            CHECK (period IN ('month','quarter','year','once')),
        starts_on   TEXT,
        ends_on     TEXT,
        colour      TEXT    NOT NULL DEFAULT '#6E56CF',
        status      TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','achieved','missed','archived')),
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );

      -- Notes are rebuilt so project_id can be NULL: a standalone notebook was
      -- not possible while every note had to belong to a project, and SQLite
      -- cannot drop a NOT NULL constraint in place.
      CREATE TABLE notes_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        title      TEXT    NOT NULL,
        -- The note's body lives in this .md file, readable outside SoloWrk.
        file       TEXT    NOT NULL,
        pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      INSERT INTO notes_new (id, project_id, title, file, created_at, updated_at)
        SELECT id, project_id, title, file, created_at, updated_at FROM notes;

      DROP TABLE notes;
      ALTER TABLE notes_new RENAME TO notes;

      CREATE INDEX idx_notes_project ON notes(project_id);
      CREATE INDEX idx_goals_status  ON goals(status);
    `
  },

  {
    id: 10,
    name: 'task_archive',
    sql: `
      -- Archiving a task keeps it and everything hanging off it — subtasks,
      -- tracked time, its place in a project — and only takes it off the board.
      -- Distinct from deleting, which is still available and still permanent.
      ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));
      ALTER TABLE tasks ADD COLUMN archived_at TEXT;

      CREATE INDEX idx_tasks_archived ON tasks(archived);
    `
  },

  {
    id: 11,
    name: 'business_plan_document',
    sql: `
      -- The business plan as a document the user already has, rather than
      -- something retyped into the app. Workspace-relative, like every path.
      ALTER TABLE settings ADD COLUMN business_plan_file TEXT NOT NULL DEFAULT '';
      -- Extraction is not free on a long PDF, so the text is cached and
      -- refreshed only when the source file has actually changed.
      ALTER TABLE settings ADD COLUMN business_plan_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN business_plan_read_at TEXT;
    `
  },

  {
    id: 12,
    name: 'notifications',
    sql: `
      -- Notifications live in the app rather than the OS tray, so they survive
      -- being missed: a Windows toast that appears while you are in another
      -- window is gone forever, which is no way to be told an invoice is late.
      CREATE TABLE notifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT    NOT NULL DEFAULT 'info'
                           CHECK (kind IN ('info', 'due', 'late', 'money', 'assistant')),
        title      TEXT    NOT NULL,
        body       TEXT    NOT NULL DEFAULT '',
        -- Route to open when clicked, e.g. '/invoices'.
        link       TEXT    NOT NULL DEFAULT '',
        -- Stable identity for a recurring alert, so the same overdue invoice
        -- does not produce a new notification every single day.
        dedupe_key TEXT,
        read_at    TEXT,
        archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT    NOT NULL
      );

      CREATE INDEX idx_notifications_unread ON notifications(archived, read_at, id);
      CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(dedupe_key)
        WHERE dedupe_key IS NOT NULL;
    `
  }
]