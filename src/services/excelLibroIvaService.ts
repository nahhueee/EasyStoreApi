import ExcelJS from 'exceljs';
import { TIPOS_COMPROBANTE_ARCA } from '../models/tiposComprobanteArca';
import { aperturaIva, CONDICION_RESPONSABLE_INSCRIPTO } from './aperturaIva';
const moment = require('moment');

/**
 * Excel del Libro IVA Ventas: 3 hojas (Libro IVA Ventas, Control correlatividad,
 * Fuera del libro). Ver HANDOFF-libro-iva-ventas-y-compras.md, Fase 1 Paso 3,
 * para el diseño original, y HANDOFF-apertura-iva-libro-iva-ventas.md (21/09/2026)
 * para la apertura por alícuota agregada en esta corrección.
 *
 * `libro` viene de LibrosIvaRepo.ObtenerLibroIvaVentas(), `correlatividad` de
 * ObtenerCorrelatividadVentas(), `excluidos` de ObtenerExcluidosDelLibro() y
 * `empresa` de EmpresasRepo.ObtenerEmpresa(idEmpresa) - se pasa aparte (no se
 * deriva de `libro[0]`) porque un período sin comprobantes no puede dejar sin
 * resolver si la empresa es RI o Monotributista.
 */
export async function crearExcelLibroIvaVentas(
  libro: any[],
  correlatividad: any[],
  excluidos: any[],
  empresa: { razonSocial?: string; condicion?: string },
) {
  const workbook = new ExcelJS.Workbook();

  const esRI = empresa?.condicion === CONDICION_RESPONSABLE_INSCRIPTO;

  // =========================
  // HOJA 1: LIBRO IVA VENTAS
  // =========================
  const sheet1 = workbook.addWorksheet('Libro IVA Ventas');

  // sheet1.columns escribe los headers en la fila 1 - por eso la nota de
  // Monotributista (si aplica) se inserta DESPUÉS, con spliceRows, en vez de
  // escribirse antes (quedaría pisada por la asignación de columns).
  sheet1.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Cod. Tipo Cbte.', key: 'codTipoCbte', width: 15 },
    { header: 'Pto. Vta.', key: 'ptoVenta', width: 12 },
    { header: 'Comprobante', key: 'comprobante', width: 15 },
    { header: 'Tipo Doc.', key: 'tipoDoc', width: 16 },
    { header: 'Cod. Tipo Doc.', key: 'codTipoDoc', width: 14 },
    { header: 'CUIT', key: 'cuit', width: 18 },
    { header: 'Razon social', key: 'razonSocial', width: 35 },
    { header: 'Cond. IVA', key: 'condIva', width: 22 },

    // Apertura de IVA por alícuota (HANDOFF-apertura-iva-libro-iva-ventas.md §4):
    // reemplaza las viejas columnas planas Gravado/Tasa/IVA. Se resuelve con la
    // MISMA función aperturaIva() que usa R1 (excelConciliacionService.ts) - un
    // solo cálculo para los dos informes. Vacío (no 0) cuando la empresa es
    // Monotributista: no discrimina IVA y un 0 ahí afirmaría lo contrario.
    { header: 'Neto gravado 21%', key: 'netoGravado21', width: 16 },
    { header: 'IVA 21%', key: 'iva21', width: 14 },
    { header: 'Neto gravado 10,5%', key: 'netoGravado105', width: 16 },
    { header: 'IVA 10,5%', key: 'iva105', width: 14 },
    { header: 'No gravado / exento', key: 'noGravadoExento', width: 16 },

    { header: 'Total', key: 'total', width: 15 },

    { header: 'CAE', key: 'cae', width: 18 },
    { header: 'Vto. CAE', key: 'caeVto', width: 14 },
    { header: 'Estado', key: 'estado', width: 12 },
    { header: 'Comp. asociado', key: 'compAsociado', width: 18 },
    { header: 'Observación', key: 'observacion', width: 40 },
  ];
  // Nota de advertencia cuando la empresa es Monotributista (HANDOFF §5): un
  // Monotributista no presenta DDJJ de IVA ni lleva Libro IVA. No se bloquea la
  // generación (el listado sigue sirviendo como control de comprobantes y
  // correlatividad) pero tiene que quedar explícito que esto NO es un Libro IVA
  // real, para que nadie lo confunda con una declaración de que sí tributó IVA.
  // Se inserta ACÁ (no antes de `sheet1.columns =`) porque esa asignación
  // escribe los headers en la fila 1 y pisaría la nota si fuera al revés.
  if (!esRI) {
    sheet1.spliceRows(1, 0, []);
    sheet1.mergeCells('A1:U1');
    sheet1.getCell('A1').value =
      `${empresa?.razonSocial ?? 'Esta empresa'} es Monotributista: no corresponde discriminar IVA y no presenta ` +
      'Libro IVA Ventas. Este listado se emite como control de comprobantes y de correlatividad; las columnas de ' +
      'apertura de IVA quedan vacías y la fila de totales no incluye totales de IVA.';
    sheet1.getCell('A1').alignment = { wrapText: true, vertical: 'middle' };
    sheet1.getCell('A1').font = { italic: true, bold: true, color: { argb: 'FF9C5700' } };
    sheet1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    sheet1.getRow(1).height = 45;
  }
  const headerRowIndex1 = esRI ? 1 : 2;

  // Filas del libro con la apertura ya resuelta y el signo de la NC ya aplicado
  // (mismo criterio que ya tenía este archivo para grabado/iva/total - HANDOFF
  // §6: "no cambies el criterio de signos de las notas de crédito").
  type FilaLibro = any;
  const filasResueltas: FilaLibro[] = libro.map(r => {
    const meta = TIPOS_COMPROBANTE_ARCA[r.tipoFactura];
    const signo = meta?.signo ?? 1;
    const esNota = meta?.esNota ?? false;

    const neto = Number(r.neto);
    const iva = Number(r.iva);
    const total = Number(r.total);

    // Todo comprobante que llega acá es fiscal (INNER JOIN ventas_factura en
    // librosIvaRepository.ts) - esFiscal siempre true, la única variable es la
    // condición del facturante.
    const apertura = aperturaIva({
      esFiscal: true,
      condicionFacturante: r.condicionFacturante,
      neto: r.neto,
      iva: r.iva,
    });
    const conSigno = (v: number | null) => (v === null ? null : v * signo);

    return {
      ...r,
      meta, signo, esNota, neto, iva, total,
      netoGravado21: conSigno(apertura.netoGravado21),
      iva21: conSigno(apertura.iva21),
      netoGravado105: conSigno(apertura.netoGravado105),
      iva105: conSigno(apertura.iva105),
      noGravadoExento: conSigno(apertura.noGravadoExento),
    };
  });

  filasResueltas.forEach(r => {
    const fila = sheet1.addRow({
      fecha: moment.utc(r.fecha).startOf('day').toDate(),
      tipo: r.meta?.descripcion ?? `TIPO ${r.tipoFactura} (SIN MAPEAR)`,
      codTipoCbte: r.tipoFactura,
      ptoVenta: String(r.ptoVenta ?? '').padStart(5, '0'),
      comprobante: r.ticket,
      tipoDoc: descripcionTipoDoc(r.tipoDni),
      codTipoDoc: r.tipoDni ?? '',
      cuit: formatearDocumento(r.dni),
      razonSocial: r.razonSocial,
      condIva: r.condicionIva,
      netoGravado21: r.netoGravado21,
      iva21: r.iva21,
      netoGravado105: r.netoGravado105,
      iva105: r.iva105,
      noGravadoExento: r.noGravadoExento,
      total: r.total * r.signo,
      cae: r.cae != null ? String(r.cae) : '',
      caeVto: r.caeVto ? moment.utc(r.caeVto).startOf('day').toDate() : null,
      estado: r.fechaBaja ? 'Anulado' : 'Emitido',
      compAsociado: r.esNota && r.ticketRelacionado
        ? `${r.tipoRelacionado}-${String(r.ptoVentaRelacionado ?? '').padStart(5, '0')}-${r.ticketRelacionado}`
        : '',
      observacion: armarObservacion(r, r.meta, r.neto, r.iva, r.total, r.esNota),
    });

    fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
    fila.getCell('cuit').numFmt = '@';
    if (r.caeVto) fila.getCell('caeVto').numFmt = 'dd/mm/yyyy';
    ['netoGravado21', 'iva21', 'netoGravado105', 'iva105', 'noGravadoExento', 'total'].forEach(key => {
      if (fila.getCell(key).value !== null) fila.getCell(key).numFmt = '$ #,##0.00';
    });
  });

  const ultimaColumna1 = columnaExcel(sheet1.columns!.length);
  sheet1.autoFilter = { from: `A${headerRowIndex1}`, to: `${ultimaColumna1}${headerRowIndex1}` };
  sheet1.views = [{ state: 'frozen', ySplit: headerRowIndex1 }];

  // Subtotales por tipo de comprobante (HANDOFF §6) - la query ya viene
  // ordenada por tipoFactura/ptoVenta/ticket, así que agrupar por tramos
  // consecutivos alcanza. Solo si la empresa es RI: para Monotributista no hay
  // nada de IVA que subtotalizar (§5), y listar $0 en todas las filas sería
  // ruido, no información.
  let filaCursor = headerRowIndex1 + filasResueltas.length + 1;
  const columnasApertura = ['netoGravado21', 'iva21', 'netoGravado105', 'iva105'] as const;

  if (esRI && filasResueltas.length > 0) {
    let inicioGrupo = 0;
    const sumar = (grupo: FilaLibro[], key: typeof columnasApertura[number]) =>
      grupo.reduce((acc, r) => acc + (r[key] ?? 0), 0);

    for (let i = 1; i <= filasResueltas.length; i++) {
      const cambioDeGrupo = i === filasResueltas.length || filasResueltas[i].tipoFactura !== filasResueltas[inicioGrupo].tipoFactura;
      if (!cambioDeGrupo) continue;

      const grupo = filasResueltas.slice(inicioGrupo, i);
      const descripcionTipo = grupo[0].meta?.descripcion ?? `TIPO ${grupo[0].tipoFactura} (SIN MAPEAR)`;

      const filaSub = sheet1.getRow(filaCursor);
      filaSub.getCell('codTipoCbte').value = `Subtotal ${descripcionTipo}`;
      columnasApertura.forEach(key => {
        filaSub.getCell(key).value = sumar(grupo, key);
        filaSub.getCell(key).numFmt = '$ #,##0.00';
      });
      filaSub.getCell('total').value = grupo.reduce((acc, r) => acc + r.total * r.signo, 0);
      filaSub.getCell('total').numFmt = '$ #,##0.00';
      filaSub.font = { italic: true };
      filaSub.eachCell(cell => { cell.border = { top: { style: 'thin' } }; });

      filaCursor++;
      inicioGrupo = i;
    }
    filaCursor++; // fila en blanco antes del total general
  }

  // Fila(s) TOTAL, calculadas en el backend (B4-218: nunca con fórmula de Excel).
  // RI (§6): total general por alícuota, es el número que se transcribe al
  // F.2002 - obligatorio. Monotributista (§5): sin totales de IVA, solo el
  // total de comprobantes del libro.
  if (esRI) {
    const totalNeto21 = sumarColumna(filasResueltas, 'netoGravado21');
    const totalIva21 = sumarColumna(filasResueltas, 'iva21');
    const totalNeto105 = sumarColumna(filasResueltas, 'netoGravado105');
    const totalIva105 = sumarColumna(filasResueltas, 'iva105');

    const filaTotal = sheet1.getRow(filaCursor);
    filaTotal.getCell('codTipoCbte').value = 'TOTAL';
    filaTotal.getCell('netoGravado21').value = totalNeto21;
    filaTotal.getCell('iva21').value = totalIva21;
    filaTotal.getCell('netoGravado105').value = totalNeto105;
    filaTotal.getCell('iva105').value = totalIva105;
    ['netoGravado21', 'iva21', 'netoGravado105', 'iva105'].forEach(key => {
      filaTotal.getCell(key).numFmt = '$ #,##0.00';
    });
    filaTotal.font = { bold: true };
    filaCursor++;
  }

  const filaTotalComprobantes = sheet1.getRow(filaCursor);
  filaTotalComprobantes.getCell('codTipoCbte').value = 'Total de comprobantes del libro';
  filaTotalComprobantes.getCell('total').value = filasResueltas.reduce((acc, r) => acc + r.total * r.signo, 0);
  filaTotalComprobantes.getCell('total').numFmt = '$ #,##0.00';
  filaTotalComprobantes.font = { bold: true };

  // =========================
  // HOJA 2: CONTROL CORRELATIVIDAD
  // =========================
  const sheet2 = workbook.addWorksheet('Control correlatividad');

  sheet2.columns = [
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Pto. Vta.', key: 'ptoVenta', width: 12 },
    { header: 'Último del período anterior', key: 'ultimoAnterior', width: 24 },
    { header: 'Desde', key: 'desde', width: 12 },
    { header: 'Hasta', key: 'hasta', width: 12 },
    { header: 'Emitidos', key: 'emitidos', width: 12 },
    { header: 'Esperados', key: 'esperados', width: 12 },
    { header: 'Faltantes', key: 'faltantes', width: 40 },
  ];

  correlatividad.forEach(r => {
    const fila = sheet2.addRow({
      tipo: TIPOS_COMPROBANTE_ARCA[r.tipoFactura]?.descripcion ?? `TIPO ${r.tipoFactura}`,
      ptoVenta: String(r.ptoVenta ?? '').padStart(5, '0'),
      ultimoAnterior: r.ultimoPeriodoAnterior ?? 'N/D (primer comprobante del par)',
      desde: r.desde,
      hasta: r.hasta,
      emitidos: r.emitidos,
      esperados: r.esperados,
      faltantes: r.faltantes.length > 0
        ? r.faltantes.join(', ') + (r.saltoRespectoPeriodoAnterior ? ' (incluye salto contra el período anterior)' : '')
        : '-',
    });

    // Fila con faltantes: fondo rojo suave para que salte a la vista.
    if (r.faltantes.length > 0) {
      fila.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
      });
    }
  });

  sheet2.autoFilter = { from: 'A1', to: 'H1' };

  // =========================
  // HOJA 3: FUERA DEL LIBRO (CONCILIACIÓN)
  // =========================
  const sheet3 = workbook.addWorksheet('Fuera del libro');

  sheet3.mergeCells('A1:E1');
  sheet3.getCell('A1').value =
    'Comprobantes internos (Cotización, NC X, ND X) que impactan las ventas del negocio pero no son fiscales - no pasan por ARCA y no tienen CAE. ' +
    'Por eso el total de esta hoja, sumado al total del Libro IVA Ventas, explica la diferencia contra el reporte de ventas del mismo período. ' +
    'Sin columnas de IVA a propósito: estos comprobantes no fueron informados a ARCA, no tienen IVA que discriminar.';
  sheet3.getCell('A1').alignment = { wrapText: true, vertical: 'middle' };
  sheet3.getCell('A1').font = { italic: true };
  sheet3.getRow(1).height = 45;

  const headerRow3 = sheet3.getRow(2);
  headerRow3.values = ['Proceso', 'N° Proceso', 'Fecha', 'Cliente', 'Total'];
  sheet3.getColumn(1).width = 18;
  sheet3.getColumn(2).width = 15;
  sheet3.getColumn(3).width = 18;
  sheet3.getColumn(4).width = 35;
  sheet3.getColumn(5).width = 15;

  excluidos.forEach(r => {
    sheet3.addRow([
      r.proceso,
      r.nroProceso,
      moment.utc(r.fecha).format('DD/MM/YYYY'),
      r.razonSocial,
      Number(r.total),
    ]);
  });

  sheet3.getColumn(5).numFmt = '$ #,##0.00';
  sheet3.autoFilter = { from: 'A2', to: 'E2' };
  sheet3.views = [{ state: 'frozen', ySplit: 2 }];

  // =========================
  // ESTILO GENERAL (encabezados)
  // =========================
  [[sheet1, headerRowIndex1], [sheet2, 1], [sheet3, 2]].forEach(([sheet, headerRowIdx]: any) => {
    const headerRow = sheet.getRow(headerRowIdx);

    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  });

  sheet2.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// Códigos de tipo de documento ARCA/AFIP más frecuentes en el negocio. Un código
// no contemplado se muestra igual (con su número), no se oculta ni se rompe.
const TIPOS_DOC_ARCA: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'CONSUMIDOR FINAL',
};

function descripcionTipoDoc(tipoDni: number | null): string {
  if (tipoDni == null) return '';
  return TIPOS_DOC_ARCA[tipoDni] ?? `TIPO ${tipoDni}`;
}

// Número de documento (CUIT/CUIL/DNI) sin separadores, apto para importación
// automática. La celda se exporta con numFmt '@' (texto) para que Excel no lo
// convierta a notación científica ni le agregue ceros/exponente.
function formatearDocumento(dni: number | null): string {
  if (dni == null) return '';
  return String(dni);
}

// Suma literal de una columna sobre las filas ya resueltas (signo aplicado) -
// nunca fórmula de Excel (B4-218). null se trata como "no aporta", no rompe la
// suma - pero si TODAS las filas son null (Monotributista) no se llama a esta
// función para las columnas de apertura.
function sumarColumna(filas: any[], key: string): number {
  return filas.reduce((acc, r) => acc + (r[key] ?? 0), 0);
}

// Concatena las alertas de la columna Observación. Vacía si no hay nada que mirar.
function armarObservacion(r: any, meta: any, neto: number, iva: number, total: number, esNota: boolean): string {
  const alertas: string[] = [];

  if (Math.abs(total - (neto + iva)) > 0.02) alertas.push('NETO+IVA NO CIERRA CONTRA TOTAL');
  if ([11, 12, 13].includes(r.tipoFactura)) alertas.push('FACTURA C EN EMPRESA RI - REVISAR');
  if (!meta) alertas.push('CODIGO DE COMPROBANTE NO MAPEADO - REVISAR');
  if (esNota && !r.ticketRelacionado) alertas.push('NOTA SIN COMPROBANTE ASOCIADO');

  return alertas.join(' | ');
}

// Letra de columna Excel a partir del índice (1-based) - nunca hardcodeada, ver
// nota en la Hoja 1 sobre por qué (trampa conocida del informe de Ventas).
function columnaExcel(n: number): string {
  let letra = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}
