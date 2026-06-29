// FASE 2 — Cuenta Corriente de Proveedores (ver ROADMAP-modulo-compras.md, sección 9).
//
// Toca 2 tablas legacy que NO tienen su CREATE TABLE versionado en este repo (fondos, metodos_pago,
// movimientos_fondos ya existían antes de cualquier migración trackeada). Por eso los ENUM de abajo
// se escriben de forma DEFENSIVA: incluyen 'CHEQUE' y 'ACREDITACION_VALOR' aunque esta migración no
// los necesita, porque existe una spec paralela (valores_acreditar.sql) que pudo haberse aplicado
// directo en la base sin pasar por una migración. Un ALTER...MODIFY COLUMN ENUM reemplaza la lista
// completa: si esos valores ya están en uso y no los incluyo acá, los filas existentes con esos
// valores quedarían con un ENUM inválido. Si valores_acreditar.sql NO se aplicó todavía, esto no
// rompe nada (son valores de más, sin filas que los usen).
//
// IMPORTANTE antes de correr en una base real: verificar con
//   SHOW COLUMNS FROM metodos_pago LIKE 'tipo';
//   SHOW COLUMNS FROM movimientos_fondos LIKE 'origen';
// que no haya ningún valor en uso que no esté en las listas de abajo.

exports.up = function (knex) {
  let idFondoCC = null;
  let idFondoSaldoFavor = null;

  return knex.raw(`
      ALTER TABLE metodos_pago
        MODIFY COLUMN tipo ENUM(
          'CREDITO','DEBITO','TRANSFERENCIA','DIGITAL','EFECTIVO',
          'CUENTA_CORRIENTE','SALDO_FAVOR','CHEQUE',
          'CUENTA_CORRIENTE_PROVEEDOR','SALDO_FAVOR_PROVEEDOR'
        ) NOT NULL
    `)
    .then(() => knex.raw(`
      ALTER TABLE movimientos_fondos
        MODIFY COLUMN origen ENUM(
          'VENTA','COBRO_CC','PAGO_PROVEEDOR','RETIRO','AJUSTE',
          'TRANSFERENCIA','INGRESO_MANUAL','NOTA_CREDITO','EGRESO_MANUAL',
          'ACREDITACION_VALOR','PAGO_CC_PROVEEDOR'
        ) NOT NULL
    `))

    // Fondos virtuales (espejo de los de Cuenta Corriente Clientes, pero versionados).
    // permiteNegativo = 0 en los dos: el reparto FIFO de PagarProveedor nunca aplica más
    // de lo que hay disponible, así que un saldo negativo acá sería síntoma de bug, no un caso válido.
    .then(() => knex('fondos').insert({
      nombre: 'Cuenta Corriente Proveedores',
      tipo: 'CC_PROVEEDORES',
      activo: 1,
      permiteNegativo: 0,
      icono: 'pi pi-truck'
    }))
    .then(([id]) => { idFondoCC = id; })
    .then(() => knex('fondos').insert({
      nombre: 'Saldo a Favor Proveedores',
      tipo: 'SALDO_FAVOR_PROVEEDORES',
      activo: 1,
      permiteNegativo: 0,
      icono: 'pi pi-rotate-left'
    }))
    .then(([id]) => { idFondoSaldoFavor = id; })

    // Método de pago nuevo por cada empresa existente, apuntando a los fondos virtuales recién creados.
    // NOTA: no hay ABM de métodos de pago en el sistema (confirmado: valores_acreditar.sql también
    // inserta a mano). Cualquier empresa que se cree DESPUÉS de correr esta migración necesita este
    // insert manual hasta que exista un ABM real.
    .then(() => knex('empresas').select('id'))
    .then((empresas) => {
      const filas = [];
      for (const e of empresas) {
        filas.push({
          idEmpresa: e.id,
          idFondo: idFondoCC,
          tipo: 'CUENTA_CORRIENTE_PROVEEDOR',
          nombre: 'Cuenta Corriente (Proveedor)'
        });
        filas.push({
          idEmpresa: e.id,
          idFondo: idFondoSaldoFavor,
          tipo: 'SALDO_FAVOR_PROVEEDOR',
          nombre: 'Saldo a Favor (Proveedor)'
        });
      }
      if (!filas.length) return null;
      return knex('metodos_pago').insert(filas);
    })

    // Saldo inicial de deuda por proveedor (mismo par de columnas que clientes.inicial/inicialHistorico).
    .then(() => knex.schema.table('proveedores', function (table) {
      table.decimal('inicial', 12, 2).notNullable().defaultTo(0);
      table.decimal('inicialHistorico', 12, 2).notNullable().defaultTo(0);
    }))

    // Marca de compra pendiente de pago (mismo criterio que ventas.impaga: evita un agregado
    // sobre compras_pagos_proveedor_detalle en cada listado de deuda).
    .then(() => knex.schema.table('compras', function (table) {
      table.tinyint('impaga').notNullable().defaultTo(0);
    }))

    // Header de pago a proveedor. Consolida lo que en Clientes son 2 tablas (recibos + ventas_entrega)
    // en una sola — esas dos nacieron separadas en Clientes por motivos históricos (ventas_pagos ya
    // existía antes de la CC), acá no hay esa restricción.
    .then(() => knex.schema.createTable('compras_pagos_proveedor', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.integer('idEmpresa').unsigned().notNullable();
      table.integer('idProveedor').unsigned().notNullable();
      table.integer('idCaja').unsigned().notNullable();
      table.date('fecha').notNullable();
      table.time('hora').notNullable();
      table.decimal('total', 12, 2).notNullable();
      table.string('observaciones', 300);
      table.string('usuario', 15);
      table.timestamp('alta').defaultTo(knex.fn.now());
      table.datetime('baja').nullable();
    }))
    // Desglose por método de pago (un pago puede combinar efectivo + transferencia, etc.).
    .then(() => knex.schema.createTable('compras_pagos_proveedor_metodos', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.bigInteger('idPagoProveedor').unsigned().notNullable();
      table.integer('idMetodo').unsigned().notNullable();
      table.decimal('monto', 12, 2).notNullable();
    }))
    // Aplicación del pago a compras pendientes (reparto FIFO, posiblemente varias compras por pago).
    // idCompra es NULLABLE + tipoAplicacion porque, igual que ventas_entrega_detalle en Clientes, un pago
    // puede aplicarse a algo que no es una compra puntual: saldo inicial del proveedor (tipoAplicacion =
    // 'SALDO_INICIAL', idCompra NULL) o excedente que pasa a ser saldo a favor del proveedor
    // (tipoAplicacion = 'SALDO_A_FAVOR', idCompra NULL). Fila con idCompra seteado y tipoAplicacion NULL
    // = aplicación normal a una compra puntual.
    .then(() => knex.schema.createTable('compras_pagos_proveedor_detalle', function (table) {
      table.bigIncrements('id').unsigned().primary();
      table.bigInteger('idPagoProveedor').unsigned().notNullable();
      table.bigInteger('idCompra').unsigned().nullable();
      table.string('tipoAplicacion', 20).nullable();
      table.decimal('montoAplicado', 12, 2).notNullable();
    }));
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('compras_pagos_proveedor_detalle')
    .then(() => knex.schema.dropTableIfExists('compras_pagos_proveedor_metodos'))
    .then(() => knex.schema.dropTableIfExists('compras_pagos_proveedor'))
    .then(() => knex.schema.table('compras', function (table) {
      table.dropColumn('impaga');
    }))
    .then(() => knex.schema.table('proveedores', function (table) {
      table.dropColumn('inicial');
      table.dropColumn('inicialHistorico');
    }))
    .then(() => knex('metodos_pago').whereIn('tipo', ['CUENTA_CORRIENTE_PROVEEDOR', 'SALDO_FAVOR_PROVEEDOR']).del())
    .then(() => knex('fondos').whereIn('nombre', ['Cuenta Corriente Proveedores', 'Saldo a Favor Proveedores']).del())
    // Revierte los ENUM a la lista previa a esta migración. Solo es seguro si ninguna fila quedó
    // usando 'CUENTA_CORRIENTE_PROVEEDOR' / 'SALDO_FAVOR_PROVEEDOR' / 'PAGO_CC_PROVEEDOR' (los deletes
    // de arriba ya deberían garantizarlo para metodos_pago; movimientos_fondos es append-only y un
    // down acá NO borra esos movimientos, así que si hubo algún pago a proveedor por CC, este ALTER
    // va a fallar a propósito en vez de corromper datos).
    .then(() => knex.raw(`
      ALTER TABLE movimientos_fondos
        MODIFY COLUMN origen ENUM(
          'VENTA','COBRO_CC','PAGO_PROVEEDOR','RETIRO','AJUSTE',
          'TRANSFERENCIA','INGRESO_MANUAL','NOTA_CREDITO','EGRESO_MANUAL',
          'ACREDITACION_VALOR'
        ) NOT NULL
    `))
    .then(() => knex.raw(`
      ALTER TABLE metodos_pago
        MODIFY COLUMN tipo ENUM(
          'CREDITO','DEBITO','TRANSFERENCIA','DIGITAL','EFECTIVO',
          'CUENTA_CORRIENTE','SALDO_FAVOR','CHEQUE'
        ) NOT NULL
    `));
};
