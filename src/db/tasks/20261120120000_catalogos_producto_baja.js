// Baja lógica + descripción única para los catálogos de producto de F2 (20-nov-2026).
// Ver HANDOFF-abm-catalogos-y-motivos.md, F2. En la UI: tipos_producto = "Producto", subtipos_producto = "Tipo".
//
//  - fechaBaja/usuarioBaja: baja lógica (nunca DELETE físico). Un registro dado de baja deja de ofrecerse en el
//    alta/edición de productos, pero los productos que ya lo usan lo conservan (referencian por id).
//  - UNIQUE sobre descripcion: la collation de las columnas (utf8mb3_general_ci) no distingue mayúsculas ni
//    espacios al borde, así que "Campera" y "CAMPERA " cuentan como duplicado.
//
// CAMPERA duplicada: en producción existen tipos_producto 17 (8 productos) y 25 (0 productos). Darla de baja
// NO alcanza para crear el UNIQUE (la fila baja sigue existiendo y choca), por eso la 25 se renombra a
// "CAMPERA (DUPLICADA 25)" y recién después se da de baja. Solo si no tiene productos: si los tuviera, la
// migración aborta sin tocar nada.
//
// Orden: primero los chequeos de solo lectura; si algo no cierra, aborta antes del primer ALTER.
// Idempotente: se puede volver a correr (agrega solo lo que falta).
// down: quita los UNIQUE y las columnas de baja, y deja la id 25 con su descripción original.

const TABLAS = ['tipos_producto', 'subtipos_producto', 'temporadas', 'generos'];
const ID_CAMPERA_DUPLICADA = 25;
const DESCRIPCION_ORIGINAL = 'CAMPERA';
const DESCRIPCION_RENOMBRADA = 'CAMPERA (DUPLICADA 25)';
const USUARIO_MIGRACION = 'MIGRACION';

const nombreIndice = (tabla) => `uq_${tabla}_descripcion`;

async function columnaExiste(knex, tabla, columna) {
  return knex.schema.hasColumn(tabla, columna);
}

async function indiceExiste(knex, tabla, indice) {
  const [filas] = await knex.raw(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tabla, indice]
  );
  return filas.length > 0;
}

// Descripciones repetidas (sin distinguir mayúsculas ni espacios al borde). `excluirId` deja afuera una fila.
async function duplicados(knex, tabla, excluirId) {
  const [filas] = await knex.raw(
    `SELECT UPPER(TRIM(descripcion)) AS descripcion, COUNT(*) AS cantidad, GROUP_CONCAT(id ORDER BY id) AS ids
     FROM ?? WHERE descripcion IS NOT NULL ${excluirId ? 'AND id <> ?' : ''}
     GROUP BY UPPER(TRIM(descripcion)) HAVING COUNT(*) > 1`,
    excluirId ? [tabla, excluirId] : [tabla]
  );
  return filas;
}

// ¿Hay que renombrar y dar de baja la CAMPERA duplicada? Solo si la id 25 se llama CAMPERA y hay otra igual.
async function hayCamperaDuplicada(knex) {
  const [filas] = await knex.raw(
    `SELECT t.id FROM tipos_producto t
     WHERE t.id = ? AND UPPER(TRIM(t.descripcion)) = ?
       AND EXISTS (SELECT 1 FROM tipos_producto o WHERE o.id <> t.id AND UPPER(TRIM(o.descripcion)) = ?)`,
    [ID_CAMPERA_DUPLICADA, DESCRIPCION_ORIGINAL, DESCRIPCION_ORIGINAL]
  );
  return filas.length > 0;
}

exports.up = async function (knex) {
  // 1) Chequeos de solo lectura
  const renombrar = await hayCamperaDuplicada(knex);

  if (renombrar) {
    const [uso] = await knex.raw('SELECT COUNT(*) AS c FROM productos WHERE idTipo = ?', [ID_CAMPERA_DUPLICADA]);
    if (Number(uso[0].c) > 0) {
      throw new Error(
        `tipos_producto ${ID_CAMPERA_DUPLICADA} (CAMPERA duplicada) tiene ${uso[0].c} producto(s): no se puede ` +
        'dar de baja sin moverlos antes a la otra CAMPERA. No se modificó nada.'
      );
    }
  }

  const problemas = [];
  for (const tabla of TABLAS) {
    const excluir = renombrar && tabla === 'tipos_producto' ? ID_CAMPERA_DUPLICADA : undefined;
    for (const d of await duplicados(knex, tabla, excluir)) {
      problemas.push(`${tabla}: "${d.descripcion}" repetida en ids ${d.ids}`);
    }
  }
  if (problemas.length > 0) {
    throw new Error(
      'Hay descripciones duplicadas y no se puede crear el UNIQUE. Resolverlas a mano y volver a correr. ' +
      'No se modificó nada. Detalle: ' + problemas.join(' | ')
    );
  }

  // 2) Columnas de baja lógica
  for (const tabla of TABLAS) {
    if (!(await columnaExiste(knex, tabla, 'fechaBaja'))) {
      await knex.raw('ALTER TABLE ?? ADD COLUMN fechaBaja DATETIME NULL', [tabla]);
    }
    if (!(await columnaExiste(knex, tabla, 'usuarioBaja'))) {
      await knex.raw('ALTER TABLE ?? ADD COLUMN usuarioBaja VARCHAR(15) NULL', [tabla]);
    }
  }

  // 3) CAMPERA duplicada: renombrar (para liberar el UNIQUE) y dar de baja
  if (renombrar) {
    await knex.raw(
      'UPDATE tipos_producto SET descripcion = ?, fechaBaja = NOW(), usuarioBaja = ? WHERE id = ?',
      [DESCRIPCION_RENOMBRADA, USUARIO_MIGRACION, ID_CAMPERA_DUPLICADA]
    );
  }

  // 4) UNIQUE sobre la descripción
  for (const tabla of TABLAS) {
    if (!(await indiceExiste(knex, tabla, nombreIndice(tabla)))) {
      await knex.raw('ALTER TABLE ?? ADD UNIQUE KEY ?? (descripcion)', [tabla, nombreIndice(tabla)]);
    }
  }
};

exports.down = async function (knex) {
  for (const tabla of TABLAS) {
    if (await indiceExiste(knex, tabla, nombreIndice(tabla))) {
      await knex.raw('ALTER TABLE ?? DROP INDEX ??', [tabla, nombreIndice(tabla)]);
    }
  }

  // Devuelve la id 25 a su estado original, solo si sigue como la dejó esta migración.
  if (await columnaExiste(knex, 'tipos_producto', 'usuarioBaja')) {
    await knex.raw(
      'UPDATE tipos_producto SET descripcion = ?, fechaBaja = NULL, usuarioBaja = NULL WHERE id = ? AND descripcion = ? AND usuarioBaja = ?',
      [DESCRIPCION_ORIGINAL, ID_CAMPERA_DUPLICADA, DESCRIPCION_RENOMBRADA, USUARIO_MIGRACION]
    );
  }

  for (const tabla of TABLAS) {
    if (await columnaExiste(knex, tabla, 'usuarioBaja')) await knex.raw('ALTER TABLE ?? DROP COLUMN usuarioBaja', [tabla]);
    if (await columnaExiste(knex, tabla, 'fechaBaja')) await knex.raw('ALTER TABLE ?? DROP COLUMN fechaBaja', [tabla]);
  }
};
