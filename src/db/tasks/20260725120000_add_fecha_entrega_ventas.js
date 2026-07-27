// Agrega fecha de entrega prometida a nivel de venta (columna `ventas.fechaEntrega`).
//
// Motivo: Presupuesto/Pedido/Nota de Empaque necesitan registrar cuándo se
// comprometió la entrega al cliente. Es un dato opcional (no toda venta pre
// tiene fecha pactada) y no aplica a Factura/Cotización/NC/ND, que no se
// tocan - la columna queda simplemente NULL para esos procesos.
//
// Bajo impacto en lectura: la query principal de listado/detalle de ventas
// (ObtenerQuery en ventasRepository.ts) ya hace `SELECT v.*`, así que esta
// columna queda disponible ahí sin tocar ninguna query - solo hace falta
// mapearla en CompletarObjeto().

exports.up = function (knex) {
  return knex.schema.table('ventas', function (table) {
    table.date('fechaEntrega').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.table('ventas', function (table) {
    table.dropColumn('fechaEntrega');
  });
};
