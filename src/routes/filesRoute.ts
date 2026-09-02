import {Router, Request, Response} from 'express';
import { upload, fullPath } from '../conf/upload_config'; // Importar configuración de Multer y las variables
import logger from '../log/loggerGeneral';
const router : Router  = Router();

import { crearExcelVentas } from '../services/excelVentasService';
import { crearExcelLibroIvaVentas } from '../services/excelLibroIvaService';
import { crearExcelProductos } from '../services/excelProductosService';
import { crearExcelClientes } from '../services/excelClientesService';
import { crearExcelCuentas } from '../services/excelCuentasService';
import { crearExcelMovimientosFondos } from '../services/excelFondosService';
import { crearExcelProveedores } from '../services/excelProveedoresService';
import { ProductosRepo } from '../data/productosRepository';
import { VentasRepo } from '../data/ventasRepository';
import { LibrosIvaRepo } from '../data/librosIvaRepository';
import { ClientesRepo } from '../data/clientesRepository';
import { CuentasRepo } from '../data/cuentasRepository';
import { FondosRepo } from '../data/fondosRepository';
import { ProveedoresRepo } from '../data/proveedoresRepository';

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

        // Generar Excel usando el servicio
        const buffer = await crearExcelLibroIvaVentas(libro, correlatividad, excluidos);

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