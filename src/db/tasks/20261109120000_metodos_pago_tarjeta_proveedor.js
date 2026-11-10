// Pago con tarjeta (crédito / débito) a proveedores, en Compras y en Pagar a Proveedor (9-nov-2026).
//
// Decisión del cliente: estos pagos NO deben verse en Fondos. Por eso el tipo nuevo TARJETA_PROVEEDOR no genera
// movimientos_fondos (ni al pagar ni al revertir): el código lo saltea explícitamente (ver
// comprasCuentasRepository.MetodoMueveFondo). Quedan registrados igual en compras_metodos_pago /
// compras_pagos_proveedor_metodos, así que se ven en el ledger, el detalle y la Orden de Pago.
//
// metodos_pago.idFondo es NOT NULL y varios JOIN a fondos son INNER, así que cada método apunta a un fondo
// "placeholder" oculto (mostrar = 0, sin vincular a ninguna caja): nunca recibe movimientos.
//
// No hay ABM de métodos de pago: una empresa nueva necesita este insert manual (igual que el resto).
// Idempotente. Se usan dos filas por empresa (crédito y débito) con el mismo tipo; las distingue el nombre.

const NOMBRE_FONDO = 'Tarjeta (Proveedores)';
const NOMBRES_METODOS = ['Tarjeta de crédito', 'Tarjeta de débito'];

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
  await agregarValorEnum(knex, 'metodos_pago', 'tipo', 'TARJETA_PROVEEDOR');

  // fondos.tipo es varchar: no necesita ALTER. permiteNegativo = 1 por las dudas (nunca recibe movimientos).
  let fondo = await knex('fondos').where({ tipo: 'TARJETA_PROVEEDOR' }).first();
  let idFondo;
  if (fondo) {
    idFondo = fondo.id;
  } else {
    [idFondo] = await knex('fondos').insert({
      nombre: NOMBRE_FONDO,
      tipo: 'TARJETA_PROVEEDOR',
      activo: 1,
      permiteNegativo: 1,
      icono: 'pi pi-credit-card',
      mostrar: 0
    });
  }

  const empresas = await knex('empresas').select('id');
  const existentes = await knex('metodos_pago').where({ tipo: 'TARJETA_PROVEEDOR' }).select('idEmpresa', 'nombre');
  const yaExiste = (idEmpresa, nombre) => existentes.some((e) => e.idEmpresa === idEmpresa && e.nombre === nombre);

  const filas = [];
  for (const e of empresas) {
    for (const nombre of NOMBRES_METODOS) {
      if (!yaExiste(e.id, nombre)) filas.push({ idEmpresa: e.id, idFondo, tipo: 'TARJETA_PROVEEDOR', nombre });
    }
  }
  if (filas.length) await knex('metodos_pago').insert(filas);
};

exports.down = async function (knex) {
  await knex('metodos_pago').where({ tipo: 'TARJETA_PROVEEDOR' }).del();
  await quitarValorEnum(knex, 'metodos_pago', 'tipo', 'TARJETA_PROVEEDOR');
  await knex('fondos').where({ tipo: 'TARJETA_PROVEEDOR' }).del();
};
