import { Router, Request, Response } from 'express';
import logger from '../log/loggerGeneral';
import { ValoresRepo } from '../data/valoresRepository';

const router: Router = Router();

/**
 * POST /valores/pendientes
 * Body: { idEmpresa: number }
 * Devuelve lista de valores pendientes + totales por tipo.
 */
router.post('/pendientes', async (req: Request, res: Response) => {
    try {
        const { idEmpresa } = req.body;
        if (!idEmpresa) {
            return res.status(400).send('Se requiere idEmpresa.');
        }
        res.json(await ValoresRepo.ObtenerValoresPendientes(idEmpresa));
    } catch (error: any) {
        const msg = 'Error al obtener valores pendientes.';
        logger.error(msg + ' ' + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

/**
 * POST /valores/acreditar
 * Body: { idValor, idCaja, usuario, idFondoDestino?, observaciones? }
 * Requerido para CHEQUE: idFondoDestino (el usuario lo elige en el front).
 */
router.post('/acreditar', async (req: Request, res: Response) => {
    try {
        const { idValor, idCaja, usuario, idFondoDestino, observaciones } = req.body;
        if (!idValor || !idCaja || !usuario) {
            return res.status(400).send('Se requieren idValor, idCaja y usuario.');
        }
        await ValoresRepo.AcreditarValor({ idValor, idCaja, usuario, idFondoDestino, observaciones });
        res.json({ ok: true });
    } catch (error: any) {
        const msg = 'Error al acreditar valor.';
        logger.error(msg + ' ' + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

/**
 * POST /valores/rechazar
 * Body: { idValor, idCaja, usuario, observaciones }
 */
router.post('/rechazar', async (req: Request, res: Response) => {
    try {
        const { idValor, idCaja, usuario, observaciones } = req.body;
        if (!idValor || !idCaja || !usuario) {
            return res.status(400).send('Se requieren idValor, idCaja y usuario.');
        }
        await ValoresRepo.RechazarValor({ idValor, idCaja, usuario, observaciones });
        res.json({ ok: true });
    } catch (error: any) {
        const msg = 'Error al rechazar valor.';
        logger.error(msg + ' ' + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

export default router;
