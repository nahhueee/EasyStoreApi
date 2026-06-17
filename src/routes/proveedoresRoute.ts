import {ProveedoresRepo} from '../data/proveedoresRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProveedoresRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de proveedores.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-proveedor/:id', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.ObtenerProveedor({idProveedor: req.params.id }));

    } catch(error:any){
        let msg = "Error al obtener el proveedor nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.ProveedoresSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de proveedores.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

    //#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProveedoresRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProveedoresRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProveedoresRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 
