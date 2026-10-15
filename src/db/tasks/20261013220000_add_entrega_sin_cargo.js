// Entrega sin cargo (ESC) y Devolución de entrega - Fase 1 (13-oct-2026).
// Ver HANDOFF-entrega-sin-cargo.md.
//
// Dos procesos nuevos en `procesos_venta` (NO una variante de Cotización): el discriminador
// es idProceso, así las ventas/informes/Libro IVA (listas blancas IN (1,2,3,4)) las dejan
// afuera solas. Sus ventas usan idTComprobante 99 (SIN_COMPROBANTE).
//   8 = ENTREGA SIN CARGO     (descuenta stock, no genera deuda)
//   9 = DEVOLUCION DE ENTREGA (devuelve stock contra una ESC puntual, no toca CC)
//
// + ventas.motivoEntrega: columna propia (EMBAJADOR / EVENTO / OTRO) y no `observacion`,
//   que ya se usa como motivo de NC y de baja y el informe tiene que agrupar por motivo.
//
// `procesos_venta.id` NO es auto-incremental, por eso el id va explícito. Idempotente: el
// INSERT tiene guard NOT EXISTS y la columna se agrega solo si falta.
//
// Sin efecto mientras no existan ventas con idProceso 8/9: el blindaje de F1
// (PROCESOS_CON_SALDO) ya las deja fuera de saldos, Fondos y estadísticas.

exports.up = async function (knex) {
  const procesos = [
    [8, 'ENTREGA SIN CARGO', 'factura', 'ESC'],
    [9, 'DEVOLUCION DE ENTREGA', 'factura', 'DEV ESC'],
  ];
  for (const [id, descripcion, tipo, abrev] of procesos) {
    await knex.raw(
      `INSERT INTO procesos_venta (id, descripcion, tipo, abrev)
       SELECT ?, ?, ?, ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM procesos_venta WHERE id = ?)`,
      [id, descripcion, tipo, abrev, id]
    );
  }

  const existe = await knex.schema.hasColumn('ventas', 'motivoEntrega');
  if (!existe) {
    await knex.schema.table('ventas', function (table) {
      table.string('motivoEntrega', 20).nullable();
    });
  }
};

exports.down = async function (knex) {
  // No se revierte si ya hay ESC/Devoluciones emitidas: borrar el proceso las dejaría huérfanas.
  const [[{ n }]] = await knex.raw('SELECT COUNT(*) AS n FROM ventas WHERE idProceso IN (8, 9)');
  if (Number(n) > 0) {
    throw new Error('Hay ventas con idProceso 8/9 (Entrega sin cargo / Devolucion de entrega): no se puede revertir.');
  }

  const existe = await knex.schema.hasColumn('ventas', 'motivoEntrega');
  if (existe) {
    await knex.schema.table('ventas', function (table) {
      table.dropColumn('motivoEntrega');
    });
  }
  await knex.raw('DELETE FROM procesos_venta WHERE id IN (8, 9)');
};
