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
  },

  /**
   * Id 13 is deliberately skipped.
   *
   * A migration numbered 13 shipped briefly and was reverted, so a database
   * that ran it already has 13 recorded as applied — and the runner skips any
   * id it has seen. Reusing the number would mean this migration silently
   * never ran on exactly the machines that had it. The gap costs nothing; the
   * collision would cost a broken install with no error to show for it.
   *
   * The DROP TABLE IF EXISTS lines below clear up after that reverted work.
   * They are no-ops on a database that never ran it.
   */
  {
    id: 14,
    name: 'client_status',
    sql: `
      DROP TABLE IF EXISTS website_deploys;
      DROP TABLE IF EXISTS website_enquiries;

      -- A client is not simply on or off. Someone who enquired and has not
      -- decided is not a client yet, someone who said no is worth keeping the
      -- details of, and someone you finished with two years ago is neither.
      -- The old boolean could only express two of those four.
      ALTER TABLE clients ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'interested', 'not_interested', 'past'));

      -- When they first became each thing. Goals count transitions, not
      -- creation: a lead added in January and won in June is a new client in
      -- June, and counting them in January would make both quarters wrong.
      -- Never cleared once set, so a past client still counts for the period
      -- they were won in.
      ALTER TABLE clients ADD COLUMN interested_at    TEXT;
      ALTER TABLE clients ADD COLUMN became_active_at TEXT;

      -- Backfilled from the boolean it replaces. active = 0 meant "dormant",
      -- which is 'past' and emphatically not 'not_interested' — mapping it
      -- that way would relabel every finished client as a lost lead.
      UPDATE clients SET status = CASE WHEN active = 1 THEN 'active' ELSE 'past' END;
      UPDATE clients SET became_active_at = created_at WHERE active = 1;

      CREATE INDEX idx_clients_status ON clients(status, archived);

      -- Goals gains a 'leads' kind, for a target like "5 new interested
      -- clients this quarter". SQLite cannot widen a CHECK constraint in
      -- place, so the table is rebuilt — the same shape migration 9 used to
      -- drop a NOT NULL from notes.
      CREATE TABLE goals_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        kind        TEXT    NOT NULL DEFAULT 'custom'
                            CHECK (kind IN ('revenue','profit','clients','leads','projects',
                                            'hours','posts','custom')),
        target      INTEGER NOT NULL DEFAULT 0,
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

      INSERT INTO goals_new
        SELECT id, name, description, kind, target, manual, period, starts_on,
               ends_on, colour, status, created_at, updated_at
          FROM goals;

      DROP TABLE goals;
      ALTER TABLE goals_new RENAME TO goals;

      CREATE INDEX idx_goals_status ON goals(status);
    `
  },
  {
    id: 15,
    name: 'invoice_chasing',
    sql: `
      -- Chasing is off until it is asked for. An app that starts emailing a
      -- customer's clients because it was installed would be indefensible,
      -- however good the drafts are.
      ALTER TABLE settings ADD COLUMN chase_enabled INTEGER NOT NULL DEFAULT 0;

      -- Days past due at which to raise a chaser, comma-separated. Three
      -- attempts is the shape most freelancers describe: a nudge, a firmer
      -- note, and a last word before it becomes a phone call.
      ALTER TABLE settings ADD COLUMN chase_days TEXT NOT NULL DEFAULT '7,14,30';

      -- How far along the schedule this invoice has been chased, and when.
      -- Kept on the invoice rather than in a chase_log table: there is one
      -- number worth knowing per invoice, and a table would be a history
      -- nobody reads guarding a value nobody disputes.
      --
      -- Step is an index into chase_days, so raising the schedule from three
      -- steps to four does not re-chase everything already at step 3.
      ALTER TABLE invoices ADD COLUMN chase_step     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE invoices ADD COLUMN last_chased_at TEXT;

      -- The sweep asks for unpaid invoices past their due date every morning.
      CREATE INDEX idx_invoices_chasing ON invoices(status, paid_at, due_date);
    `
  },
  {
    id: 16,
    name: 'outbound_mail',
    sql: `
      -- The user's own mail server. SoloWrk sends as them, through their
      -- provider, from their machine — there is no SoloWrk mail infrastructure
      -- and there is not going to be: a service relaying a freelancer's client
      -- correspondence is a service that can read it, lose it, and be blamed
      -- for it.
      --
      -- The password is deliberately not here. It lives in the OS keychain via
      -- Electron's safeStorage, because this database sits in the user's
      -- workspace folder, and that folder is very often inside Dropbox or
      -- OneDrive. A mail password in a synced folder is a mail password in
      -- somebody else's datacentre.
      ALTER TABLE settings ADD COLUMN smtp_host   TEXT    NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN smtp_port   INTEGER NOT NULL DEFAULT 587;
      ALTER TABLE settings ADD COLUMN smtp_secure INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE settings ADD COLUMN smtp_user   TEXT    NOT NULL DEFAULT '';

      -- Who the client sees it from. Usually the same as smtp_user, but not
      -- always: a shared mailbox, or a domain alias, needs to differ.
      ALTER TABLE settings ADD COLUMN smtp_from   TEXT    NOT NULL DEFAULT '';

      -- 'hold' drafts the chaser and waits for a press. 'auto' sends it on the
      -- schedule. Default 'hold', and it takes a deliberate act to change:
      -- automatically emailing somebody's client in their name is the single
      -- most consequential thing this app can do, and it should never be the
      -- consequence of leaving a default alone.
      ALTER TABLE settings ADD COLUMN chase_send  TEXT    NOT NULL DEFAULT 'hold';

      -- Outbound mail, as a queue rather than a function call.
      --
      -- A queue because the machine that decided to send is often not awake
      -- when sending becomes possible: the sweep runs at nine, the laptop is
      -- shut at nine, and a send attempted and lost is a chaser nobody knows
      -- did not go. Rows survive restarts and are retried on the next launch.
      CREATE TABLE mail_queue (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT    NOT NULL DEFAULT 'chaser',
        invoice_id  INTEGER REFERENCES invoices(id) ON DELETE CASCADE,

        -- Which milestone of the chase schedule produced this. Part of the
        -- identity of the message, not a detail of it.
        attempt     INTEGER NOT NULL DEFAULT 1,

        to_address  TEXT    NOT NULL,
        subject     TEXT    NOT NULL,
        body        TEXT    NOT NULL,

        -- held | queued | sent | failed | cancelled
        --
        -- 'held' is waiting for the user; 'queued' is waiting for the network.
        -- The difference matters: one of them is a decision nobody has taken,
        -- and the other is a decision already taken that has not landed yet.
        status      TEXT    NOT NULL DEFAULT 'held',

        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,

        -- Not before this. Set by the backoff after a transient failure.
        send_after  TEXT,

        created_at  TEXT    NOT NULL,
        sent_at     TEXT
      );

      -- One message per invoice per milestone, ever. This is what stops a
      -- sweep that runs twice, or a queue drained twice, chasing a client
      -- twice for the same thing — which is the failure everybody would
      -- remember. Cancelled rows are included on purpose: cancelling is a
      -- decision, and tomorrow's sweep must not quietly undo it.
      CREATE UNIQUE INDEX idx_mail_queue_chase
        ON mail_queue(invoice_id, attempt) WHERE kind = 'chaser';

      -- The drain asks for what is sendable, oldest first.
      CREATE INDEX idx_mail_queue_status ON mail_queue(status, send_after);
    `
  },
  {
    id: 17,
    name: 'automation_rules',
    sql: `
      -- When this, then that.
      --
      -- Columns rather than a JSON blob for the parameters. There are only
      -- three things a rule ever needs to carry and they are all scalars, and a
      -- blob would put the one part worth validating — what the user typed —
      -- somewhere no constraint can see it.
      CREATE TABLE automation_rules (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,

        -- invoice_overdue | invoice_paid | project_completed
        --   | task_overdue | document_expiring
        trigger      TEXT    NOT NULL,
        -- How many days late, or how many days before expiry. Ignored by the
        -- triggers that do not have a horizon.
        trigger_days INTEGER NOT NULL DEFAULT 0,

        -- create_task | notify | draft_invoice
        action       TEXT    NOT NULL,
        -- The task title or the notification wording, with {name}, {client},
        -- {amount} and {days} filled in.
        action_text  TEXT    NOT NULL DEFAULT '',
        -- Due this many days out, for a task. Null means no due date.
        action_days  INTEGER,

        enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      -- What each rule has already acted on.
      --
      -- The primary key is the whole point: a rule fires once per thing, ever.
      -- Without it the morning sweep would create the same task every morning
      -- for as long as an invoice stayed unpaid, which is the exact behaviour
      -- that makes people switch a feature like this off.
      --
      -- It is also how a new rule is stopped from acting on three years of
      -- history: every currently-matching subject is written here at the moment
      -- the rule is saved, so the rule only ever acts on what becomes true
      -- afterwards. See backfillRule in automations.ts.
      CREATE TABLE automation_runs (
        rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        -- 'invoice:12', 'project:4'. Typed because the same number means
        -- different things in different tables.
        subject TEXT    NOT NULL,
        ran_at  TEXT    NOT NULL,
        -- Empty when the rule was backfilled rather than run, so the history
        -- can tell "already true when you made this" from "this happened".
        outcome TEXT    NOT NULL DEFAULT '',
        PRIMARY KEY (rule_id, subject)
      );
    `
  },
  {
    id: 18,
    name: 'links_and_activity',
    sql: `
      -- Connections the foreign keys do not already express.
      --
      -- Deliberately *additive*. The existing keys are not going anywhere:
      -- an invoice belongs to a client, a task belongs to a project, and that
      -- is ownership rather than a link — modelling it here instead would
      -- throw away every cascade and every constraint the database already
      -- enforces, in exchange for nothing.
      --
      -- What this adds is the rest: a note about a client rather than about a
      -- project, a document that belongs to two projects, a task that came out
      -- of a quote. The backlinks query reads both — the keys for structure,
      -- this for everything else — and returns one list.
      --
      -- Rows only. File attachments get their own table when they are built,
      -- because a file reference needs things a row link does not: detecting
      -- that the file has moved, and repairing the path. Making one table
      -- serve both would compromise both.
      CREATE TABLE links (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type  TEXT    NOT NULL,
        source_id    INTEGER NOT NULL,
        target_type  TEXT    NOT NULL,
        target_id    INTEGER NOT NULL,
        -- Reserved. Everything is 'related' today; naming the column now means
        -- 'blocks' and 'invoiced-by' do not need a migration later.
        relationship TEXT    NOT NULL DEFAULT 'related',
        created_at   TEXT    NOT NULL
      );

      -- One row per connection, whichever end it was made from. The service
      -- orders the two ends before writing, so linking A to B and later B to A
      -- is the same row rather than two rows that render as a duplicate.
      CREATE UNIQUE INDEX idx_links_pair
        ON links(source_type, source_id, target_type, target_id, relationship);

      -- Both directions get an index, because the backlinks query asks in both.
      CREATE INDEX idx_links_source ON links(source_type, source_id);
      CREATE INDEX idx_links_target ON links(target_type, target_id);

      -- What happened to a thing, and when.
      --
      -- Written by triggers rather than by the services. Every write path gets
      -- covered including the ones nobody remembered — the assistant's tools,
      -- the automation actions, the recurring-invoice run, a future importer —
      -- and no service has to remember to call anything.
      --
      -- The catch worth knowing: a migration that rebuilds a table by dropping
      -- and recreating it takes that table's triggers with it. Two migrations
      -- have already done that. Any future one must recreate them.
      CREATE TABLE activity (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL,
        entity_id   INTEGER NOT NULL,
        -- created | edited | status
        action      TEXT    NOT NULL,
        -- The name at creation, or 'sent to paid' for a status change. Held as
        -- written rather than looked up later, so the timeline still reads
        -- correctly after the thing has been renamed.
        detail      TEXT    NOT NULL DEFAULT '',
        at          TEXT    NOT NULL
      );

      CREATE INDEX idx_activity_entity ON activity(entity_type, entity_id, at DESC);

      -- Edits are coalesced into one entry per ten minutes.
      --
      -- The spec asks for created, edited and status-changed. Taken literally,
      -- 'edited' fires on every keystroke-triggered save the app already makes
      -- — note bodies save as you type, task fields save on change — and an
      -- Activity tab with four hundred identical 'edited' lines buries the
      -- three events anybody wanted to see. So an edit inside ten minutes of
      -- the last one is the same sitting, and is not recorded twice.
      --
      -- Status changes are never coalesced. Those are the timeline.
      CREATE TRIGGER activity_clients_created AFTER INSERT ON clients BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('client', NEW.id, 'created', NEW.name, datetime('now'));
      END;
      CREATE TRIGGER activity_clients_edited AFTER UPDATE ON clients
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'client' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('client', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_projects_created AFTER INSERT ON projects BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('project', NEW.id, 'created', NEW.name, datetime('now'));
      END;
      CREATE TRIGGER activity_projects_status AFTER UPDATE OF status ON projects
      WHEN OLD.status != NEW.status BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('project', NEW.id, 'status', OLD.status || ' to ' || NEW.status, datetime('now'));
      END;
      CREATE TRIGGER activity_projects_edited AFTER UPDATE ON projects
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'project' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('project', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_tasks_created AFTER INSERT ON tasks BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('task', NEW.id, 'created', NEW.title, datetime('now'));
      END;
      CREATE TRIGGER activity_tasks_status AFTER UPDATE OF status ON tasks
      WHEN OLD.status != NEW.status BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('task', NEW.id, 'status', OLD.status || ' to ' || NEW.status, datetime('now'));
      END;
      CREATE TRIGGER activity_tasks_edited AFTER UPDATE ON tasks
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'task' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('task', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_invoices_created AFTER INSERT ON invoices BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('invoice', NEW.id, 'created', NEW.number, datetime('now'));
      END;
      CREATE TRIGGER activity_invoices_status AFTER UPDATE OF status ON invoices
      WHEN OLD.status != NEW.status BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('invoice', NEW.id, 'status', OLD.status || ' to ' || NEW.status, datetime('now'));
      END;
      CREATE TRIGGER activity_invoices_edited AFTER UPDATE ON invoices
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'invoice' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('invoice', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_quotes_created AFTER INSERT ON quotes BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('quote', NEW.id, 'created', NEW.number, datetime('now'));
      END;
      CREATE TRIGGER activity_quotes_status AFTER UPDATE OF status ON quotes
      WHEN OLD.status != NEW.status BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('quote', NEW.id, 'status', OLD.status || ' to ' || NEW.status, datetime('now'));
      END;
      CREATE TRIGGER activity_quotes_edited AFTER UPDATE ON quotes
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'quote' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('quote', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_notes_created AFTER INSERT ON notes BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('note', NEW.id, 'created', NEW.title, datetime('now'));
      END;
      CREATE TRIGGER activity_notes_edited AFTER UPDATE ON notes
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'note' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('note', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_documents_created AFTER INSERT ON documents BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('document', NEW.id, 'created', NEW.title, datetime('now'));
      END;
      CREATE TRIGGER activity_documents_edited AFTER UPDATE ON documents
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'document' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('document', NEW.id, 'edited', '', datetime('now'));
      END;
      CREATE TRIGGER activity_expenses_created AFTER INSERT ON expenses BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('expense', NEW.id, 'created', NEW.description, datetime('now'));
      END;
      CREATE TRIGGER activity_expenses_edited AFTER UPDATE ON expenses
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'expense' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('expense', NEW.id, 'edited', '', datetime('now'));
      END;
    `
  },
  {
    id: 19,
    name: 'saved_views',
    sql: `
      -- A named set of filters for one list.
      --
      -- The filters themselves are stored as the page's own URL query string,
      -- not as columns. Every list keeps its state in the address bar — which
      -- is what makes a filtered list something you can link to, and what makes
      -- the back button undo a filter — so a saved view is literally that
      -- string, and applying one is setting it.
      --
      -- The alternative was a column per filter, and it fails the first time a
      -- page grows one: a migration to add 'rebillable' to expenses, and
      -- another for whatever tasks needs. This way a page that gains a filter
      -- gains it in saved views for free, and a page that loses one ignores a
      -- parameter it no longer reads. That is the right failure — an old view
      -- filters by a little less rather than refusing to open.
      CREATE TABLE saved_views (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        -- 'invoices', 'tasks' — the list this belongs to, not a route, so
        -- moving a page does not orphan its views.
        page       TEXT    NOT NULL,
        name       TEXT    NOT NULL,
        -- The query string without its leading '?'.
        query      TEXT    NOT NULL,
        -- REAL so a view can be dropped between two others by averaging their
        -- orders, the same trick tasks use.
        sort_order REAL    NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      -- One name per list. Saving over a view somebody already made is a thing
      -- they should be asked about, not something the database allows twice.
      CREATE UNIQUE INDEX idx_saved_views_name ON saved_views(page, name);
      CREATE INDEX idx_saved_views_page ON saved_views(page, sort_order);
    `
  },
  {
    id: 20,
    name: 'trash',
    sql: `
      -- Deleted things, kept for a while.
      --
      -- The row is genuinely gone from its own table. The alternative — a
      -- deleted_at column on all eight, and 'AND deleted_at IS NULL' on every
      -- query in the app — puts the correctness of every report in the hands of
      -- whoever writes the next SELECT, and the failure mode is a deleted
      -- invoice quietly turning up in a tax year. So the row is removed, and
      -- what it takes with it is captured here first.
      --
      -- payload is JSON: the row, every row SQLite's cascades would have taken
      -- with it, every reference that would have been nulled, and the links and
      -- activity that no foreign key covers. Restoring puts them all back.
      --
      -- This is only safe because every table uses INTEGER PRIMARY KEY
      -- AUTOINCREMENT, so SQLite never reissues an id. A restored row goes back
      -- under the number it had, and everything that referred to it still
      -- refers to it.
      CREATE TABLE trash (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL,
        entity_id   INTEGER NOT NULL,
        -- What it was called, held as written. The row is gone, so there is
        -- nothing left to look the name up from.
        label       TEXT    NOT NULL DEFAULT '',
        -- A sentence for the trash list: '3 tasks, 2 notes'.
        summary     TEXT    NOT NULL DEFAULT '',
        payload     TEXT    NOT NULL,
        deleted_at  TEXT    NOT NULL
      );

      CREATE INDEX idx_trash_when ON trash(deleted_at DESC);
      CREATE INDEX idx_trash_entity ON trash(entity_type, entity_id);

      -- Archive reaches the two lists that wanted it and did not have it.
      -- Clients, projects and tasks already had it; invoices and quotes do not
      -- get it, because an invoice already has a status and a second axis for
      -- "put this away" would mean two answers to where it went.
      ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));
      ALTER TABLE notes ADD COLUMN archived_at TEXT;
      CREATE INDEX idx_notes_archived ON notes(archived);

      ALTER TABLE documents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));
      ALTER TABLE documents ADD COLUMN archived_at TEXT;
      CREATE INDEX idx_documents_archived ON documents(archived);
    `
  },
  {
    id: 21,
    name: 'archived_at_everywhere',
    sql: `
      -- Clients and projects have had 'archived' since the beginning but never
      -- recorded when. Tasks, notes and documents all do, and one service now
      -- archives all five through the same door — so the odd two out get the
      -- column rather than the service growing a special case for them.
      --
      -- Nothing backfills. There is no honest value for when something was
      -- filed away before anybody was writing it down, and inventing one would
      -- put a wrong date on a real record.
      ALTER TABLE clients ADD COLUMN archived_at TEXT;
      ALTER TABLE projects ADD COLUMN archived_at TEXT;
    `
  },
  {
    id: 22,
    name: 'tags',
    sql: `
      -- One vocabulary of tags, shared by everything.
      --
      -- Documents already had tags as a comma-separated column, with a comment
      -- saying a tags table would be the textbook answer but that these were a
      -- search aid rather than a relation. That was true when documents were
      -- the only thing with them. A tag that means the same on a document, a
      -- project and an invoice is a relation, and free text cannot be renamed,
      -- coloured, or counted.
      CREATE TABLE tags (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        colour     TEXT    NOT NULL DEFAULT '#8a8a93',
        created_at TEXT    NOT NULL
      );

      -- Case-insensitive, so 'Urgent' and 'urgent' cannot both exist. People
      -- capitalise inconsistently and would otherwise end up with two tags that
      -- look identical in a filter list.
      CREATE UNIQUE INDEX idx_tags_name ON tags(name COLLATE NOCASE);

      -- Polymorphic, like links: a tag reaches every kind of record, and no
      -- foreign key can express "any of eight tables".
      CREATE TABLE entity_tags (
        tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        entity_type TEXT    NOT NULL,
        entity_id   INTEGER NOT NULL,
        created_at  TEXT    NOT NULL,
        PRIMARY KEY (tag_id, entity_type, entity_id)
      );

      CREATE INDEX idx_entity_tags_entity ON entity_tags(entity_type, entity_id);

      -- Bring the document tags across.
      --
      -- Split on the comma with a recursive CTE. Doing it here rather than in
      -- application code means it happens exactly once, inside the migration's
      -- own transaction, and a user who never opens the Documents page still
      -- gets their tags.
      INSERT OR IGNORE INTO tags (name, colour, created_at)
      WITH RECURSIVE split(id, tag, rest) AS (
        SELECT id, '', tags || ',' FROM documents WHERE tags != ''
        UNION ALL
        SELECT id,
               TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1)),
               SUBSTR(rest, INSTR(rest, ',') + 1)
          FROM split WHERE rest != ''
      )
      SELECT DISTINCT tag, '#8a8a93', datetime('now') FROM split WHERE tag != '';

      INSERT OR IGNORE INTO entity_tags (tag_id, entity_type, entity_id, created_at)
      WITH RECURSIVE split(id, tag, rest) AS (
        SELECT id, '', tags || ',' FROM documents WHERE tags != ''
        UNION ALL
        SELECT id,
               TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1)),
               SUBSTR(rest, INSTR(rest, ',') + 1)
          FROM split WHERE rest != ''
      )
      SELECT t.id, 'document', s.id, datetime('now')
        FROM split s
        JOIN tags t ON t.name = s.tag COLLATE NOCASE
       WHERE s.tag != '';

      -- documents.tags stays, and stops being written.
      --
      -- Kept rather than dropped because it is the only record of what the
      -- backfill above read: if the split turns out to have mangled something,
      -- the original text is still there to look at. Nothing reads it after
      -- this migration.
    `
  },
  {
    id: 23,
    name: 'calendar_blocks',
    sql: `
      -- The calendar, rebuilt around what a block *is* rather than where it
      -- came from.
      --
      -- The old table called its one classifying column 'kind', with values
      -- local | google | teams. That is provenance, not type: it says nothing
      -- about whether an hour is client work, a meeting, admin or a holiday,
      -- which is the distinction the whole module now turns on. Provenance
      -- moves to 'source', and block_type carries the meaning.
      --
      -- Ids stay INTEGER AUTOINCREMENT rather than the uuid the specification
      -- asks for. EntityRef.id is a number across links, tags, activity, trash,
      -- the drawer and quick-add, and restoring from the trash is only safe
      -- because SQLite never reissues an autoincrement id. A uuid here would
      -- either need a union id type threaded through all of that, or would put
      -- the calendar outside every one of those features.
      CREATE TABLE calendar_subscriptions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        url             TEXT    NOT NULL,
        colour          TEXT    NOT NULL DEFAULT '#8a8a93',
        visible         INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
        last_synced_at  TEXT,
        last_status     TEXT    NOT NULL DEFAULT '',
        sync_error      TEXT    NOT NULL DEFAULT '',
        refresh_minutes INTEGER NOT NULL DEFAULT 60,
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );

      CREATE TABLE calendar_blocks (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        title            TEXT    NOT NULL,
        description      TEXT    NOT NULL DEFAULT '',
        location         TEXT    NOT NULL DEFAULT '',

        -- What kind of hour this is. Drives colour, whether it counts toward
        -- capacity, and whether it can be dragged.
        block_type       TEXT    NOT NULL DEFAULT 'meeting'
                                 CHECK (block_type IN ('focus', 'task', 'meeting', 'admin',
                                                       'personal', 'travel', 'deadline',
                                                       'holiday', 'external')),

        -- Local wall time, 'yyyy-mm-ddThh:mm'. Never a UTC instant: a block at
        -- 09:00 is at 09:00 wherever the laptop happens to be.
        starts_at        TEXT    NOT NULL,
        ends_at          TEXT    NOT NULL,
        all_day          INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
        -- The IANA zone the wall time was written in, so a block booked in
        -- London still means 09:00 London after a flight.
        timezone         TEXT    NOT NULL DEFAULT 'Europe/London',

        project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        client_id        INTEGER REFERENCES clients(id)  ON DELETE SET NULL,
        -- Set when the block schedules a task. SET NULL rather than CASCADE:
        -- deleting a task does take its blocks, but that is a confirmed action
        -- in the service, not something the schema does quietly.
        task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,

        -- Empty means "inherit", falling back to the project colour and then
        -- the block type's own, so recolouring a project recolours its work.
        colour           TEXT    NOT NULL DEFAULT '',
        billable         INTEGER NOT NULL DEFAULT 0 CHECK (billable IN (0, 1)),

        -- RFC 5545 RRULE. Null is a single occurrence. The rule is stored, not
        -- the occurrences: a weekly stand-up is one row, expanded for whatever
        -- range is on screen.
        recurrence_rule      TEXT,
        -- Set on a materialised exception, pointing at the series it broke off.
        recurrence_parent_id INTEGER REFERENCES calendar_blocks(id) ON DELETE CASCADE,
        -- Comma-separated ISO dates the parent series skips.
        recurrence_exdates   TEXT NOT NULL DEFAULT '',

        source           TEXT    NOT NULL DEFAULT 'local'
                                 CHECK (source IN ('local', 'ics_subscription', 'ics_import')),
        source_uid       TEXT,
        source_calendar_id INTEGER REFERENCES calendar_subscriptions(id) ON DELETE CASCADE,
        -- Read-only, for anything pulled from someone else's calendar.
        locked           INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),

        meeting_url      TEXT    NOT NULL DEFAULT '',
        reminder_minutes INTEGER,
        reminded_at      TEXT,

        archived         INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        archived_at      TEXT,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL
      );

      CREATE INDEX idx_blocks_span     ON calendar_blocks(starts_at, ends_at);
      CREATE INDEX idx_blocks_project  ON calendar_blocks(project_id);
      CREATE INDEX idx_blocks_task     ON calendar_blocks(task_id);
      CREATE INDEX idx_blocks_reminder ON calendar_blocks(reminded_at, reminder_minutes);
      CREATE INDEX idx_blocks_series   ON calendar_blocks(recurrence_parent_id);
      CREATE UNIQUE INDEX idx_blocks_source
        ON calendar_blocks(source_calendar_id, source_uid)
        WHERE source_uid IS NOT NULL;

      -- Everything that was in the calendar comes across, keeping its id.
      --
      -- All of it was written by hand, so all of it is 'meeting': the one type
      -- that means "an hour with a time on it" without claiming anything the
      -- user never said. Guessing 'focus' from a project link would invent
      -- billable hours and put them straight into the capacity figures.
      INSERT INTO calendar_blocks
        (id, title, description, location, block_type, starts_at, ends_at, all_day,
         project_id, client_id, colour, meeting_url, reminder_minutes, reminded_at,
         source, source_uid, created_at, updated_at)
      SELECT id, title, description, location, 'meeting', starts_at, ends_at, all_day,
             project_id, client_id, colour, meeting_url, reminder_minutes, reminded_at,
             CASE kind WHEN 'local' THEN 'local' ELSE 'ics_subscription' END,
             external_id, created_at, updated_at
        FROM events;

      DROP TABLE events;

      -- How this person works. One row, and the CHECK keeps it one row.
      CREATE TABLE calendar_settings (
        id                     INTEGER PRIMARY KEY CHECK (id = 1),
        -- Minutes past midnight, matching how the grid already measures a day.
        working_hours_start    INTEGER NOT NULL DEFAULT 540,
        working_hours_end      INTEGER NOT NULL DEFAULT 1050,
        -- Bitmask, Monday = bit 0. 31 is Monday to Friday.
        working_days           INTEGER NOT NULL DEFAULT 31,
        -- Six hours, deliberately. Eight-hour days of billable work do not
        -- exist, and a capacity nobody can hit is a warning nobody reads.
        daily_capacity_minutes INTEGER NOT NULL DEFAULT 360,
        weekly_billable_target INTEGER NOT NULL DEFAULT 1500,
        default_block_minutes  INTEGER NOT NULL DEFAULT 60,
        snap_minutes           INTEGER NOT NULL DEFAULT 15,
        -- 0 = Monday. UK default, and configurable because it has to be.
        week_starts_on         INTEGER NOT NULL DEFAULT 0,
        default_view           TEXT    NOT NULL DEFAULT 'week',
        show_weekends          INTEGER NOT NULL DEFAULT 1 CHECK (show_weekends IN (0, 1)),
        hour_height            INTEGER NOT NULL DEFAULT 56,
        updated_at             TEXT    NOT NULL
      );

      INSERT INTO calendar_settings (id, updated_at) VALUES (1, datetime('now'));

      -- A block is an entity now, so it keeps a timeline like the other eight.
      -- The ten-minute window on 'edited' matters more here than anywhere
      -- else: dragging a block across a week is one intention and a great many
      -- writes, and a timeline recording each of them would be unreadable.
      CREATE TRIGGER activity_blocks_created AFTER INSERT ON calendar_blocks BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('block', NEW.id, 'created', NEW.title, datetime('now'));
      END;
      CREATE TRIGGER activity_blocks_edited AFTER UPDATE ON calendar_blocks
      WHEN NEW.updated_at != OLD.updated_at AND NOT EXISTS (
        SELECT 1 FROM activity
         WHERE entity_type = 'block' AND entity_id = NEW.id AND action = 'edited'
           AND at > datetime('now', '-10 minutes')
      ) BEGIN
        INSERT INTO activity (entity_type, entity_id, action, detail, at)
        VALUES ('block', NEW.id, 'edited', '', datetime('now'));
      END;
    `
  },
  {
    id: 24,
    name: 'scheduling',
    sql: `
      -- What a task is expected to take, and when it is going to happen.
      --
      -- Two separate columns because they are two separate claims. An estimate
      -- is about the work ("this is about ninety minutes"); scheduled_at is
      -- about the diary ("I am doing it on Thursday at ten"). A task can have
      -- either without the other, and conflating them would make scheduling
      -- something require guessing how long it takes.
      ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER;
      -- Denormalised from the block that schedules it. The block is still the
      -- record — this is here so the task list can say "Thursday 10:00"
      -- without a join, and so an unscheduled task is one indexed lookup
      -- rather than a NOT EXISTS across the calendar.
      ALTER TABLE tasks ADD COLUMN scheduled_at TEXT;

      CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_at);

      -- The dates inside a project that are not its deadline.
      --
      -- projects.due_on is the one date a project ends. A three-month build
      -- has a design sign-off, a content deadline and a launch, and putting
      -- those in as tasks makes a board of things nobody does — a milestone
      -- is a date you are held to, not work you perform.
      CREATE TABLE project_milestones (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title       TEXT    NOT NULL,
        due_on      TEXT    NOT NULL,
        notes       TEXT    NOT NULL DEFAULT '',
        -- Reached, rather than 'done': a milestone is a date, and a date you
        -- have passed is not a task you completed.
        reached_at  TEXT,
        sort_order  REAL    NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );

      CREATE INDEX idx_milestones_project ON project_milestones(project_id);
      CREATE INDEX idx_milestones_due     ON project_milestones(due_on);

      -- Keeping tasks.scheduled_at true, in the schema rather than in code.
      --
      -- A task's time is a mirror of the block that schedules it, and mirrors
      -- go stale: there are five ways a block's start can change — the
      -- service, a drag, the assistant, a trash restore, a subscription sync —
      -- and a service-layer copy would need remembering in all five. One of
      -- them being missed leaves a task claiming a time no block is at, which
      -- is invisible until somebody misses the work.
      --
      -- MIN over the task's blocks rather than the block's own start, so a
      -- task split across three sittings reports the first, and a task whose
      -- last block is deleted goes back to NULL — which is what puts it back
      -- on the unscheduled rail, whole.
      CREATE TRIGGER blocks_task_scheduled_insert AFTER INSERT ON calendar_blocks
      WHEN NEW.task_id IS NOT NULL BEGIN
        UPDATE tasks
           SET scheduled_at = (SELECT MIN(starts_at) FROM calendar_blocks
                                WHERE task_id = NEW.task_id AND archived = 0)
         WHERE id = NEW.task_id;
      END;

      CREATE TRIGGER blocks_task_scheduled_update
      AFTER UPDATE OF starts_at, task_id, archived ON calendar_blocks BEGIN
        -- The task it used to belong to, which may now have nothing.
        UPDATE tasks
           SET scheduled_at = (SELECT MIN(starts_at) FROM calendar_blocks
                                WHERE task_id = OLD.task_id AND archived = 0)
         WHERE OLD.task_id IS NOT NULL AND id = OLD.task_id;
        UPDATE tasks
           SET scheduled_at = (SELECT MIN(starts_at) FROM calendar_blocks
                                WHERE task_id = NEW.task_id AND archived = 0)
         WHERE NEW.task_id IS NOT NULL AND id = NEW.task_id;
      END;

      CREATE TRIGGER blocks_task_scheduled_delete AFTER DELETE ON calendar_blocks
      WHEN OLD.task_id IS NOT NULL BEGIN
        UPDATE tasks
           SET scheduled_at = (SELECT MIN(starts_at) FROM calendar_blocks
                                WHERE task_id = OLD.task_id AND archived = 0)
         WHERE id = OLD.task_id;
      END;
    `
  },
  {
    id: 25,
    name: 'calendar_timezone',
    sql: `
      -- The zone the calendar is *written* in.
      --
      -- Not the machine's zone, which is where it is being read. Blocks are
      -- wall time, so a week planned in London is 09:00 London whether it is
      -- read in London or in Lisbon — and the honest thing to do about a
      -- mismatch is to say so, rather than silently reinterpret somebody's
      -- diary an hour sideways.
      ALTER TABLE calendar_settings ADD COLUMN timezone TEXT NOT NULL
        DEFAULT 'Europe/London';
      -- Off by default: most people never leave their own zone, and a banner
      -- nobody needs is worse than no banner.
      ALTER TABLE calendar_settings ADD COLUMN pin_timezone INTEGER NOT NULL
        DEFAULT 0 CHECK (pin_timezone IN (0, 1));
    `
  },
  {
    id: 26,
    name: 'mileage',
    sql: `
      -- Approved mileage rates, one row per kind of vehicle.
      --
      -- A table rather than a constant because HMRC moves these, and a rate
      -- change should be something somebody edits rather than a release they
      -- wait for. Rates are pence per mile; distances are tenths of a mile,
      -- as integers, for the same reason money is pence.
      CREATE TABLE mileage_rates (
        vehicle          TEXT    PRIMARY KEY
                         CHECK (vehicle IN ('car','motorcycle','bicycle')),
        first_rate       INTEGER NOT NULL,
        second_rate      INTEGER NOT NULL,
        -- Where the rate drops, in tenths. 0 means flat-rate: a motorcycle is
        -- 24p for ever, and expressing that as a threshold of nothing keeps
        -- one code path instead of two.
        threshold_tenths INTEGER NOT NULL DEFAULT 0,
        updated_at       TEXT    NOT NULL
      );

      INSERT INTO mileage_rates (vehicle, first_rate, second_rate, threshold_tenths, updated_at)
      VALUES ('car',        45, 25, 100000, datetime('now')),
             ('motorcycle', 24, 24, 0,      datetime('now')),
             ('bicycle',    20, 20, 0,      datetime('now'));

      -- The log itself.
      --
      -- Note what is *not* here: no rate, and no amount. What a journey is
      -- worth depends on how many miles came before it in the tax year, and
      -- that changes whenever an earlier journey is added, edited or deleted.
      -- Both are computed on the way out, so no stored copy can drift out of
      -- step with the log.
      CREATE TABLE mileage (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        date            TEXT    NOT NULL,
        from_place      TEXT    NOT NULL DEFAULT '',
        to_place        TEXT    NOT NULL DEFAULT '',
        -- HMRC wants to know why, not just how far.
        purpose         TEXT    NOT NULL DEFAULT '',
        tenths          INTEGER NOT NULL DEFAULT 0 CHECK (tenths >= 0),
        vehicle         TEXT    NOT NULL DEFAULT 'car'
                        REFERENCES mileage_rates(vehicle),
        client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        rebillable      INTEGER NOT NULL DEFAULT 0 CHECK (rebillable IN (0, 1)),
        invoice_line_id INTEGER REFERENCES invoice_lines(id) ON DELETE SET NULL,
        archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        archived_at     TEXT,
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );

      -- The log is read a tax year at a time, in date order, because that is
      -- the order the threshold is reached in.
      CREATE INDEX idx_mileage_date    ON mileage(date);
      CREATE INDEX idx_mileage_project ON mileage(project_id);
    `
  },
  {
    id: 27,
    name: 'bank_import',
    sql: `
      -- Statement lines from a CSV the user downloaded themselves.
      --
      -- Kept rather than consumed. An import that read a file, created some
      -- rows and forgot the file has no answer to "did that £1,500 ever get
      -- reconciled?" — and no way to import next month's statement, which
      -- overlaps this one, without doing everything twice.
      CREATE TABLE bank_transactions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        -- Built in \`@shared/bankCsv\` from date, amount and payee, so
        -- re-importing an overlapping statement recognises what it has seen.
        -- UNIQUE is the whole mechanism: the import inserts and ignores.
        fingerprint  TEXT    NOT NULL UNIQUE,
        date         TEXT    NOT NULL,
        description  TEXT    NOT NULL DEFAULT '',
        reference    TEXT    NOT NULL DEFAULT '',
        -- Signed integer pence. Negative is money leaving the account.
        amount       INTEGER NOT NULL,
        -- Which statement it came from, so a bad import can be found again.
        source       TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','matched','ignored')),
        -- What it was reconciled to. Both null while it is still 'new'.
        invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        expense_id   INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
        imported_at  TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );

      CREATE INDEX idx_bank_status ON bank_transactions(status);
      CREATE INDEX idx_bank_date   ON bank_transactions(date);
    `
  },
  {
    id: 28,
    name: 'document_templates',
    sql: `
      -- Templates with merge fields.
      --
      -- The starter library is seeded from '@shared/starterTemplates' on first
      -- run rather than written out here, so the prose lives somewhere it can
      -- be read and edited rather than inside a SQL string. 'builtin' marks
      -- the ones that shipped, only so the UI can offer to restore one; an
      -- update never rewrites a row, because quietly reverting somebody's
      -- amended contract would be unforgivable.
      CREATE TABLE document_templates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        kind       TEXT    NOT NULL DEFAULT 'other',
        summary    TEXT    NOT NULL DEFAULT '',
        body       TEXT    NOT NULL DEFAULT '',
        builtin    INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
        archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      -- Documents gain a body.
      --
      -- Until now the table was a register of files on disk: a title, a
      -- category and a path. A generated document is written *here*, so it can
      -- be edited, versioned and re-rendered — 'file' stays for the ones that
      -- are a scan of something somebody signed, and the two kinds live
      -- together because to the user they are both paperwork.
      ALTER TABLE documents ADD COLUMN body TEXT NOT NULL DEFAULT '';
      ALTER TABLE documents ADD COLUMN project_id INTEGER
        REFERENCES projects(id) ON DELETE SET NULL;
      ALTER TABLE documents ADD COLUMN template_id INTEGER
        REFERENCES document_templates(id) ON DELETE SET NULL;

      -- Manual signature tracking. No e-signature integration: it adds cost
      -- and complexity for marginal gain, and a date plus a note is what
      -- people actually keep.
      ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','signed','declined'));
      ALTER TABLE documents ADD COLUMN status_at TEXT;
      ALTER TABLE documents ADD COLUMN status_note TEXT NOT NULL DEFAULT '';

      -- Version history.
      --
      -- A snapshot per save, not a diff chain: a contract is a few kilobytes
      -- of text, and storing whole copies means restoring one can never
      -- depend on replaying a sequence correctly.
      CREATE TABLE document_versions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        body        TEXT    NOT NULL,
        -- What the user was told changed, when there is anything to say.
        note        TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL
      );

      CREATE INDEX idx_doc_versions ON document_versions(document_id, id DESC);
      CREATE INDEX idx_documents_project ON documents(project_id);
      CREATE INDEX idx_documents_status  ON documents(status);
    `
  },
  {
    id: 29,
    name: 'lead_pipeline',
    sql: `
      -- The pipeline that stops the feast-and-famine cycle.
      --
      -- Note what is nullable and what is not: 'next_action_on' is nullable
      -- on purpose, because a lead with nothing planned is a real and common
      -- state and the app's job is to *show* it rather than to prevent it
      -- being recorded. Forcing a date at the point of entry would produce a
      -- pipeline full of invented dates, which is worse than one with visible
      -- gaps.
      CREATE TABLE leads (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        company        TEXT    NOT NULL DEFAULT '',
        email          TEXT    NOT NULL DEFAULT '',
        phone          TEXT    NOT NULL DEFAULT '',
        -- Where they came from. Free text, because a freelancer's sources are
        -- their own and a fixed list would be wrong for everybody.
        source         TEXT    NOT NULL DEFAULT '',
        stage          TEXT    NOT NULL DEFAULT 'lead'
                       CHECK (stage IN ('lead','contacted','conversation','proposal','won','lost')),
        -- Estimated, in pence. Nullable: an early lead genuinely has no figure,
        -- and a zero would drag the weighted total down as though it did.
        value          INTEGER,
        next_action    TEXT    NOT NULL DEFAULT '',
        next_action_on TEXT,
        -- From the fixed list in '@shared/pipeline'. Free text cannot be
        -- counted, and the point of asking is the count.
        lost_reason    TEXT,
        lost_note      TEXT    NOT NULL DEFAULT '',
        notes          TEXT    NOT NULL DEFAULT '',
        -- Set when a lead is won and turned into real work.
        client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        -- When it left the board, either way. Drives time-to-win.
        closed_at      TEXT,
        sort_order     REAL    NOT NULL DEFAULT 0,
        archived       INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        archived_at    TEXT,
        created_at     TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL
      );

      CREATE INDEX idx_leads_stage  ON leads(stage);
      CREATE INDEX idx_leads_action ON leads(next_action_on);

      -- Every stage a lead has passed through, so the funnel is measured
      -- rather than inferred from where things happen to sit today. Without
      -- this, a lead that went lead -> proposal -> lost is indistinguishable
      -- from one that was never contacted, and the conversion figures would
      -- flatter whichever way the board was last tidied.
      CREATE TABLE lead_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        stage   TEXT    NOT NULL,
        at      TEXT    NOT NULL
      );

      CREATE INDEX idx_lead_events ON lead_events(lead_id, id);
    `
  },

  {
    id: 30,
    name: 'marketing_rebuild',
    sql: `
      -- Marketing, corrected.
      --
      -- The module was built as a lead pipeline, which is a sales function.
      -- Marketing is where a freelancer plans how work gets *found*: channels,
      -- campaigns, content and the rhythm of publishing. Sales is what happens
      -- after somebody puts their hand up.
      --
      -- The pipeline is not deleted. It moves to Clients, which already has a
      -- relationship stage, so a person exists in one place instead of two.
      -- The conversion itself runs in code rather than here: a client owns a
      -- folder on disk, and \`createClient\` makes the directory *before* the
      -- row so no row can point at a directory that does not exist. SQL cannot
      -- do that. See \`migrateLeadsToClients\`.

      /* ---------------------------------------------------------------- *
       * Clients gain the full stage vocabulary
       * ---------------------------------------------------------------- */

      -- Added and back-filled rather than widened in place, and that is not a
      -- style preference. Widening a CHECK in SQLite means rebuilding the
      -- table, and rebuilding \`clients\` with foreign keys enforced runs an
      -- implicit delete against every child row: projects, invoices, quotes
      -- and time entries would all have their client_id quietly set to null.
      -- It succeeds without an error and loses every link in the workspace.
      ALTER TABLE clients ADD COLUMN relationship_stage TEXT NOT NULL DEFAULT 'active'
        CHECK (relationship_stage IN ('lead','prospect','active','dormant','former'));

      -- 'past' and 'not_interested' both become 'former'. The distinction they
      -- carried -- finished versus never started -- is not lost: it is the
      -- difference between a former client with invoices and one without, and
      -- that is a truer test than a status somebody set once and forgot.
      UPDATE clients SET relationship_stage = CASE status
        WHEN 'interested'     THEN 'prospect'
        WHEN 'not_interested' THEN 'former'
        WHEN 'past'           THEN 'former'
        ELSE 'active'
      END;

      DROP INDEX IF EXISTS idx_clients_status;
      ALTER TABLE clients DROP COLUMN status;
      CREATE INDEX idx_clients_stage ON clients(relationship_stage, archived);

      /* ---------------------------------------------------------------- *
       * Where a client came from
       * ---------------------------------------------------------------- */

      -- How attribution works with no tracking infrastructure at all: the user
      -- says where somebody came from when they add them. Every figure in the
      -- Results tab is built from these two columns and nothing else.
      ALTER TABLE clients ADD COLUMN source_campaign_id INTEGER
        REFERENCES marketing_campaigns(id) ON DELETE SET NULL;
      ALTER TABLE clients ADD COLUMN source_channel_id INTEGER
        REFERENCES marketing_channels(id) ON DELETE SET NULL;

      /* ---------------------------------------------------------------- *
       * The strategy
       * ---------------------------------------------------------------- */

      -- A single row, like settings. Positioning is deliberately absent as a
      -- column: it lives in the business plan and is referenced there rather
      -- than copied, because two copies of a positioning statement is how a
      -- business ends up describing itself two different ways.
      CREATE TABLE marketing_plan (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        audience        TEXT    NOT NULL DEFAULT '',
        quarterly_focus TEXT    NOT NULL DEFAULT '',
        annual_budget   INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT    NOT NULL
      );

      INSERT INTO marketing_plan (id, updated_at) VALUES (1, datetime('now'));

      /* ---------------------------------------------------------------- *
       * Channels, and the commitment attached to each
       * ---------------------------------------------------------------- */

      -- cadence_count and cadence_period are the highest-value pair of columns
      -- in this module. Freelance marketing fails on consistency, not on
      -- strategy, and a commitment made visible is the only mechanism that
      -- reliably fixes it. Zero means no commitment, which is a legitimate
      -- answer for a channel somebody keeps but does not work at.
      CREATE TABLE marketing_channels (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        type          TEXT    NOT NULL DEFAULT 'social'
                      CHECK (type IN ('social','content','paid','direct',
                                      'directory','referral','event')),
        handle_or_url TEXT    NOT NULL DEFAULT '',
        colour        TEXT    NOT NULL DEFAULT '#6E56CF',
        is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        cadence_count INTEGER NOT NULL DEFAULT 0,
        cadence_period TEXT   NOT NULL DEFAULT 'week'
                      CHECK (cadence_period IN ('week','month')),
        -- Per-channel rather than a maintained table of platform limits, which
        -- would drift the moment a platform changed one. Null means no limit.
        character_limit INTEGER,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );

      CREATE INDEX idx_channels_active ON marketing_channels(is_active, sort_order);

      /* ---------------------------------------------------------------- *
       * Campaigns
       * ---------------------------------------------------------------- */

      CREATE TABLE marketing_campaigns (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        objective     TEXT    NOT NULL DEFAULT '',
        campaign_type TEXT    NOT NULL DEFAULT 'content'
                      CHECK (campaign_type IN ('content','paid_ads','outreach',
                                               'launch','event','always_on')),
        status        TEXT    NOT NULL DEFAULT 'planning'
                      CHECK (status IN ('planning','active','complete','abandoned')),
        starts_on     TEXT,
        ends_on       TEXT,
        -- Pence, like every other money column here.
        budget        INTEGER NOT NULL DEFAULT 0,
        target_metric TEXT    NOT NULL DEFAULT '',
        target_value  INTEGER,
        brief         TEXT    NOT NULL DEFAULT '',
        -- Written at completion, when it is the only time it will ever be
        -- written. It is the mechanism by which somebody stops repeating an
        -- expensive mistake.
        retrospective TEXT    NOT NULL DEFAULT '',
        -- Saved campaigns that exist to be copied, not run.
        is_template   INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0,1)),
        archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        archived_at   TEXT,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );

      CREATE INDEX idx_campaigns_status ON marketing_campaigns(status, archived);

      /* ---------------------------------------------------------------- *
       * Content
       * ---------------------------------------------------------------- */

      -- 'hook' is its own column rather than the first line of the body, and
      -- that is the point of it: the first line decides whether anything else
      -- gets read, and giving it a field of its own makes somebody think about
      -- it deliberately instead of typing past it.
      CREATE TABLE content_items (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        title             TEXT    NOT NULL DEFAULT '',
        hook              TEXT    NOT NULL DEFAULT '',
        body              TEXT    NOT NULL DEFAULT '',
        channel_id        INTEGER REFERENCES marketing_channels(id) ON DELETE SET NULL,
        campaign_id       INTEGER REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
        status            TEXT    NOT NULL DEFAULT 'idea'
                          CHECK (status IN ('idea','drafting','ready','scheduled',
                                            'published','parked')),
        -- Local wall-clock, 'yyyy-mm-ddThh:mm', exactly as calendar blocks are.
        scheduled_for     TEXT,
        published_at      TEXT,
        -- The live post, asked for once when something is marked published.
        link_url          TEXT    NOT NULL DEFAULT '',
        -- References into Files, never copies.
        asset_paths       TEXT    NOT NULL DEFAULT '',
        source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        -- A repurposed derivative points at what it came from, so one piece of
        -- work can visibly become five.
        parent_content_id INTEGER REFERENCES content_items(id) ON DELETE SET NULL,
        notes             TEXT    NOT NULL DEFAULT '',
        archived          INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        archived_at       TEXT,
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE INDEX idx_content_scheduled ON content_items(scheduled_for);
      CREATE INDEX idx_content_status    ON content_items(status, archived);
      CREATE INDEX idx_content_parent    ON content_items(parent_content_id);

      /* ---------------------------------------------------------------- *
       * Measurement, entered by hand
       * ---------------------------------------------------------------- */

      -- Every figure is nullable. Partial data is the normal case: somebody
      -- knows they got two enquiries and has no idea how many impressions it
      -- took, and a form that refuses that is a form nobody fills in twice.
      CREATE TABLE content_metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        content_id  INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
        recorded_at TEXT    NOT NULL,
        impressions INTEGER,
        engagements INTEGER,
        clicks      INTEGER,
        enquiries   INTEGER,
        notes       TEXT    NOT NULL DEFAULT ''
      );

      CREATE INDEX idx_content_metrics ON content_metrics(content_id, recorded_at);

      CREATE TABLE campaign_metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
        recorded_on TEXT    NOT NULL,
        spend       INTEGER,
        impressions INTEGER,
        clicks      INTEGER,
        enquiries   INTEGER,
        notes       TEXT    NOT NULL DEFAULT ''
      );

      CREATE INDEX idx_campaign_metrics ON campaign_metrics(campaign_id, recorded_on);

      /* ---------------------------------------------------------------- *
       * The library
       * ---------------------------------------------------------------- */

      CREATE TABLE library_assets (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        type              TEXT    NOT NULL DEFAULT 'swipe'
                          CHECK (type IN ('case_study','testimonial','image',
                                          'template','swipe')),
        title             TEXT    NOT NULL,
        body              TEXT    NOT NULL DEFAULT '',
        file_path         TEXT    NOT NULL DEFAULT '',
        url               TEXT    NOT NULL DEFAULT '',
        source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        client_id         INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        -- Testimonials carry it explicitly, because using one without asking
        -- is a thing somebody only does once.
        may_use           INTEGER NOT NULL DEFAULT 0 CHECK (may_use IN (0,1)),
        tags              TEXT    NOT NULL DEFAULT '',
        archived          INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        archived_at       TEXT,
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE INDEX idx_library_type ON library_assets(type, archived);
    `
  },
  {
    id: 31,
    name: 'campaign_work',
    sql: `
      -- A campaign is a thing you do, not just a thing you record. It already
      -- gathers content through content_items.campaign_id; this gives it the
      -- other two halves of real work: the jobs that have to happen, and the
      -- files they produce.

      /* ---------------------------------------------------------------- *
       * Tasks that belong to a campaign
       * ---------------------------------------------------------------- */

      -- A column rather than a row in \`links\`, because this is ownership and
      -- not association. Every existing task surface — the list, the board,
      -- the project filter, what is due on the dashboard — reads a task's
      -- owner from a column. A campaign task reached only through the link
      -- table would exist and be invisible everywhere somebody looks for work.
      --
      -- SET NULL, unlike project_id's CASCADE. Deleting a campaign must not
      -- delete the work somebody did for it: an orphaned task in the list is
      -- recoverable, and a silently deleted one is not.
      ALTER TABLE tasks ADD COLUMN campaign_id INTEGER
        REFERENCES marketing_campaigns(id) ON DELETE SET NULL;

      CREATE INDEX idx_tasks_campaign ON tasks(campaign_id);

      /* ---------------------------------------------------------------- *
       * Somewhere for a campaign's files to live
       * ---------------------------------------------------------------- */

      -- Workspace-relative, exactly as clients and projects hold theirs, so
      -- the Files module lists a campaign folder without knowing campaigns
      -- exist. Empty for campaigns made before this ran; the service makes the
      -- folder on first use rather than this migration touching the disk,
      -- because a migration that half-writes to the filesystem cannot be
      -- rolled back with the transaction it runs in.
      ALTER TABLE marketing_campaigns ADD COLUMN folder TEXT NOT NULL DEFAULT '';
    `
  }
]