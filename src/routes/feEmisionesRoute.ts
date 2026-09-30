// F4.3 - HANDOFF blindaje facturacion y logs. Pantalla "Pendientes fiscales"
// (Administracion, solo ADMINISTRADOR): listar y resolver filas de fe_emisiones que
// quedaron sin registrar (INCIERTO, APROBADO_SIN_REGISTRAR, o APROBADO con idVenta
// NULL - ver comentarios en feEmisionesRepository.ts).
import { FeEmisionesRepo } from '../data/feEmisionesRepository';
import { FacturacionServ } from '../services/facturacionService';
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requiereRol } from '../middlewares/rolMiddleware';

const router: Router = Router();

router.get('/', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await FeEmisionesRepo.ObtenerPendientes());
    } catch (error) {
        next(error);
    }
});

router.get('/historial', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await FeEmisionesRepo.ObtenerHistorialRegularizados());
    } catch (error) {
        next(error);
    }
});

router.post('/:id/verificar', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await FacturacionServ.VerificarEnArca(Number(req.params.id), req.requestId));
    } catch (error) {
        next(error);
    }
});

router.post('/:id/regularizar', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        const { motivo } = req.body;
        res.json(await FacturacionServ.Regularizar(Number(req.params.id), motivo, req.usuario?.usuario ?? '', req.requestId));
    } catch (error) {
        next(error);
    }
});

export default router;
