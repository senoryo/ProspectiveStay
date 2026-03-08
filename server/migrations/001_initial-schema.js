exports.up = (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    name: { type: 'text', notNull: true, unique: true },
    avatar: { type: 'text', notNull: true, default: '' },
    is_admin: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('sessions', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, references: 'users' },
    token: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('reservations', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, references: 'users' },
    name: { type: 'text', notNull: true },
    size_of_party: { type: 'integer', notNull: true, default: 1 },
    start_date: { type: 'date', notNull: true },
    end_date: { type: 'date', notNull: true },
    status: { type: 'text', notNull: true, default: 'Pending' },
    notes: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('audit_log', {
    id: 'id',
    reservation_id: { type: 'integer', notNull: true, references: 'reservations' },
    user_id: { type: 'integer', notNull: true, references: 'users' },
    user_name: { type: 'text', notNull: true, default: '' },
    action: { type: 'text', notNull: true },
    changes_json: { type: 'text', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('messages', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, references: 'users' },
    parent_id: { type: 'integer', references: 'messages' },
    content: { type: 'text', notNull: true },
    gif_url: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('message_reactions', {
    id: 'id',
    message_id: { type: 'integer', notNull: true, references: { name: 'messages', options: { onDelete: 'CASCADE' } } },
    user_id: { type: 'integer', notNull: true, references: 'users' },
    emoji: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.createTable('custom_avatars', {
    id: 'id',
    name: { type: 'text', notNull: true, unique: true },
    photo_url: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  // Indexes
  pgm.createIndex('reservations', 'user_id', { ifNotExists: true });
  pgm.createIndex('reservations', ['start_date', 'end_date'], { ifNotExists: true });
  pgm.createIndex('reservations', 'status', { ifNotExists: true });
  pgm.createIndex('audit_log', 'reservation_id', { ifNotExists: true });
  pgm.createIndex('message_reactions', 'message_id', { ifNotExists: true });
  pgm.createIndex('messages', 'parent_id', { ifNotExists: true });
  pgm.createIndex('sessions', 'user_id', { ifNotExists: true });

  // Constraints (idempotent via DO blocks)
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE reservations ADD CONSTRAINT reservations_size_check CHECK (size_of_party >= 1);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE reservations ADD CONSTRAINT reservations_dates_check CHECK (end_date >= start_date);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
        CHECK (status IN ('Pending', 'Accepted', 'Cancelled', 'Rejected', 'Completed', 'PendingCancel'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE message_reactions ADD CONSTRAINT message_reactions_unique UNIQUE (message_id, user_id, emoji);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
};
