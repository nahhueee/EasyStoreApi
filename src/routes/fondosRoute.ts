import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { FondosRepo } from '../data/fondosRepository';
const router : Router  = Router();

router.get('/cajas', async (req:Request, res:Response) => {
    try{ 
        res.json(await FondosRepo.SelectorCajas());

    } catch(error:any){
        let msg = "Error al obtener el listado de cajas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.post('/resumen', async (req:Request, res:Response) => {
    try{ 
        res.json(await FondosRepo.ObtenerSeccionResumen(req.body));

    } catch(error:any){
        let msg = "Error al obtener la sección de resumen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.post('/resumen-fondos', async (req:Request, res:Response) => {
    try{ 
        res.json(await FondosRepo.ObtenerResumenFondos(req.body));

    } catch(error:any){
        let msg = "Error al obtener la sección de resumen de fondos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.post('/movimientos', async (req:Request, res:Response) => {
    try{ 
        res.json(await FondosRepo.ObtenerMovimientos(req.body));

    } catch(error:any){
        let msg = "Error al obtener los movimientos de caja.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.post('/registrar-movimiento', async (req:Request, res:Response) => {
    try{ 
        res.json(await FondosRepo.RegistrarMovimientoManual(req.body));

    } catch(error:any){
        let msg = "Error al intentar registrar movimiento.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 