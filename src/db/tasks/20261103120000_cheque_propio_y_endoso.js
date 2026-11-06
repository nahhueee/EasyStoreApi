// Cheque propio y endoso de cheques de terceros en Compras (3-nov-2026).
// Ver HANDOFF-cheque-propio-y-endoso.md.
//
// Contexto: en Compras el método CHEQUE (idFondo = 10 "Valores a Acreditar") se usaba para pagar con
// cheques PROPIOS, lo que egresaba de Valores a Acreditar plata que nunca estuvo ahí. Se separa en dos
// circuitos:
//   - CHEQUE_PROPIO: cheque de chequera propia / eCheq. Al emitirlo egresa del fondo puente
//     "Cheques emitidos a debitar"; al debitarse (botón Debitar) sale del banco.
//   - CHEQUE (existente): pasa a significar ENDOSO de un cheque de tercero PENDIENTE en Valores a
//     Acreditar. El valor queda ENDOSADO y se vincula a la pierna de pago.
//
// ENUM: en vez de reescribir la lista completa (que obliga a conocer los valores de cada base y los
// pisa si testing/producción difieren), el helper agregarValorEnum lee el ENUM actual de
// information_schema y le suma SOLO el valor nuevo, conservando NULL/DEFAULT. Es idempotente.
//
// NO se toca el idFondo del método CHEQUE existente (82, 94, 98, 102, 106): los reversos históricos
// dependen de él.
//
// Sin FOREIGN KEY a propósito: varias tablas legacy (proveedores, fondos, metodos_pago) no tienen su
// CREATE TABLE versionado y no se verificaron los tipos exactos de id; una FK con tipo distinto hace
// fallar la migración. Los índices sí están.

const NOMBRE_FONDO_PUENTE = 'Cheques emitidos a debitar';

async function leerEnum(knex, tabla, columna) {
  const [rows] = await knex.raw(
    `SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defecto
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabla, columna]
  );
  if (!rows.length) throw new Error(`No existe la columna ${tabla}.${columna}`);
  const r = rows[0];
  if (!/^enum\(/i.test(r.tipo)) throw new Error(`${tabla}.${columna} no es un ENUM (${r.tipo})`);
  const valores = [...r.tipo.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  return { valores, nullable: r.nullable === 'YES', defecto: r.defecto };
}

async function reescribirEnum(knex, tabla, columna, valores, nullable, defecto) {
  const lista = valores.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nulo = nullable ? 'NULL' : 'NOT NULL';
  const def = defecto === null || defecto === undefined ? (nullable ? 'DEFAULT NULL' : '') : `DEFAULT '${String(defecto).replace(/'/g, "''")}'`;
  await knex.raw(`ALTER TABLE \`${tabla}\` MODIFY COLUMN \`${columna}\` ENUM(${lista}) ${nulo} ${def}`);
}

async function agregarValorEnum(knex, tabla, columna, valorNuevo) {
  const { valores, nullable, defecto } = await leerEnum(knex, tabla, columna);
  if (valores.includes(valorNuevo)) return;
  await reescribirEnum(knex, tabla, columna, [...valores, valorNuevo], nullable, defecto);
}

// Falla a propósito (error de truncamiento en modo estricto) si quedaron filas con el valor.
async function quitarValorEnum(knex, tabla, columna, valor) {
  const { valores, nullable, defecto } = await leerEnum(knex, tabla, columna);
  if (!valores.includes(valor)) return;
  await reescribirEnum(knex, tabla, columna, valores.filter((v) => v !== valor), nullable, defecto);
}

exports.up = async function (knex) {
  await agregarValorEnum(knex, 'metodos_pago', 'tipo', 'CHEQUE_PROPIO');
  await agregarValorEnum(knex, 'movimientos_fondos', 'origen', 'DEBITO_CHEQUE_PROPIO');
  // tipoReferencia desambigua idReferencia (ver 20260727120000): el débito de un cheque propio apunta a
  // cheques_emitidos.id.
  await agregarValorEnum(knex, 'movimientos_fondos', 'tipoReferencia', 'CHEQUE_EMITIDO');
  await agregarValorEnum(knex, 'valores_acreditar', 'estado', 'ENDOSADO');

  // Datos del endoso en el valor (quién, cuándo y a qué proveedor se entregó).
  await knex.schema.table('valores_acreditar', function (table) {
    table.dateTime('fechaEndoso').nullable();
    table.string('usuarioEndoso', 15).nullable();
    table.integer('idProveedorEndoso').unsigned().nullable();
  });

  // Fondo puente. permiteNegativo = 1: el saldo es SIEMPRE <= 0 (es lo comprometido y todavía no
  // debitado); el invariante es saldo = -SUM(cheques_emitidos.importe WHERE estado = 'EMITIDO').
  // fondos.tipo es varchar: no necesita ALTER.
  let fondo = await knex('fondos').where({ nombre: NOMBRE_FONDO_PUENTE }).first();
  let idFondoPuente;
  if (fondo) {
    idFondoPuente = fondo.id;
  } else {
    [idFondoPuente] = await knex('fondos').insert({
      nombre: NOMBRE_FONDO_PUENTE,
      tipo: 'CHEQUE_EMITIDO',
      activo: 1,
      permiteNegativo: 1,
      icono: 'pi pi-file-edit',
      mostrar: 1
    });
  }

  // Las pantallas de Fondos (tarjetas, resumen por caja) hacen JOIN con caja_fondos: sin una fila por caja
  // activa el fondo puente existe pero no se ve ni se puede seleccionar para abrir el panel de cheques.
  const cajas = await knex('cajas').where({ activa: 1 }).select('id');
  for (const caja of cajas) {
    const yaVinculada = await knex('caja_fondos').where({ idCaja: caja.id, idFondo: idFondoPuente }).first();
    if (!yaVinculada) await knex('caja_fondos').insert({ idCaja: caja.id, idFondo: idFondoPuente, activo: 1 });
  }

  // Un método "Cheque propio" por cada empresa que hoy tiene método CHEQUE (1, 4, 5, 6, 7 en producción).
  // No hay ABM de métodos de pago: una empresa nueva necesita este insert manual.
  const empresas = await knex('metodos_pago').where({ tipo: 'CHEQUE' }).distinct('idEmpresa');
  const yaExisten = (await knex('metodos_pago').where({ tipo: 'CHEQUE_PROPIO' }).select('idEmpresa')).map((r) => r.idEmpresa);
  const filas = empresas
    .filter((e) => !yaExisten.includes(e.idEmpresa))
    .map((e) => ({ idEmpresa: e.idEmpresa, idFondo: idFondoPuente, tipo: 'CHEQUE_PROPIO', nombre: 'Cheque propio' }));
  if (filas.length) await knex('metodos_pago').insert(filas);

  // Cheques propios emitidos. No se reusa `cheques`: esa tabla cuelga de valores_acreditar (cheques
  // RECIBIDOS), acá la dirección es la inversa.
  await knex.schema.createTable('cheques_emitidos', function (table) {
    table.bigIncrements('id').unsigned().primary();
    table.integer('idEmpresa').notNullable();
    table.integer('idFondoBanco').notNullable();            // cuenta de la que se libra (fondo BANCARIO)
    table.integer('idProveedor').unsigned().notNullable();
    table.enu('tipo', ['FISICO', 'ECHEQ']).notNullable();
    table.string('numero', 30).notNullable();
    table.decimal('importe', 12, 2).notNullable();
    table.date('fechaEmision').notNullable();
    table.date('fechaPago').notNullable();
    table.enu('estado', ['EMITIDO', 'DEBITADO', 'ANULADO']).notNullable().defaultTo('EMITIDO');
    table.dateTime('fechaAlta').defaultTo(knex.fn.now());
    table.string('usuarioAlta', 15).nullable();
    table.dateTime('fechaDebito').nullable();
    table.string('usuarioDebito', 15).nullable();
    table.dateTime('fechaAnulacion').nullable();
    table.string('observaciones', 255).nullable();
    table.index(['estado', 'fechaPago'], 'ix_cheques_emitidos_estado_fechapago');
  });

  // Unicidad (banco, número) SOLO entre cheques vigentes. Si fuera unique sobre `numero` a secas, un
  // cheque ANULADO (pago revertido) bloquearía para siempre volver a cargar el mismo cheque físico.
  // numeroVigente vale NULL cuando el cheque está ANULADO y MySQL permite varios NULL en un UNIQUE.
  // Requiere MySQL 5.7+ (columnas generadas).
  await knex.raw(`
    ALTER TABLE cheques_emitidos
      ADD COLUMN numeroVigente VARCHAR(30) GENERATED ALWAYS AS (IF(estado = 'ANULADO', NULL, numero)) STORED AFTER numero,
      ADD UNIQUE KEY uq_cheques_emitidos_vigente (idFondoBanco, numeroVigente)
  `);

  // Vínculo pierna de pago <-> instrumento. En la pierna (y no solo en el cheque) porque los reversos
  // (RevertirPagoProveedor, Compras.Eliminar) ya iteran piernas.
  //   CHEQUE_PROPIO -> exactamente un idChequeEmitido
  //   CHEQUE        -> exactamente un idValorAcreditar (monto = valores_acreditar.monto)
  // idValorAcreditar es BIGINT con signo, igual que valores_acreditar.id.
  await knex.schema.table('compras_metodos_pago', function (table) {
    table.bigInteger('idChequeEmitido').unsigned().nullable();
    table.bigInteger('idValorAcreditar').nullable();
  });
  await knex.schema.table('compras_pagos_proveedor_metodos', function (table) {
    table.bigInteger('idChequeEmitido').unsigned().nullable();
    table.bigInteger('idValorAcreditar').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.table('compras_pagos_proveedor_metodos', function (table) {
    table.dropColumn('idChequeEmitido');
    table.dropColumn('idValorAcreditar');
  });
  await knex.schema.table('compras_metodos_pago', function (table) {
    table.dropColumn('idChequeEmitido');
    table.dropColumn('idValorAcreditar');
  });
  await knex.schema.dropTableIfExists('cheques_emitidos');
  await knex('metodos_pago').where({ tipo: 'CHEQUE_PROPIO' }).del();
  const puente = await knex('fondos').where({ nombre: NOMBRE_FONDO_PUENTE }).first();
  if (puente) await knex('caja_fondos').where({ idFondo: puente.id }).del();
  await knex('fondos').where({ nombre: NOMBRE_FONDO_PUENTE }).del();
  await knex.schema.table('valores_acreditar', function (table) {
    table.dropColumn('fechaEndoso');
    table.dropColumn('usuarioEndoso');
    table.dropColumn('idProveedorEndoso');
  });
  // Los cuatro fallan a propósito si quedaron filas con los valores nuevos (en vez de truncarlas).
  await quitarValorEnum(knex, 'valores_acreditar', 'estado', 'ENDOSADO');
  await quitarValorEnum(knex, 'movimientos_fondos', 'tipoReferencia', 'CHEQUE_EMITIDO');
  await quitarValorEnum(knex, 'movimientos_fondos', 'origen', 'DEBITO_CHEQUE_PROPIO');
  await quitarValorEnum(knex, 'metodos_pago', 'tipo', 'CHEQUE_PROPIO');
};
