// UNIQUE(idProceso, nroProceso) en `ventas` - red de seguridad definitiva contra
// nroProceso duplicado. Complementa el reintento agregado en Agregar()
// (ventasRepository.ts): ese reintento es el que reacciona al error que este
// índice va a generar - sin el índice, el reintento nunca se dispara porque
// nunca hay error que atrapar.
//
// OJO al correr esta migración: falla si quedan filas duplicadas en la tabla.
// Al momento de escribir esto (ago-2026) quedan 2 grupos sin resolver
// (nroProceso 19 y 45 en Pedidos) pendientes de confirmar con el cliente real
// antes de decidir a qué venta corresponden - ver memoria
// pedidos-nroproceso-duplicados. Confirmar con:
//
//   SELECT idProceso, nroProceso, COUNT(*) FROM ventas
//   GROUP BY idProceso, nroProceso HAVING COUNT(*) > 1;
//
// que no devuelva NINGUNA fila antes de correr esta migración.

exports.up = function (knex) {
  return knex.schema.table('ventas', function (table) {
    table.unique(['idProceso', 'nroProceso']);
  });
};

exports.down = function (knex) {
  return knex.schema.table('ventas', function (table) {
    table.dropUnique(['idProceso', 'nroProceso']);
  });
};
