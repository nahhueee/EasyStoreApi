// Vendedor / usuario que dio de alta la venta (pedido del cliente B4-205, informe
// de conciliación - ver HANDOFF-informes-administracion-R1.md §7.a).
//
// `ventas` no tenía ninguna referencia al usuario que la creó. VentasRepository
// .Agregar(venta, usuario) ya recibe el usuario (lo usa para los movimientos de
// fondos), así que persistirlo es barato: se setea SOLO en Agregar(), nunca en
// Modificar() (la columna es "quién la creó", no "quién la tocó último").
//
// Sin backfill: el histórico queda NULL. No hay forma honesta de reconstruir el
// usuario de ventas ya cargadas, y así queda explícito en el informe (vacío,
// no un valor inventado).
//
// Bajo impacto en lectura: igual que fechaVencimiento (migración
// 20260912120000_add_vencimiento_clientes_ventas), la query principal de
// listado/detalle de ventas ya hace `SELECT v.*`, así que esta columna queda
// disponible ahí sin tocar ninguna query - solo falta mapearla en
// CompletarObjeto() si se necesita mostrar en el front (no requerido por R1,
// que la lee directo del repositorio nuevo).

exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas
      ADD COLUMN usuarioAlta VARCHAR(30) NULL DEFAULT NULL
        COMMENT 'usuario que dio de alta la venta (Agregar() unicamente); NULL en historico sin backfill'
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas DROP COLUMN usuarioAlta
  `);
};
