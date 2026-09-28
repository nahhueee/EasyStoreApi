import winston from 'winston';
import path from 'path';
import { SEVERIDAD, CodigoError } from './CodigosError';

const timezoned = () =>
  new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}] ${message}`;
});

// F2 - HANDOFF blindaje facturacion y logs.
//
// Normaliza el patrón `logger.error({ code, message, ... })`: Winston trata el
// primer argumento de logger[level]() como info.message, así que si se le pasa
// un objeto plano en vez de un string, el objeto queda serializado como
// "message": { ... } y todos los campos quedan enterrados ahí adentro. Este
// format extrae las propiedades del objeto al nivel raíz.
//
// De paso, auto-inyecta severity (CRITICA/ALTA/MEDIA/BAJA) desde el mapa
// SEVERIDAD cuando el log trae un `code` y no una severity explícita, para que
// ningún call site tenga que acordarse de setearla a mano (y no pueda
// desincronizarse del mapa).
const extraerCamposDeMessage = winston.format((info) => {
  if (info.message !== null && typeof info.message === 'object') {
    const { message: msg, ...campos } = info.message as Record<string, unknown>;
    Object.assign(info, { message: msg ?? '', ...campos });
  }

  if (info.code && !info.severity) {
    info.severity = SEVERIDAD[info.code as CodigoError] ?? undefined;
  }

  return info;
})();

// F2 - HANDOFF blindaje facturacion y logs.
// Bug previo: comparaba contra 'production', pero este proyecto usa NODE_ENV='prod'
// (ver app.config.ts / facturacionService.VerificarEntorno). Con el bug, el nivel
// quedaba siempre en 'debug' incluso en produccion.
const esProduccion = process.env.NODE_ENV === 'prod';

// F2 - HANDOFF blindaje facturacion y logs.
// Rotacion de archivos: sin esto, error.log crece indefinidamente (ya llego a >120KB
// en homologacion en pocas semanas). maxsize/maxFiles/tailable rotan cuando el archivo
// activo supera el tamaño, conservando hasta maxFiles anteriores; tailable mantiene
// siempre el archivo mas reciente con el nombre base (sin sufijo numerico).
const ROTACION = {
  maxsize: 5 * 1024 * 1024, // 5MB
  maxFiles: 5,
  tailable: true
};

export const logger = winston.createLogger({
  level: esProduccion ? 'info' : 'debug',

  format: winston.format.combine(
    extraerCamposDeMessage,
    winston.format.timestamp({ format: timezoned }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),

  transports: [

    // consola (solo mensaje)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }),
        consoleFormat
      )
    }),

    // archivo error.log (json completo) - solo nivel 'error'. Es lo que lee
    // logsRoute.ts para la pantalla de Errores.
    new winston.transports.File({
      filename: path.resolve(__dirname, '../log/error.log'),
      level: 'error',
      ...ROTACION
    }),

    // F2 - HANDOFF blindaje facturacion y logs.
    // archivo app.log (json completo) - info/warn/error. Trazabilidad general
    // (arranque del server, descalces que solo advierten, etc.) que no llega
    // a ser un error de negocio; no se expone por logsRoute.ts.
    new winston.transports.File({
      filename: path.resolve(__dirname, '../log/app.log'),
      level: 'info',
      ...ROTACION
    }),
  ]
});
