// Agrega un campo de observación libre a nivel de venta (columna `ventas.observacion`).
//
// Motivo inmediato: Nota de Crédito X necesita poder cargarse "sin productos"
// (ej. adelanto de producción, saldo de orden de compra) - un caso donde no hay
// ítems reales que devolver, solo un importe que se acredita como saldo a favor
// del cliente. Guardar el motivo como texto libre acá evita inventar un producto
// "falso" en ventas_productos (que hubiera obligado a joins condicionales,
// idProducto nullable, etc. - ver decisión del 19/07/2026).
//
// Decisión de diseño: se puso a nivel de VENTA (no de ítem/ventas_productos)
// porque el motivo describe al comprobante completo, no a una línea puntual -
// y porque ya se sabe que en el corto plazo también va a hacer falta una
// observación para Pedido y Nota de Empaque (mismo campo, sin necesidad de
// otra migración).
//
// Bajo impacto en lectura: la query principal de listado/detalle de ventas
// (ObtenerQuery en ventasRepository.ts) ya hace `SELECT v.*`, así que esta
// columna queda disponible ahí sin tocar ninguna query - solo hace falta
// mapearla en CompletarObjeto().

exports.up = function (knex) {
  return knex.schema.table('ventas', function (table) {
    table.string('observacion', 255).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.table('ventas', function (table) {
    table.dropColumn('observacion');
  });
};
