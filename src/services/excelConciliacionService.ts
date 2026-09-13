import ExcelJS from 'exceljs';
import { MapearListaPrecio } from '../data/clientesRepository';
import { TIPOS_COMPROBANTE_ARCA } from '../models/tiposComprobanteArca';
const moment = require('moment');

/**
 * Excel del informe "Ventas para Conciliación" (R1 - cabecera). 3 hojas:
 * "Informe" (encabezado), "Ventas" (1 fila por comprobante) y "Totales" (4
 * bloques de subtotales). Ver HANDOFF-informes-administracion-R1.md §5 y §9
 * para el diseño completo y el porqué de cada decisión.
 *
 * `filas` viene de ConciliacionRepo.ObtenerVentasConciliacion(), `subtotalesPorMedioPago`
 * de ConciliacionRepo.ObtenerSubtotalesPorMedioPago(). `meta` trae los datos del
 * encabezado que no salen de una query (período/filtros ya resueltos por el
 * caller, usuario que lo generó).
 */
export async function crearExcelConciliacion(filas: any[], subtotalesPorMedioPago: any[], meta: any) {
    const workbook = new ExcelJS.Workbook();

    // =========================
    // HOJA 1: INFORME (B4-207)
    // =========================
    // En hoja separada, no arriba de la tabla: un encabezado sobre la tabla rompe
    // el autofiltro y las tablas dinámicas que el cliente pide en B4-204/B4-206.
    const sheetInforme = workbook.addWorksheet('Informe');
    sheetInforme.getColumn(1).width = 22;
    sheetInforme.getColumn(2).width = 50;

    // [label, valor, numFmt?] - numFmt presente => valor va como Date real, no
    // como texto formateado (corrección sep-2026, mismo criterio B4-204 que ya
    // se aplica en la hoja "Ventas": una fecha tiene que poder ordenarse/filtrarse
    // en Excel, no ser un string con esa forma).
    const filasInforme: [string, any, string?][] = [
        ['Informe', 'Ventas para Conciliación'],
        ['Período desde', meta?.fechaDesde ? moment.utc(meta.fechaDesde).startOf('day').toDate() : '(sin límite)', 'dd/mm/yyyy'],
        ['Período hasta', meta?.fechaHasta ? moment.utc(meta.fechaHasta).startOf('day').toDate() : '(sin límite)', 'dd/mm/yyyy'],
        ['Proceso', meta?.filtroProceso || 'Todos'],
        ['Cliente', meta?.filtroCliente || 'Todos'],
        ['N° Proceso', meta?.filtroNroProceso || 'Todos'],
        ['Incluye anulados', meta?.incluirAnuladas ? 'Sí' : 'No'],
        ['Emitido', new Date(), 'dd/mm/yyyy hh:mm'],
        ['Usuario', meta?.usuario || ''],
    ];
    filasInforme.forEach(([label, valor, numFmt]) => {
        const fila = sheetInforme.addRow([label, valor]);
        fila.getCell(1).font = { bold: true };
        if (numFmt) fila.getCell(2).numFmt = numFmt;
    });

    // Nota al pie (corrección §4, sep-2026): "Comprobante origen" (hoja "Ventas")
    // usa dos gramáticas a propósito - ver armarComprobanteOrigen() más abajo.
    sheetInforme.addRow([]);
    const filaNota = sheetInforme.addRow([
        'Nota',
        'Comprobante origen: los comprobantes fiscales se identifican por punto de venta y número; los internos (NC/ND "X"), por número de proceso.',
    ]);
    filaNota.getCell(1).font = { bold: true, italic: true };
    filaNota.getCell(2).font = { italic: true };
    filaNota.getCell(2).alignment = { wrapText: true };

    // =========================
    // HOJA 2: VENTAS
    // =========================
    const sheetVentas = workbook.addWorksheet('Ventas');

    sheetVentas.columns = [
        { header: 'ID Venta', key: 'idVenta', width: 10 },
        { header: 'N° Proceso', key: 'nroProceso', width: 12 },
        { header: 'Proceso', key: 'proceso', width: 16 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Hora', key: 'hora', width: 10 },
        { header: 'Punto de venta', key: 'puntoVenta', width: 14 },
        { header: 'Tipo comprobante', key: 'tipoComprobante', width: 18 },
        { header: 'N° comprobante', key: 'nroComprobante', width: 14 },
        { header: 'Fiscal', key: 'fiscal', width: 8 },
        { header: 'Estado', key: 'estado', width: 10 },
        { header: 'Canal de venta', key: 'canalVenta', width: 16 },

        { header: 'Facturante', key: 'facturante', width: 22 },
        { header: 'CUIT facturante', key: 'cuitFacturante', width: 16 },

        { header: 'Cód. cliente', key: 'codCliente', width: 12 },
        { header: 'Razón social', key: 'razonSocial', width: 30 },
        { header: 'Nombre', key: 'nombreCliente', width: 30 },
        { header: 'Tipo doc', key: 'tipoDoc', width: 12 },
        { header: 'CUIT / DNI', key: 'cuitDni', width: 16 },
        { header: 'Cond. IVA', key: 'condIva', width: 22 },
        { header: 'Lista de precios', key: 'listaPrecio', width: 18 },
        { header: 'Localidad', key: 'localidad', width: 18 },

        { header: 'Vendedor', key: 'vendedor', width: 16 },
        // Renombrado (corrección sep-2026, no es el mismo dato que "Condición de
        // venta": este sale del ABM del cliente, puede no coincidir con lo que
        // pasó en ESTA venta - ver condicionVenta más abajo).
        { header: 'Cond. pago (ABM cliente)', key: 'condicionPago', width: 20 },
        { header: 'Condición de venta', key: 'condicionVenta', width: 16 },
        { header: 'Fecha de vencimiento', key: 'fechaVencimiento', width: 16 },
        { header: 'Fecha de entrega', key: 'fechaEntrega', width: 16 },
        { header: 'Depósito', key: 'deposito', width: 14 },
        { header: 'Moneda', key: 'moneda', width: 10 },

        { header: 'Cant. prendas', key: 'cantPrendas', width: 12 },
        { header: 'Cant. servicios', key: 'cantServicios', width: 12 },
        { header: 'Venta $', key: 'venta', width: 14 },
        { header: 'Servicio $', key: 'servicio', width: 14 },
        { header: 'Descuento $', key: 'descuentoMonto', width: 14 },
        { header: 'Descuento %', key: 'descuentoPorcentaje', width: 12 },
        { header: 'Ajuste transferencia $', key: 'ajusteTransferencia', width: 16 },
        { header: 'Redondeo $', key: 'redondeo', width: 12 },
        { header: 'Neto gravado', key: 'netoGravado', width: 14 },
        { header: 'Exento / No gravado', key: 'exento', width: 14 },
        { header: 'IVA', key: 'iva', width: 14 },
        { header: 'Percepciones', key: 'percepciones', width: 14 },
        { header: 'Total comprobante', key: 'totalComprobante', width: 16 },

        { header: 'Métodos de pago', key: 'metodosPago', width: 24 },
        { header: 'Montos de pago', key: 'montosPago', width: 24 },

        { header: 'CAE', key: 'cae', width: 18 },
        { header: 'Vto CAE', key: 'caeVto', width: 14 },
        { header: 'Comprobante origen', key: 'comprobanteOrigen', width: 20 },
        { header: 'Motivo / Observación', key: 'motivo', width: 30 },
        { header: 'Remito', key: 'remito', width: 16 },
    ];

    const COLUMNAS_MONEDA = [
        'venta', 'servicio', 'descuentoMonto', 'ajusteTransferencia', 'redondeo',
        'netoGravado', 'exento', 'iva', 'percepciones', 'totalComprobante',
    ];

    filas.forEach(r => {
        const fila = sheetVentas.addRow({
            idVenta: r.idVenta,
            nroProceso: r.nroProceso,
            proceso: r.proceso,
            fecha: moment.utc(r.fecha).startOf('day').toDate(),
            hora: r.hora,
            puntoVenta: r.puntoVenta,
            tipoComprobante: r.tipoComprobante,
            nroComprobante: r.nroComprobante,
            fiscal: r.fiscal,
            estado: r.estado,
            canalVenta: r.canalVenta,

            facturante: r.facturante,
            cuitFacturante: r.cuitFacturante,

            codCliente: r.codCliente,
            razonSocial: r.razonSocial,
            nombreCliente: r.nombreCliente,
            tipoDoc: r.tipoDoc,
            cuitDni: r.cuitDni,
            condIva: r.condIva,
            // No hay tabla listas_precio en BD (ver clientesRepository.ts) - se resuelve
            // igual que en el ABM de clientes, sobre v.idLista (la lista de LA VENTA, no
            // la del cliente: puede haber cambiado de lista después - decisión §3.5).
            listaPrecio: MapearListaPrecio(r.idListaVenta),
            localidad: r.localidad,

            vendedor: r.vendedor,
            condicionPago: r.condicionPago,
            condicionVenta: r.condicionVenta,
            fechaVencimiento: r.fechaVencimiento ? moment.utc(r.fechaVencimiento).startOf('day').toDate() : null,
            fechaEntrega: r.fechaEntrega ? moment.utc(r.fechaEntrega).startOf('day').toDate() : null,
            deposito: 'Depósito 1',
            moneda: 'ARS',

            // Number() explícito (bug B4-204, corrección sep-2026): mysql2 devuelve
            // los SUM() sobre columnas DECIMAL/INT como string - sin este cast salían
            // como texto en Excel cada vez que el valor era distinto de 0 (con 0 el
            // patrón cambiaba porque el IFNULL/valor por defecto sí venía numérico
            // del lado de TS, lo que hacía el bug intermitente y difícil de ver a
            // simple vista). Mismo criterio que ya usa excelVentasService.ts.
            cantPrendas: Number(r.cantPrendas) || 0,
            cantServicios: Number(r.cantServicios) || 0,
            venta: Number(r.venta) || 0,
            servicio: Number(r.servicio) || 0,
            descuentoMonto: Number(r.descuentoMonto) || 0,
            descuentoPorcentaje: Number(r.descuentoPorcentaje) || 0,
            ajusteTransferencia: Number(r.ajusteTransferencia) || 0,
            redondeo: Number(r.redondeo) || 0,
            // Vacío (no cero) cuando Fiscal = N (corrección tanda 2, sep-2026): derivar
            // neto/exento/IVA/percepciones de un comprobante no fiscal a partir del
            // total (p.ej. total/1.21) inventa una apertura fiscal que ARCA nunca vio -
            // error de especificación del §8 original, no un bug de código. Total
            // comprobante y el resto de las columnas de gestión sí se completan igual
            // para todas las filas.
            netoGravado: r.fiscal === 'S' ? (Number(r.netoGravado) || 0) : null,
            exento: r.fiscal === 'S' ? 0 : null,
            iva: r.fiscal === 'S' ? (Number(r.iva) || 0) : null,
            percepciones: r.fiscal === 'S' ? 0 : null,
            totalComprobante: Number(r.totalComprobante) || 0,

            metodosPago: r.metodosPago ?? '',
            montosPago: r.montosPago ?? '',

            cae: r.cae != null ? String(r.cae) : '',
            caeVto: r.caeVto ? moment.utc(r.caeVto).startOf('day').toDate() : null,
            comprobanteOrigen: armarComprobanteOrigen(r),
            motivo: r.motivo ?? '',
            remito: r.remito,
        });

        fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
        if (r.fechaVencimiento) fila.getCell('fechaVencimiento').numFmt = 'dd/mm/yyyy';
        if (r.fechaEntrega) fila.getCell('fechaEntrega').numFmt = 'dd/mm/yyyy';
        if (r.caeVto) fila.getCell('caeVto').numFmt = 'dd/mm/yyyy';
        fila.getCell('cae').numFmt = '@'; // texto: evita notación científica en los 14 dígitos del CAE.
        fila.getCell('descuentoPorcentaje').numFmt = '0.00%';
        COLUMNAS_MONEDA.forEach(key => { fila.getCell(key).numFmt = '#,##0.00'; }); // sin "$", pedido B4-204.

        // Comprobantes anulados: aparecen como fila (B4-226) pero no suman en TOTAL -
        // se resuelve dejándolos afuera de la suma más abajo, no ocultando la fila.
    });

    // Calculá la letra final desde sheet.columns.length, no la escribas a mano -
    // trampa conocida del informe actual (autoFilter hardcodeado a 'T1', ExcelJS
    // no valida que coincida con las columnas reales).
    const ultimaColumna = columnaExcel(sheetVentas.columns!.length);
    sheetVentas.autoFilter = { from: 'A1', to: `${ultimaColumna}1` };
    sheetVentas.views = [{ state: 'frozen', ySplit: 1 }];

    // Filas TOTAL calculadas en el backend (B4-218: "no usar una fórmula dentro
    // del excel"), excluyendo anulados de la suma (B4-226).
    //
    // Corrección sep-2026 (§2 de la auditoría): una única fila TOTAL mezclaba
    // Fiscal=S y Fiscal=N - el IVA resultante no cruza contra el Libro IVA Ventas
    // (que es 100% fiscal) y administración lo iba a reportar como bug. El neto/IVA
    // no fiscal NO se pone en cero (es plata real de ventas reales): se separa en
    // su propia fila en vez de ocultarse.
    const filasParaTotal = filas.filter(r => r.estado !== 'Anulada');
    const filasFiscales = filasParaTotal.filter(r => r.fiscal === 'S');
    const filasNoFiscales = filasParaTotal.filter(r => r.fiscal === 'N');

    const columnasSumar = ['cantPrendas', 'cantServicios', ...COLUMNAS_MONEDA];

    // Columnas que se derivan de la apertura fiscal (ventas_factura): en TOTAL NO
    // FISCAL y TOTAL GENERAL van vacías, no en cero (corrección tanda 2, sep-2026 -
    // mismo criterio que en netoGravado/exento/iva/percepciones más arriba: sumar
    // "0" ahí sí sería un dato, no una ausencia de dato). TOTAL FISCAL las suma
    // normalmente, es 100% comprobantes fiscales.
    const COLUMNAS_FISCALES = ['netoGravado', 'exento', 'iva', 'percepciones'];

    const escribirFilaTotal = (etiqueta: string, filasDelTotal: any[], opciones: { resaltar?: boolean; vaciarFiscales?: boolean } = {}) => {
        const { resaltar = false, vaciarFiscales = false } = opciones;
        const fila = sheetVentas.rowCount + 1;
        sheetVentas.getCell(`A${fila}`).value = etiqueta;
        columnasSumar.forEach(key => {
            const celda = sheetVentas.getCell(`${sheetVentas.getColumn(key).letter}${fila}`);
            if (vaciarFiscales && COLUMNAS_FISCALES.includes(key)) {
                celda.value = null;
                return;
            }
            const total = filasDelTotal.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
            celda.value = total;
            if (COLUMNAS_MONEDA.includes(key)) celda.numFmt = '#,##0.00';
        });
        sheetVentas.getRow(fila).font = { bold: true };
        // TOTAL FISCAL resaltado: es el que usa contabilidad para cruzar contra
        // el Libro IVA Ventas.
        if (resaltar) {
            sheetVentas.getRow(fila).eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
            });
        }
    };

    escribirFilaTotal('TOTAL FISCAL', filasFiscales, { resaltar: true });
    escribirFilaTotal('TOTAL NO FISCAL', filasNoFiscales, { vaciarFiscales: true });
    escribirFilaTotal('TOTAL GENERAL', filasParaTotal, { vaciarFiscales: true });

    // Ajuste de ancho fijo (ver columns arriba): NO usar autoFitColumns() del
    // servicio actual acá - con ~48 columnas y varios miles de filas es
    // O(filas × columnas) y se nota (advertencia §9 del handoff).

    // =========================
    // HOJA 3: TOTALES (B4-206)
    // =========================
    const sheetTotales = workbook.addWorksheet('Totales');
    sheetTotales.getColumn(1).width = 30;
    sheetTotales.getColumn(2).width = 18;

    sheetTotales.getColumn(3).width = 18;
    sheetTotales.getColumn(4).width = 18;

    let filaActual = 1;
    const agregarBloque = (titulo: string, datos: Map<string, number>) => {
        sheetTotales.getCell(`A${filaActual}`).value = titulo;
        sheetTotales.getCell(`A${filaActual}`).font = { bold: true };
        filaActual++;
        for (const [clave, total] of datos) {
            sheetTotales.getCell(`A${filaActual}`).value = clave || '(sin dato)';
            const celda = sheetTotales.getCell(`B${filaActual}`);
            celda.value = total;
            celda.numFmt = '#,##0.00';
            filaActual++;
        }
        filaActual++; // fila en blanco entre bloques
    };

    // Bloque nuevo (§2 de la auditoría, sep-2026), primero: es el que explica por
    // qué el IVA de TOTAL FISCAL (hoja "Ventas") no es el mismo que el IVA de
    // TOTAL GENERAL. Los 4 bloques que ya existían NO se abren por condición
    // fiscal - abrir los 4 hubiera duplicado la hoja sin agregar información
    // nueva; este bloque solo alcanza para entender la composición.
    sheetTotales.getCell(`A${filaActual}`).value = 'Resumen por condición fiscal';
    sheetTotales.getCell(`A${filaActual}`).font = { bold: true };
    filaActual++;
    sheetTotales.getRow(filaActual).values = ['', 'Neto gravado', 'IVA', 'Total comprobante'];
    sheetTotales.getRow(filaActual).font = { bold: true };
    filaActual++;
    const sumar = (filasDelGrupo: any[], campo: string) =>
        filasDelGrupo.reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);
    const gruposFiscales: Array<[string, any[]]> = [
        ['Fiscal', filasFiscales],
        ['No fiscal', filasNoFiscales],
    ];
    gruposFiscales.forEach(([etiqueta, grupo]) => {
        sheetTotales.getCell(`A${filaActual}`).value = etiqueta;
        ['netoGravado', 'iva', 'totalComprobante'].forEach((campo, i) => {
            const celda = sheetTotales.getCell(`${String.fromCharCode(66 + i)}${filaActual}`);
            celda.value = sumar(grupo, campo);
            celda.numFmt = '#,##0.00';
        });
        filaActual++;
    });
    sheetTotales.getCell(`A${filaActual}`).value = 'Total';
    sheetTotales.getRow(filaActual).font = { bold: true };
    ['netoGravado', 'iva', 'totalComprobante'].forEach((campo, i) => {
        const celda = sheetTotales.getCell(`${String.fromCharCode(66 + i)}${filaActual}`);
        celda.value = sumar(filasParaTotal, campo);
        celda.numFmt = '#,##0.00';
    });
    filaActual += 2; // fila en blanco antes del siguiente bloque

    // Los 3 bloques siguientes se agrupan en TS sobre las filas ya traídas (no
    // hace falta query nueva - §9 del handoff), todos excluyendo anulados y SIN
    // abrir por condición fiscal (ver comentario arriba).
    agregarBloque('Por canal de venta', sumarPor(filasParaTotal, r => r.canalVenta, 'totalComprobante'));
    agregarBloque('Por punto de venta', sumarPor(filasParaTotal, r => r.puntoVenta, 'totalComprobante'));
    agregarBloque('Por facturante', sumarPor(filasParaTotal, r => r.facturante, 'totalComprobante'));

    // 4° bloque: viene de ObtenerSubtotalesPorMedioPago (necesita datos a nivel de
    // pago, no de la fila de venta - reusa el criterio de ObtenerReporteAcumulado).
    const subtotalesMedioPago = new Map<string, number>();
    subtotalesPorMedioPago.forEach(r => subtotalesMedioPago.set(r.metodoPago, Number(r.totalAcumulado) || 0));
    agregarBloque('Por medio de pago', subtotalesMedioPago);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

// Comprobante origen (columna 46, B4-214): dos fuentes según el tipo de
// comprobante - ver §5 del handoff. Corrección sep-2026 (§4 de la auditoría):
// antes cada fuente emitía su propio formato ("FACTURA N° 143" vs "6-0012-298"),
// dos gramáticas en una misma columna de un informe contable. Unificado acá; la
// diferencia real que queda (con/sin punto de venta) está documentada en la nota
// al pie de la hoja "Informe", no escondida en el dato.
//   - NC/ND fiscales (con fila en ventas_factura): vf.tipoRelacionado es el
//     CÓDIGO ARCA del comprobante de origen (1/6/11/... - confirmado sep-2026 vía
//     SHOW CREATE TABLE ventas_factura) - se decodifica con el mismo mapeo que ya
//     usa el Libro IVA (TIPOS_COMPROBANTE_ARCA), no uno nuevo. Formato:
//     "FACTURA A 0012-00000298" (punto de venta y número completos - SÍ existen
//     para un comprobante fiscal).
//   - NC/ND "X" (internas, sin fila en ventas_factura): v.nroRelacionado es el
//     nroProceso del comprobante interno de origen, no un ticket fiscal - no se
//     le puede armar un "0012-00000143" sin mentir. Formato: "FACTURA N° 143".
//   - Cualquier otro comprobante (Factura/Cotización sin origen): vacío.
function armarComprobanteOrigen(r: any): string {
    // Se decide por presencia de datos (vf.* vs v.*), más robusto que inferir por
    // idTComprobante/idProceso.
    if (r.vfTicketRelacionado != null) {
        const meta = TIPOS_COMPROBANTE_ARCA[Number(r.vfTipoRelacionado)];
        const descripcion = meta?.descripcion ?? `TIPO ${r.vfTipoRelacionado} (SIN MAPEAR)`;
        const ptoVenta = String(r.vfPtoVentaRelacionado ?? '').padStart(4, '0');
        const numero = String(r.vfTicketRelacionado ?? '').padStart(8, '0');
        return `${descripcion} ${ptoVenta}-${numero}`;
    }
    if (r.vNroRelacionado && r.vTipoRelacionado && !['PRESUPUESTO', 'PEDIDO', 'NOTA DE EMPAQUE'].includes(r.vTipoRelacionado)) {
        // Acá tipoRelacionado es la descripción del comprobante original (NC/ND X) -
        // 'PRESUPUESTO'/'PEDIDO'/'NOTA DE EMPAQUE' son el otro uso del mismo campo
        // (trazabilidad de fecha de entrega, ver conciliacionRepository.ts) y no
        // corresponden a un comprobante origen para esta columna.
        return `${r.vTipoRelacionado} N° ${r.vNroRelacionado}`;
    }
    return '';
}

function sumarPor(filas: any[], clave: (r: any) => string, campo: string): Map<string, number> {
    const mapa = new Map<string, number>();
    filas.forEach(r => {
        const k = clave(r) ?? '(sin dato)';
        mapa.set(k, (mapa.get(k) ?? 0) + (Number(r[campo]) || 0));
    });
    return mapa;
}

// Letra de columna Excel a partir del índice (1-based) - evita hardcodear el
// rango del autoFilter (trampa conocida del informe actual, ver §9 del handoff).
function columnaExcel(indice: number): string {
    let letra = '';
    let n = indice;
    while (n > 0) {
        const resto = (n - 1) % 26;
        letra = String.fromCharCode(65 + resto) + letra;
        n = Math.floor((n - 1) / 26);
    }
    return letra;
}
