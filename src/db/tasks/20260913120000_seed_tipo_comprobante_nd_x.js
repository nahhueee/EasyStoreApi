// Alta del tipo de comprobante 101 (Nota de Débito "X") en `tipos_comprobantes`,
// + normalización de la tilde de la fila 100.
//
// PROBLEMA (detectado sep-2026 en el informe de Ventas para Conciliación, B4-221):
// los 7 registros de NOTA DE DEBITO del período salían con el tipo de comprobante
// vacío. No es un bug de la query: `ventas.idTComprobante = 101` (ND "X", interna,
// no pasa por ARCA - ver nota-debito-x.component.ts) simplemente NO EXISTE en
// `tipos_comprobantes`, así que el LEFT JOIN no matchea y devuelve NULL. La 100
// (NC "X") sí está, por eso esa sí resuelve bien. Confirmado por Nahu: falta tanto
// en test como en producción.
//
// Se corrige en el catálogo y NO con un CASE/IFNULL en el informe: cualquier otra
// query que joinee `tipos_comprobantes` por idTComprobante tiene el mismo agujero,
// y taparlo en un solo reporte lo deja roto en el resto.
//
// cod_arca: se copia el de la fila 100 en vez de escribirlo literal. Las dos son
// comprobantes internos que no van a ARCA, así que el valor correcto para la 101 es
// exactamente el que tenga su hermana - sea NULL o un placeholder. Si la 100 no
// existiera, el subquery devuelve NULL, que también es el valor correcto.
//
// Tilde: la 100 estaba como 'NOTA DE CREDITO X' (sin tilde) mientras las fiscales
// son 'NOTA DE CRÉDITO A/B/C' (con tilde), y eso se veía en el informe como dos
// ortografías distintas en la misma columna. Se normaliza acá.
//
// ATENCIÓN ANTES DE CORRER - verificar que ningún código compare la descripción
// como string literal, o la normalización de la tilde lo rompe en silencio:
//
//   grep -rn "NOTA DE CREDITO X" --include=*.ts --include=*.html EasyStoreApi/src ChazaGolfApp/src
//
// Si aparece algún match, hay que actualizarlo en el mismo commit. Lo correcto es
// comparar por id (100/101), no por descripción.
//
// Idempotente: el INSERT tiene guard NOT EXISTS y el UPDATE filtra por el valor
// viejo, así que correrla dos veces (o sobre un ambiente donde ya se arregló a
// mano) es no-op.

exports.up = function (knex) {
  return knex.raw(`
    INSERT INTO tipos_comprobantes (id, cod_arca, descripcion)
    SELECT
      101,
      (SELECT cod_arca FROM tipos_comprobantes WHERE id = 100),
      'NOTA DE DÉBITO X'
    FROM DUAL
    WHERE NOT EXISTS (SELECT 1 FROM tipos_comprobantes WHERE id = 101)
  `).then(() => knex.raw(`
    UPDATE tipos_comprobantes
      SET descripcion = 'NOTA DE CRÉDITO X'
      WHERE id = 100 AND descripcion = 'NOTA DE CREDITO X'
  `));
};

exports.down = function (knex) {
  return knex.raw(`
    UPDATE tipos_comprobantes
      SET descripcion = 'NOTA DE CREDITO X'
      WHERE id = 100 AND descripcion = 'NOTA DE CRÉDITO X'
  `).then(() => knex.raw(`
    DELETE FROM tipos_comprobantes WHERE id = 101
  `));
};
