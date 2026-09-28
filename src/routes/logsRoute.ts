import { Router, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import jwt from 'jsonwebtoken';
import { logger } from '../logger/logger';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requiereRol } from '../middlewares/rolMiddleware';
import config from '../conf/app.config';

const router: Router = Router();

interface EntradaLog {
  timestamp: string;
  level: string;
  code?: string;
  message: string;
  severity?: string;
  type?: string;
  route?: string;
  method?: string;
  status?: number;
  requestId?: string;
  context?: Record<string, any>;
  cause?: string;
  stack?: string;
}

// Lee todas las líneas del error.log y las parsea.
// F2 - HANDOFF blindaje facturacion y logs: la pantalla de Errores muestra
// específicamente errores (nivel 'error'), que es lo único que escribe este
// archivo (ver logger.ts, transport con level:'error'). app.log queda para
// trazabilidad general (info/warn/error) y no se expone por esta ruta.
async function leerEntradas(): Promise<EntradaLog[]> {
  const rutaLog = path.resolve(__dirname, '../log/error.log');

  if (!fs.existsSync(rutaLog)) return [];

  const fileStream = fs.createReadStream(rutaLog);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const entradas: EntradaLog[] = [];

  for await (const linea of rl) {
    try {
      const log = JSON.parse(linea);
      entradas.push({
        timestamp:  log.timestamp,
        level:      log.level,
        code:       log.code,
        message:    log.message,
        severity:   log.severity,
        type:       log.type,
        route:      log.route,
        method:     log.method,
        status:     log.status,
        requestId:  log.requestId,
        context:    log.context,
        cause:      log.cause ?? log.context?.cause,
        stack:      log.stack,
      });
    } catch {
      // línea no parseable (ej: cortada por una rotación en curso) — se ignora
    }
  }

  return entradas;
}

// GET /logs — devuelve entradas con soporte de filtros y paginación.
// Query params: limit, offset, severity (CRITICA|ALTA|MEDIA|BAJA, admite varias
// separadas por coma), code, requestId (busqueda exacta, para el "Ref:" que ve
// el usuario en el toast de error).
//
// F2 - HANDOFF blindaje facturacion y logs: la pantalla de Administración no
// tiene hoy una restricción de rol propia (main-administracion es una grilla de
// cards accesible a cualquier usuario autenticado), así que acá solo exigimos
// sesión iniciada (authMiddleware), no rol ADMINISTRADOR — eso queda reservado
// para el DELETE, que es la acción destructiva. Si en el futuro se decide que
// "Errores" sea solo para ADMINISTRADOR, agregar requiereRol('ADMINISTRADOR')
// acá también.
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  ?? 50), 10), 200);
    const offset = parseInt(String(req.query.offset ?? 0), 10);
    const severityFiltro = req.query.severity  ? String(req.query.severity).toUpperCase().split(',') : [];
    const codeFiltro     = req.query.code      ? String(req.query.code).toUpperCase() : '';
    const requestIdFiltro = req.query.requestId ? String(req.query.requestId).toUpperCase() : '';

    let entradas = await leerEntradas();

    // Más recientes primero
    entradas.reverse();

    if (severityFiltro.length > 0) {
      entradas = entradas.filter(e => {
        if (severityFiltro.includes('SIN_CODIGO') && !e.code) return true;
        return !!e.severity && severityFiltro.includes(e.severity.toUpperCase());
      });
    }

    if (codeFiltro) {
      entradas = entradas.filter(e => e.code?.toUpperCase() === codeFiltro);
    }

    if (requestIdFiltro) {
      entradas = entradas.filter(e => e.requestId?.toUpperCase() === requestIdFiltro);
    }

    res.json({
      total: entradas.length,
      datos: entradas.slice(offset, offset + limit),
    });

  } catch (error) {
    next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al leer el log de errores', 500, { modulo: 'logsRoute', metodo: 'GET /' }, error));
  }
});

// DELETE /logs — limpia el error.log. Acción destructiva: solo ADMINISTRADOR
// (handoff F2.1, explícito).
router.delete('/', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rutaLog = path.resolve(__dirname, '../log/error.log');

    // Truncamos el archivo preservando la ruta — Winston sigue escribiendo
    // en el mismo file descriptor.
    fs.writeFileSync(rutaLog, '');

    res.json('OK');

  } catch (error) {
    next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al limpiar el log de errores', 500, { modulo: 'logsRoute', metodo: 'DELETE /' }, error));
  }
});

// POST /logs/front — recibe errores capturados por GlobalErrorHandlerService
// (excepciones de JS/framework, NO respuestas HTTP: esas ya quedan logueadas
// server-side por errorMiddleware cuando ocurren).
//
// Se deja SIN authMiddleware a propósito: un error de JS puede ocurrir antes
// de loguearse (pantalla de login, token vencido) y ese caso es justamente el
// que más interesa poder ver. Si viene un Bearer token válido lo decodificamos
// para trazabilidad (quién estaba logueado), pero su ausencia o invalidez
// nunca bloquea el reporte del error.
//
// Devolvemos 201 y no delegamos a errorMiddleware: esto no es un error de
// ESTE request, es el ack de que se registró el error del cliente.
router.post('/front', (req: Request, res: Response) => {
  const { message, context, stack } = req.body ?? {};

  if (!message || typeof message !== 'string') {
    res.status(400).json({ message: 'message es requerido' });
    return;
  }

  let usuario: { id: number; usuario: string } | undefined;
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.substring(7) : null;
  if (token) {
    try {
      const payload: any = jwt.verify(token, config.jwtSecret);
      usuario = { id: payload.id, usuario: payload.usuario };
    } catch {
      // token vencido/invalido - no bloquea el reporte, solo queda sin trazar el usuario
    }
  }

  logger.error({
    type:    'FRONT_ERROR',
    code:    CodigoError.FRONT_ERROR,
    message,
    context: { ...(context ?? {}), usuario },
    stack:   typeof stack === 'string' ? stack : undefined,
  });

  res.status(201).json({ ok: true });
});

// Export the router
export default router;
