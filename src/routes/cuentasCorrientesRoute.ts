import {CuentasRepo} from '../data/cuentasRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de cuentas corriente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/deuda-cliente/:idCliente', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ObtenerDeudaTotalCliente(req.params.idCliente));

    } catch(error:any){
        let msg = "Error al obtener el total de deuda del cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/entrega', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.EntregaDinero(req.body));

    } catch(error:any){
        let msg = "No se pudo realizar el proceso de entrega de dinero.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/revertir-entrega', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.RevertirEntrega(req.body));

    } catch(error:any){
        let msg = "No se pudo realizar la reversión de la última entrega.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-pago', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ActualizarPagosVenta(req.body));

    } catch(error:any){
        let msg = "No se pudo actualizar el estado de pago.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 