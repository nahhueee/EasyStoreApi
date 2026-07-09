// Retenciones sufridas al cobrar (Ganancias / IIBB / SUSS).
//
// Contexto de negocio: cuando un cliente cancela deuda de cuenta corriente y además
// retiene un impuesto (hoy solo se habilita para el método CHEQUE, a futuro para
// otros métodos), esa retención SÍ cancela deuda del cliente pero NO es plata real
// que entra a ningún fondo de caja/banco — es un crédito fiscal futuro contra AFIP/
// ARBA/SUSS. Por eso necesita su propio fondo virtual (mismo patrón que
// 'Valores a Acreditar' en valores_acreditar.sql, o 'CC_PROVEEDORES' en
// 20260623120000_create_cc_proveedores.js) en vez de mezclarse con movimientos de
// fondos reales.
//
// Diseño minimalista a pedido: solo tipo + importe (sin número de comprobante ni
// fecha de emisión del certificado - si más adelante hace falta conciliar contra el
// papel que entrega el cliente, agregar esas columnas ahí, no antes).
//
// idVentaPago es el mismo tipo de "ancla" que ya usa valores_acreditar.idVentaPago:
// un solo cheque/retención físico puede terminar repartido en varios ventas_pagos
// (ver EntregaDinero en cuentasRepository.ts), así que se registra UN solo row de
// retención por el monto total de la operación, anclado al primer ventas_pagos que
// se genere - no un row por cada fragmento.

exports.up = function (knex) {
  // Idempotente ante un reintento después de un fallo a mitad de camino: en MySQL
  // el CREATE TABLE hace commit implícito aunque falle un ALTER TABLE posterior
  // (como pasó acá: la tabla se creó con el tipo de columna viejo, y recién el ADD
  // CONSTRAINT de la FK falló después) - así que puede quedar la tabla a medio
  // crear de un intento anterior aunque la migración completa se haya marcado
  // como fallida. Se dropea si existe antes de recrearla, y el insert del fondo
  // solo se hace si todavía no está.
  return knex('fondos')
    .where({ tipo: 'RETENCIONES_SUFRIDAS' })
    .then((existentes) => {
      if (existentes.length) return null;
      return knex('fondos').insert({
        nombre: 'Retenciones Sufridas',
        tipo: 'RETENCIONES_SUFRIDAS',
        activo: 1,
        permiteNegativo: 0,
        icono: 'pi pi-percentage',
      });
    })
    .then(() => knex.schema.dropTableIfExists('retenciones'))
    .then(() =>
      knex.schema.createTable('retenciones', function (table) {
        table.bigIncrements('id').primary();
        // ventas_pagos.id es `int` (signed, NO unsigned) - tiene que matchear
        // exacto para que MySQL acepte la FK (ver valores_acreditar.sql, que usa
        // el mismo `INT NOT NULL` sin unsigned para esta misma referencia).
        table.integer('idVentaPago').notNullable();
        table.enum('tipo', ['GANANCIAS', 'IIBB', 'SUSS']).notNullable();
        table.decimal('importe', 12, 2).notNullable();
        table.timestamp('fechaAlta').defaultTo(knex.fn.now());
        table.string('usuarioAlta', 15);

        table.foreign('idVentaPago').references('id').inTable('ventas_pagos');
      })
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('retenciones')
    .then(() => knex('fondos').where({ tipo: 'RETENCIONES_SUFRIDAS' }).del());
};
