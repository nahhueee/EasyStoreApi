// Completa métodos de pago faltantes para las empresas 4, 5, 6, 7.
//
// Estas empresas ya tenían CREDITO/DEBITO/TRANSFERENCIA por banco (Santander/BBVA) y
// CUENTA_CORRIENTE_PROVEEDOR / SALDO_FAVOR_PROVEEDOR (migración 20260623120000), pero
// nunca se les cargó EFECTIVO, CHEQUE, CUENTA_CORRIENTE (cliente) ni SALDO_FAVOR (cliente).
// La empresa 1 sí los tiene (ids 11, 82, 12, 13 respectivamente).
//
// No hay ABM de métodos de pago (confirmado en 20260623120000_create_cc_proveedores.js),
// así que este insert es manual, igual que los anteriores.
//
// idFondo: se reutilizan los MISMOS fondos globales que ya usa la empresa 1 para estos tipos
// (fondos no son por-empresa, ver ejemplo de Santander/BBVA compartiendo idFondo entre 1,4,5,6,7).
//   EFECTIVO           -> idFondo 1  (Efectivo)
//   CHEQUE             -> idFondo 10 (Cheque)
//   CUENTA_CORRIENTE   -> idFondo 4  (Cuenta Corriente)
//   SALDO_FAVOR        -> idFondo 5  (Saldo a Favor)
//
// IMPORTANTE antes de correr en la base real: verificar que no existan ya filas de estos
// tipos para las empresas 4,5,6,7, para no duplicar:
//   SELECT * FROM metodos_pago WHERE idEmpresa IN (4,5,6,7)
//     AND tipo IN ('EFECTIVO','CHEQUE','CUENTA_CORRIENTE','SALDO_FAVOR');

const EMPRESAS = [4, 5, 6, 7];

const METODOS = [
  { idFondo: 1, tipo: 'EFECTIVO', nombre: 'Efectivo' },
  { idFondo: 10, tipo: 'CHEQUE', nombre: 'Cheque' },
  { idFondo: 4, tipo: 'CUENTA_CORRIENTE', nombre: 'Cuenta Corriente' },
  { idFondo: 5, tipo: 'SALDO_FAVOR', nombre: 'Saldo a Favor' },
];

exports.up = function (knex) {
  const filas = [];
  for (const idEmpresa of EMPRESAS) {
    for (const m of METODOS) {
      filas.push({
        idEmpresa,
        idFondo: m.idFondo,
        tipo: m.tipo,
        nombre: m.nombre,
      });
    }
  }

  // Evita duplicados si la migración se corre más de una vez o si alguna fila ya existía.
  return knex('metodos_pago')
    .whereIn('idEmpresa', EMPRESAS)
    .whereIn('tipo', METODOS.map((m) => m.tipo))
    .then((existentes) => {
      const yaExiste = (idEmpresa, tipo) =>
        existentes.some((e) => e.idEmpresa === idEmpresa && e.tipo === tipo);

      const aInsertar = filas.filter((f) => !yaExiste(f.idEmpresa, f.tipo));
      if (!aInsertar.length) return null;
      return knex('metodos_pago').insert(aInsertar);
    });
};

exports.down = function (knex) {
  return knex('metodos_pago')
    .whereIn('idEmpresa', EMPRESAS)
    .whereIn('tipo', METODOS.map((m) => m.tipo))
    .del();
};
