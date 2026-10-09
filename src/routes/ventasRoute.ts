import {VentasRepo} from '../data/ventasRepository';
import {ProductosRepo} from '../data/productosRepository';
import {FacturacionServ} from '../services/facturacionService';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { authMiddleware } from '../middlewares/authMiddleware';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de ventas de la caja.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Cantidad de Notas de Empaque pendientes de control (badge del menú y cartel del listado).
router.get('/notas-empaque-pendientes', async (req:Request, res:Response) => {
    try{
        res.json(await VentasRepo.ResumenNotasEmpaquePendientes());

    } catch(error:any){
        let msg = "Error al obtener las notas de empaque pendientes.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-una/:idVenta', async (req:Request, res:Response) => {
    try{ 
        
        res.json(await VentasRepo.ObtenerVenta(req.params.idVenta));

    } catch(error:any){
        let msg = "Error al obtener la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.get('/obtener-venta-cuenta/:idVenta', async (req:Request, res:Response) => {
    try{ 
        
        res.json(await VentasRepo.ObtenerVenta(req.params.idVenta, true));

    } catch(error:any){
        let msg = "Error al obtener la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-proximo/:idProceso', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.ObtenerProximoNroProceso(req.params.idProceso));

    } catch(error:any){
        let msg = "Error al obtener el proximo nro de proceso.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/obtener-cliente', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.ObtenerVentasCliente(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de ventas del cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/verificar-nota/:nroNota', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.VerificarNroNotaEmpaque(req.params.nroNota));

    } catch(error:any){
        let msg = "Error al verificar el nro de nota empaque.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', authMiddleware, async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.Agregar(req.body.venta, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});

router.put('/modificar', authMiddleware, async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.Modificar(req.body, req.usuario!.usuario));

    } catch(error:any){
        next(error);
    }
});

router.put('/dar-baja', async (req:Request, res:Response) => {
    try{
        res.json(await VentasRepo.DarBajaVenta(req.body.idVenta, req.body.motivo));

    } catch(error:any){
        let msg = "No se pudo dar de baja.";
        logger.error(msg + " " + error.message);
        // Mismo patrón que dar-baja-recibo (cuentasCorrientesRoute.ts): DarBajaVenta
        // tira { status, message } para los bloqueos de negocio (proceso no válido,
        // estado no abierto, motivo faltante), así el front puede mostrar el motivo
        // específico en vez de un 500 genérico.
        res.status(error.status || 500).send(error.message || msg);
    }
});

router.put('/aprobar', authMiddleware, async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.Aprobar(req.body, req.usuario!.usuario));

    } catch(error:any){
        let msg = "Error al intentar aprobar la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region FACTURA
router.get('/obtenerQR/:id', async (req:Request, res:Response, next) => {
    try{ 
        res.json(await FacturacionServ.ObtenerQRFactura(req.params.id));
    } catch(error){
        next(error);
    }
});

// Chequeo preventivo de stock (ProductosRepo.ValidarStockVenta), llamado desde
// ConfirmarFacturacion() en el front ANTES de abrir el modal de facturar - o sea,
// antes de pedir el CAE a AFIP. No reemplaza el chequeo con lock que sigue estando
// en Agregar/ActualizarInventario (esa es la garantia real contra condiciones de
// carrera); esto corta el caso comun ANTES del punto de no retorno fiscal.
router.post('/validar-stock', async (req:Request, res:Response, next) => {
    try{
        await ProductosRepo.ValidarStockVenta(req.body.productos);
        res.json({ ok: true });
    } catch(error){
        next(error);
    }
});

router.post('/facturar', authMiddleware, async (req:Request, res:Response, next) => {
    try{ 
        res.json(await FacturacionServ.Facturar(req.body, req.requestId, req.usuario?.usuario));
    } catch(error){
        next(error);
    }
});

// F4.1 - HANDOFF blindaje facturacion y logs. Endpoint unificado: persiste la venta y
// pide el CAE en una sola operacion (a diferencia de /facturar + /agregar|/modificar,
// que son dos llamadas separadas). Body: { venta, objFacturar, modificando }. Todavia
// no lo usa el front (eso es F4.2) - /facturar sigue activo para Cotizacion/NC X.
router.post('/emitir', authMiddleware, async (req:Request, res:Response, next) => {
    try{
        const { venta, objFacturar, modificando } = req.body;
        res.json(await FacturacionServ.Emitir(venta, objFacturar, !!modificando, req.requestId, req.usuario?.usuario));
    } catch(error){
        next(error);
    }
});
//#endregion

// Export the router
export default router; 