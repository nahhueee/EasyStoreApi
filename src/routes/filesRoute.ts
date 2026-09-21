import {Router, Request, Response} from 'express';
import { upload, fullPath } from '../conf/upload_config'; // Importar configuración de Multer y las variables
import logger from '../log/loggerGeneral';
import { authMiddleware } from '../middlewares/authMiddleware';
const router : Router  = Router();

// B4-209 Fase 3 (§4.b del handoff): mismo criterio que productosRoute.ts
// (puedeVerCosto) y usuarios.service.ts (PuedeVerCostoYMargen) del front - los
// tres tienen que decir lo mismo. Se repite acá en vez de extraer un módulo
// compartido porque el resto del proyecto ya resuelve este chequeo puntual así,
// duplicado en dos lugares (no hay un middlewares/roles.ts hoy) - no es el
// momento de introducir esa abstracción por un tercer uso de dos líneas.
function puedeVerCostoInforme(req: Request): boolean {
    const cargo = req.usuario?.cargo?.toUpperCase();
    return cargo === 'ADMINISTRADOR' || cargo === 'ENCARGADO';
}

import { crearExcelVentas } from '../services/excelVentasService';
import { crearExcelLibroIvaVentas } from '../services/excelLibroIvaService';
import { crearExcelConciliacion } from '../services/excelConciliacionService';
import { crearExcelProductos } from '../services/excelProductosService';
import { crearExcelClientes } from '../services/excelClientesService';
import { crearExcelCuentas } from '../services/excelCuentasService';
import { crearExcelMovimientosFondos } from '../services/excelFondosService';
import { crearExcelProveedores } from '../services/excelProveedoresService';
import { crearExcelCompras } from '../services/excelComprasService';
import { ProductosRepo } from '../data/productosRepository';
import { VentasRepo } from '../data/ventasRepository';
import { LibrosIvaRepo } from '../data/librosIvaRepository';
import { EmpresasRepo } from '../data/empresasRepository';
import { ConciliacionRepo } from '../data/conciliacionRepository';
import { ClientesRepo } from '../data/clientesRepository';
import { CuentasRepo } from '../data/cuentasRepository';
import { FondosRepo } from '../data/fondosRepository';
import { ProveedoresRepo } from '../data/proveedoresRepository';
import { ComprasRepo } from '../data/comprasRepository';

//#region IMPRESION DE PDFS
const printer = require('pdf-to-printer');
const fs = require('fs');

router.post('/imprimir-pdf', upload.single('doc'), (req:Request, res:Response) => {
    const printerName = req.body.printerName;

    printer.print(fullPath, { printer: printerName, orientation: 'portrait', scale: 'noscale'})
    .then(() => {
        res.status(200).json('OK');
        fs.unlinkSync(fullPath); // Elimina el archivo temporal
    })
    .catch((error) => {
        let msg = "Error al intentar imprimir el documento.";
        logger.error(msg + " " + error);
        res.status(500).send(msg);
    });   
});
//#endregion

//#region EXCEL
router.post('/descargar-excel', async (req, res) => {
    try {

        const productos = await ProductosRepo.ObtenerParaExcel(req.body);
        const columnas = [
        "Proceso", "Codigo", "Nombre", "Producto", "Tipo", "Genero", "Material", "Color",
        "XS","S","M","L","XL","XXL","3XL","4XL","5XL","6XL","Total"
        ];

        const data = productos.map(p => {
            const obj: any = {};
            columnas.forEach(col => obj[col] = p[col]);
            return obj;
        });

        // Generar Excel usando el servicio
        const buffer = await crearExcelProductos(data);

        // Configurar headers para descarga
        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="usuarios.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        res.end(buffer);

    } catch(error:any){
        let msg = "Error al intentar generar el excel de resultados.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


router.post('/ventas-excel', async (req, res) => {
    try {

        const res1 = await VentasRepo.ObtenerReporteAcumulado(req.body);
        const res2 = await VentasRepo.ObtenerReporteVentas(req.body);
        const res3 = await VentasRepo.ObtenerReporteDetalles(req.body);
        const res4 = await VentasRepo.ObtenerReporteServicios(req.body);

        //console.log(res1, res2, res3, res4)
        //Generar Excel usando el servicio
        const buffer = await crearExcelVentas(res1, res2, res3, res4);

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="usuarios.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        let msg = "Error al intentar generar el excel de resultados.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


router.post('/libro-iva-ventas-excel', async (req, res) => {
    try {

        const libro = await LibrosIvaRepo.ObtenerLibroIvaVentas(req.body);
        const correlatividad = await LibrosIvaRepo.ObtenerCorrelatividadVentas(req.body);
        const excluidos = await LibrosIvaRepo.ObtenerExcluidosDelLibro(req.body);
        // Se necesita aparte (no se deriva de `libro[0]`) para saber si la empresa
        // es RI o Monotributista incluso en un período sin comprobantes -
        // HANDOFF-apertura-iva-libro-iva-ventas.md.
        const empresa = await EmpresasRepo.ObtenerEmpresa(req.body.idEmpresa);

        // Generar Excel usando el servicio
        const buffer = await crearExcelLibroIvaVentas(libro, correlatividad, excluidos, empresa);

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="libro-iva-ventas.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        let msg = "Error al intentar generar el Libro IVA Ventas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/ventas-conciliacion-excel', authMiddleware, async (req, res) => {
    try {
        // Mismo body que ya usan los reportes de ventas actuales (fechas, idProceso,
        // cliente, nroProceso), más incluirAnuladas. filtroProcesoNombre/filtroClienteNombre/
        // usuario: igual que fondos-excel (cajaNombre/fondoNombre) - ya resueltos en el
        // frontend, solo para el encabezado del excel (evita otro round-trip al backend).
        // formatoLargo: checkbox "Exportar talles en formato largo" (R2, B4-212).
        const { filtros, filtroProcesoNombre, filtroClienteNombre, usuario, formatoLargo } = req.body;

        const filas = await ConciliacionRepo.ObtenerVentasConciliacion(filtros);
        const subtotalesPorMedioPago = await ConciliacionRepo.ObtenerSubtotalesPorMedioPago(filtros);
        // R2: detalle crudo (líneas de producto/servicio) para la hoja "Detalle
        // valorizado" - la valorización sucede en crearExcelConciliacion.
        const lineasDetalle = await ConciliacionRepo.ObtenerDetalleLineas(filtros);
        // R3: 1 fila por cobro (hoja "Cobranzas") - filtrado por fecha de COBRO,
        // no de comprobante (mismo `filtros`, resuelto en ArmarBaseCobranzas).
        const cobranzas = await ConciliacionRepo.ObtenerCobranzas(filtros);
        // R3, corrección 15/09/2026, fix 4.b: recibos dados de baja en el período
        // (mismo rango de fechas de `filtros`, filtrado por fechaBaja).
        const recibosDadosDeBaja = await ConciliacionRepo.ObtenerRecibosDadosDeBaja(filtros);

        const buffer = await crearExcelConciliacion(filas, subtotalesPorMedioPago, {
            fechaDesde: filtros?.fechas?.[0],
            fechaHasta: filtros?.fechas?.[1],
            filtroProceso: filtroProcesoNombre,
            filtroCliente: filtroClienteNombre,
            filtroNroProceso: filtros?.nroProceso,
            incluirAnuladas: filtros?.incluirAnuladas,
            usuario,
        }, lineasDetalle, !!formatoLargo, cobranzas, recibosDadosDeBaja, puedeVerCostoInforme(req));

        res.setHeader('Content-Disposition', 'attachment; filename="ventas-conciliacion.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch (error: any) {
        let msg = "Error al intentar generar el informe de conciliación.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/clientes-excel', async (req, res) => {
    try {

        const clientes = await ClientesRepo.ObtenerParaExcel(req.body);

        // Generar Excel usando el servicio
        const buffer = await crearExcelClientes(clientes);

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="clientes.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        let msg = "Error al intentar generar el excel de clientes.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/proveedores-excel', async (req, res) => {
    try {

        const proveedores = await ProveedoresRepo.ObtenerParaExcel(req.body);

        // Generar Excel usando el servicio
        const buffer = await crearExcelProveedores(proveedores);

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="proveedores.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        let msg = "Error al intentar generar el excel de proveedores.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/compras-excel', async (req, res) => {
    try {

        const compras = await ComprasRepo.ObtenerParaExcel(req.body);

        // Generar Excel usando el servicio
        const buffer = await crearExcelCompras(compras);

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="compras.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        const status = error?.status ?? 500;
        const msg = error?.message ?? "Error al intentar generar el excel de compras.";
        if (status === 500) logger.error(msg + " " + (error?.message ?? ''));
        res.status(status).send(msg);
    }
});

router.post('/cuentas-excel', async (req, res) => {
    try {

        const cuentas = await CuentasRepo.ObtenerParaExcel(req.body);

        // Generar Excel usando el servicio
        const buffer = await crearExcelCuentas(cuentas);

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', 'attachment; filename="cuentas-corrientes.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        let msg = "Error al intentar generar el excel de cuentas corrientes.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.post('/fondos-excel', async (req, res) => {
    try {

        // req.body.filtros: mismos filtros que usa la grilla (idCaja, idFondo,
        // usuario, fechaDesde, fechaHasta). req.body.cajaNombre/fondoNombre:
        // nombres ya resueltos en el frontend, solo para el encabezado del excel
        // (evita otro round-trip al backend para resolverlos acá).
        const { filtros, cajaNombre, fondoNombre } = req.body;

        const movimientos = await FondosRepo.ObtenerMovimientosParaExcel(filtros);

        // Período "Todo": no viene fechaDesde (sin límite inferior a propósito).
        // Para que el encabezado del excel muestre una fecha real y no quede en
        // blanco, se toma el movimiento más antiguo del propio resultado (ya
        // viene ordenado DESC por fecha, así que es el último elemento) en vez
        // de disparar una consulta MIN(fecha) aparte.
        const fechaDesdeMostrar = filtros?.fechaDesde
            ?? (movimientos.length ? movimientos[movimientos.length - 1].fecha : null);

        const buffer = await crearExcelMovimientosFondos(movimientos, {
            fechaDesde: fechaDesdeMostrar,
            fechaHasta: filtros?.fechaHasta,
            caja:       cajaNombre,
            fondo:      fondoNombre,
            usuario:    filtros?.usuario
        });

        res.setHeader('Content-Disposition', 'attachment; filename="movimientos-fondos.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        res.send(buffer);
    } catch(error:any){
        const status = error?.status ?? 500;
        const msg = error?.message ?? "Error al intentar generar el excel de movimientos de fondos.";
        if (status === 500) logger.error(msg + " " + (error?.message ?? ''));
        res.status(status).send(msg);
    }
});
//#endregion

// Export the router
export default router;