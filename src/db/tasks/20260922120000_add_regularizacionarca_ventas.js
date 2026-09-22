// Regularización de correlatividad ARCA (sep-2026, ver memoria "boton-nc-regularizacion-arca"
// / conversación Cowork sep-2026). Contexto: se detectaron comprobantes (Factura A/B) que
// existen de verdad en ARCA -con CAE real- porque se emitieron por error desde testing
// apuntando al CUIT/punto de venta real, pero nunca quedaron registrados en la base de
// producción. Se backfillean directo en `ventas`/`ventas_factura` (sin pasar por Facturar())
// para que el sistema los reconozca y el usuario pueda anularlos con una NC real desde la
// pantalla normal.
//
// Como esas facturas nunca tuvieron un cobro real, la NC que las cancela NO puede generar el
// saldo a favor que RegistrarMovimientoNotaCredito() acredita siempre (ventasRepository.ts) -
// el cliente terminaría con crédito por una venta que jamás pagó. Este flag marca esas
// facturas puntuales para que ese único paso (ventas_pagos + movimientos_fondos) se saltee;
// todo lo demás (numeración, CAE real al generar la NC, Libro IVA) sigue el camino normal,
// porque el comprobante fiscal sí es real.
//
// Se agrega en `ventas` (no en `ventas_factura`) porque el flag tiene que sobrevivir y ser
// consultable también para la propia NC que se genere después, con el mismo criterio simple
// usado en el resto del proyecto (columna + default 0, sin tabla aparte).
exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas
      ADD COLUMN regularizacionArca TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'factura backfilleada por correlatividad ARCA (sin cobro real) - gatea que su NC no genere saldo a favor. Ver ventasRepository.RegistrarMovimientoNotaCredito'
  `);
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas DROP COLUMN regularizacionArca
  `);
};
