// Adelantos de producción vinculados a una Nota de Empaque (pedido del cliente, 29-oct-2026).
//
// Caso: el cliente encarga X y entrega una parte. Se emite una Factura fiscal "sin productos o
// servicios" por lo entregado (adelanto, ver addmod-ventas / MOTIVOS_SIN_PRODUCTOS) y más tarde, cuando
// llega la mercadería, se carga la Nota de Empaque (NE) por el total. Esta tabla vincula la NE con
// la/s factura/s de adelanto para que el sistema sepa cuánto ya fue facturado y cuál es el saldo.
// La facturación de la NE por saldo exacto es la fase siguiente (F3); acá solo se guarda el vínculo.
//
//  - idNE:      ventas.id de la Nota de Empaque (idProceso 7).
//  - idFactura: ventas.id de la Factura de adelanto. UNIQUE: un adelanto solo puede ir a UNA NE.
//  - total/neto/iva: snapshot de la factura al momento del vínculo (total = ventas.total; neto e
//    iva = ventas_factura), para que el saldo no dependa de recalcular después.
//  - usuario/fechaVinculo: auditoría de quién y cuándo lo vinculó.
//
// Idempotente: crea la tabla solo si no existe. No altera datos existentes.

exports.up = async function (knex) {
  const existe = await knex.schema.hasTable('ventas_adelantos');
  if (existe) return;

  await knex.raw(`
    CREATE TABLE ventas_adelantos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      idNE INT NOT NULL,
      idFactura INT NOT NULL,
      total DECIMAL(14,2) NOT NULL,
      neto DECIMAL(14,2) NOT NULL,
      iva DECIMAL(14,2) NOT NULL,
      usuario VARCHAR(100) NULL,
      fechaVinculo DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ventas_adelantos_factura (idFactura),
      KEY idx_ventas_adelantos_ne (idNE),
      CONSTRAINT fk_ventas_adelantos_ne FOREIGN KEY (idNE) REFERENCES ventas(id),
      CONSTRAINT fk_ventas_adelantos_factura FOREIGN KEY (idFactura) REFERENCES ventas(id)
    ) ENGINE=InnoDB
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ventas_adelantos');
};
