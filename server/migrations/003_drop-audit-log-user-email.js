exports.up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE audit_log DROP COLUMN user_email;
    EXCEPTION WHEN undefined_column THEN NULL;
    END $$;
  `);
};
