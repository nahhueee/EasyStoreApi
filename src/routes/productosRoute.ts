import { ProductosRepo } from '../data/productosRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { authMiddleware } from '../middlewares/authMiddleware';
const router : Router  = Router();

// Roles que pueden ver costo/margen (B4-209). Espeja el mismo criterio de
// PuedeAjustarStock() del front (usuarios.service.ts) - NO reemplaza esa gate
// de UI, la vuelve exigible: la ruta abajo saca `costo` de la respuesta para
// cualquier otro rol, para que no viaje en el JSON aunque el campo esté oculto.
const ROLES_COSTO = ['ADMINISTRADOR', 'ENCARGADO'];

function puedeVerCosto(req: Request): boolean {
    const cargo = req.usuario?.cargo?.toUpperCase();
    return !!cargo && ROLES_COSTO.includes(cargo);
}

function ocultarCostoTalles(producto: any): any {
    if (!producto?.talles) return producto;
    producto.talles = producto.talles.map((t: any) => {
        const { costo, ...resto } = t;
        return resto;
    });
    return producto;
}

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/validar/:codigo', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ValidarCodigo(req.params.codigo));

    } catch(error:any){
        let msg = "Error intentando validar el codigo: " + req.params.codigo;
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-uno/:id', authMiddleware, async (req:Request, res:Response) => {
    try{ 
        const producto = await ProductosRepo.ObtenerUno({id: req.params.id});
        res.json(puedeVerCosto(req) ? producto : ocultarCostoTalles(producto));

    } catch(error:any){
        let msg = "Error intentando obtener el pedido con id: " + req.params.id;
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/buscar-productos/:filtro', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.BuscarProductos(req.params.filtro));

    } catch(error:any){
        let msg = "Error intentando buscar productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/obtener-prod-presupuesto', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ObtenerProductosPresupuesto(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de productos presupuesto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/buscar-prod-presupuesto/:filtro', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.BuscarProductosPresupuesto(req.params.filtro));

    } catch(error:any){
        let msg = "Error intentando buscar productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-stock-disponible/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ObtenerStockDisponiblePorProducto(req.params.id));

    } catch(error:any){
        let msg = "Error intentando obtener el stock disponible del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


router.put('/aniadir', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.AniadirCantidad(req.body));

    } catch(error:any){
        let msg = "Error al intentar añadir cantidad al producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-imagen', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ActualizarImagen(req.body));

    } catch(error:any){
        let msg = "Error al intentar actualizar la imagen del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//#region Productos Presupuesto
router.post('/agregar-prod-presupuesto', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.AgregarProductoPresupuesto(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el producto presupuesto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar-prod-presupuesto', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ModificarProductoPresupuesto(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el producto presupuesto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar-prod-presupuesto/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.EliminarProductoPresupuesto(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el producto presupuesto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#endregion

//#region ACTUALIZAR PRECIOS
router.put('/actualizar-precio', async (req:Request, res:Response) => {
    try{ 
        if(req.body.tipoPrecio == "%")
            res.json(await ProductosRepo.ActualizarPrecioPorcentaje(req.body));

        if(req.body.tipoPrecio == "$")
            res.json(await ProductosRepo.ActualizarPrecioFijo(req.body));

    } catch(error:any){
        let msg = "No se pudo actualizar el precio de un producto. nro " + req.body.id;
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 