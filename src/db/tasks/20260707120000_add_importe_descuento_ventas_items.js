// Persiste el importe de descuento ($) realmente aplicado a cada línea de
// ventas_productos/ventas_servicios al momento de la venta.
//
// Motivo: el tope de descuento por ítem (topeDescuento, tomado del catálogo de
// productos/servicios) solo existía en memoria mientras se armaba la venta en
// addmod-ventas — nunca se guardaba. Al volver a mostrar una venta ya guardada
// (listado-ventas -> calcularPrecioItem, usado por vista-previa y notas de
// crédito), no había forma de saber qué tope tenía cada ítem en su momento, así
// que se asumía 100 (elegible para el 100% del descuento) y se recalculaba mal
// para cualquier ítem que originalmente tuviera un tope distinto (típicamente
// servicios con tope 0). Bug real: Venta #114, total persistido $350.000,
// resumen recalculado mostraba $337.500 (aplicaba 25% también a un servicio con
// tope 0). Ver memoria del proyecto para el detalle completo.
//
// Fix de alcance acotado (opción elegida por el usuario, 07/2026): guardar el
// importe ya calculado en el momento de la venta y leerlo tal cual al
// redisplayar, en vez de reconstruirlo con datos que ya no están disponibles.

exports.up = function (knex) {
  return knex.schema
    .table('ventas_productos', function (table) {
      table.decimal('importeDescuento', 12, 2).notNullable().defaultTo(0);
    })
    .then(() => knex.schema.table('ventas_servicios', function (table) {
      table.decimal('importeDescuento', 12, 2).notNullable().defaultTo(0);
    }));
};

exports.down = function (knex) {
  return knex.schema
    .table('ventas_productos', function (table) {
      table.dropColumn('importeDescuento');
    })
    .then(() => knex.schema.table('ventas_servicios', function (table) {
      table.dropColumn('importeDescuento');
    }));
};
