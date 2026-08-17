// Siembra el tope minimo/maximo (%) del descuento editable por item de Lista 3.0
// (ver LISTA_PRECIO_CONFIG / descuentoListaEditableMin-Max en
// addmod-ventas.component.ts). No es un cambio de esquema: `parametros` ya existe
// como tabla generica clave/valor (sin PK) - esta migracion solo agrega las 2 filas
// que la lee en runtime (ObtenerTopeDescuentoListaEditable), con los defaults
// DESCUENTO_LISTA_EDITABLE_MIN_DEFAULT/MAX_DEFAULT (venta.constants.ts) como
// respaldo si por lo que sea no estan sembradas.
//
// Guard NOT EXISTS en vez de INSERT IGNORE / ON DUPLICATE KEY porque `parametros`
// no tiene PK ni UNIQUE sobre `clave` - sin el guard, correr esta migracion dos
// veces (ej. rebuild de un ambiente) duplicaria las filas.
//
// Reemplaza al script suelto "Seed parametros descuento Lista 3.0 - ago-2026.sql"
// (mismo contenido, ahora versionado como migracion real en vez de correrse a
// mano). Si esa migracion ya se corrio a mano en algun ambiente, este `up` es
// no-op ahi gracias al mismo guard.
//
// Para cambiar el rango despues (el usuario aviso que "puede cambiar"), no hace
// falta otra migracion: alcanza un UPDATE directo sobre `parametros`.
exports.up = function (knex) {
  return knex.raw(`
    INSERT INTO parametros (clave, valor)
    SELECT 'descuentoLista3Min', '10'
    WHERE NOT EXISTS (SELECT 1 FROM parametros WHERE clave = 'descuentoLista3Min')
  `).then(() =>
    knex.raw(`
      INSERT INTO parametros (clave, valor)
      SELECT 'descuentoLista3Max', '50'
      WHERE NOT EXISTS (SELECT 1 FROM parametros WHERE clave = 'descuentoLista3Max')
    `)
  );
};

exports.down = function (knex) {
  return knex('parametros')
    .whereIn('clave', ['descuentoLista3Min', 'descuentoLista3Max'])
    .del();
};
