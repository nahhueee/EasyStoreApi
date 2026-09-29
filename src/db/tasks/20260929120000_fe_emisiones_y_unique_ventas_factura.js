// F3 - HANDOFF blindaje facturacion y logs: registro durable de emisiones + UNIQUE
// fiscal en ventas_factura.
//
// Contexto (ver HANDOFF-blindaje-facturacion-y-logs.md, sec. F3): hasta ahora la unica
// garantia de que ARCA nunca reciba dos veces el mismo (emisor, ptoVenta, tipo, nro) era
// el lock GET_LOCK de F1.3 + el chequeo de correlatividad de F1.2, ambos en memoria del
// proceso Node. Esta migracion agrega una garantia real a nivel de base de datos:
//
// 1) `ventas_factura.cuitEmisor` + UNIQUE(cuitEmisor, ptoVenta, tipoFactura, ticket):
//    ya no depende de resolver el emisor via join contra ventas/empresas (ObtenerUltimoTicketLocal
//    lo hacia asi por no tener la columna). El backfill toma el CUIT de la empresa de la
//    venta a la que pertenece cada factura. MySQL permite multiples NULL en un UNIQUE, asi
//    que las filas con ticket NULL (ventas sin comprobante fiscal real, ver diagnostico F3.1)
//    no rompen la restriccion.
//
//    Diagnostico previo (F3.1, script "Diagnostico unicidad comprobantes ventas_factura -
//    sep-2026.sql") corrido en testing y produccion antes de aplicar esto: produccion sin
//    duplicados; los 2 pares encontrados en testing se resuelven restaurando una replica
//    limpia de produccion sobre testing (accion de Nahu, no requiere dato-fix acá). No
//    correr esta migracion contra una DB con duplicados: el ADD UNIQUE fallaria (esperado,
//    es la red de seguridad funcionando) - hay que resolver los duplicados primero.
//
// 2) `fe_emisiones`: registro durable de cada intento de emision, escrito ANTES de pedirle
//    el CAE a ARCA (regla del HANDOFF sec. 2: "nunca se pide un CAE a ARCA sin haber
//    guardado antes, de forma durable y fuera de la transaccion de la venta, que se va a
//    pedir"). Estados en el enum EstadoEmision (src/models/EstadoEmision.ts, con el
//    significado de cada uno documentado ahi). UNIQUE(cuitEmisor, ptoVenta, tipoCbte, nro)
//    es la garantia de fondo: un RECHAZADO no consume numero (no rompe correlatividad en
//    ARCA), por eso el reintento reutiliza la misma fila (UPDATE a PENDIENTE) en vez de
//    insertar una nueva - ver facturacionService.ts.
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ventas_factura
      ADD COLUMN cuitEmisor BIGINT NULL
        COMMENT 'CUIT del emisor (empresas.cuil) al momento de facturar. Backfill via ventas.idEmpresa -> empresas.cuil. F3 - HANDOFF blindaje facturacion'
  `);

  await knex.raw(`
    UPDATE ventas_factura vf
      JOIN ventas v ON v.id = vf.idVenta
      JOIN empresas e ON e.id = v.idEmpresa
    SET vf.cuitEmisor = e.cuil
    WHERE vf.cuitEmisor IS NULL
  `);

  await knex.raw(`
    ALTER TABLE ventas_factura
      ADD UNIQUE KEY uq_vf_comprobante (cuitEmisor, ptoVenta, tipoFactura, ticket)
  `);

  await knex.raw(`
    CREATE TABLE fe_emisiones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      idEmpresa INT NOT NULL,
      cuitEmisor BIGINT NOT NULL,
      ptoVenta INT NOT NULL,
      tipoCbte INT NOT NULL,
      nro INT NOT NULL,
      estado ENUM('PENDIENTE','APROBADO','RECHAZADO','INCIERTO','APROBADO_SIN_REGISTRAR','REGULARIZADO') NOT NULL,
      cae BIGINT NULL,
      caeVto DATE NULL,
      idVenta INT NULL,
      payloadVenta JSON NULL COMMENT 'la venta completa tal como llego (insumo para Regularizar en F4)',
      payloadArca JSON NULL COMMENT 'lo que se mando a ARCA (createVoucher)',
      respuestaArca JSON NULL COMMENT 'lo que respondio ARCA, o el error. En reintentos tras RECHAZADO, array de intentos',
      entornoProduccion TINYINT(1) NOT NULL,
      usuario VARCHAR(50) NULL,
      requestId VARCHAR(16) NULL,
      usuarioRegulariza VARCHAR(50) NULL,
      fechaRegulariza DATETIME NULL,
      motivoRegulariza VARCHAR(250) NULL,
      fechaAlta DATETIME DEFAULT CURRENT_TIMESTAMP,
      fechaMod DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_fe_nro (cuitEmisor, ptoVenta, tipoCbte, nro),
      KEY ix_fe_estado (estado)
    ) ENGINE=InnoDB
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS fe_emisiones`);
  await knex.raw(`ALTER TABLE ventas_factura DROP KEY uq_vf_comprobante`);
  await knex.raw(`ALTER TABLE ventas_factura DROP COLUMN cuitEmisor`);
};
