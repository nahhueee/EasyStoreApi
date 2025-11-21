import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { ServiciosRepo } from '../data/serviciosRepository';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await ServiciosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de servicios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector', async (req:Request, res:Response) => {
    try{ 
        res.json(await ServiciosRepo.ServiciosSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de servicios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ServiciosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el servicio.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ServiciosRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el servicio.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ServiciosRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el servicio.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 