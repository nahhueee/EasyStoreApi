import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../conf/app.config';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

// Payload que viaja en el token, generado en el login (usuariosRoute.ts).
export interface UsuarioToken {
    id: number;
    usuario: string;
    nombre: string;
    idCargo: number;
    cargo: string;
}

declare global {
    namespace Express {
        interface Request {
            usuario?: UsuarioToken;
        }
    }
}

// Reemplaza al viejo SesionServ.LeerSesion() (archivo de sesión único en el
// servidor, se pisaba con el último login). Cada request se identifica a sí
// mismo con su propio token, sin estado compartido en el server.
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.substring(7) : null;

    if (!token) {
        return next(new AppError(CodigoError.AUTH_NO_HABILITADO, 'No se encontró el token de autenticación. Inicie sesión.', 401));
    }

    try {
        req.usuario = jwt.verify(token, config.jwtSecret) as UsuarioToken;
        next();
    } catch (error) {
        next(new AppError(CodigoError.AUTH_NO_HABILITADO, 'Token inválido o expirado. Inicie sesión nuevamente.', 401));
    }
}
