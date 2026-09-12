// Vencimiento de comprobantes por cliente (pedido del cliente, sep-2026).
//
// clientes.diasVencimiento: plazo de pago habitual del cliente, en días.
// Default 0 = no configurado (sin vencimiento) - decisión de negocio, no NULL,
// para no tener que distinguir "0 días" de "sin cargar" en ningún lado.
//
// ventas.fechaVencimiento: fecha de vencimiento del comprobante, calculada como
// fecha emisión + diasVencimiento del cliente AL MOMENTO DE EMITIR, y persistida
// (no se recalcula después) para poder exportarla de forma confiable aunque el
// cliente cambie su plazo de pago más adelante. Solo se completa para procesos
// de cierre (Factura/Cotización - ver esProcesoDeCierre en ventaEstados.ts);
// queda NULL para Presupuesto/Pedido/Nota de Empaque/Nota de Crédito/Nota de
// Débito, igual que diasVencimiento = 0 (no configurado). Ver
// ObtenerFechaVencimiento en ventasRepository.ts.
//
// Bajo impacto en lectura: la query principal de listado/detalle de ventas
// (ObtenerQuery en ventasRepository.ts) ya hace `SELECT v.*`, así que esta
// columna queda disponible ahí sin tocar ninguna query - solo hace falta
// mapearla en CompletarObjeto(). Mismo patrón para clientes (SELECT c.*).

exports.up = function (knex) {
  return knex.raw(`
    ALTER TABLE clientes
      ADD COLUMN diasVencimiento INT NOT NULL DEFAULT 0
        COMMENT '0 = sin plazo de vencimiento configurado'
  `).then(() => knex.raw(`
    ALTER TABLE ventas
      ADD COLUMN fechaVencimiento DATE NULL DEFAULT NULL
        COMMENT 'fecha emision + diasVencimiento del cliente al momento de emitir; solo Factura/Cotizacion'
  `));
};

exports.down = function (knex) {
  return knex.raw(`
    ALTER TABLE ventas DROP COLUMN fechaVencimiento
  `).then(() => knex.raw(`
    ALTER TABLE clientes DROP COLUMN diasVencimiento
  `));
};
