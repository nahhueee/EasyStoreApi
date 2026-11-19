// Motivos de un comprobante "sin productos o servicios" (19-nov-2026). Ver HANDOFF-abm-catalogos-y-motivos.md, F1.
//
// Hasta hoy la lista vivía hardcodeada en dos constantes espejo (una en ventaEstados.ts del backend y otra en
// venta.constants.ts del front), compartida por la Factura de adelanto y la NC X. Pasa a una tabla con ABM en
// Administración > Catálogos, para que sumar un motivo no requiera un deploy.
//
//  - descripcion: el texto que se guarda tal cual en ventas.observacion. El cruce con las ventas es POR TEXTO
//    (ventasAdelantos.ts > SQL_ES_ADELANTO), por eso el seed lleva el texto idéntico a las constantes viejas,
//    acentos incluidos, y por eso el backend bloquea renombrar un motivo que ya se usó.
//  - orden: orden de aparición en los selectores.
//  - fechaBaja/usuarioBaja: baja lógica (nunca DELETE físico). Un motivo dado de baja deja de ofrecerse, pero
//    sigue identificando a los adelantos históricos.
//
// Collation: descripcion se cruza columna contra columna con ventas.observacion (IN (SELECT descripcion ...)).
// Si la tabla nueva quedara con otra collation (ej. la default de la base, utf8mb4), el cruce puede tirar
// "Illegal mix of collations" o cambiar la sensibilidad a acentos/mayúsculas. Por eso se leen el charset y la
// collation de ventas.observacion y se usan los mismos.
//
// "Chomba" NO va en el seed: lo carga el cliente desde el ABM.
//
// Idempotente: crea la tabla solo si no existe y siembra solo los motivos que falten.
// down: borra la tabla entera, incluidos los motivos que se hayan cargado desde el ABM después del seed.

const MOTIVOS_INICIALES = [
  'Adelanto de producción',
  'Saldo orden de compra',
  'Embajadores-premios',
  'Camisas',
];

// charset y collation de la columna contra la que se cruza. Se valida el formato porque se concatenan en el DDL.
async function charsetDeObservacion(knex) {
  const [filas] = await knex.raw(
    `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS col
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ventas' AND COLUMN_NAME = 'observacion'`
  );
  const fila = filas && filas[0];
  if (!fila || !/^[a-z0-9_]+$/i.test(fila.cs) || !/^[a-z0-9_]+$/i.test(fila.col)) {
    throw new Error('No se pudo leer el charset/collation de ventas.observacion: no se crea motivos_sin_productos.');
  }
  return { charset: fila.cs, collation: fila.col };
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('motivos_sin_productos'))) {
    const { charset, collation } = await charsetDeObservacion(knex);

    await knex.raw(`
      CREATE TABLE motivos_sin_productos (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        descripcion VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NOT NULL,
        orden INT NOT NULL DEFAULT 0,
        fechaBaja DATETIME NULL,
        usuarioBaja VARCHAR(15) NULL,
        UNIQUE KEY uq_motivos_sp_descripcion (descripcion)
      ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${collation}
    `);
  }

  for (let i = 0; i < MOTIVOS_INICIALES.length; i++) {
    const descripcion = MOTIVOS_INICIALES[i];
    const existe = await knex('motivos_sin_productos').where('descripcion', descripcion).first();
    if (!existe) await knex('motivos_sin_productos').insert({ descripcion, orden: i + 1 });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('motivos_sin_productos');
};
