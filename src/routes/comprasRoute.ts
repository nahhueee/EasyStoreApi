import {ComprasRepo} from '../data/comprasRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de compras.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-una/:idCompra', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasRepo.ObtenerUna(req.params.idCompra));

    } catch(error:any){
        let msg = "Error al obtener la compra.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/metodos-pago/:idEmpresa', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasRepo.SelectorMetodosPago(req.params.idEmpresa));

    } catch(error:any){
        let msg = "Error al obtener los metodos de pago de la compra.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar la compra.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/eliminar', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasRepo.Eliminar(req.body));

    } catch(error:any){
        let msg = "Error al intentar eliminar la compra.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});
//#endregion

// Export the router
export default router;
