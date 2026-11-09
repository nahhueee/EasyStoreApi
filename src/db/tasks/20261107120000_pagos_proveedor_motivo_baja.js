// Motivo y usuario de baja en compras_pagos_proveedor (7-nov-2026). Ver HANDOFF-orden-de-pago-y-recibo-a4.md.
// Mismos nombres que compras / proveedores (observacionBaja, usuarioBaja). Idempotente.

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('compras_pagos_proveedor', 'observacionBaja'))) {
    await knex.schema.alterTable('compras_pagos_proveedor', (t) => {
      t.string('observacionBaja', 300).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('compras_pagos_proveedor', 'usuarioBaja'))) {
    await knex.schema.alterTable('compras_pagos_proveedor', (t) => {
      t.string('usuarioBaja', 15).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('compras_pagos_proveedor', 'usuarioBaja')) {
    await knex.schema.alterTable('compras_pagos_proveedor', (t) => {
      t.dropColumn('usuarioBaja');
    });
  }
  if (await knex.schema.hasColumn('compras_pagos_proveedor', 'observacionBaja')) {
    await knex.schema.alterTable('compras_pagos_proveedor', (t) => {
      t.dropColumn('observacionBaja');
    });
  }
};
