exports.up = (pgm) => {
  // Drop legacy email column if it exists
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE users DROP COLUMN email;
    EXCEPTION WHEN undefined_column THEN NULL;
    END $$;
  `);

  // Ensure users.name has unique constraint
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_name_key UNIQUE (name);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$;
  `);

  // Ensure avatar column exists
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  // Drop legacy user_email column from audit_log if it exists
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE audit_log DROP COLUMN user_email;
    EXCEPTION WHEN undefined_column THEN NULL;
    END $$;
  `);

  // Ensure user_name column exists on audit_log
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE audit_log ADD COLUMN user_name TEXT NOT NULL DEFAULT '';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  // Ensure gif_url column exists on messages
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE messages ADD COLUMN gif_url TEXT NOT NULL DEFAULT '';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  // Ensure PendingCancel status is allowed
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
      ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
        CHECK (status IN ('Pending', 'Accepted', 'Cancelled', 'Rejected', 'Completed', 'PendingCancel'));
    END $$;
  `);
};
