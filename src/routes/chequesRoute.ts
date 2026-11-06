import {ChequesRepo} from '../data/chequesRepository';
import {Router, Request, Response, NextFunction} from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
const router : Router  = Router();

//#region OBTENER
// Panel "Cheques emitidos" de Fondos: filtros estado, idEmpresa, idFondoBanco, fechaPagoDesde/fechaPagoHasta.
router.post('/obtener', async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ChequesRepo.ObtenerCheques(req.body));

    } catch(error:any){
        next(error);
    }
});
//#endregion

//#region ABM
router.put('/debitar', authMiddleware, async (req:Request, res:Response, next:NextFunction) => {
    try{
        res.json(await ChequesRepo.Debitar(req.body?.idCheque, req.body?.idCaja, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});
//#endregion

// Export the router
export default router;
