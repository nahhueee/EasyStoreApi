/**
 * Estados de una fila de `fe_emisiones` (F3 - HANDOFF blindaje facturacion y logs, sec. 2
 * y F3.2). Cada intento de pedirle un CAE a ARCA se registra en `fe_emisiones` ANTES de
 * llamar a `createVoucher` (regla del handoff: "nunca se pide un CAE a ARCA sin haber
 * guardado antes, de forma durable y fuera de la transaccion de la venta, que se va a
 * pedir"). No cambiar estos valores sin migracion: se persisten en la columna ENUM
 * `fe_emisiones.estado`.
 *
 * | Estado | Significado | Que hace el sistema | Bloquea el talonario? |
 * |---|---|---|---|
 * | PENDIENTE | Se reservo el numero y se esta por pedir el CAE, o se esta pidiendo. | Estado normal, dura segundos. | Si, mientras dura |
 * | APROBADO | ARCA dio CAE y la venta quedo registrada. | Nada. | No |
 * | RECHAZADO | ARCA rechazo. El numero NO se consumio. | Rollback completo, el stock no se toca. | No |
 * | INCIERTO | Se mando a ARCA y no hubo respuesta (timeout o corte). No se sabe si existe. | Consulta getVoucherInfo(nro): si existe, pasa a APROBADO; si ARCA confirma que no (ultimo == nro-1), a RECHAZADO; si ARCA sigue caido, queda asi. | Si, hasta reconciliarlo |
 * | APROBADO_SIN_REGISTRAR | ARCA dio CAE pero fallo el guardado de la venta. El comprobante es real. | Queda el payload completo para "Regularizar" sin volver a llamar a ARCA. | No (la correlatividad lo cuenta como emitido) |
 * | REGULARIZADO | Era APROBADO_SIN_REGISTRAR o INCIERTO y se registro despues. El stock puede haber quedado negativo, con aviso. | Auditoria: quien y cuando. | No |
 *
 * Regla que tiene que cumplirse siempre: nunca se pide un CAE a ARCA sin haber guardado
 * antes, de forma durable y fuera de la transaccion de la venta, que se va a pedir.
 */
export enum EstadoEmision {
  PENDIENTE = 'PENDIENTE',
  APROBADO = 'APROBADO',
  RECHAZADO = 'RECHAZADO',
  INCIERTO = 'INCIERTO',
  APROBADO_SIN_REGISTRAR = 'APROBADO_SIN_REGISTRAR',
  REGULARIZADO = 'REGULARIZADO',
}

/**
 * Estados de `fe_emisiones` que bloquean el talonario (impiden una nueva emision hasta
 * resolverse). Ver F3.3: un PENDIENTE de mas de 2 minutos o un INCIERTO disparan la
 * reconciliacion de F1.4 antes de permitir facturar de nuevo.
 */
export const ESTADOS_EMISION_BLOQUEAN: EstadoEmision[] = [
  EstadoEmision.PENDIENTE,
  EstadoEmision.INCIERTO,
];

/**
 * Estados que cuentan como "numero realmente consumido" para calcular el ultimo
 * comprobante local (F3.3, reemplaza el join contra ventas_factura de F1.2/ObtenerUltimoTicketLocal).
 */
export const ESTADOS_EMISION_CONSUMEN_NUMERO: EstadoEmision[] = [
  EstadoEmision.APROBADO,
  EstadoEmision.APROBADO_SIN_REGISTRAR,
  EstadoEmision.REGULARIZADO,
];
