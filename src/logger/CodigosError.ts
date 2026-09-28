export enum CodigoError {
  ADMIN_SERVER_ERROR = 'ADMIN_SERVER_ERROR',
  APPCLIENTE_CREACION_ERROR = 'APPCLIENTE_CREACION_ERROR',

  VALIDACION = 'VALIDACION',
  TERMINAL_NO_ENCONTRADA = 'TERMINAL_NO_ENCONTRADA',

  CERTIFICADOS = 'CERTIFICADOS',

  AFIP_TIMEOUT = 'AFIP_TIMEOUT',
  AFIP_NO_DISPONIBLE = 'AFIP_NO_DISPONIBLE',
  AFIP_ERROR = 'AFIP_ERROR',
  AFIP_RECHAZO = 'AFIP_RECHAZO',
  QR_ERROR = 'QR_ERROR',

  AUTH_NO_HABILITADO = 'AUTH_NO_HABILITADO',

  // Entorno de ejecucion (NODE_ENV / config.produccion / parametro 'entorno' en DB)
  // inconsistente. Bloquea la facturacion (fail-closed) sin tirar el proceso.
  ENTORNO_INVALIDO = 'ENTORNO_INVALIDO',

  // F1 - HANDOFF blindaje facturacion y logs
  CORRELATIVIDAD_ARCA = 'CORRELATIVIDAD_ARCA',
  FACTURACION_EN_CURSO = 'FACTURACION_EN_CURSO',
  COMPROBANTE_INCIERTO = 'COMPROBANTE_INCIERTO',
  COMPROBANTE_RECUPERADO = 'COMPROBANTE_RECUPERADO',
  NETO_DESCALCE = 'NETO_DESCALCE',
  STOCK_INSUFICIENTE = 'STOCK_INSUFICIENTE',

  // F2 - HANDOFF blindaje facturacion y logs. Errores de JS/runtime capturados
  // en el frontend por GlobalErrorHandlerService y reportados via POST /logs/front.
  FRONT_ERROR = 'FRONT_ERROR',

  NOT_FOUND = 'NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

// F2 - HANDOFF blindaje facturacion y logs.
//
// Severidad de negocio por codigo de error, independiente del status HTTP.
// Un 400 de VALIDACION no es lo mismo que un 500 de COMPROBANTE_INCIERTO: el primero
// es ruido esperado (usuario cargo mal un dato), el segundo es una alerta que puede
// requerir intervencion manual en ARCA. El status HTTP solo dice "que le respondo al
// front"; esta tabla dice "que tan grave es esto para el negocio".
//
// Orden de severidad: CRITICA > ALTA > MEDIA > BAJA.
export type Severidad = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

export const SEVERIDAD: Record<CodigoError, Severidad> = {
  // Codigos legacy sin call sites conocidos (confirmado por grep en src/, F2).
  // Se les asigna una severidad razonable solo para satisfacer la exhaustividad
  // del Record<CodigoError, Severidad>; si en el futuro se detecta un uso real,
  // revisar el valor acorde al caso.
  ADMIN_SERVER_ERROR: 'ALTA',
  APPCLIENTE_CREACION_ERROR: 'ALTA',

  VALIDACION: 'BAJA',
  TERMINAL_NO_ENCONTRADA: 'MEDIA',

  CERTIFICADOS: 'CRITICA',

  AFIP_TIMEOUT: 'ALTA',
  AFIP_NO_DISPONIBLE: 'ALTA',
  AFIP_ERROR: 'ALTA',
  AFIP_RECHAZO: 'MEDIA',
  QR_ERROR: 'BAJA',

  AUTH_NO_HABILITADO: 'MEDIA',

  // Bloquea toda la facturacion hasta que se corrija el parametro de entorno.
  ENTORNO_INVALIDO: 'CRITICA',

  // F1 - HANDOFF blindaje facturacion y logs
  // Descalce entre el ultimo comprobante local y el ultimo autorizado por ARCA:
  // puede ser el sintoma de un CAE huerfano. Requiere revision.
  CORRELATIVIDAD_ARCA: 'CRITICA',
  // Lock ocupado, otra facturacion en curso para el mismo talonario: transitorio,
  // se resuelve solo con el reintento del usuario.
  FACTURACION_EN_CURSO: 'BAJA',
  // getVoucherInfo no pudo confirmar si el comprobante se emitio o no tras un timeout:
  // el caso mas delicado, requiere revision manual en ARCA antes de reintentar.
  COMPROBANTE_INCIERTO: 'CRITICA',
  // Igual que arriba pero la reconciliacion automatica encontro el comprobante:
  // se resolvio solo, pero queda registro por si el patron se repite.
  COMPROBANTE_RECUPERADO: 'ALTA',
  // Diferencia entre el neto calculado y el informado a ARCA: no bloquea, pero
  // amerita revision de redondeos/alicuotas si se repite.
  NETO_DESCALCE: 'MEDIA',
  STOCK_INSUFICIENTE: 'BAJA',

  // F2 - HANDOFF blindaje facturacion y logs
  FRONT_ERROR: 'MEDIA',

  NOT_FOUND: 'BAJA',
  INTERNAL_ERROR: 'ALTA'
};
