import ExcelJS from 'exceljs';
import { MapearListaPrecio } from '../data/clientesRepository';
import { TIPOS_COMPROBANTE_ARCA } from '../models/tiposComprobanteArca';
import { IdProceso } from '../models/ventaEstados';
import { aperturaIva } from './aperturaIva';
const moment = require('moment');

/**
 * Excel del informe "Ventas para Conciliación". 5 hojas: "Informe" (encabezado),
 * "Ventas" (R1, 1 fila por comprobante), "Detalle valorizado" y "Control" (R2,
 * 1 fila por línea / por comprobante) y "Totales" (4 bloques de subtotales).
 * Ver HANDOFF-informes-administracion-R1.md (§5, §9), sus dos tandas de
 * correcciones, y HANDOFF-informes-administracion-R2.md (§4 a §9) más su
 * tanda de correcciones (sep-2026) para el diseño completo y el porqué de
 * cada decisión.
 *
 * `filas` viene de ConciliacionRepo.ObtenerVentasConciliacion() y hace de
 * cabecera para las 5 hojas (R2 la reusa en vez de volver a traerla - ver
 * comentario en ObtenerDetalleLineas). `subtotalesPorMedioPago` de
 * ConciliacionRepo.ObtenerSubtotalesPorMedioPago(). `meta` trae los datos del
 * encabezado que no salen de una query (período/filtros ya resueltos por el
 * caller, usuario que lo generó). `lineasDetalle` viene de
 * ConciliacionRepo.ObtenerDetalleLineas() (R2, crudo - la valorización sucede
 * acá). `formatoLargo` es el checkbox "Exportar talles en formato largo"
 * (B4-212, §7 del handoff R2); default false.
 */
export async function crearExcelConciliacion(
    filas: any[],
    subtotalesPorMedioPago: any[],
    meta: any,
    lineasDetalle: any[] = [],
    formatoLargo: boolean = false,
    // R3 (HANDOFF-informes-administracion-R3.md): 1 fila por cobro, filtrado
    // por fecha de COBRO (no de comprobante - §2 del handoff, el punto más
    // importante de R3). `filasPeriodo` es lo que se muestra; `filasUniverso`
    // es el historial completo de cada comprobante que aparece en el período
    // (sin filtro de fecha), necesario para el arrastre de Saldo pendiente
    // (si una factura se cobró en dos meses, el saldo de este período tiene
    // que descontar también lo cobrado antes - ver calcularCobranzas más
    // abajo). Viene de ConciliacionRepo.ObtenerCobranzas() - ver
    // ArmarBaseCobranzas en conciliacionRepository.ts para el porqué de la
    // unión ventas_pagos + ventas_entrega_detalle.
    cobranzas: { filasPeriodo: any[]; filasUniverso: any[] } = { filasPeriodo: [], filasUniverso: [] },
    // R3, corrección 15/09/2026, fix 4.b: recibos dados de baja en el período -
    // ver ObtenerRecibosDadosDeBaja en conciliacionRepository.ts.
    recibosDadosDeBaja: any[] = [],
    // B4-209 Fase 3, §4.b del handoff: rol del usuario que pidió el informe. Las 4
    // columnas de costo/margen de "Detalle valorizado" NO se agregan al workbook
    // cuando es false - no alcanza con dejarlas vacías (una columna vacía con un
    // total al pie sigue filtrando el orden de magnitud). valorizarComprobante()
    // SIGUE calculando margen/costo siempre, sin mirar este flag: la gate es
    // pura capa de presentación acá, para no mezclar auth con la matemática.
    puedeVerCosto: boolean = false,
) {
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
    filasInforme.forEach(([label, valor, numFmt], i) => {
        const fila = sheetInforme.addRow([label, valor]);
        // Corrección tanda 2, punto 2: la fila de título de la hoja se estiliza
        // igual que el header de columnas de las otras 4 hojas; el resto de las
        // filas (label:valor) sigue con solo negrita en la etiqueta, como antes.
        if (i === 0) {
            aplicarEstiloEncabezado(fila);
        } else {
            fila.getCell(1).font = { bold: true };
        }
        if (numFmt) fila.getCell(2).numFmt = numFmt;
    });

    // Notas al pie (corrección R1 §4 y corrección R2 tanda 1 punto 6, sep-2026):
    // "Comprobante origen" usa dos gramáticas a propósito (ver armarComprobanteOrigen
    // más abajo); "Fecha de vencimiento" puede ser estimada cuando el cliente todavía
    // no tiene plazo cargado (ver hoja "Ventas" y "Origen del vencimiento").
    sheetInforme.addRow([]);
    const notasInforme: string[] = [
        'Comprobante origen: los comprobantes fiscales se identifican por punto de venta y número; los internos (NC/ND "X"), por número de proceso.',
        'Fecha de vencimiento: se toma del plazo de pago configurado en el ABM del cliente. Para los clientes que todavía no lo tienen cargado, se estima en 15 días desde la emisión y se identifica como tal en la columna Origen del vencimiento.',
        // Nombre interno "R3" fuera del texto visible (corrección presentación
        // 15/09/2026, punto 2) - el cliente nunca vio esa nomenclatura.
        'Hoja "Cobranzas": a diferencia de "Ventas" y "Detalle valorizado" (que filtran por fecha de emisión del comprobante), "Cobranzas" filtra por fecha de COBRO. El total del período puede no coincidir entre hojas: una venta de fines de mes puede cobrarse recién el mes siguiente, y una cuenta corriente vieja puede cancelarse este mes.',
        // Corrección presentación 15/09/2026, punto 3: texto simplificado a
        // pedido de Nahu (ya no explica el mecanismo de baja en detalle, solo
        // el efecto que le importa a quien lee el informe).
        'Recibos anulados: los cobros de un recibo dado de baja no se incluyen en el informe. Por eso un informe re-emitido de un período puede no coincidir con uno emitido antes, si en el medio se anuló algún recibo de ese período. El listado de recibos dados de baja está al pie de la hoja Cobranzas.',
        // Corrección presentación 15/09/2026, punto 1: explica la columna
        // resumida de "Ventas" y dónde está el detalle real por cobro.
        'Medios de pago (resumen): muestra los medios agrupados de cada comprobante. El detalle de cada cobro, con su fecha e importe, está en la hoja Cobranzas.',
        // Corrección presentación 15/09/2026, punto 5 (cierra B4-218).
        'Criterio de signos: las notas de crédito y las aplicaciones de saldo a favor se muestran en negativo, porque restan del total del período.',
        // B4-209 Fase 3: nota pedida explícitamente en el handoff (§Fase 3, último punto).
        // Solo aparece cuando el usuario tiene permiso de ver costo (las columnas ni
        // siquiera existen en el archivo si no lo tiene - ver puedeVerCosto).
        ...(puedeVerCosto ? [
            'Costo y margen (hoja "Detalle valorizado"): el margen se calcula solo sobre líneas de Producto con costo cargado al momento de facturar. Servicios, ítems no catalogados y las filas de Ajuste/Redondeo/Sin detalle/Diferencia no explicada quedan sin costo ni margen (celda vacía, no cero) - al armar una tabla dinámica de margen por artículo/canal/cliente, esas filas quedan afuera del promedio o suma automáticamente. Una venta anterior a esta funcionalidad, o un talle sin costo cargado en el momento de facturar, también queda vacía: el costo nunca se reconstruye con el valor actual del maestro.',
        ] : []),
        // Cierre R3 (16/09/2026, punto 1) - la nota más importante del cierre:
        // sin esto el contador hace Σ "Ingresó" vs. ingresos del módulo de
        // Fondos, no coinciden ($8,9 M de diferencia en agosto) y lo reporta
        // como bug cuando son 4 diferencias de criterio esperadas. \n dentro
        // del string + wrapText (ya seteado en el forEach de abajo) - Excel
        // respeta el salto de línea en una celda wrapeada.
        // Corrección punto 10 (21/09/2026): la nota original (una sola oración +
        // 4 viñetas cortas) no alcanzaba para que el cliente entendiera POR QUÉ
        // pasa esto, solo listaba los casos. Se saca de acá (lista de notas cortas
        // en formato Nota/texto) y se arma como bloque aparte, al pie de la hoja
        // Informe (después de escribirse todas las notas de esta lista - ver más
        // abajo) - fuente monoespaciada, sin la etiqueta "Nota" en negrita, para que
        // el cuadro ASCII se lea alineado como una explicación aparte, no como una
        // nota más entre las demás.
        // Punto 7 (21/09/2026): el cliente vio 48 filas de la hoja Cobranzas con las
        // columnas del comprobante en blanco y preguntó si eran cobros no aplicados a
        // una factura - tenía razón exactamente (26 Saldo a favor + 22 Cancelación de
        // saldo inicial). Las columnas quedan bien vacías (vacío, no cero, mismo
        // criterio de siempre): no hay un comprobante puntual al que corresponda.
        'Hoja Cobranzas — filas sin comprobante: los cobros con Tipo de cobro = Saldo a favor o Cancelación de saldo inicial no se aplican a un comprobante puntual, así que las columnas del comprobante (punto de venta, número, fecha, total, vencimiento) van vacías. El importe cobrado y el medio están completos igual.',
        // Punto 8 (21/09/2026): el cliente preguntó qué significan los valores de "Ref.
        // interna" (VED208, VP401). No se tocan los prefijos - sirven para soporte y ya
        // están verificados.
        'Hoja Cobranzas — Ref. interna: identifica el movimiento de cobro dentro del sistema, para poder rastrearlo si hace falta. "VP" es un cobro aplicado directamente a un comprobante; "VED", la aplicación de una entrega de dinero que se repartió entre varios comprobantes. El número que sigue es el identificador interno del movimiento.',
    ];
    notasInforme.forEach(texto => {
        const filaNota = sheetInforme.addRow(['Nota', texto]);
        filaNota.getCell(1).font = { bold: true, italic: true };
        filaNota.getCell(2).font = { italic: true };
        filaNota.getCell(2).alignment = { wrapText: true };
        // CORRECCIÓN (16/09/2026): había un alto de fila fijo acá
        // (lineas * 15) para la nota con viñetas - mal calculado, asumía 1
        // línea visual por cada '\n' sin contar que cada oración larga ya
        // envuelve en 3-4 líneas dentro del ancho de columna B (50). Quedaba
        // muy por debajo de lo necesario (~75pt reservados, ~220pt reales) y
        // Excel mostraba el texto solapado/repetido entre filas al no poder
        // ajustar una altura marcada como fija. Sacado: sin alto explícito,
        // el visor autoajusta - mismo criterio que ya usan sin problema el
        // resto de las notas de esta hoja.
    });

    // Bloque aparte (corrección punto 10, 21/09/2026): reemplaza a la nota
    // "Hoja Cobranzas — cómo cruzar el total contra caja y banco" que vivía en
    // notasInforme de arriba (formato Nota/texto en negrita+cursiva, una fila
    // por nota). El cliente la entendía a medias - la nueva versión explica el
    // PORQUÉ (dos fechas distintas para el mismo hecho: cuándo cobró vs. cuándo
    // el banco acreditó) antes de listar los 4 casos, y agrega una fórmula de
    // verificación al pie. Va al final de la hoja Informe, después de todas las
    // notas cortas - es deliberadamente MÁS grande y con otro tratamiento
    // visual (fuente monoespaciada, sin la etiqueta "Nota" en negrita) para que
    // se lea como una explicación aparte, no como una nota más de la lista.
    //
    // Merge B:H + fuente Consolas: el cuadro ASCII depende de que cada columna
    // de caracteres se alinee - con la fuente proporcional del resto de la hoja
    // (Calibri) las líneas no calzan. wrapText sigue en true (necesario para que
    // Excel respete los '\n', igual que en notasInforme) pero el merge deja
    // ancho de sobra para que ninguna línea individual vuelva a wrapear sola.
    sheetInforme.addRow([]);
    const notaCobranzasVsFondos =
        '\u2501'.repeat(64) + '\n' +
        'COBRANZAS vs FONDOS \u2014 por qu\u00e9 pueden mostrar totales distintos\n' +
        '\u2501'.repeat(64) + '\n' +
        '\n' +
        'Cobranzas y Fondos responden preguntas distintas, a prop\u00f3sito:\n' +
        '\n' +
        '  \u2022 Cobranzas responde: "\u00bfqu\u00e9 cobr\u00e9, cu\u00e1ndo, y de qui\u00e9n?"\n' +
        '    \u2192 Es la vista comercial. Usa la fecha en que el cliente pag\u00f3\n' +
        '      (entreg\u00f3 el cheque, pas\u00f3 la tarjeta, transfiri\u00f3).\n' +
        '\n' +
        '  \u2022 Fondos responde: "\u00bfqu\u00e9 plata tengo disponible, y cu\u00e1ndo entr\u00f3\n' +
        '    al banco?"\n' +
        '    \u2192 Es la vista de tesorer\u00eda. Usa la fecha en que esa plata est\u00e1\n' +
        '      efectivamente acreditada y disponible.\n' +
        '\n' +
        'Son dos fechas distintas para el mismo hecho, no un error de carga.\n' +
        'En un per\u00edodo con solo cobros en efectivo (donde ambas fechas\n' +
        'coinciden), los dos totales cierran exactos.\n' +
        '\n' +
        'Cuando el total NO coincide, casi siempre es por una de estas 4\n' +
        'situaciones \u2014 todas esperadas:\n' +
        '\n' +
        '\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n' +
        '\u2502 Situaci\u00f3n              \u2502 Qu\u00e9 pasa                       \u2502 Aparece en \u2502\n' +
        '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n' +
        '\u2502 Cobro con tarjeta o    \u2502 Cobranzas lo cuenta el d\u00eda que \u2502 Cobranzas: \u2502\n' +
        '\u2502 cheque                 \u2502 el cliente pag\u00f3. Fondos lo     \u2502 este mes.  \u2502\n' +
        '\u2502                        \u2502 cuenta el d\u00eda que el banco lo  \u2502 Fondos:    \u2502\n' +
        '\u2502                        \u2502 acredita (la diferencia m\u00e1s    \u2502 mes sgte.  \u2502\n' +
        '\u2502                        \u2502 com\u00fan).                        \u2502            \u2502\n' +
        '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n' +
        '\u2502 Saldo a favor del      \u2502 Entra al banco (es plata       \u2502 Cobranzas: \u2502\n' +
        '\u2502 cliente                \u2502 real), pero no cancela una     \u2502 suma.      \u2502\n' +
        '\u2502                        \u2502 cuenta corriente, as\u00ed que      \u2502 Fondos: lo \u2502\n' +
        '\u2502                        \u2502 Fondos lo registra aparte.     \u2502 separa     \u2502\n' +
        '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n' +
        '\u2502 Retenci\u00f3n sufrida      \u2502 Est\u00e1 incluida en lo cobrado,   \u2502 Est\u00e1 en    \u2502\n' +
        '\u2502                        \u2502 pero en Fondos se registra en  \u2502 ambos, con \u2502\n' +
        '\u2502                        \u2502 un fondo propio (no es plata   \u2502 distinta   \u2502\n' +
        '\u2502                        \u2502 bancarizada).                  \u2502 etiqueta   \u2502\n' +
        '\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n' +
        '\u2502 Recibo anulado en el   \u2502 No suma al total de Cobranzas. \u2502 Cobranzas: \u2502\n' +
        '\u2502 per\u00edodo                \u2502 Est\u00e1 detallado aparte, en      \u2502 en su      \u2502\n' +
        '\u2502                        \u2502 "Recibos dados de baja en el   \u2502 propia     \u2502\n' +
        '\u2502                        \u2502 per\u00edodo" (con motivo). Fondos  \u2502 secci\u00f3n.   \u2502\n' +
        '\u2502                        \u2502 deja el ingreso original MAS   \u2502 Fondos:    \u2502\n' +
        '\u2502                        \u2502 la reversi\u00f3n (historial        \u2502 quedan     \u2502\n' +
        '\u2502                        \u2502 completo).                     \u2502 ambos      \u2502\n' +
        '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n' +
        '\n' +
        'C\u00f3mo verificar si la diferencia es "sana":\n' +
        '\n' +
        '  Cobranzas (sin tarjetas/cheques)\n' +
        '    = Fondos [ventas + cobros de cuenta corriente]\n' +
        '    + Saldos a favor del cliente\n' +
        '    + Retenciones sufridas\n' +
        '    \u2212 Recibos anulados con cobro en el per\u00edodo\n' +
        '\n' +
        '  Si aplicando esta f\u00f3rmula el n\u00famero cierra, la diferencia es\n' +
        '  la esperada. Si sigue sin cerrar, ah\u00ed s\u00ed hay algo para revisar.\n' +
        '\u2501'.repeat(64);
    const filaNotaCobranzasVsFondos = sheetInforme.addRow(['', notaCobranzasVsFondos]);
    sheetInforme.mergeCells(`B${filaNotaCobranzasVsFondos.number}:H${filaNotaCobranzasVsFondos.number}`);
    filaNotaCobranzasVsFondos.getCell(2).font = { name: 'Consolas', size: 9 };
    filaNotaCobranzasVsFondos.getCell(2).alignment = { wrapText: true, vertical: 'top' };

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
        // Nueva (corrección R2 tanda 1, punto 6): distingue un vencimiento pactado
        // (ABM del cliente) de uno estimado (+15 días) - administración usa esta
        // columna para reclamar cobranzas y no puede confundir los dos casos.
        { header: 'Origen del vencimiento', key: 'origenVencimiento', width: 20 },
        { header: 'Fecha de entrega', key: 'fechaEntrega', width: 16 },
        { header: 'Depósito', key: 'deposito', width: 14 },
        { header: 'Moneda', key: 'moneda', width: 10 },

        { header: 'Cant. prendas', key: 'cantPrendas', width: 12 },
        { header: 'Cant. servicios', key: 'cantServicios', width: 12 },
        { header: 'Venta $', key: 'venta', width: 14 },
        { header: 'Servicio $', key: 'servicio', width: 14 },
        { header: 'Descuento $', key: 'descuentoMonto', width: 14 },
        { header: 'Descuento (%)', key: 'descuentoPorcentaje', width: 12 },
        { header: 'Ajuste transferencia $', key: 'ajusteTransferencia', width: 16 },
        { header: 'Redondeo $', key: 'redondeo', width: 12 },

        // Apertura de IVA por alícuota (HANDOFF-apertura-iva-R1.md, B4-203; reubicado
        // acá en la corrección del 21/09/2026 §3 - único bloque de IVA de la hoja,
        // reemplaza a "Neto gravado"/"Exento / No gravado"/"IVA"/"Percepciones" que
        // vivían acá antes). Solo para facturantes Responsable Inscripto (condición
        // del FACTURANTE, no del comprobante), separado por alícuota. Monotributista
        // va con las 5 columnas vacías (NULL, no 0): no discrimina IVA, y un 0 ahí
        // afirmaría "facturó y no tributó IVA" - falso (§3 del handoff original). Hoy
        // el 100% de lo facturado por un RI es al 21% (verificado contra toda la
        // base, §4 del handoff); las columnas de 10,5% quedan en 0 por completitud
        // del cuadro fiscal - ver nota al pie en la hoja Informe. Sin columna de
        // percepciones (§5 del handoff original: no existe el dato, y
        // estructuralmente solo podría aplicar a 1 de los 6 facturantes) - no vuelve.
        { header: 'Neto gravado 21%', key: 'netoGravado21', width: 16 },
        { header: 'IVA 21%', key: 'iva21', width: 14 },
        { header: 'Neto gravado 10,5%', key: 'netoGravado105', width: 16 },
        { header: 'IVA 10,5%', key: 'iva105', width: 14 },
        { header: 'No gravado / exento', key: 'noGravadoExento', width: 16 },

        { header: 'Total comprobante', key: 'totalComprobante', width: 16 },

        { header: 'Medios de pago (resumen)', key: 'metodosPago', width: 26 },
        { header: 'Montos de pago (resumen)', key: 'montosPago', width: 26 },
        // Punto 1 (21/09/2026): "Montos de pago" sigue siendo texto cuando el
        // comprobante tiene VARIOS medios (no se puede meter dos importes en una
        // celda numérica), pero con UN solo medio ahora es número (antes salía
        // string incluso en ese caso - único punto de B4-204 que seguía abierto).
        // Esta columna es la que suma siempre, tenga uno o varios medios.
        { header: 'Total pagado $', key: 'totalPagado', width: 16 },

        { header: 'CAE', key: 'cae', width: 18 },
        { header: 'Vto CAE', key: 'caeVto', width: 14 },
        { header: 'Comprobante origen', key: 'comprobanteOrigen', width: 20 },
        { header: 'Motivo / Observación', key: 'motivo', width: 30 },
        { header: 'Remito', key: 'remito', width: 16 },
    ];
    aplicarEstiloEncabezado(sheetVentas.getRow(1));

    const COLUMNAS_MONEDA = [
        'venta', 'servicio', 'descuentoMonto', 'ajusteTransferencia', 'redondeo', 'totalComprobante',
        'totalPagado',
    ];

    filas.forEach(r => {
        // Fecha de vencimiento con fallback de +15 días (corrección R2 tanda 1,
        // punto 6): v.fechaVencimiento manda si tiene valor (es el plazo real,
        // derivado del diasVencimiento del cliente al emitir); si está vacía y el
        // comprobante es Factura o Cotización, se ESTIMA en emisión + 15 días -
        // nunca se persiste, se calcula acá y se marca en "Origen del vencimiento".
        // NC/ND quedan siempre vacías (no vencen) - ver §6 del handoff.
        let fechaVencimientoFinal: Date | null = null;
        let origenVencimiento = '';
        if (r.fechaVencimiento) {
            fechaVencimientoFinal = moment.utc(r.fechaVencimiento).startOf('day').toDate();
            // diasVencimientoCliente es el plazo ACTUAL del cliente (c.diasVencimiento) -
            // si cambió después de esta venta, el texto no refleja el que se usó en su
            // momento. Aceptado: es solo informativo, la fecha en sí no se recalcula.
            origenVencimiento = `Cliente (${r.diasVencimientoCliente ?? '?'} días)`;
        } else if (Number(r.idProcesoRaw) === IdProceso.FACTURA || Number(r.idProcesoRaw) === IdProceso.COTIZACION) {
            fechaVencimientoFinal = moment.utc(r.fecha).startOf('day').add(15, 'days').toDate();
            origenVencimiento = 'Estimado (+15 días)';
        }

        // Apertura de IVA por alícuota (HANDOFF-apertura-iva-R1.md §3): aplica solo
        // si el facturante es Responsable Inscripto Y el comprobante es fiscal (si
        // no hay ventas_factura, p.ej. una Cotización de un RI, tampoco hay neto/IVA
        // confirmado por ARCA - mismo criterio "vacío, no derivado" que ya usan
        // netoGravado/iva más abajo). Se guarda en r (no solo en la fila de Excel)
        // porque el bloque "Apertura de IVA por facturante" de la hoja Totales, más
        // abajo, reusa estas mismas filas.
        // Corrección 21/09/2026 (HANDOFF-apertura-iva-libro-iva-ventas.md §2): la
        // apertura por alícuota ahora vive en aperturaIva.ts, compartida con el
        // Libro IVA Ventas - un solo cálculo para los dos informes, nunca dos
        // copias que puedan desalinearse.
        const esFiscal = r.fiscal === 'S';
        const apertura = aperturaIva({
            esFiscal,
            condicionFacturante: r.condicionFacturante,
            neto: r.netoGravado,
            iva: r.iva,
        });
        r.netoGravado21 = apertura.netoGravado21;
        r.iva21 = apertura.iva21;
        r.netoGravado105 = apertura.netoGravado105;
        r.iva105 = apertura.iva105;
        r.noGravadoExento = apertura.noGravadoExento;
        // Corrección 21/09/2026 §1: única resolución de neto/IVA fiscal, reusada por
        // el bloque "Resumen por condición fiscal" de la hoja Totales más abajo - ANTES
        // ese bloque volvía a sumar r.netoGravado/r.iva crudos (que para un comprobante
        // NO fiscal siguen trayendo el derivado v.total/1.21 de la query, aunque la
        // hoja Ventas ya no lo muestre), y reaparecía el IVA al 21% inventado sobre
        // Cotizaciones/NC X. Vacío (NULL), no cero, cuando no es fiscal - mismo
        // criterio que toda columna fiscal de este archivo. Independiente de la
        // apertura por alícuota (esto no distingue RI de Monotributista).
        r.netoGravadoResuelto = esFiscal ? (Number(r.netoGravado) || 0) : null;
        r.ivaResuelto = esFiscal ? (Number(r.iva) || 0) : null;

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
            fechaVencimiento: fechaVencimientoFinal,
            origenVencimiento,
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
            // Corrección 21/09/2026 (pedido 2 veces por el cliente): número entero de
            // porcentaje (50, 21), no fracción con formato %. r.descuentoPorcentaje sigue
            // viniendo de SQL como fracción 0..1 (sin tocar esa query) - se multiplica acá.
            descuentoPorcentaje: round2((Number(r.descuentoPorcentaje) || 0) * 100),
            ajusteTransferencia: Number(r.ajusteTransferencia) || 0,
            redondeo: Number(r.redondeo) || 0,
            totalComprobante: Number(r.totalComprobante) || 0,

            // Agrupado por método, sumando importes (corrección presentación
            // 15/09/2026, B4-216/B4-217): antes "Efectivo;Efectivo" con 100 y
            // 200 salía tal cual, dos entradas del mismo método sin sumar - la
            // queja original del cliente. Solo agrupa/suma - no cambia qué
            // pagos existen ni sus montos, no toca ningún total. No se saca
            // la columna: el detalle por cobro con fecha está en "Cobranzas",
            // pero una venta de fin de mes cobrada el mes siguiente no
            // aparece en el "Cobranzas" de ESE período - el resumen acá sigue
            // sirviendo para saber cómo se pagó esa venta.
            ...agruparMediosDePago(r.metodosPago, r.montosPago),

            cae: r.cae != null ? String(r.cae) : '',
            caeVto: r.caeVto ? moment.utc(r.caeVto).startOf('day').toDate() : null,
            comprobanteOrigen: armarComprobanteOrigen(r),
            motivo: r.motivo ?? '',
            remito: r.remito,

            netoGravado21: r.netoGravado21,
            iva21: r.iva21,
            netoGravado105: r.netoGravado105,
            iva105: r.iva105,
            noGravadoExento: r.noGravadoExento,
        });

        fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
        if (fechaVencimientoFinal) fila.getCell('fechaVencimiento').numFmt = 'dd/mm/yyyy';
        if (r.fechaEntrega) fila.getCell('fechaEntrega').numFmt = 'dd/mm/yyyy';
        if (r.caeVto) fila.getCell('caeVto').numFmt = 'dd/mm/yyyy';
        fila.getCell('cae').numFmt = '@'; // texto: evita notación científica en los 14 dígitos del CAE.
        fila.getCell('descuentoPorcentaje').numFmt = '0.00';
        COLUMNAS_MONEDA.forEach(key => { fila.getCell(key).numFmt = '#,##0.00'; }); // sin "$", pedido B4-204.
        // Punto 1: "montosPago" es tipo mixto (número con 1 medio, texto con varios) - no
        // puede ir en COLUMNAS_MONEDA (esa lista asume numérico siempre). Formato solo
        // cuando el valor realmente quedó numérico.
        if (typeof fila.getCell('montosPago').value === 'number') fila.getCell('montosPago').numFmt = '#,##0.00';
        // Fuera de COLUMNAS_MONEDA a propósito (§2 del handoff de apertura de IVA):
        // esa lista alimenta columnasSumar/escribirFilaTotal más abajo, y estas 5
        // columnas nunca deben sumarse en un total general que mezcle un Responsable
        // Inscripto con Monotributistas - el subtotal correcto es por facturante, en
        // la hoja Totales (bloque "Apertura de IVA por facturante").
        ['netoGravado21', 'iva21', 'netoGravado105', 'iva105', 'noGravadoExento'].forEach(key => {
            if (fila.getCell(key).value !== null) fila.getCell(key).numFmt = '#,##0.00';
        });

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

    // Corrección 21/09/2026 §1: las filas TOTAL de esta hoja solo totalizan columnas
    // de gestión (cantidades, Venta $/Servicio $/Descuento $/Ajuste transferencia $/
    // Redondeo $/Total comprobante) - las 5 columnas de apertura de IVA NUNCA se
    // totalizan acá (ni siquiera en TOTAL FISCAL): mezclarían Responsable Inscripto
    // con Monotributistas por alícuota. Ese subtotal, el único que significa algo,
    // vive por facturante en la hoja Totales ("Apertura de IVA por facturante") - por
    // eso quedan fuera de columnasSumar (siguen sin estar en COLUMNAS_MONEDA).
    const columnasSumar = ['cantPrendas', 'cantServicios', ...COLUMNAS_MONEDA];

    const escribirFilaTotal = (etiqueta: string, filasDelTotal: any[], opciones: { resaltar?: boolean } = {}) => {
        const { resaltar = false } = opciones;
        const fila = sheetVentas.rowCount + 1;
        sheetVentas.getCell(`A${fila}`).value = etiqueta;
        columnasSumar.forEach(key => {
            const celda = sheetVentas.getCell(`${sheetVentas.getColumn(key).letter}${fila}`);
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
    escribirFilaTotal('TOTAL NO FISCAL', filasNoFiscales);
    escribirFilaTotal('TOTAL GENERAL', filasParaTotal);

    // Ajuste de ancho fijo (ver columns arriba): NO usar autoFitColumns() del
    // servicio actual acá - con ~48 columnas y varios miles de filas y se nota
    // (advertencia §9 del handoff).

    // =========================
    // HOJA 3: DETALLE VALORIZADO (R2)
    // =========================
    // 1 fila por línea de cada comprobante (o por talle si formatoLargo=true,
    // §7) más las pseudolíneas de §5. La valorización (convención BRUTO/NETO,
    // IVA por prorrateo de vf.iva, pseudolíneas, residual) sucede acá en TS -
    // ver valorizarComprobante() más abajo y el comentario de ObtenerDetalleLineas
    // en conciliacionRepository.ts sobre por qué no va en SQL.
    const sheetDetalle = workbook.addWorksheet('Detalle valorizado');
    sheetDetalle.columns = [
        { header: 'ID Venta', key: 'idVenta', width: 10 },
        { header: 'N° proceso', key: 'nroProceso', width: 12 },
        { header: 'Punto de venta', key: 'puntoVenta', width: 14 },
        { header: 'Tipo comprobante', key: 'tipoComprobante', width: 18 },
        { header: 'N° comprobante', key: 'nroComprobante', width: 14 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Fiscal', key: 'fiscal', width: 8 },
        { header: 'Cód. cliente', key: 'codCliente', width: 12 },
        { header: 'Cliente', key: 'cliente', width: 30 },
        { header: 'Canal de venta', key: 'canalVenta', width: 16 },

        { header: 'N° línea', key: 'nroLinea', width: 10 },
        { header: 'Tipo de ítem', key: 'tipoItem', width: 20 },
        { header: 'SKU', key: 'sku', width: 18 },
        { header: 'Cód. artículo', key: 'codArticulo', width: 12 },
        { header: 'Descripción', key: 'descripcion', width: 30 },
        { header: 'Producto', key: 'producto', width: 16 },
        { header: 'Tipo', key: 'tipo', width: 14 },
        { header: 'Género', key: 'genero', width: 12 },
        { header: 'Material', key: 'material', width: 14 },
        { header: 'Color', key: 'color', width: 14 },
        // Nueva (corrección tanda 1, punto 5 / B4-213): existe en productos.idTemporada,
        // sin migración. Solo catálogo; vacía en servicios, no catalogados y pseudolíneas.
        { header: 'Temporada', key: 'temporada', width: 16 },
        { header: 'Talle', key: 'talle', width: 16 },
        // Punto 6: S/N para filtrar/contar sin leer el texto de "Talle". Solo tiene
        // sentido para líneas de Producto (catálogo) - vacío en No catalogado/Servicio.
        { header: 'Talle desglosado', key: 'talleDesglosado', width: 14 },
        { header: 'Cantidad', key: 'cantidad', width: 10 },

        { header: 'Precio de lista unit.', key: 'precioListaUnit', width: 16 },
        { header: 'Desc. (%)', key: 'pctDesc', width: 10 },
        { header: 'Precio unit. neto', key: 'precioUnitNeto', width: 16 },
        // Punto 4 (21/09/2026): solo se renombran encabezados, ningún cálculo cambia.
        // "Importe bruto" y "Importe neto" mezclaban dos ejes distintos (uno hablaba del
        // descuento, el otro del IVA) y la resta entre columnas vecinas no cerraba, lo que
        // iba a generar tickets de soporte apenas alguien armara una dinámica. Ahora la
        // cadena se lee sola: "Importe s/ descuento" − "Importe descuento" = "Importe
        // total", y "Neto gravado" + IVA = "Importe total".
        { header: 'Importe s/ descuento', key: 'importeBruto', width: 16 },
        { header: 'Importe descuento', key: 'importeDesc', width: 16 },
        { header: 'Neto gravado', key: 'importeNeto', width: 14 },
        // "Alíc. IVA" ahora es la tasa EFECTIVA (IVA/neto), no 21% fijo - corrección
        // tanda 1 punto 1: en Factura C da 0%, sale solo del prorrateo de vf.iva.
        { header: 'Alíc. IVA (%)', key: 'alicIva', width: 10 },
        { header: 'IVA', key: 'iva', width: 14 },
        { header: 'Importe total', key: 'importeTotal', width: 14 },
        // B4-209 Fase 3: costo y margen por línea (§4.b del handoff - gateado por rol,
        // ver puedeVerCosto más arriba). Van DESPUÉS de "Importe total", orden del
        // ejemplo del cliente. Vacías en Servicio/No catalogado/pseudolíneas - nunca 0,
        // ver comentario en valorizarComprobante().
        ...(puedeVerCosto ? [
            { header: 'Costo unitario', key: 'costoUnitario', width: 14 },
            { header: 'Costo total', key: 'costoTotal', width: 14 },
            { header: 'Margen $', key: 'margen', width: 14 },
            { header: 'Margen %', key: 'margenPct', width: 12 },
        ] : []),
    ];
    aplicarEstiloEncabezado(sheetDetalle.getRow(1));

    const COLUMNAS_MONEDA_DETALLE = [
        'precioListaUnit', 'precioUnitNeto', 'importeBruto', 'importeDesc', 'importeNeto', 'iva', 'importeTotal',
        ...(puedeVerCosto ? ['costoUnitario', 'costoTotal', 'margen'] : []),
    ];

    // idVenta -> convención detectada (§4.a), total del detalle, IVA cabecera/detalle
    // (signados) - los usa la hoja "Control".
    const convencionPorVenta = new Map<number, Convencion>();
    const totalDetallePorVenta = new Map<number, number>();
    const ivaCabeceraPorVenta = new Map<number, number>();
    const ivaDetallePorVenta = new Map<number, number>();
    const tienePseudolineaDifPorVenta = new Map<number, boolean>();

    const lineasPorVenta = new Map<number, any[]>();
    lineasDetalle.forEach(l => {
        if (!lineasPorVenta.has(l.idVenta)) lineasPorVenta.set(l.idVenta, []);
        lineasPorVenta.get(l.idVenta)!.push(l);
    });

    filas.forEach(cabecera => {
        const lineasCrudas = lineasPorVenta.get(cabecera.idVenta) ?? [];
        const resultado = valorizarComprobante(cabecera, lineasCrudas, formatoLargo);

        convencionPorVenta.set(cabecera.idVenta, resultado.convencion);
        totalDetallePorVenta.set(cabecera.idVenta, resultado.totalDetalle);
        ivaCabeceraPorVenta.set(cabecera.idVenta, resultado.ivaCabecera);
        ivaDetallePorVenta.set(cabecera.idVenta, resultado.ivaDetalle);
        tienePseudolineaDifPorVenta.set(cabecera.idVenta, resultado.tuvoPseudolineaDiferencia);

        resultado.filas.forEach(f => {
            const fila = sheetDetalle.addRow({
                idVenta: cabecera.idVenta,
                nroProceso: cabecera.nroProceso,
                puntoVenta: cabecera.puntoVenta,
                tipoComprobante: cabecera.tipoComprobante,
                nroComprobante: cabecera.nroComprobante,
                fecha: moment.utc(cabecera.fecha).startOf('day').toDate(),
                fiscal: cabecera.fiscal,
                codCliente: cabecera.codCliente,
                cliente: cabecera.razonSocial,
                canalVenta: cabecera.canalVenta,
                ...f,
            });
            fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
            if (f.pctDesc != null) fila.getCell('pctDesc').numFmt = '0.00';
            fila.getCell('alicIva').numFmt = '0.00';
            if (puedeVerCosto && f.margenPct != null) fila.getCell('margenPct').numFmt = '0.00%';
            COLUMNAS_MONEDA_DETALLE.forEach(key => { fila.getCell(key).numFmt = '#,##0.00'; });
        });
    });

    const ultimaColumnaDetalle = columnaExcel(sheetDetalle.columns!.length);
    sheetDetalle.autoFilter = { from: 'A1', to: `${ultimaColumnaDetalle}1` };
    sheetDetalle.views = [{ state: 'frozen', ySplit: 1 }];
    // Ancho fijo (mismo motivo que la hoja "Ventas"): con ~700-1500 filas por mes
    // (o varias veces más en formato largo) autoFitColumns() no es viable.

    // Totales generales (se reusan acá y en la hoja "Control" - una sola cuenta).
    const totalCabeceraGeneral = round2(filas.reduce((acc, c) => acc + (Number(c.totalComprobante) || 0), 0));
    const totalDetalleGeneral = round2(Array.from(totalDetallePorVenta.values()).reduce((acc, v) => acc + v, 0));
    const ivaCabeceraGeneral = round2(Array.from(ivaCabeceraPorVenta.values()).reduce((acc, v) => acc + v, 0));
    const ivaDetalleGeneral = round2(Array.from(ivaDetallePorVenta.values()).reduce((acc, v) => acc + v, 0));

    // Resumen de 3 líneas al pie del detalle (corrección tanda 1, punto 4.a): es
    // el control "a simple vista" que el cliente dibujó en su ejemplo, para quien
    // abre solo esta hoja. La hoja "Control" no se toca - sigue siendo la que
    // sirve para encontrar CUÁL comprobante falla cuando esto no da cero.
    //
    // Corrección tanda 2, punto 3: el importe va bajo la columna "Importe total",
    // no en A/B/C - con ~30 columnas quedaba flotando lejos de la suya. La etiqueta
    // ocupa el resto de la fila, de A hasta la columna anterior a "Importe total"
    // (merge para que se lea de corrido).
    //
    // B4-209 Fase 3: "Importe total" YA NO es necesariamente la última columna (las
    // 4 de costo/margen se agregan después, cuando puedeVerCosto) - se busca su
    // índice en vez de asumir sheetDetalle.columns!.length, que ahora apuntaría a
    // "Margen %" y desubicaría todo este bloque de control.
    const indiceImporteTotalDetalle = sheetDetalle.columns!.findIndex(c => c.key === 'importeTotal') + 1;
    const colImporteTotalDetalle = columnaExcel(indiceImporteTotalDetalle);
    const colAntesImporteTotalDetalle = columnaExcel(indiceImporteTotalDetalle - 1);
    const escribirFilaResumenDetalle = (etiqueta: string, valor: number) => {
        const fila = sheetDetalle.rowCount + 1;
        sheetDetalle.mergeCells(`A${fila}:${colAntesImporteTotalDetalle}${fila}`);
        sheetDetalle.getCell(`A${fila}`).value = etiqueta;
        const celdaValor = sheetDetalle.getCell(`${colImporteTotalDetalle}${fila}`);
        celdaValor.value = valor;
        celdaValor.numFmt = '#,##0.00';
        sheetDetalle.getRow(fila).font = { bold: true };
    };
    sheetDetalle.addRow([]);
    sheetDetalle.getCell(`A${sheetDetalle.rowCount}`).value = 'CONTROL';
    sheetDetalle.getCell(`A${sheetDetalle.rowCount}`).font = { bold: true, italic: true };
    escribirFilaResumenDetalle('Importe total del detalle', totalDetalleGeneral);
    escribirFilaResumenDetalle('Total del comprobante en la cabecera', totalCabeceraGeneral);
    escribirFilaResumenDetalle('Diferencia (debe ser cero)', round2(totalCabeceraGeneral - totalDetalleGeneral));

    // =========================
    // HOJA 4: COBRANZAS (R3)
    // =========================
    // 1 fila por cobro (no por comprobante), filtrada por fecha de COBRO - ver
    // comentario del parámetro `cobranzas` y HANDOFF-informes-administracion-R3.md
    // §2/§5/§6. `calcularCobranzas` arma el arrastre (Saldo pendiente, Días de
    // atraso) sobre el UNIVERSO completo de cada comprobante antes de filtrar
    // a las filas del período - así el saldo es correcto aunque la factura se
    // haya empezado a cobrar antes del período pedido.
    const sheetCobranzas = workbook.addWorksheet('Cobranzas');

    sheetCobranzas.getCell('A1').value =
        'Esta hoja filtra por FECHA DE COBRO, no por fecha de comprobante (a diferencia de "Ventas" y "Detalle valorizado", que filtran por fecha de emisión) - un mismo período puede no coincidir entre hojas. Los totales de esta hoja (ver "Totales") son los que concilian contra ingresos reales de caja/banco.';
    sheetCobranzas.getCell('A1').font = { italic: true, bold: true };
    sheetCobranzas.getCell('A1').alignment = { wrapText: true };

    const columnasCobranzas: Partial<ExcelJS.Column>[] = [
        { key: 'tipoCobro', width: 24 },
        { key: 'fechaCobro', width: 12 },
        { key: 'codCliente', width: 12 },
        { key: 'cliente', width: 28 },
        { key: 'puntoVenta', width: 14 },
        { key: 'tipoComprobante', width: 18 },
        { key: 'nroComprobante', width: 14 },
        { key: 'fiscal', width: 8 },
        { key: 'facturante', width: 22 },
        { key: 'nroProceso', width: 12 },
        { key: 'condicionVenta', width: 16 },
        { key: 'fechaComprobante', width: 14 },
        { key: 'totalComprobante', width: 16 },
        { key: 'fechaVencimiento', width: 14 },
        { key: 'origenVencimiento', width: 20 },
        { key: 'importeCobrado', width: 16 },
        { key: 'medioCobro', width: 20 },
        { key: 'fondo', width: 16 },
        { key: 'empresaCobro', width: 22 },
        { key: 'estadoIngreso', width: 22 },
        { key: 'numeroOperacion', width: 16 },
        { key: 'estadoValor', width: 16 },
        { key: 'importeValor', width: 16 },
        { key: 'saldoPendiente', width: 16 },
        { key: 'diasAtraso', width: 14 },
        { key: 'idVentaCab', width: 10 },
        { key: 'idPago', width: 12 },
    ];
    sheetCobranzas.columns = columnasCobranzas;

    const ultimaColumnaCobranzas = columnaExcel(columnasCobranzas.length);
    sheetCobranzas.mergeCells(`A1:${ultimaColumnaCobranzas}1`);

    const encabezadosCobranzas = [
        // Tipo de cobro bien a la izquierda, junto a las columnas de comprobante
        // (decisión explícita de Nahu, R3): se entiende de entrada por qué las
        // filas de Saldo inicial / Saldo a favor vienen con esas columnas vacías.
        'Tipo de cobro', 'Fecha de cobro', 'Cód. cliente', 'Cliente',
        'Punto de venta', 'Tipo comprobante', 'N° comprobante', 'Fiscal', 'Facturante',
        'N° proceso', 'Condición de venta', 'Fecha comprobante', 'Total comprobante',
        'Fecha de vencimiento', 'Origen del vencimiento',
        'Importe cobrado', 'Medio de cobro', 'Fondo', 'Empresa del cobro',
        'Estado del ingreso', 'N° de operación', 'Estado del valor', 'Importe del valor',
        'Saldo pendiente', 'Días de atraso',
        'ID venta', 'Ref. interna',
    ];
    const filaHeaderCobranzas = sheetCobranzas.addRow(encabezadosCobranzas);
    aplicarEstiloEncabezado(filaHeaderCobranzas);

    const filasCobranzasCalculadas = calcularCobranzas(cobranzas.filasPeriodo, cobranzas.filasUniverso);

    const COLUMNAS_MONEDA_COBRANZAS = ['totalComprobante', 'importeCobrado', 'importeValor', 'saldoPendiente'];

    filasCobranzasCalculadas.forEach(f => {
        const fila = sheetCobranzas.addRow({
            tipoCobro: f.tipoCobro,
            fechaCobro: f.fechaCobro ? moment.utc(f.fechaCobro).startOf('day').toDate() : null,
            codCliente: f.codCliente,
            cliente: f.cliente,
            puntoVenta: f.puntoVenta ?? '',
            tipoComprobante: f.tipoComprobante ?? '',
            nroComprobante: f.nroComprobante ?? '',
            fiscal: f.fiscal ?? '',
            facturante: f.facturante ?? '',
            nroProceso: f.nroProceso ?? '',
            condicionVenta: f.condicionVenta ?? '',
            fechaComprobante: f.fechaComprobante ? moment.utc(f.fechaComprobante).startOf('day').toDate() : null,
            totalComprobante: f.totalComprobante != null ? Number(f.totalComprobante) : null,
            fechaVencimiento: f.fechaVencimientoFinal,
            origenVencimiento: f.origenVencimiento,
            importeCobrado: Number(f.importeCobrado) || 0,
            medioCobro: f.medioCobro ?? '',
            fondo: f.fondo ?? '',
            // Punto 5: a qué EMPRESA entró la plata (metodos_pago.idEmpresa), distinto de
            // "Facturante" (quién emitió el comprobante) - no siempre coinciden, ver las 48
            // filas de Saldo a favor/Cancelación de saldo inicial (punto 7) donde Facturante
            // va vacío pero acá sí hay dato.
            empresaCobro: f.empresaCobro ?? '',
            estadoIngreso: f.estadoIngreso,
            numeroOperacion: f.numeroOperacion ?? '',
            estadoValor: f.estadoValor ?? '',
            importeValor: f.importeValor != null ? Number(f.importeValor) : null,
            saldoPendiente: f.saldoPendiente,
            diasAtraso: f.diasAtraso,
            idVentaCab: f.idVentaCab,
            idPago: f.idPago,
        });
        fila.getCell('fechaCobro').numFmt = 'dd/mm/yyyy';
        if (f.fechaComprobante) fila.getCell('fechaComprobante').numFmt = 'dd/mm/yyyy';
        if (f.fechaVencimientoFinal) fila.getCell('fechaVencimiento').numFmt = 'dd/mm/yyyy';
        COLUMNAS_MONEDA_COBRANZAS.forEach(key => { fila.getCell(key).numFmt = '#,##0.00'; });
        // Rechazado bien visible (decisión de Nahu - "es una venta que figura
        // cobrada y cuya plata nunca entró"): mismo resaltado rojo que usa la
        // hoja "Control" para diferencias.
        if (f.estadoIngreso === 'Rechazado') {
            fila.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; });
            fila.font = { bold: true };
        }
        // "Revisar (fondo sin clasificar)": fondos.tipo con un valor que no
        // está en ninguna de las dos listas de ArmarBaseCobranzas - visible en
        // amarillo, no perdido en silencio (mismo criterio que llevó a agregar
        // este 5° valor: no confiar en un default silencioso en ninguna
        // dirección).
        if (f.estadoIngreso === 'Revisar (fondo sin clasificar)') {
            fila.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } }; });
            fila.font = { bold: true };
        }
        // Corrección presentación 15/09/2026: sin distinción visual - "Días de
        // atraso" queda con el mismo color que el resto de las celdas, aunque
        // el vencimiento sea estimado (+15 días). "Origen del vencimiento" ya
        // es la columna que dice cuál es el caso, no hace falta remarcarlo acá.
    });

    sheetCobranzas.autoFilter = { from: 'A2', to: `${ultimaColumnaCobranzas}2` };
    sheetCobranzas.views = [{ state: 'frozen', ySplit: 2 }];

    // Resumen al pie (CORRECCIÓN R3, 15/09/2026, punto 3): antes una sola fila
    // "Total cobrado" sumaba también la financiación de cuenta corriente y
    // llamaba "cobranza" a algo que no lo era - con el fix del punto 2 (CC ya
    // no tiene fila propia) el número se arregla solo, pero la etiqueta seguía
    // mal. Ahora se desglosa por las 4 categorías de Estado del ingreso (cada
    // importe bajo su propia columna, mismo criterio que ya usa "Detalle
    // valorizado" y "Control"), más el total general con el nombre correcto.
    // "Rechazado" se escribe SIEMPRE, aunque dé $0 - que se vea que se miró.
    const colImporteCobradoCobranzas = sheetCobranzas.getColumn('importeCobrado').letter;
    const escribirFilaResumenCobranzas = (etiqueta: string, valor: number, resaltar = false) => {
        const fila = sheetCobranzas.rowCount + 1;
        sheetCobranzas.getCell(`A${fila}`).value = etiqueta;
        const celdaValor = sheetCobranzas.getCell(`${colImporteCobradoCobranzas}${fila}`);
        celdaValor.value = valor;
        celdaValor.numFmt = '#,##0.00';
        sheetCobranzas.getRow(fila).font = { bold: true };
        if (resaltar) {
            sheetCobranzas.getRow(fila).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; });
        }
    };
    const sumarPorEstadoIngreso = (estado: string) => round2(
        filasCobranzasCalculadas.filter(f => f.estadoIngreso === estado)
            .reduce((acc, f) => acc + (Number(f.importeCobrado) || 0), 0)
    );
    const totalMovimientosHoja = round2(filasCobranzasCalculadas.reduce((acc, f) => acc + (Number(f.importeCobrado) || 0), 0));
    sheetCobranzas.addRow([]);
    escribirFilaResumenCobranzas('Ingresó (cruzar contra caja/banco)', sumarPorEstadoIngreso('Ingresó'));
    escribirFilaResumenCobranzas('Pendiente de acreditación', sumarPorEstadoIngreso('Pendiente de acreditación'));
    escribirFilaResumenCobranzas('Rechazado', sumarPorEstadoIngreso('Rechazado'), true);
    // 5° valor (ver ArmarBaseCobranzas): con los datos de hoy este bucket
    // queda en $0, pero la fila se escribe SIEMPRE - un fondo nuevo sin
    // clasificar tiene que aparecer acá, no perderse dentro de otra categoría.
    escribirFilaResumenCobranzas('Revisar (fondo sin clasificar)', sumarPorEstadoIngreso('Revisar (fondo sin clasificar)'), sumarPorEstadoIngreso('Revisar (fondo sin clasificar)') !== 0);
    escribirFilaResumenCobranzas('No es ingreso', sumarPorEstadoIngreso('No es ingreso'));
    escribirFilaResumenCobranzas('Total de movimientos de la hoja', totalMovimientosHoja);

    // --- R3, corrección 15/09/2026, fix 4.b: recibos dados de baja en el período ---
    // DarBajaRecibo() NO borra el recibo (queda con fechaBaja + motivo), pero SÍ
    // borra en cascada sus movimientos de cobro - por eso una corrida futura del
    // mismo período puede no coincidir con esta. En vez de que la plata "no esté"
    // sin explicación, se lista qué se anuló, cuándo y por qué (trazabilidad -
    // ver nota de la hoja "Informe").
    const filaTituloBajas = sheetCobranzas.rowCount + 2;
    sheetCobranzas.getCell(`A${filaTituloBajas}`).value = 'Recibos dados de baja en el período';
    sheetCobranzas.getRow(filaTituloBajas).font = { bold: true, italic: true };
    const filaHeaderBajas = sheetCobranzas.addRow(['ID recibo', 'Fecha', 'Cód. cliente', 'Cliente', 'Total', 'Fecha de baja', 'Motivo']);
    aplicarEstiloEncabezado(filaHeaderBajas);
    if (recibosDadosDeBaja.length === 0) {
        const filaSinBajas = sheetCobranzas.addRow(['', '', '', 'Sin recibos anulados en el período', '', '', '']);
        filaSinBajas.font = { italic: true };
    } else {
        recibosDadosDeBaja.forEach(rb => {
            // addRow([]) + celdas por posición a propósito: este bloque tiene su
            // propio layout de 7 columnas, no las 26 (por key) de la tabla de arriba.
            const fila = sheetCobranzas.addRow([]);
            fila.getCell(1).value = rb.id;
            fila.getCell(2).value = rb.fecha ? moment.utc(rb.fecha).startOf('day').toDate() : null;
            fila.getCell(2).numFmt = 'dd/mm/yyyy';
            fila.getCell(3).value = rb.idCliente;
            fila.getCell(4).value = rb.cliente;
            fila.getCell(5).value = Number(rb.total) || 0;
            fila.getCell(5).numFmt = '#,##0.00';
            fila.getCell(6).value = rb.fechaBaja ? moment.utc(rb.fechaBaja).toDate() : null;
            fila.getCell(6).numFmt = 'dd/mm/yyyy hh:mm';
            fila.getCell(7).value = rb.motivo ?? '';
        });
    }

    // =========================
    // HOJA 5: CONTROL (R2, B4-222)
    // =========================
    // El criterio de aceptación de R2 hecho hoja (§1 y §9 del handoff): 1 fila
    // por comprobante (mismo universo que la hoja "Ventas", incluidas anuladas
    // si se pidieron - ver nota de la fila 1: el control valida consistencia de
    // TODOS los comprobantes, vigentes o no, a propósito), ordenada por
    // |Diferencia| + |Diferencia IVA| descendente para que lo que no cierra
    // quede arriba sin buscarlo.
    const sheetControl = workbook.addWorksheet('Control');

    // Nota de alcance (corrección tanda 1, punto 4.c): en fila 1, ANTES del
    // encabezado de la tabla (fila 2) - por eso `columns` acá NO lleva `header`
    // (eso escribiría en la fila 1 y pisaría la nota); el encabezado se escribe
    // a mano en la fila 2.
    const columnasControl: Partial<ExcelJS.Column>[] = [
        { key: 'idVenta', width: 10 },
        { key: 'nroProceso', width: 12 },
        { key: 'tipoComprobante', width: 18 },
        { key: 'nroComprobante', width: 14 },
        { key: 'fiscal', width: 8 },
        { key: 'totalCabecera', width: 16 },
        { key: 'totalDetalle', width: 16 },
        { key: 'diferencia', width: 14 },
        { key: 'ivaCabecera', width: 16 },
        { key: 'ivaDetalle', width: 16 },
        { key: 'diferenciaIva', width: 14 },
        { key: 'convencion', width: 16 },
        { key: 'tienePseudolinea', width: 24 },
    ];
    sheetControl.columns = columnasControl;

    const ultimaColumnaControl = columnaExcel(columnasControl.length);
    sheetControl.getCell('A1').value =
        'Incluye comprobantes anulados: el control valida la consistencia de todos los comprobantes, estén vigentes o no. Los totales de la hoja Ventas excluyen los anulados.';
    sheetControl.getCell('A1').font = { italic: true, bold: true };
    sheetControl.getCell('A1').alignment = { wrapText: true };
    sheetControl.mergeCells(`A1:${ultimaColumnaControl}1`);

    const encabezadosControl = [
        'ID Venta', 'N° proceso', 'Tipo comprobante', 'N° comprobante', 'Fiscal',
        'Total cabecera', 'Total detalle', 'Diferencia',
        'IVA cabecera', 'IVA detalle', 'Diferencia IVA',
        'Convención', 'Tiene pseudolínea de diferencia',
    ];
    const filaHeaderControl = sheetControl.addRow(encabezadosControl);
    aplicarEstiloEncabezado(filaHeaderControl);

    // "Diferencia"/"Diferencia IVA" acá van a dar ~0 en prácticamente todas las
    // filas (esa es la función de la pseudolínea "Diferencia no explicada" y del
    // prorrateo de IVA: absorberlas). No es redundante con "Tiene pseudolínea de
    // diferencia": esa columna dice si ESE cero de Importe total es real o fue
    // forzado por un hueco de datos que se tuvo que hacer visible (§4.c).
    const filasControl = filas.map(cabecera => {
        const totalCabecera = Number(cabecera.totalComprobante) || 0;
        const totalDetalle = totalDetallePorVenta.get(cabecera.idVenta) ?? 0;
        const ivaCabecera = ivaCabeceraPorVenta.get(cabecera.idVenta) ?? 0;
        const ivaDetalle = ivaDetallePorVenta.get(cabecera.idVenta) ?? 0;
        return {
            idVenta: cabecera.idVenta,
            nroProceso: cabecera.nroProceso,
            tipoComprobante: cabecera.tipoComprobante,
            nroComprobante: cabecera.nroComprobante,
            fiscal: cabecera.fiscal,
            totalCabecera,
            totalDetalle,
            diferencia: round2(totalCabecera - totalDetalle),
            ivaCabecera,
            ivaDetalle,
            diferenciaIva: round2(ivaCabecera - ivaDetalle),
            convencion: convencionPorVenta.get(cabecera.idVenta) ?? 'INDETERMINADA',
            tienePseudolinea: tienePseudolineaDifPorVenta.get(cabecera.idVenta) ? 'Sí' : 'No',
        };
    }).sort((a, b) => (Math.abs(b.diferencia) + Math.abs(b.diferenciaIva)) - (Math.abs(a.diferencia) + Math.abs(a.diferenciaIva)));

    filasControl.forEach(f => {
        const fila = sheetControl.addRow(f);
        ['totalCabecera', 'totalDetalle', 'diferencia', 'ivaCabecera', 'ivaDetalle', 'diferenciaIva']
            .forEach(key => { fila.getCell(key).numFmt = '#,##0.00'; });
        if (Math.abs(f.diferencia) >= TOL_RESIDUAL || Math.abs(f.diferenciaIva) >= TOL_RESIDUAL) {
            fila.font = { bold: true };
            fila.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; });
        }
    });

    sheetControl.autoFilter = { from: 'A2', to: `${ultimaColumnaControl}2` };
    sheetControl.views = [{ state: 'frozen', ySplit: 2 }];

    // 4 filas al pie (§9 del handoff + corrección tanda 1 punto 1): total
    // cabecera, total detalle, diferencia, y ahora también el IVA - calculadas
    // en backend, no con fórmulas de Excel (B4-218).
    const filaPie1 = sheetControl.rowCount + 2;
    sheetControl.getCell(`A${filaPie1}`).value = 'Total cabecera';
    sheetControl.getCell(`F${filaPie1}`).value = totalCabeceraGeneral;
    sheetControl.getCell(`A${filaPie1 + 1}`).value = 'Total detalle';
    sheetControl.getCell(`G${filaPie1 + 1}`).value = totalDetalleGeneral;
    sheetControl.getCell(`A${filaPie1 + 2}`).value = 'Diferencia (debe ser cero)';
    sheetControl.getCell(`H${filaPie1 + 2}`).value = round2(totalCabeceraGeneral - totalDetalleGeneral);
    sheetControl.getCell(`A${filaPie1 + 3}`).value = 'Diferencia IVA (debe ser cero)';
    sheetControl.getCell(`K${filaPie1 + 3}`).value = round2(ivaCabeceraGeneral - ivaDetalleGeneral);
    [filaPie1, filaPie1 + 1, filaPie1 + 2, filaPie1 + 3].forEach(fila => {
        sheetControl.getRow(fila).font = { bold: true };
    });
    sheetControl.getCell(`F${filaPie1}`).numFmt = '#,##0.00';
    sheetControl.getCell(`G${filaPie1 + 1}`).numFmt = '#,##0.00';
    sheetControl.getCell(`H${filaPie1 + 2}`).numFmt = '#,##0.00';
    sheetControl.getCell(`K${filaPie1 + 3}`).numFmt = '#,##0.00';

    // --- R3, §8 del handoff: 2 checks sobre "Cobranzas" ---
    // Se listan solo las violaciones (no se ajustan - "si alguno de los dos
    // falla, repórtalo, no lo ajustes"). Se calculan sobre filasCobranzasCalculadas
    // (que ya tiene el arrastre hecho sobre el universo completo, no solo el
    // período) filtrando a `tipoCobro === 'Aplicado a comprobante'` - las filas
    // de saldo inicial/a favor no tienen comprobante para chequear contra.
    const filaTituloChecks = sheetControl.rowCount + 3;
    sheetControl.getCell(`A${filaTituloChecks}`).value = 'Cobranzas - comprobantes con inconsistencia de cobro';
    sheetControl.getRow(filaTituloChecks).font = { bold: true, italic: true };

    const aplicadasPorVenta = new Map<number, any[]>();
    filasCobranzasCalculadas
        .filter(f => f.tipoCobro === 'Aplicado a comprobante' && f.idVentaCab != null)
        .forEach(f => {
            if (!aplicadasPorVenta.has(f.idVentaCab)) aplicadasPorVenta.set(f.idVentaCab, []);
            aplicadasPorVenta.get(f.idVentaCab)!.push(f);
        });

    const violacionesCobranzas: { idVenta: number; comprobante: string; problema: string; detalle: string }[] = [];
    aplicadasPorVenta.forEach((filasVenta, idVenta) => {
        const totalComprobante = Math.abs(Number(filasVenta[0].totalComprobante) || 0);
        const totalCobrado = round2(filasVenta.reduce((acc, f) => acc + (Number(f.importeCobrado) || 0), 0));
        const comprobante = `${filasVenta[0].tipoComprobante ?? ''} ${filasVenta[0].nroComprobante ?? ''}`.trim();
        // Check 1: comprobante totalmente cobrado (última fila con saldo 0)
        // cuya última fila NO tiene saldoPendiente 0.
        const ultima = [...filasVenta].sort((a, b) => new Date(a.fechaCobro).getTime() - new Date(b.fechaCobro).getTime()).slice(-1)[0];
        if (Math.abs(totalCobrado - totalComprobante) <= TOL_RESIDUAL && Math.abs(Number(ultima.saldoPendiente) || 0) > TOL_RESIDUAL) {
            violacionesCobranzas.push({
                idVenta, comprobante,
                problema: 'Cobrado 100% pero última fila no da saldo 0',
                detalle: `Saldo pendiente última fila: ${ultima.saldoPendiente}`,
            });
        }
        // Check 2: total cobrado supera el total del comprobante.
        if (totalCobrado - totalComprobante > TOL_RESIDUAL) {
            violacionesCobranzas.push({
                idVenta, comprobante,
                problema: 'Total cobrado supera el total del comprobante',
                detalle: `Cobrado: ${totalCobrado} / Comprobante: ${totalComprobante}`,
            });
        }
    });

    const filaHeaderChecks = sheetControl.addRow(['ID Venta', 'Comprobante', 'Problema', 'Detalle']);
    aplicarEstiloEncabezado(filaHeaderChecks);
    if (violacionesCobranzas.length === 0) {
        const filaOk = sheetControl.addRow(['', '', 'Sin violaciones', '']);
        filaOk.font = { italic: true };
    } else {
        violacionesCobranzas.forEach(v => {
            const fila = sheetControl.addRow([v.idVenta, v.comprobante, v.problema, v.detalle]);
            fila.font = { bold: true };
            fila.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; });
        });
    }

    // =========================
    // HOJA 6: TOTALES (B4-206)
    // =========================
    const sheetTotales = workbook.addWorksheet('Totales');
    sheetTotales.getColumn(1).width = 30;
    sheetTotales.getColumn(2).width = 18;

    sheetTotales.getColumn(3).width = 18;
    sheetTotales.getColumn(4).width = 18;
    // E:H - usadas por "Apertura de IVA por facturante" (Neto 10,5% / IVA 10,5% /
    // No gravado-exento / No fiscal / Total): sin esto quedaban en el ancho
    // default de ExcelJS y el número no se veía sin agrandar la columna a mano.
    sheetTotales.getColumn(5).width = 18;
    sheetTotales.getColumn(6).width = 18;
    sheetTotales.getColumn(7).width = 18;
    sheetTotales.getColumn(8).width = 18;

    let filaActual = 1;
    const agregarBloque = (titulo: string, datos: Map<string, number>) => {
        sheetTotales.getCell(`A${filaActual}`).value = titulo;
        aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
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
    aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
    filaActual++;
    sheetTotales.getRow(filaActual).values = ['', 'Neto gravado', 'IVA', 'Total comprobante'];
    aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
    filaActual++;
    const sumar = (filasDelGrupo: any[], campo: string) =>
        filasDelGrupo.reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);
    const gruposFiscales: Array<[string, any[]]> = [
        ['Fiscal', filasFiscales],
        ['No fiscal', filasNoFiscales],
    ];
    gruposFiscales.forEach(([etiqueta, grupo]) => {
        sheetTotales.getCell(`A${filaActual}`).value = etiqueta;
        // Corrección 21/09/2026 §1: "No fiscal" va con Neto gravado / IVA VACÍOS, no
        // derivados - agrega sobre netoGravadoResuelto/ivaResuelto (NULL para todo lo
        // no fiscal), no sobre r.netoGravado/r.iva crudos, que seguían trayendo el
        // derivado v.total/1.21 de la query aunque la hoja Ventas ya no lo mostrara.
        // Sumar un array de puros NULL daría 0 igual (Number(null)||0), así que para
        // "No fiscal" se deja la celda en null directamente en vez de sumar.
        if (etiqueta === 'No fiscal') {
            sheetTotales.getCell(`B${filaActual}`).value = null;
            sheetTotales.getCell(`C${filaActual}`).value = null;
        } else {
            sheetTotales.getCell(`B${filaActual}`).value = sumar(grupo, 'netoGravadoResuelto');
            sheetTotales.getCell(`B${filaActual}`).numFmt = '#,##0.00';
            sheetTotales.getCell(`C${filaActual}`).value = sumar(grupo, 'ivaResuelto');
            sheetTotales.getCell(`C${filaActual}`).numFmt = '#,##0.00';
        }
        sheetTotales.getCell(`D${filaActual}`).value = sumar(grupo, 'totalComprobante');
        sheetTotales.getCell(`D${filaActual}`).numFmt = '#,##0.00';
        filaActual++;
    });
    // Corrección 21/09/2026 §1: la fila "Total" de ESTE bloque ya no suma Neto/IVA -
    // sumaría base imponible de un Responsable Inscripto con facturación de
    // monotributo y con cotizaciones no fiscales, un número que no cruza contra nada
    // y que antes parecía válido. Solo totaliza Total comprobante.
    sheetTotales.getCell(`A${filaActual}`).value = 'Total';
    sheetTotales.getRow(filaActual).font = { bold: true };
    sheetTotales.getCell(`D${filaActual}`).value = sumar(filasParaTotal, 'totalComprobante');
    sheetTotales.getCell(`D${filaActual}`).numFmt = '#,##0.00';
    filaActual += 2; // fila en blanco antes del siguiente bloque

    // Los 3 bloques siguientes se agrupan en TS sobre las filas ya traídas (no
    // hace falta query nueva - §9 del handoff), todos excluyendo anulados y SIN
    // abrir por condición fiscal (ver comentario arriba).
    agregarBloque('Por canal de venta', sumarPor(filasParaTotal, r => r.canalVenta, 'totalComprobante'));
    // Corrección 21/09/2026 §4: agrupa por (facturante, punto de venta), no por PV
    // suelto - el PV es único POR CUIT, no a nivel global (Brian/Alan/Chazarreta
    // pueden compartir el 0004 y es correcto), así que un PV solo no identifica al
    // facturante. Antes esto sumaba tres contribuyentes distintos bajo la etiqueta
    // "0004". No renumerar los PV repetidos - ver §4 del handoff, es fiscalmente
    // correcto que se repitan.
    agregarBloque('Por punto de venta', sumarPor(
        filasParaTotal,
        r => `${r.facturante} — ${r.puntoVenta}${r.puntoVenta === '9999' ? ' (no fiscal)' : ''}`,
        'totalComprobante',
    ));
    agregarBloque('Por facturante', sumarPor(filasParaTotal, r => r.facturante, 'totalComprobante'));

    // Apertura de IVA por facturante (HANDOFF-apertura-iva-R1.md §2 y §7): mismo
    // criterio que "Resumen por condición fiscal" más arriba - nunca un total
    // general que mezcle un Responsable Inscripto con Monotributistas, así que el
    // desglose va SIEMPRE por facturante, nunca en una fila de total único. Un
    // Monotributista muestra las 5 columnas fiscales vacías (no 0): no declara
    // neto/IVA discriminado bajo su propio CUIT.
    sheetTotales.getCell(`A${filaActual}`).value = 'Apertura de IVA por facturante';
    aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
    filaActual++;
    sheetTotales.getRow(filaActual).values = [
        'Facturante', 'Neto gravado 21%', 'IVA 21%', 'Neto gravado 10,5%', 'IVA 10,5%', 'No gravado / exento', 'No fiscal', 'Total',
    ];
    aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
    filaActual++;
    const columnasApertura = ['netoGravado21', 'iva21', 'netoGravado105', 'iva105', 'noGravadoExento'];
    const facturantesDelPeriodo = Array.from(new Set(filasParaTotal.map(r => r.facturante ?? '(sin dato)')));
    facturantesDelPeriodo.forEach(nombreFacturante => {
        const filasFacturante = filasParaTotal.filter(r => (r.facturante ?? '(sin dato)') === nombreFacturante);
        const esRI = filasFacturante[0]?.condicionFacturante === 'Responsable Inscripto';
        sheetTotales.getCell(`A${filaActual}`).value = nombreFacturante;
        columnasApertura.forEach((campo, i) => {
            const celda = sheetTotales.getCell(`${String.fromCharCode(66 + i)}${filaActual}`);
            if (!esRI) { celda.value = null; return; }
            celda.value = sumar(filasFacturante, campo);
            celda.numFmt = '#,##0.00';
        });
        // Corrección 21/09/2026 §5: columna "No fiscal" - sin esto la fila de un RI
        // con Cotizaciones/NC X no cerraba contra su propio Total (le faltaba
        // exactamente esa plata, que no tiene apertura por no ser fiscal). Se calcula
        // para TODOS los facturantes, no solo RI: hoy da 0 en los monotributistas
        // (no tienen comprobantes no fiscales en este circuito), pero no hay
        // supuesto de por medio si algún día lo tienen.
        const celdaNoFiscal = sheetTotales.getCell(`${String.fromCharCode(66 + columnasApertura.length)}${filaActual}`);
        celdaNoFiscal.value = sumar(filasFacturante.filter(r => r.fiscal === 'N'), 'totalComprobante');
        celdaNoFiscal.numFmt = '#,##0.00';
        const celdaTotal = sheetTotales.getCell(`${String.fromCharCode(66 + columnasApertura.length + 1)}${filaActual}`);
        celdaTotal.value = sumar(filasFacturante, 'totalComprobante');
        celdaTotal.numFmt = '#,##0.00';
        filaActual++;
    });
    filaActual++; // fila en blanco entre bloques

    // 4° bloque: viene de ObtenerSubtotalesPorMedioPago (necesita datos a nivel de
    // pago, no de la fila de venta - reusa el criterio de ObtenerReporteAcumulado).
    const subtotalesMedioPago = new Map<string, number>();
    subtotalesPorMedioPago.forEach(r => subtotalesMedioPago.set(r.metodoPago, Number(r.totalAcumulado) || 0));
    agregarBloque('Por medio de pago', subtotalesMedioPago);

    // --- Bloques de cobranzas, sobre "Cobranzas" filtrado a Ingresó únicamente ---
    // Distintos de los bloques de arriba: estos filtran por fecha de COBRO, no
    // de comprobante, y solo suman lo que realmente entró a caja/banco (§10 del
    // criterio de aceptación: la suma acá tiene que dar los ingresos reales del
    // período, no los $ aplicados a comprobantes).
    //
    // Corrección presentación 15/09/2026, punto 6: título largo (nombraba una
    // columna interna, "Estado del ingreso = Ingresó", y se cortaba) partido en
    // 2 líneas de encabezado de bloque (segunda en texto normal, la aclaración
    // de qué es "Ingresó" va acá UNA sola vez); los 2 sub-títulos, más cortos
    // (sin el "(solo Ingresó)" repetido), en negrita y alineados a la
    // izquierda - centrados quedaban flotando sobre una columna de nombres.
    const filasIngresaron = filasCobranzasCalculadas.filter(f => f.estadoIngreso === 'Ingresó');
    const totalIngresadoGeneral = round2(filasIngresaron.reduce((acc, f) => acc + (Number(f.importeCobrado) || 0), 0));

    sheetTotales.getCell(`A${filaActual}`).value = 'COBRANZAS DEL PERÍODO — por fecha de cobro';
    aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
    sheetTotales.getRow(filaActual).alignment = { horizontal: 'left', vertical: 'middle' };
    filaActual++;
    sheetTotales.getCell(`A${filaActual}`).value = 'Incluye solo el dinero que efectivamente ingresó a caja o banco.';
    sheetTotales.getRow(filaActual).alignment = { horizontal: 'left' };
    filaActual += 2;

    const agregarSubBloqueCobranzas = (titulo: string, datos: Map<string, number>) => {
        sheetTotales.getCell(`A${filaActual}`).value = titulo;
        aplicarEstiloEncabezado(sheetTotales.getRow(filaActual));
        sheetTotales.getRow(filaActual).alignment = { horizontal: 'left', vertical: 'middle' };
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

    const porMedioCobro = new Map<string, number>();
    filasIngresaron.forEach(f => {
        const k = f.medioCobro || '(sin dato)';
        porMedioCobro.set(k, (porMedioCobro.get(k) ?? 0) + (Number(f.importeCobrado) || 0));
    });
    agregarSubBloqueCobranzas('Cobranzas por medio de cobro', porMedioCobro);

    const porFondo = new Map<string, number>();
    filasIngresaron.forEach(f => {
        const k = f.fondo || '(sin dato)';
        porFondo.set(k, (porFondo.get(k) ?? 0) + (Number(f.importeCobrado) || 0));
    });
    agregarSubBloqueCobranzas('Cobranzas por fondo', porFondo);

    // Punto 5 (21/09/2026): mismo criterio que los dos bloques de arriba, agrupado por
    // metodos_pago.idEmpresa en vez de por fondo o medio de cobro.
    const porEmpresa = new Map<string, number>();
    filasIngresaron.forEach(f => {
        const k = f.empresaCobro || '(sin dato)';
        porEmpresa.set(k, (porEmpresa.get(k) ?? 0) + (Number(f.importeCobrado) || 0));
    });
    agregarSubBloqueCobranzas('Cobranzas por empresa', porEmpresa);

    // Cierre R3 (16/09/2026, punto 2): nombre anterior citaba la columna
    // ("Ingresó") y era la única de las tres filas del bloque sin alineación
    // seteada explícitamente - queda alineada a la izquierda como el resto.
    sheetTotales.getCell(`A${filaActual}`).value = 'Total cobrado que ingresó a caja o banco';
    sheetTotales.getRow(filaActual).font = { bold: true };
    sheetTotales.getRow(filaActual).alignment = { horizontal: 'left' };
    sheetTotales.getCell(`B${filaActual}`).value = totalIngresadoGeneral;
    sheetTotales.getCell(`B${filaActual}`).numFmt = '#,##0.00';
    filaActual += 2;

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

// Agrupa "Métodos de pago" / "Montos de pago" (corrección presentación
// 15/09/2026, B4-216/B4-217): pagos.metodos/pagos.montos vienen de
// conciliacionRepository.ts como dos strings separados por ';', alineados por
// posición (GROUP_CONCAT ... ORDER BY mp.nombre en las dos). Acá se agrupa por
// método y se suman los importes - "Efectivo;Efectivo" con 100 y 200 pasa a
// "Efectivo" con 300. Preserva el orden de primera aparición (ya viene
// alfabético por el ORDER BY mp.nombre de la query). Solo presentación: no
// cambia qué pagos existen ni sus montos, no toca ningún total de la hoja.
function agruparMediosDePago(metodosPago: string | null | undefined, montosPago: string | null | undefined): { metodosPago: string; montosPago: number | string; totalPagado: number } {
    const metodos = metodosPago ? String(metodosPago).split(';') : [];
    const montos = montosPago ? String(montosPago).split(';') : [];
    if (metodos.length === 0) return { metodosPago: '', montosPago: '', totalPagado: 0 };

    const totalesPorMetodo = new Map<string, number>();
    metodos.forEach((m, i) => {
        const monto = Number(montos[i]) || 0;
        totalesPorMetodo.set(m, round2((totalesPorMetodo.get(m) ?? 0) + monto));
    });

    const metodosAgrupados = Array.from(totalesPorMetodo.keys());
    const importes = metodosAgrupados.map(m => totalesPorMetodo.get(m)!);
    const totalPagado = round2(importes.reduce((acc, v) => acc + v, 0));

    // Punto 1: un solo medio -> número (antes salía texto siempre, era lo único
    // de B4-204 que quedaba abierto). Varios medios -> se mantiene texto con la
    // lista formateada, no hay forma de meter dos importes en una celda numérica.
    const montosPagoSalida: number | string = importes.length === 1
        ? importes[0]
        : importes.map(v => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).join(' | ');

    return {
        metodosPago: metodosAgrupados.join(';'),
        montosPago: montosPagoSalida,
        totalPagado,
    };
}

// =========================================================================
// R2: valorización del detalle (HANDOFF-informes-administracion-R2.md §4-§7
// y su tanda de correcciones, sep-2026)
// =========================================================================

const TOL_CONVENCION = 1.00; // pesos - absorbe redondeo, no diferencias reales (§4.a).
const TOL_RESIDUAL = 0.01;   // pesos - a partir de acá el residual se emite como fila (§4.c).
const ALICUOTA_IVA = 0.21;   // fija hoy (facturacionService.ts manda siempre Iva:[{Id:5}]=21%) -
                              // se usa SOLO para reconstruir Importe total en la convención NETO
                              // (§4.b). La columna "Alíc. IVA" que ve el usuario ya NO usa esta
                              // constante: es la tasa efectiva IVA/neto de cada línea, corrección
                              // tanda 1 punto 1.

// "SIN DETALLE": comprobante sin ninguna línea real (§5, pseudolínea "Sin
// detalle") - no es indeterminación, es un caso resuelto y esperado.
// "INDETERMINADA": el comprobante SÍ tiene líneas y no cierra con ninguna
// convención - antes cursaba en silencio como BRUTO; ahora queda visible,
// corrección tanda 1 punto 3 (la fórmula/umbrales de §4.a no cambiaron, solo
// la etiqueta de este caso límite).
type Convencion = 'BRUTO' | 'NETO' | 'SIN DETALLE' | 'INDETERMINADA';

function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Estilo de encabezado compartido por las 5 hojas (corrección tanda 2, punto 2):
// antes solo lo tenía "Control" (negrita + fondo celeste + bordes fino) y el
// resto quedaba sin estilo, así que no se leían como la misma familia de
// informe. En "Informe"/"Totales", que no son tablas con header de columnas,
// se usa sobre la fila de título del bloque en vez de un header de columnas.
const ESTILO_FILL_ENCABEZADO: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
const ESTILO_BORDE_ENCABEZADO: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
};
function aplicarEstiloEncabezado(fila: ExcelJS.Row): void {
    fila.font = { bold: true };
    fila.alignment = { horizontal: 'center', vertical: 'middle' };
    fila.eachCell(cell => {
        cell.fill = ESTILO_FILL_ENCABEZADO;
        cell.border = ESTILO_BORDE_ENCABEZADO;
    });
}

// Resultado de analizar el talle de una línea (corrección tanda 2, punto 5):
// - 'desglosado': vp.talles trae VARIAS etiquetas y t1..t10 sí dice cuánto se
//   vendió de cada una - caso normal, se puede explotar en formato largo.
// - 'unico': vp.talles trae UNA sola etiqueta - toda la cantidad de la línea
//   es ese talle, no hace falta t1..t10 para saberlo (5.a, antes mostraba la
//   etiqueta pelada porque t1..t10 suele venir vacío en este caso).
// - 'sin_desglose': vp.talles trae VARIAS etiquetas pero t1..t10 no dice cuánto
//   de cada una (dato que no existe) - no se inventa un reparto (5.b): se
//   muestra el talle compuesto tal cual, marcado, y en formato largo va en
//   UNA sola fila (no se parte cantidad ni importe).
// - 'vacio': sin talles.
// Exportados para reuso en ventasRepository.ts (ResolverCostoUnitarioLinea, B4-209 Fase 2):
// el cálculo del costo ponderado por línea necesita la MISMA clasificación de talles
// que ya usa este informe (desglosado/único/sin_desglose/vacío), para no duplicar el
// criterio de negocio de qué es "sin desglose" en dos lugares que se puedan desincronizar.
export type TalleInfo =
    | { tipo: 'desglosado'; grupos: { talle: string; cantidad: number }[] }
    | { tipo: 'unico'; talle: string; cantidad: number }
    | { tipo: 'sin_desglose'; talle: string }
    | { tipo: 'vacio' };

// Corrección "M, L sin desglose" (21/09/2026, ver informes-administracion-r2-detalle-valorizado
// en memoria del proyecto): t1..t10 son posiciones FIJAS de la grilla completa del producto
// (lineas_talle.descripcion, p.ej. "XS-S-M-L-XL-XXL-3XL-4XL-5XL-6XL"), NO del orden en que
// aparecen las etiquetas en vp.talles. vp.talles solo lista qué talles tuvieron movimiento en
// la línea (subconjunto), así que indexar cantidades[i] contra etiquetas[i] (lo que hacía esta
// función antes) da resultados falsos apenas la línea no usa la grilla completa desde la
// posición 1 - caso real: vp.talles="M, L", cantidad real en t3/t4 (M y L son las posiciones
// 3 y 4 de una grilla de 10), y el código viejo miraba t1/t2 (NULL) y la marcaba "sin_desglose"
// aunque el dato estaba cargado.
// `grilla` (opcional) es el array de talles en orden de posición real, típicamente
// lineas_talle.descripcion.split('-') - mismo patrón que ya usa ObtenerLineaDeTalle en
// miscRepository.ts / ObtenerStockDisponiblePorProducto en productosRepository.ts. Si no se
// provee (producto sin talles_producto cargado, o llamador viejo) se cae al criterio anterior
// como fallback - menos confiable, pero no rompe.
export function analizarTalle(talles: string | null | undefined, cantidades: any[], cantidadLinea: number, grilla?: string[] | null): TalleInfo {
    const etiquetas = talles ? String(talles).split(',').map(t => t.trim()).filter(t => t.length > 0) : [];
    if (etiquetas.length === 0) return { tipo: 'vacio' };
    if (etiquetas.length === 1) return { tipo: 'unico', talle: etiquetas[0], cantidad: cantidadLinea };

    const base = grilla && grilla.length > 0 ? grilla : etiquetas;
    const grupos = base
        .map((talle, i) => ({ talle, cantidad: Number(cantidades[i]) || 0 }))
        .filter(g => g.cantidad > 0);
    if (grupos.length === 0) return { tipo: 'sin_desglose', talle: etiquetas.join(', ') };
    return { tipo: 'desglosado', grupos };
}

// Corrección R2 tanda 3, fix 2: en formato largo la fila YA representa un solo
// talle (la cantidad está en su propia columna) - ":cantidad" ahí es ruido y
// queda inconsistente con las líneas expandidas desde t1..t10, que muestran la
// etiqueta a secas. En formato normal se mantiene "etiqueta:cantidad" (sí
// aporta, una fila puede resumir varios talles). Las compuestas sin desglose
// muestran el mismo texto en los dos formatos - no hay cantidad que mostrar.
function textoTalle(info: TalleInfo, formatoLargo: boolean): string {
    switch (info.tipo) {
        case 'unico': return formatoLargo ? info.talle : `${info.talle}:${info.cantidad}`;
        case 'desglosado': return info.grupos.map(g => `${g.talle}:${g.cantidad}`).join(', ');
        // Punto 6 (21/09/2026): etiqueta explícita sobre por qué no se abre por talle -
        // no es un límite del formato largo, es que la venta se cargó con la cantidad total
        // y los talles como etiqueta, sin registrar cuántas unidades de cada uno. No se
        // reparte la cantidad entre los talles (serían unidades inventadas en un informe
        // contable) - eso no cambia, solo el texto. Ver columna "Talle desglosado" (S/N)
        // para filtrar/contar sin tener que leer este texto.
        case 'sin_desglose': return `${info.talle} (no se registró cuántas de cada talle)`;
        default: return '';
    }
}

/**
 * Valoriza el detalle de UN comprobante: detecta la convención BRUTO/NETO
 * (§4.a) para reconstruir el Importe total de cada línea, arma las
 * pseudolíneas (§5), cierra con el residual (§4.c) y por último reparte el
 * IVA REAL de ARCA (`vf.iva`) entre todas las filas por peso de Importe total
 * (corrección tanda 1, punto 1 - reemplaza la derivación al 21% fijo, que
 * rompía en Factura C). Todos los cálculos internos son SIN signo - el signo
 * de NC se aplica una única vez, al final, sobre cantidad/importes (no sobre
 * precios unitarios ni tasas: un precio de lista o una alícuota no son
 * "negativos" en una NC, lo que se niega es la cantidad y la plata que mueve
 * - criterio §6).
 *
 * `cabecera` es la fila correspondiente de ObtenerVentasConciliacion (`filas`
 * en crearExcelConciliacion) - trae totalComprobante/ajusteTransferencia ya
 * calculados con signo (se destranza acá), redondeo/idProcesoRaw crudos, y
 * vfIvaRaw (IVA real informado a ARCA, NULL si no es fiscal). `lineasCrudas`
 * son las filas de ObtenerDetalleLineas para ese idVenta.
 */
// Descripción exacta con la que HANDOFF-recargo-transferencia-10.md persiste el
// recargo como línea real en ventas_productos (frontend: DESCRIPCION_ITEM_
// RECARGO_TRANSFERENCIA en venta.constants.ts, ChazaGolfApp - no hay forma de
// importarla entre los dos repos, se duplica el literal). Ventas ANTERIORES al
// fix del 21/09/2026 tienen ajusteTransf=1 pero ninguna línea real en
// ventas_productos - para esas, cabecera.ajusteTransferencia (calculado acá, ver
// conciliacionRepository.ts) sigue siendo la única fuente. Ventas posteriores ya
// traen la línea real dentro de lineasCrudas - sumarla de nuevo via
// ajusteTransferencia duplicaría el recargo (línea real + pseudolínea, con una
// "Diferencia no explicada" negativa tapando el excedente).
const DESCRIPCION_ITEM_RECARGO_TRANSFERENCIA = 'Recargo transferencia 10%';

function valorizarComprobante(cabecera: any, lineasCrudas: any[], formatoLargo: boolean): {
    filas: any[]; convencion: Convencion; totalDetalle: number;
    ivaCabecera: number; ivaDetalle: number; tuvoPseudolineaDiferencia: boolean;
} {
    const signo = Number(cabecera.idProcesoRaw) === IdProceso.NOTA_CREDITO ? -1 : 1;
    const totalRaw = signo * (Number(cabecera.totalComprobante) || 0);
    // Solo se usa como fallback para ventas históricas sin línea real (ver
    // DESCRIPCION_ITEM_RECARGO_TRANSFERENCIA arriba) - se neutraliza más abajo en
    // cuanto lineasCrudas ya trae la línea real.
    const tieneLineaRealDeRecargo = lineasCrudas.some(l => l.descripcion === DESCRIPCION_ITEM_RECARGO_TRANSFERENCIA);
    const ajusteRaw = tieneLineaRealDeRecargo ? 0 : signo * (Number(cabecera.ajusteTransferencia) || 0);
    const redondeoRaw = Number(cabecera.redondeo) || 0;
    // IVA real de ARCA, SIN signo (se destranza como el resto) - 0 si no es
    // fiscal (vfIvaRaw NULL), consistente con el criterio ya usado en R1 tanda 2
    // para netoGravado/iva de la hoja "Ventas".
    const ivaComprobanteRaw = Number(cabecera.vfIvaRaw) || 0;

    // --- §4.a: detección de convención (fórmula/umbrales sin cambios) ---
    const sumaProductos = lineasCrudas
        .filter(l => l.tipoItem !== 'Servicio')
        .reduce((acc, l) => acc + (Number(l.total) || 0), 0);
    const sumaServicios = lineasCrudas
        .filter(l => l.tipoItem === 'Servicio')
        .reduce((acc, l) => acc + (Number(l.total) || 0), 0);
    const sumaDesc = lineasCrudas.reduce((acc, l) => acc + (Number(l.importeDescuento) || 0), 0);
    // Cuando ya hay línea real, sumaProductos ya la incluye - ajusteRaw está en 0
    // acá arriba, así que no hace falta ninguna rama extra.
    const base = (sumaProductos + sumaServicios) - sumaDesc + ajusteRaw + redondeoRaw;

    let convencion: Convencion;
    if (lineasCrudas.length === 0) {
        convencion = 'SIN DETALLE';
    } else if (Math.abs(base - totalRaw) <= TOL_CONVENCION) {
        convencion = 'BRUTO';
    } else if (Math.abs(base * 1.21 - totalRaw) <= TOL_CONVENCION) {
        convencion = 'NETO';
    } else {
        // Antes caía en silencio a BRUTO; ahora queda visible (corrección tanda 1
        // punto 3). El cálculo de Importe total igual necesita una rama - usa
        // BRUTO, y la diferencia real queda expuesta en la pseudolínea de §4.c.
        convencion = 'INDETERMINADA';
    }
    const convencionEfectiva: 'BRUTO' | 'NETO' = convencion === 'NETO' ? 'NETO' : 'BRUTO';

    // Reconstruye el Importe total de una línea real a partir de su importe
    // post-descuento (§4.b) - SIN calcular IVA acá, eso ahora sale del
    // prorrateo de vf.iva más abajo (corrección tanda 1, punto 1).
    const calcularImporteTotal = (importePostDesc: number): number => {
        if (convencionEfectiva === 'NETO') {
            const importeNeto = round2(importePostDesc);
            const iva = round2(importeNeto * ALICUOTA_IVA);
            return round2(importeNeto + iva);
        }
        return round2(importePostDesc);
    };

    const filas: any[] = [];

    // --- §4.b + §6: líneas reales (catálogo, no catalogado, servicio) ---
    lineasCrudas.forEach(l => {
        const cantidad = Number(l.cantidad) || 0;
        const total = Number(l.total) || 0;
        const importeDescuento = Number(l.importeDescuento) || 0;
        const precioLista = l.precioLista != null ? Number(l.precioLista) : null;

        const importeBruto = precioLista != null ? round2(cantidad * precioLista) : total;
        const importePostDesc = total - importeDescuento;
        const importeDesc = round2(importeBruto - importePostDesc);
        // Punto 3 (servicios sin precio base cargado) + criterio general: dividir por un
        // importeBruto en 0 no es "0% de descuento", es "no hay base para calcular el
        // porcentaje" - va vacío (null), no 0,00%. Antes esto quedaba en 0 siempre; con
        // servicios ahora trayendo precioLista = sugerido, un sugerido 0/NULL hace
        // importeBruto 0 y hay que distinguirlo (21/09/2026).
        // Corrección 21/09/2026: número entero de porcentaje (50, 21), no fracción con
        // formato % (pedido 2 veces por el cliente). Sigue null cuando no hay base de
        // cálculo (importeBruto 0, ver comentario arriba) - null*100 sería 0, hay que
        // guardar el null explícito.
        const pctDesc = importeBruto !== 0 ? round2((importeDesc / importeBruto) * 100) : null;
        const precioUnitNeto = cantidad !== 0 ? importePostDesc / cantidad : 0;
        const importeTotal = calcularImporteTotal(importePostDesc);

        // B4-209 Fase 3: costo/margen SIN signo todavía (mismo criterio que el resto de
        // esta función - el signo de NC se aplica una sola vez, al final, sobre totales).
        // costoUnitario sale del snapshot de Fase 2 (vp.costoUnitario), YA es un promedio
        // ponderado si la línea cubre varios talles - acá no se vuelve a promediar, solo
        // se multiplica por la cantidad de la línea para tener el total a repartir si
        // hace falta explotar por talle. null (no 0) si no hay costo cargado - nunca se
        // inventa ni se cae a el costo actual del maestro.
        const costoUnitario = l.costoUnitario != null ? Number(l.costoUnitario) : null;
        const costoTotalLinea = costoUnitario != null ? round2(costoUnitario * cantidad) : null;

        const filaBase = {
            idLinea: l.idLinea,
            tipoItem: l.tipoItem,
            codArticulo: l.codigoArticulo ?? '',
            descripcion: l.descripcion ?? '',
            producto: l.producto ?? '',
            tipo: l.tipo ?? '',
            genero: l.genero ?? '',
            material: l.material ?? '',
            color: l.color ?? '',
            temporada: l.temporada ?? '',
            precioListaUnit: precioLista,
            pctDesc,
            precioUnitNeto,
            importeBruto,
            importeDesc,
            importeTotal,
            // importeNeto/iva/alicIva se completan más abajo, después de tener
            // TODAS las filas del comprobante (líneas + pseudolíneas), por el
            // prorrateo de vf.iva - corrección tanda 1, punto 1.
            // margen/margenPct se completan más abajo también, junto con el signo de NC.
            costoUnitario,
            costoTotal: costoTotalLinea,
        };

        // §7: grano de la hoja - default 1 fila por línea de ventas_productos.
        // Solo explota en formato largo, solo "Producto" (catálogo) y solo si
        // el talle está realmente desglosado (corrección tanda 2, punto 5): una
        // sola etiqueta o varias sin desglose real NO se pueden partir en filas
        // por talle - se quedan en una sola fila más abajo, con vp.cantidad o
        // marcadas "(sin desglose)" según el caso.
        const grillaTalle = l.grillaTalle ? String(l.grillaTalle).split('-') : null;
        const infoTalle = analizarTalle(l.talles, [l.t1, l.t2, l.t3, l.t4, l.t5, l.t6, l.t7, l.t8, l.t9, l.t10], cantidad, grillaTalle);

        // Punto 12: SKU = código de barras cuando el talle de ESTA fila está resuelto
        // (un solo talle posible, sin ambigüedad); si no, se mantiene el SKU compuesto
        // de siempre (código de artículo + color) - decisión de Nahu, no se agrega
        // columna aparte "Artículo-Color-Talle" (21/09/2026).
        const codigoBarraPorTalle = new Map<string, string>();
        if (l.codigosBarraPorTalle) {
            for (const par of String(l.codigosBarraPorTalle).split('|')) {
                const idx = par.lastIndexOf(':');
                if (idx === -1) continue;
                const talle = par.slice(0, idx);
                const codigo = par.slice(idx + 1);
                if (codigo) codigoBarraPorTalle.set(talle, codigo);
            }
        }
        const skuCompuesto = `${l.codigoArticulo ?? ''}-${l.color ?? ''}`;
        const explota = formatoLargo && l.tipoItem === 'Producto' && infoTalle.tipo === 'desglosado';

        if (!explota) {
            // Corrección R2 tanda 3, fix 1: en formato largo cada fila es UN talle,
            // así que el SKU tiene que incluirlo también cuando el talle es único
            // (t1..t10 vacío, se resolvió con vp.cantidad - antes solo lo llevaban
            // las filas expandidas desde t1..t10). Las 30 compuestas sin desglose
            // quedan con SKU de 2 partes a propósito: no hay un talle único que
            // agregar sin inventarlo.
            const skuUnico = infoTalle.tipo === 'unico' ? codigoBarraPorTalle.get(infoTalle.talle) : undefined;
            // Punto 3: SKU de servicio = "SRV-<código>" (propuesto por el cliente, no
            // colisiona con los SKU de catálogo que arrancan con números) - 21/09/2026.
            const sku = l.tipoItem === 'Producto' ? (skuUnico ?? skuCompuesto)
                : l.tipoItem === 'Servicio' ? `SRV-${l.codigoArticulo ?? ''}`
                : '';
            // Punto 6: solo tiene sentido para Producto - infoTalle.tipo 'vacio' (sin
            // talles.g. No catalogado/Servicio ya vienen con l.talles NULL) también queda
            // vacío, no forzado a 'S'.
            const talleDesglosado = l.tipoItem === 'Producto'
                ? (infoTalle.tipo === 'sin_desglose' ? 'N' : infoTalle.tipo === 'vacio' ? '' : 'S')
                : '';
            filas.push({
                ...filaBase,
                sku,
                talle: textoTalle(infoTalle, formatoLargo),
                talleDesglosado,
                cantidad,
            });
            return;
        }

        const gruposTalle = (infoTalle as { tipo: 'desglosado'; grupos: { talle: string; cantidad: number }[] }).grupos;

        // El residual del prorrateo (redondeo de centavos) se asigna a la fila
        // de mayor cantidad del grupo, así la suma del grupo da EXACTAMENTE
        // importeTotal - documentado acá y en §7 del handoff. Importe bruto y
        // descuento se prorratean por cantidad sin este cuidado: no son la
        // invariante que tiene que cerrar (esa es importeTotal, vía §1).
        const cantidadTotalGrupo = gruposTalle.reduce((acc, g) => acc + g.cantidad, 0);
        let indiceMayor = 0;
        gruposTalle.forEach((g, i) => { if (g.cantidad > gruposTalle[indiceMayor].cantidad) indiceMayor = i; });

        const totalesPorTalle = gruposTalle.map((g, i) => (
            i === indiceMayor ? 0 : round2(importeTotal * (g.cantidad / cantidadTotalGrupo))
        ));
        const sumaOtros = totalesPorTalle.reduce((acc, t, i) => (i === indiceMayor ? acc : acc + t), 0);
        totalesPorTalle[indiceMayor] = round2(importeTotal - sumaOtros);

        // B4-209 Fase 3: mismo prorrateo por cantidad, mismo residual al grupo de mayor
        // cantidad, para que el costo también cierre EXACTO contra costoTotalLinea al
        // explotar por talle (igual que importeTotal arriba). costoUnitario por fila sale
        // de volver a dividir (costoTotal de la fila / cantidad de la fila), así la
        // fórmula del cliente "Costo total = Cantidad × Costo unitario" sigue cerrando
        // fila por fila, no solo a nivel línea - mismo criterio que precioUnitNeto, que
        // tampoco se re-redondea antes de esta división.
        const costosPorTalle = costoTotalLinea != null
            ? gruposTalle.map((g, i) => (
                i === indiceMayor ? 0 : round2(costoTotalLinea * (g.cantidad / cantidadTotalGrupo))
            ))
            : null;
        if (costosPorTalle) {
            const sumaCostoOtros = costosPorTalle.reduce((acc, t, i) => (i === indiceMayor ? acc : acc + t), 0);
            costosPorTalle[indiceMayor] = round2(costoTotalLinea! - sumaCostoOtros);
        }

        gruposTalle.forEach((g, i) => {
            const proporcion = g.cantidad / cantidadTotalGrupo;
            const costoTotalFila = costosPorTalle ? costosPorTalle[i] : null;
            filas.push({
                ...filaBase,
                sku: codigoBarraPorTalle.get(g.talle) ?? skuCompuesto,
                talle: g.talle,
                talleDesglosado: 'S',
                cantidad: g.cantidad,
                importeBruto: round2(importeBruto * proporcion),
                importeDesc: round2(importeDesc * proporcion),
                importeTotal: totalesPorTalle[i],
                costoTotal: costoTotalFila,
                costoUnitario: (costoTotalFila != null && g.cantidad !== 0) ? costoTotalFila / g.cantidad : null,
            });
        });
    });

    // --- §5: pseudolíneas (sin neto/iva todavía - ver prorrateo más abajo) ---
    const filaPseudo = (tipoItem: string, descripcion: string, importeTotal: number) => ({
        idLinea: null, tipoItem, sku: '', codArticulo: '', descripcion,
        producto: '', tipo: '', genero: '', material: '', color: '', temporada: '', talle: '', talleDesglosado: '', cantidad: null,
        precioListaUnit: null, pctDesc: null, precioUnitNeto: null, importeBruto: null, importeDesc: null,
        importeTotal,
        // Ajuste/Redondeo/Sin detalle/Diferencia no explicada: nunca tienen costo (§Fase3
        // del handoff, tabla de tipos de ítem) - quedan vacías, no en 0.
        costoUnitario: null, costoTotal: null,
    });
    // Corrección 21/09/2026 §2: tipo propio 'Recargo', no 'Ajuste' - compartía el
    // mismo tipo que las pseudolíneas de control/conciliación, imposible de
    // distinguir de un recargo real en una tabla dinámica del detalle valorizado.
    if (ajusteRaw !== 0) filas.push(filaPseudo('Recargo', 'Recargo por transferencia (10%)', ajusteRaw));
    if (redondeoRaw !== 0) filas.push(filaPseudo('Redondeo', 'Redondeo', redondeoRaw));
    if (lineasCrudas.length === 0) {
        filas.push(filaPseudo('Sin detalle', (cabecera.motivo && String(cabecera.motivo).trim()) || 'Sin detalle', totalRaw));
    }

    // --- §4.c: cierre exacto ---
    const totalFilasHastaAhora = filas.reduce((acc, f) => acc + (Number(f.importeTotal) || 0), 0);
    const residual = round2(totalRaw - totalFilasHastaAhora);
    let tuvoPseudolineaDiferencia = false;
    if (Math.abs(residual) >= TOL_RESIDUAL) {
        filas.push(filaPseudo('Diferencia no explicada', 'Diferencia no explicada', residual));
        tuvoPseudolineaDiferencia = true;
    }

    // --- Corrección tanda 1, punto 1: IVA real por prorrateo, no derivado ---
    // Se reparte vf.iva (el que se informó a ARCA) entre TODAS las filas del
    // comprobante (líneas + pseudolíneas) por peso de Importe total, y el
    // residual del prorrateo se asigna a la fila de MAYOR |Importe total| - así
    // Σ IVA de las filas = vf.iva exacto, sea cual sea la convención (incluida
    // NETO: ahí el Importe total ya se construyó como neto×1,21, y el prorrateo
    // igual reparte los 60.060 reales de vf.iva, no un IVA recalculado).
    const sumaImporteTotalTodas = filas.reduce((acc, f) => acc + (Number(f.importeTotal) || 0), 0);
    if (sumaImporteTotalTodas !== 0) {
        let indiceMayorIva = 0;
        filas.forEach((f, i) => {
            if (Math.abs(f.importeTotal) > Math.abs(filas[indiceMayorIva].importeTotal)) indiceMayorIva = i;
        });
        let ivaAsignado = 0;
        filas.forEach((f, i) => {
            if (i === indiceMayorIva) return;
            const peso = f.importeTotal / sumaImporteTotalTodas;
            f.iva = round2(ivaComprobanteRaw * peso);
            ivaAsignado += f.iva;
        });
        filas[indiceMayorIva].iva = round2(ivaComprobanteRaw - ivaAsignado);
    } else {
        filas.forEach(f => { f.iva = 0; });
    }
    filas.forEach(f => {
        f.importeNeto = round2(f.importeTotal - f.iva);
        // Tasa EFECTIVA (no 21% fijo) - en Factura C da 0% sola, sin caso
        // especial (corrección tanda 1, punto 1 y §8 "qué no hacer").
        // Corrección 21/09/2026: número entero de porcentaje, no fracción (pedido 2 veces
        // por el cliente) - Factura C sigue dando 0 (no null: acá SÍ hay base de cálculo,
        // un comprobante real con importeNeto propio, la tasa efectiva es 0%, no "sin dato").
        f.alicIva = f.importeNeto !== 0 ? round2((f.iva / f.importeNeto) * 100) : 0;
    });

    // Numeración final y signo de NC (§6) - cantidad e importes, no precios
    // unitarios, alícuotas ni porcentajes (ver comentario de la función). costoTotal es
    // un importe (como importeTotal) -> lleva signo. costoUnitario es un valor por
    // unidad (como precioUnitNeto) -> no lleva, pasa tal cual por el spread de arriba.
    //
    // B4-209 Fase 3: margen/margenPct se calculan ACÁ, con importeNeto y costoTotal ya
    // firmados - así una NC da margen$ negativo (revierte el margen de la venta
    // original, §5 del handoff - no se "arregla" con ABS()) y margenPct sale positivo
    // igual (negativo/negativo), que es lo correcto. Fórmula tal cual la trae el cliente
    // en su Excel (Margen % = IFERROR(Margen$/Importe neto, 0)) - ese IFERROR es solo
    // para importeNeto = 0 con costo cargado; si no hay costo cargado, margen/margenPct
    // quedan en null (vacío), no en 0 - un 0 ahí se leería como "margen cero real".
    const filasFinal = filas.map((f, i) => {
        const costoTotal = f.costoTotal != null ? round2(f.costoTotal * signo) : null;
        const importeNeto = round2(f.importeNeto * signo);
        const margen = costoTotal != null ? round2(importeNeto - costoTotal) : null;
        const margenPct = margen != null ? (importeNeto !== 0 ? margen / importeNeto : 0) : null;

        return {
            ...f,
            nroLinea: i + 1,
            cantidad: f.cantidad != null ? f.cantidad * signo : null,
            importeBruto: f.importeBruto != null ? round2(f.importeBruto * signo) : null,
            importeDesc: f.importeDesc != null ? round2(f.importeDesc * signo) : null,
            importeNeto,
            iva: round2(f.iva * signo),
            importeTotal: round2(f.importeTotal * signo),
            costoTotal,
            margen,
            margenPct,
        };
    });

    const totalDetalle = round2(filasFinal.reduce((acc, f) => acc + (Number(f.importeTotal) || 0), 0));
    const ivaDetalle = round2(filasFinal.reduce((acc, f) => acc + (Number(f.iva) || 0), 0));

    return {
        filas: filasFinal,
        convencion,
        totalDetalle,
        ivaCabecera: round2(signo * ivaComprobanteRaw),
        ivaDetalle,
        tuvoPseudolineaDiferencia,
    };
}

// =========================================================================
// R3: arrastre de la hoja "Cobranzas" (HANDOFF-informes-administracion-R3.md
// §5-§6, más las 3 correcciones acordadas con Nahu - ver comentario de
// ArmarBaseCobranzas en conciliacionRepository.ts para el porqué de la unión
// ventas_pagos + ventas_entrega_detalle).
// =========================================================================

/**
 * Calcula, para cada fila de `filasPeriodo`, el Saldo pendiente y los Días de
 * atraso, y la fecha de vencimiento final (con el mismo fallback +15 días que
 * usa la hoja "Ventas" - v.fechaVencimiento no trae ese cálculo, es crudo).
 *
 * El arrastre (Saldo pendiente) se calcula sobre `filasUniverso` - TODO el
 * historial de cobros de cada comprobante, sin filtro de fecha - para que el
 * saldo de una fila del período descuente también lo cobrado en meses
 * anteriores (§6 del handoff). Solo las filas con tipoCobro = "Aplicado a
 * comprobante" entran en el arrastre; las de saldo inicial/saldo a favor no
 * tienen comprobante contra el cual calcular un saldo (van vacías, no cero -
 * cambio de alcance acordado con Nahu, no son "$0 de saldo", son "no aplica").
 */
function calcularCobranzas(filasPeriodo: any[], filasUniverso: any[]): any[] {
    const porVenta = new Map<number, any[]>();
    filasUniverso
        .filter(f => f.tipoCobro === 'Aplicado a comprobante' && f.idVentaCab != null)
        .forEach(f => {
            if (!porVenta.has(f.idVentaCab)) porVenta.set(f.idVentaCab, []);
            porVenta.get(f.idVentaCab)!.push(f);
        });

    const saldoPorPago = new Map<string, number>();
    const diasAtrasoPorPago = new Map<string, number | null>();

    porVenta.forEach(filasVenta => {
        const ordenadas = [...filasVenta].sort((a, b) => {
            const fa = new Date(a.fechaCobro).getTime();
            const fb = new Date(b.fechaCobro).getTime();
            if (fa !== fb) return fa - fb;
            return String(a.idPago).localeCompare(String(b.idPago));
        });
        const totalComprobante = Math.abs(Number(ordenadas[0].totalComprobante) || 0);
        const { fechaVencimientoFinal } = resolverVencimiento(ordenadas[0]);

        let acumulado = 0;
        ordenadas.forEach(f => {
            acumulado += Number(f.importeCobrado) || 0;
            saldoPorPago.set(f.idPago, round2(totalComprobante - acumulado));
            if (fechaVencimientoFinal) {
                const dias = Math.max(0, moment.utc(f.fechaCobro).startOf('day').diff(moment.utc(fechaVencimientoFinal).startOf('day'), 'days'));
                diasAtrasoPorPago.set(f.idPago, dias);
            } else {
                diasAtrasoPorPago.set(f.idPago, null);
            }
        });
    });

    return filasPeriodo.map(f => {
        const { fechaVencimientoFinal, origenVencimiento } = resolverVencimiento(f);
        const esAplicado = f.tipoCobro === 'Aplicado a comprobante';
        return {
            ...f,
            fechaVencimientoFinal,
            origenVencimiento,
            saldoPendiente: esAplicado ? (saldoPorPago.get(f.idPago) ?? null) : null,
            diasAtraso: esAplicado ? (diasAtrasoPorPago.get(f.idPago) ?? null) : null,
        };
    });
}

// Mismo criterio +15 días que ya usa la hoja "Ventas" (corrección R2 tanda 1,
// punto 6) - v.fechaVencimiento crudo, sin ese fallback, viene igual en las
// filas de "Cobranzas" (misma columna de ObtenerVentasConciliacion/
// ArmarBaseCobranzas). Se reusa acá en vez de duplicar el cálculo con otro
// criterio - las dos hojas tienen que coincidir en qué vencimiento le
// atribuyen a la misma venta.
function resolverVencimiento(f: any): { fechaVencimientoFinal: Date | null; origenVencimiento: string } {
    if (f.fechaVencimiento) {
        return {
            fechaVencimientoFinal: moment.utc(f.fechaVencimiento).startOf('day').toDate(),
            origenVencimiento: `Cliente (${f.diasVencimientoCliente ?? '?'} días)`,
        };
    }
    if (Number(f.idProcesoRaw) === IdProceso.FACTURA || Number(f.idProcesoRaw) === IdProceso.COTIZACION) {
        return {
            fechaVencimientoFinal: moment.utc(f.fechaComprobante).startOf('day').add(15, 'days').toDate(),
            origenVencimiento: 'Estimado (+15 días)',
        };
    }
    return { fechaVencimientoFinal: null, origenVencimiento: '' };
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
