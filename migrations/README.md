# Migrations

SQLite migrations for `PDF_Viewer_Editor`. Applied by `src/db/migrate.ts` on every
main-process startup. Forward-only.

## Filename convention

```
NNNN_<slug>.sql
```

- `NNNN` — zero-padded integer, sequential, never reused.
- `<slug>` — short kebab-case description (e.g. `init`, `add-form-templates`).
- One migration per file. No multi-version files.

## Idempotency

Every statement uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
so re-running an already-applied migration is a no-op. The runner additionally
short-circuits any file whose version is `<= MAX(schema_migrations.version)`.

## Rollback

**Not supported.** Forward-only. If a migration corrupts state, ship a new
migration that fixes the corruption.

If a migration fails partway, the wrapping transaction rolls back and the
`schema_migrations` row is never written. The next launch retries the migration
from a clean slate. See `docs/data-models.md` §6.3.

## Adding a new migration

1. Pick the next version: `find migrations -name '*.sql' | sort | tail -1`.
2. Create `NNNN_<slug>.sql` with `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` / etc.
3. Update `docs/data-models.md` §2 if the schema surface changes.
4. Add a Vitest test under `src/db/repositories/` that exercises the new shape
   against an in-memory database (`:memory:`).
