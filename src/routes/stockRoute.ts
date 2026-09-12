import { StockRepo } from '../data/stockRepository';
import { Router, Request, Response } from 'express';
import logger from '../log/loggerGeneral';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requiereRol } from '../middlewares/rolMiddleware';
const router: Router = Router();

//#region OBTENER
router.post('/obtener', async (req: Request, res: Response) => {
    try {
        res.json(await StockRepo.Obtener(req.body));

    } catch (error: any) {
        let msg = "Error al obtener el listado de ajustes de stock.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});
//#endregion

//#region ABM
router.post('/ajustar', authMiddleware, requiereRol('ADMINISTRADOR', 'ENCARGADO'), async (req: Request, res: Response) => {
    try {
        res.json(await StockRepo.AjustarStock(req.body, req.usuario!.usuario));

    } catch (error: any) {
        let msg = "Error al intentar ajustar el stock.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

router.put('/revertir', authMiddleware, requiereRol('ADMINISTRADOR', 'ENCARGADO'), async (req: Request, res: Response) => {
    try {
        await StockRepo.RevertirAjuste(req.body.idMovimiento, req.body.motivoBaja, req.usuario!.usuario);
        res.json(true);

    } catch (error: any) {
        let msg = "Error al intentar revertir el ajuste de stock.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});
//#endregion

// Export the router
export default router;
