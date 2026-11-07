// Motivo y usuario de baja en compras (6-nov-2026). Ver HANDOFF-ledger-proveedores.md.
// Mismos nombres que proveedores.observacionBaja / proveedores.usuarioBaja. Idempotente.

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('compras', 'observacionBaja'))) {
    await knex.schema.alterTable('compras', (t) => {
      t.string('observacionBaja', 300).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('compras', 'usuarioBaja'))) {
    await knex.schema.alterTable('compras', (t) => {
      t.string('usuarioBaja', 15).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('compras', 'usuarioBaja')) {
    await knex.schema.alterTable('compras', (t) => {
      t.dropColumn('usuarioBaja');
    });
  }
  if (await knex.schema.hasColumn('compras', 'observacionBaja')) {
    await knex.schema.alterTable('compras', (t) => {
      t.dropColumn('observacionBaja');
    });
  }
};
