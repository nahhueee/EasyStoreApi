// Desambigua movimientos_fondos.idReferencia para los dos únicos orígenes donde
// hoy puede apuntar a más de una tabla según el caso: AJUSTE (puede ser
// ventas.id, ventas_entrega.id o compras_pagos_proveedor.id) y
// PAGO_CC_PROVEEDOR (puede ser compras.id o compras_pagos_proveedor.id). Todos
// los demás orígenes (VENTA, NOTA_CREDITO, PAGO_PROVEEDOR, ACREDITACION_VALOR,
// COBRO_CC, INGRESO_MANUAL/EGRESO_MANUAL, TRANSFERENCIA) ya son unívocos: el
// propio `origen` alcanza para saber a qué tabla mirar (ver análisis jul-2026,
// motivado por querer mostrar Cliente/Proveedor en la grilla de Fondos).
//
// Columna nueva (no una modificación del ENUM `origen` existente), nullable:
// las filas históricas quedan en NULL y simplemente no van a poder resolver
// cliente/proveedor en la lectura (se van a mostrar en blanco, no se
// "adivina" - ver fondosRepository.ts). Solo los INSERT de AJUSTE/
// PAGO_CC_PROVEEDOR nuevos, de acá en adelante, la completan.
exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE movimientos_fondos
      ADD COLUMN tipoReferencia ENUM(
        'VENTA', 'VENTA_ENTREGA', 'COMPRA', 'COMPRA_PAGO_PROVEEDOR'
      ) NULL DEFAULT NULL AFTER idReferencia
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE movimientos_fondos
      DROP COLUMN tipoReferencia
  `);
};
