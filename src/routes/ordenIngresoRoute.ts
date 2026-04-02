import {OrdenesRepo} from '../data/ordenIngresoRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de ordenes de ingreso.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener/:idOrden', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.ObtenerOrden(req.params.idOrden));

    } catch(error:any){
        let msg = "Error al obtener la orden de ingreso.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-recepciones/:idOrden', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.ObtenerHistorialRecepciones(req.params.idOrden));

    } catch(error:any){
        let msg = "Error al obtener el historial de recepciones.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar la orden de ingreso.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar la orden de ingreso.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar la orden de ingreso.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/agregar-recepcion', async (req:Request, res:Response) => {
    try{ 
        res.json(await OrdenesRepo.AgregarRecepcion(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar la orden de recepción.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 