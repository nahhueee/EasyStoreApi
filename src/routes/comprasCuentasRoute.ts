import {ComprasCuentasRepo} from '../data/comprasCuentasRepository';
import {Router, Request, Response, NextFunction} from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasCuentasRepo.ObtenerCuentasProveedores(req.body));

    } catch(error:any){
        next(error);
    }
});

router.post('/movimientos-proveedor', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasCuentasRepo.ObtenerMovimientosProveedor(req.body));

    } catch(error:any){
        next(error);
    }
});

router.get('/pago/:idPagoProveedor', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasCuentasRepo.ObtenerPagoProveedor(req.params.idPagoProveedor));

    } catch(error:any){
        next(error);
    }
});
//#endregion

//#region ABM
router.put('/pagar', authMiddleware, async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasCuentasRepo.PagarProveedor(req.body, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});

router.put('/revertir-pago', authMiddleware, async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasCuentasRepo.RevertirPagoProveedor(req.body?.idPagoProveedor, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});
//#endregion

// Export the router
export default router;
