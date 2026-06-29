import {ComprasCuentasRepo} from '../data/comprasCuentasRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasCuentasRepo.ObtenerCuentasProveedores(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de cuentas corrientes de proveedores.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

router.post('/movimientos-proveedor', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasCuentasRepo.ObtenerMovimientosProveedor(req.body));

    } catch(error:any){
        let msg = "Error al obtener el ledger de movimientos del proveedor.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

router.get('/pago/:idPagoProveedor', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasCuentasRepo.ObtenerPagoProveedor(req.params.idPagoProveedor));

    } catch(error:any){
        let msg = "Error al obtener el pago nro " + req.params.idPagoProveedor + "";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});
//#endregion

//#region ABM
router.put('/pagar', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasCuentasRepo.PagarProveedor(req.body));

    } catch(error:any){
        let msg = "No se pudo realizar el pago al proveedor.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});

router.put('/revertir-pago', async (req:Request, res:Response) => {
    try{
        res.json(await ComprasCuentasRepo.RevertirPagoProveedor(req.body?.idPagoProveedor));

    } catch(error:any){
        let msg = "No se pudo revertir el pago al proveedor.";
        logger.error(msg + " " + error.message);
        res.status(error.status || 500).send(error.message || msg);
    }
});
//#endregion

// Export the router
export default router;
