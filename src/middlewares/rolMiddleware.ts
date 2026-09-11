import { Request, Response, NextFunction } from 'express';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

// Debe usarse siempre después de authMiddleware (necesita req.usuario ya cargado).
// Uso: router.put('/ruta', authMiddleware, requiereRol('ADMINISTRADOR', 'ENCARGADO'), handler)
export function requiereRol(...rolesPermitidos: string[]) {
    const permitidos = rolesPermitidos.map(r => r.toUpperCase());

    return (req: Request, res: Response, next: NextFunction) => {
        const cargo = req.usuario?.cargo?.toUpperCase();

        if (!cargo || !permitidos.includes(cargo)) {
            return next(new AppError(CodigoError.AUTH_NO_HABILITADO, 'No tiene permisos para realizar esta acción.', 403));
        }

        next();
    };
}
