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

router.post('/ventas-cliente', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ObtenerVentasCliente(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de ventas del cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.post('/ventas-cliente-reporte', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ObtenerVentasClienteReporte(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de ventas del cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/saldo-cliente/:idCliente', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ObtenerSaldoCliente(req.params.idCliente));

    } catch(error:any){
        let msg = "Error al obtener el saldo total del cliente nro " + req.params.idCliente + "";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/recibo/:idRecibo', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ObtenerRecibo(req.params.idRecibo));

    } catch(error:any){
        let msg = "Error al obtener el recibo nro " + req.params.idRecibo + "";
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