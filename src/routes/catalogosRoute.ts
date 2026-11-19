// Catálogos administrables (Administración > Catálogos). Los GET quedan abiertos (los usan los selectores de
// ventas y, más adelante, el form de producto); las escrituras son solo ADMINISTRADOR. El detalle de qué
// catálogos existen y sus reglas vive en catalogosRepository.ts (whitelist CATALOGOS).
import { CatalogosRepo } from '../data/catalogosRepository';
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requiereRol } from '../middlewares/rolMiddleware';

const router: Router = Router();

//#region OBTENER
router.get('/:cat', async (req: Request, res: Response, next) => {
    try {
        res.json(await CatalogosRepo.Listar(req.params.cat, req.query.activos === '1'));
    } catch (error) {
        next(error);
    }
});
//#endregion

//#region ABM
router.post('/:cat', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await CatalogosRepo.Agregar(req.params.cat, req.body));
    } catch (error) {
        next(error);
    }
});

router.put('/:cat/:id', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await CatalogosRepo.Modificar(req.params.cat, req.params.id, req.body));
    } catch (error) {
        next(error);
    }
});

router.put('/:cat/:id/baja', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await CatalogosRepo.DarBaja(req.params.cat, req.params.id, req.usuario!.usuario));
    } catch (error) {
        next(error);
    }
});

router.put('/:cat/:id/reactivar', authMiddleware, requiereRol('ADMINISTRADOR'), async (req: Request, res: Response, next) => {
    try {
        res.json(await CatalogosRepo.Reactivar(req.params.cat, req.params.id));
    } catch (error) {
        next(error);
    }
});
//#endregion

export default router;
