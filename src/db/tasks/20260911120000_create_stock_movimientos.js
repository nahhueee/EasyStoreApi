// Ledger append-only de ajustes manuales de stock (Fase 1 del rediseño de permisos/auditoría,
// ver sesion-jwt-permisos-fase0.md). Un registro por cada ajuste manual de cantidad en
// talles_producto, nunca se edita ni se borra: se revierte con un contra-asiento (baja lógica +
// UPDATE inverso sobre talles_producto), mismo criterio que compras/movimientos_fondos.
//
// idTalle queda desnormalizado (nullable) solo para no repetir el JOIN a `talles` en cada
// consulta del listado; la fuente de verdad para aplicar/revertir el ajuste sigue siendo
// (idProducto, talle) sobre talles_producto, igual que productosRepository.ActualizarInventario.
//
// usuario/usuarioBaja son string (no FK a usuarios), mismo criterio que compras.usuario y
// movimientos_fondos.usuario en esta base.
//
// Idempotente (corrección sep-2026): la tabla ya existía en el server (quedó creada en un
// intento previo que no llegó a registrarse en knex_migrations - no se investigó la causa acá
// porque no hace a la migración en sí), lo que rompía el `up` con "Table already exists" en cada
// corrida. Se resuelve chequeando hasTable antes de crear, mismo criterio a aplicar de acá en
// más en toda migración de creación de tabla en este proyecto.
exports.up = async function (knex) {
  const existe = await knex.schema.hasTable('stock_movimientos');
  if (existe) return;

  return knex.schema.createTable('stock_movimientos', function (table) {
    table.bigIncrements('id').unsigned().primary();
    table.integer('idProducto').unsigned().notNullable();
    table.string('talle', 20).notNullable();
    table.integer('idTalle').unsigned().nullable();
    table.integer('cantidadAnterior').notNullable();
    table.integer('cantidadNueva').notNullable();
    table.integer('diferencia').notNullable();
    table.string('motivo', 255).notNullable();
    table.string('usuario', 15).notNullable();
    table.timestamp('alta').defaultTo(knex.fn.now());
    table.datetime('baja').nullable();
    table.string('motivoBaja', 255).nullable();
    table.string('usuarioBaja', 15).nullable();

    table.index(['idProducto', 'talle'], 'idx_stock_movimientos_producto_talle');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('stock_movimientos');
};
