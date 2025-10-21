import {DireccionesServ} from '../services/direccionesService';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

router.get('/provincias', async (req:Request, res:Response) => {
    try{ 
        res.json(await DireccionesServ.ObtenerProvincias());

    } catch(error:any){
        let msg = "Error al obtener el listado de provincias.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


router.post('/localidades', async (req:Request, res:Response) => {
    try{ 
        res.json(await DireccionesServ.ObtenerLocalidades(req.body.provincia, req.body.filtro));

    } catch(error:any){
        let msg = "Error al obtener las localidades de la provincia " + req.body.provincia + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/calles', async (req:Request, res:Response) => {
    try{ 
        res.json(await DireccionesServ.ObtenerCalles(req.body.localidad, req.body.filtro));

    } catch(error:any){
        let msg = "Error al obtener las calles de la localidad " + req.body.localidad + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 