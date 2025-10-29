import {MiscRepo} from '../data/miscRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.get('/materiales', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.MaterialesSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de materiales.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/procesos', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.ProcesosSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de procesos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/tipos-producto', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.TiposProductoSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de tipos de producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/subtipos-producto', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.SubtiposProductoSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de subtipos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/generos', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.GenerosSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de generos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/colores', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.ColoresSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de colores.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/temporadas', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.TemporadasSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de temporadas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/lineas-talle', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.ObtenerLineasTalle());

    } catch(error:any){
        let msg = "Error al obtener el listado de lineas de talle.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/linea-talle/:idLinea', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.ObtenerLineaDeTalle(req.params.idLinea));

    } catch(error:any){
        let msg = "Error al obtener la lineas de talle.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/condiciones-iva', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.CondicionesIvaSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de condiciones de IVA.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/comprobantes/:condicionIva', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.ComprobantesCondicionSelector(req.params.condicionIva));

    } catch(error:any){
        let msg = "Error al obtener el listado de comprobantes para la condicion de IVA.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/servicios', async (req:Request, res:Response) => {
    try{ 
        res.json(await MiscRepo.ServiciosSelector());

    } catch(error:any){
        let msg = "Error al obtener el listado de servicios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 