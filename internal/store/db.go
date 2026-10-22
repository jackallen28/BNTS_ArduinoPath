// Package store keeps profiles, sessions, sketches and progress in one
// SQLite file on the student's laptop (WAL mode, synchronous=FULL so every
// save is on the disk before the app says "Saved").
//
// The schema has a version (PRAGMA user_version) and a list of migrations.
// Never edit a migration that has shipped: add a new one at the end.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a row doesn't exist.
var ErrNotFound = errors.New("not found")

// ErrExists is returned when a unique row already exists.
var ErrExists = errors.New("already exists")

// migrations[i] takes the database from version i to version i+1.
var migrations = []string{
	// 1: the first schema (from the Raspberry Pi server: classes and
	// picture_hash are no longer used, and stay empty).
	`
	CREATE TABLE classes (
		id         INTEGER PRIMARY KEY,
		name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
		created_at INTEGER NOT NULL
	);
	CREATE TABLE students (
		id           INTEGER PRIMARY KEY,
		class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
		names        TEXT NOT NULL,  -- JSON array of 1 to 4 first names
		name_key     TEXT NOT NULL,  -- lower-case names + school, for duplicates
		school       TEXT NOT NULL,
		picture_hash TEXT NOT NULL,
		settings     TEXT NOT NULL DEFAULT '{}',
		created_at   INTEGER NOT NULL,
		last_seen    INTEGER NOT NULL
	);
	CREATE UNIQUE INDEX students_unique ON students (IFNULL(class_id, 0), name_key);
	CREATE INDEX students_class ON students (class_id);
	CREATE TABLE sessions (
		token_hash TEXT PRIMARY KEY,
		student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX sessions_student ON sessions (student_id);
	CREATE TABLE sketches (
		student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
		project_id TEXT NOT NULL,
		code       TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (student_id, project_id)
	);
	CREATE TABLE progress (
		student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
		project_id TEXT NOT NULL,
		data       TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (student_id, project_id)
	);
	CREATE TABLE server_settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	`,
}

// SchemaVersion is the version this build of the server writes.
var SchemaVersion = len(migrations)

// Store is the database.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Open opens (or creates) the database at path and brings its schema up to date.
func Open(path string) (*Store, error) {
	q := url.Values{}
	for _, p := range []string{
		"journal_mode(WAL)",
		"synchronous(FULL)",
		"foreign_keys(1)",
		"busy_timeout(10000)",
	} {
		q.Add("_pragma", p)
	}
	q.Set("_txlock", "immediate")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	s := &Store{db: db, now: time.Now}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// Version returns the schema version stored in the file.
func (s *Store) Version(ctx context.Context) (int, error) {
	var v int
	err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&v)
	return v, err
}

func (s *Store) migrate(ctx context.Context) error {
	v, err := s.Version(ctx)
	if err != nil {
		return err
	}
	if v > SchemaVersion {
		return fmt.Errorf("the database is from a newer ArduinoPath (schema %d, this server knows %d); update the server", v, SchemaVersion)
	}
	for ; v < SchemaVersion; v++ {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, migrations[v]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", v+1, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", v+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) millis() int64 { return s.now().UnixMilli() }

// Setting reads a server setting, returning def if it isn't set.
func (s *Store) Setting(ctx context.Context, key, def string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, "SELECT value FROM server_settings WHERE key = ?", key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return def, nil
	}
	return v, err
}

// SetSetting writes a server setting.
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
		key, value)
	return err
}
