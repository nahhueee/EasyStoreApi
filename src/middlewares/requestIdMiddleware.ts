import crypto from 'crypto';

declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}

// F1.7 - HANDOFF blindaje facturacion y logs. Identificador corto por request, para
// poder correlacionar "lo que ve el usuario" (Ref: XXXX en el mensaje de error) con
// la entrada correspondiente en error.log, sin depender de AsyncLocalStorage.
export function requestIdMiddleware(req, res, next) {
    req.requestId = crypto.randomBytes(4).toString('hex').toUpperCase();
    res.setHeader('X-Request-Id', req.requestId);
    next();
}
