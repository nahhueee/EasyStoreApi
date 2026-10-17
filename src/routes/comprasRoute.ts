import {ComprasRepo} from '../data/comprasRepository';
import {Router, Request, Response, NextFunction} from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasRepo.Obtener(req.body));

    } catch(error:any){
        next(error);
    }
});

router.get('/obtener-una/:idCompra', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasRepo.ObtenerUna(req.params.idCompra));

    } catch(error:any){
        next(error);
    }
});

router.get('/metodos-pago/:idEmpresa', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasRepo.SelectorMetodosPago(req.params.idEmpresa));

    } catch(error:any){
        next(error);
    }
});
//#endregion

//#region ABM
router.post('/agregar', authMiddleware, async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasRepo.Agregar(req.body, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});

router.put('/eliminar', authMiddleware, async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ComprasRepo.Eliminar(req.body, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});
//#endregion

// Export the router
export default router;
