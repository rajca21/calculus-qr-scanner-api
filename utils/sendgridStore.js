import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const RETENTION_DAYS = Number(process.env.SENDGRID_EVENTS_RETENTION_DAYS) || 30;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let db;

const purgeOldEvents = () => {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM events WHERE received_at < ?').run(cutoff);
};

// # Baza se otvara pri prvom korišćenju, kako bi server radio i kada SendGrid statusi nisu u upotrebi
const getDb = () => {
  if (db) return db;

  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  db = new DatabaseSync(path.join(dataDir, 'sendgrid.db'));
  // WAL i busy_timeout jer pri reciklaži app pool-a stari i novi proces kratko rade zajedno
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      webhook_id TEXT,
      public_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      email TEXT NOT NULL,
      event TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      reason TEXT,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS events_message ON events (account_id, message_id);
    CREATE INDEX IF NOT EXISTS events_received ON events (received_at);
  `);

  purgeOldEvents();
  setInterval(() => {
    try {
      purgeOldEvents();
    } catch (error) {
      console.error('[SENDGRID] Brisanje starih događaja nije uspelo', { message: error?.message });
    }
  }, PURGE_INTERVAL_MS).unref();

  return db;
};

export const findAccountById = (id) =>
  getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);

export const findAccountByTokenHash = (tokenHash) =>
  getDb().prepare('SELECT * FROM accounts WHERE token_hash = ?').get(tokenHash);

export const saveAccount = ({ id, tokenHash, webhookId, publicKey }) => {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO accounts (id, token_hash, webhook_id, public_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         webhook_id = excluded.webhook_id,
         public_key = excluded.public_key,
         updated_at = excluded.updated_at`,
    )
    .run(id, tokenHash, webhookId, publicKey, now, now);
};

export const deleteAccount = (id) => {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
};

// # Ponovljeni događaji (SendGrid ponavlja isporuku do 24h) se ignorišu po sg_event_id
export const insertEvents = (accountId, events) => {
  const database = getDb();
  const insert = database.prepare(
    `INSERT OR IGNORE INTO events
       (account_id, event_id, message_id, email, event, occurred_at, reason, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  let inserted = 0;

  database.exec('BEGIN');
  try {
    for (const e of events) {
      inserted += Number(
        insert.run(accountId, e.eventId, e.messageId, e.email, e.event, e.occurredAt, e.reason, now)
          .changes,
      );
    }
    database.exec('COMMIT');
    return inserted;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};

export const findEvents = (accountId, messageIds) => {
  if (!messageIds.length) return [];
  const placeholders = messageIds.map(() => '?').join(', ');
  return getDb()
    .prepare(
      `SELECT message_id, email, event, occurred_at, reason FROM events
       WHERE account_id = ? AND message_id IN (${placeholders})
       ORDER BY occurred_at`,
    )
    .all(accountId, ...messageIds);
};
