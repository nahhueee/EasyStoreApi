import ExcelJS from 'exceljs';
const moment = require('moment');

/**
 * Export "Entregas sin cargo" (F4.1). Dos hojas:
 *  - "Resumen": por cliente y motivo, neto = entregado (ESC) - devuelto (Devolución de entrega),
 *    a precio y (si el usuario puede ver costos) a costo.
 *  - "Detalle": una fila por línea, con signo (devolución en negativo).
 *
 * Costo: un costo NULL jamás se informa como 0. En el Detalle se muestra "sin costo" y en el
 * Resumen se cuenta en "Líneas sin costo" (el costo neto lo excluye). Los servicios no tienen
 * costo: se muestran "n/a" y no cuentan como línea sin costo.
 * Las columnas de costo solo se incluyen si puedeVerCosto (mismo criterio que el resto de los
 * informes con costo).
 */

const ID_DEVOLUCION = 9;

const MOTIVOS: Record<string, string> = { EMBAJADOR: 'Embajador', EVENTO: 'Evento', OTRO: 'Otro' };
const motivoTexto = (m: any) => (m ? (MOTIVOS[m] ?? String(m)) : '(sin motivo)');
const aFecha = (v: any): Date | null => (v ? moment.utc(v).startOf('day').toDate() : null);
const FMT_IMPORTE = '#,##0.00;-#,##0.00';
const FMT_CANT = '#,##0;-#,##0';

export async function crearExcelEntregasSinCargo(lineasSinOrden: any[], puedeVerCosto: boolean) {
  const workbook = new ExcelJS.Workbook();

  // El repo devuelve prendas y servicios por separado: se ordena por documento (y prendas antes
  // que servicios dentro de cada uno).
  const lineas = [...lineasSinOrden].sort((a, b) =>
    (+new Date(a.fecha) - +new Date(b.fecha)) ||
    String(a.hora ?? '').localeCompare(String(b.hora ?? '')) ||
    (Number(a.idVenta) - Number(b.idVenta)) ||
    ((a.tipoItem === 'Servicio' ? 1 : 0) - (b.tipoItem === 'Servicio' ? 1 : 0)) ||
    (Number(a.idLinea) - Number(b.idLinea)));

  // ---------- RESUMEN ----------
  const resumen = new Map<string, any>();
  const docsVistos = new Set<string>();
  lineas.forEach(l => {
    const motivo = motivoTexto(l.motivoEntrega);
    const clave = `${l.cliente ?? ''}|${motivo}`;
    let r = resumen.get(clave);
    if (!r) {
      r = {
        cliente: l.cliente ?? '', motivo, entregas: 0, devoluciones: 0,
        uEntregadas: 0, uDevueltas: 0, vEntregado: 0, vDevuelto: 0,
        costoNeto: 0, sinCosto: 0,
      };
      resumen.set(clave, r);
    }
    const cant = Number(l.cantidad) || 0;
    const total = Number(l.total) || 0;
    const esDevolucion = Number(l.idProceso) === ID_DEVOLUCION;

    const docKey = `${clave}|${l.idVenta}`;
    if (!docsVistos.has(docKey)) {
      docsVistos.add(docKey);
      if (esDevolucion) r.devoluciones++; else r.entregas++;
    }
    if (esDevolucion) { r.uDevueltas += -cant; r.vDevuelto += -total; }
    else { r.uEntregadas += cant; r.vEntregado += total; }

    if (l.costoUnitario != null) r.costoNeto += cant * Number(l.costoUnitario);
    else if (l.tipoItem !== 'Servicio') r.sinCosto++;
  });

  const filasResumen = [...resumen.values()].sort((a, b) =>
    a.cliente.localeCompare(b.cliente, 'es') || a.motivo.localeCompare(b.motivo, 'es'));

  const sheet1 = workbook.addWorksheet('Resumen');
  const cols1: Partial<ExcelJS.Column>[] = [
    { header: 'Cliente', key: 'cliente', width: 32 },
    { header: 'Motivo', key: 'motivo', width: 14 },
    { header: 'Entregas', key: 'entregas', width: 10 },
    { header: 'Devoluciones', key: 'devoluciones', width: 14 },
    { header: 'Unidades entregadas', key: 'uEntregadas', width: 20 },
    { header: 'Unidades devueltas', key: 'uDevueltas', width: 19 },
    { header: 'Unidades netas', key: 'uNetas', width: 16 },
    { header: 'Valor entregado', key: 'vEntregado', width: 18 },
    { header: 'Valor devuelto', key: 'vDevuelto', width: 18 },
    { header: 'Valor neto', key: 'vNeto', width: 18 },
  ];
  if (puedeVerCosto) {
    cols1.push({ header: 'Costo neto', key: 'costoNeto', width: 18 });
    cols1.push({ header: 'Líneas sin costo', key: 'sinCosto', width: 17 });
  }
  sheet1.columns = cols1;

  const tot = { entregas: 0, devoluciones: 0, uEntregadas: 0, uDevueltas: 0, vEntregado: 0, vDevuelto: 0, costoNeto: 0, sinCosto: 0 };
  filasResumen.forEach(r => {
    sheet1.addRow({ ...r, uNetas: r.uEntregadas - r.uDevueltas, vNeto: r.vEntregado - r.vDevuelto });
    (Object.keys(tot) as (keyof typeof tot)[]).forEach(k => { tot[k] += r[k]; });
  });
  const filaTotal = sheet1.addRow({
    cliente: 'TOTAL', ...tot,
    uNetas: tot.uEntregadas - tot.uDevueltas,
    vNeto: tot.vEntregado - tot.vDevuelto,
  });
  filaTotal.font = { bold: true };

  ['entregas', 'devoluciones', 'uEntregadas', 'uDevueltas', 'uNetas'].forEach(k => { sheet1.getColumn(k).numFmt = FMT_CANT; });
  ['vEntregado', 'vDevuelto', 'vNeto'].forEach(k => { sheet1.getColumn(k).numFmt = FMT_IMPORTE; });
  if (puedeVerCosto) {
    sheet1.getColumn('costoNeto').numFmt = FMT_IMPORTE;
    sheet1.getColumn('sinCosto').numFmt = FMT_CANT;
  }

  // ---------- DETALLE ----------
  const sheet2 = workbook.addWorksheet('Detalle');
  const cols2: Partial<ExcelJS.Column>[] = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Comprobante', key: 'comprobante', width: 22 },
    { header: 'Número', key: 'nroProceso', width: 10 },
    { header: 'Entrega relacionada', key: 'relacionada', width: 24 },
    { header: 'Cliente', key: 'cliente', width: 32 },
    { header: 'Motivo', key: 'motivo', width: 14 },
    { header: 'Tipo', key: 'tipoItem', width: 14 },
    { header: 'Código', key: 'codigo', width: 14 },
    { header: 'Artículo', key: 'articulo', width: 36 },
    { header: 'Cantidad', key: 'cantidad', width: 10 },
    { header: 'Precio unitario', key: 'precio', width: 16 },
    { header: 'Total', key: 'total', width: 16 },
  ];
  if (puedeVerCosto) {
    cols2.push({ header: 'Costo unitario', key: 'costoUnitario', width: 16 });
    cols2.push({ header: 'Total a costo', key: 'totalCosto', width: 16 });
  }
  sheet2.columns = cols2;

  lineas.forEach(l => {
    const cant = Number(l.cantidad) || 0;
    const esDev = Number(l.idProceso) === ID_DEVOLUCION;
    const sinDato = l.tipoItem === 'Servicio' ? 'n/a' : 'sin costo';
    const fila = sheet2.addRow({
      fecha: aFecha(l.fecha),
      comprobante: esDev ? 'Devolución de entrega' : 'Entrega sin cargo',
      nroProceso: Number(l.nroProceso),
      relacionada: esDev && l.nroRelacionado ? `Entrega sin cargo ${l.nroRelacionado}` : '',
      cliente: l.cliente,
      motivo: motivoTexto(l.motivoEntrega),
      tipoItem: l.tipoItem,
      codigo: l.codigo ?? '',
      articulo: l.articulo,
      cantidad: cant,
      precio: l.precio != null ? Number(l.precio) : null,
      total: Number(l.total) || 0,
      costoUnitario: l.costoUnitario != null ? Number(l.costoUnitario) : sinDato,
      totalCosto: l.costoUnitario != null ? cant * Number(l.costoUnitario) : sinDato,
    });
    fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
    if (puedeVerCosto && l.costoUnitario == null) {
      fila.getCell('costoUnitario').alignment = { horizontal: 'right' };
      fila.getCell('totalCosto').alignment = { horizontal: 'right' };
    }
  });
  sheet2.getColumn('cantidad').numFmt = FMT_CANT;
  ['precio', 'total'].forEach(k => { sheet2.getColumn(k).numFmt = FMT_IMPORTE; });
  if (puedeVerCosto) {
    ['costoUnitario', 'totalCosto'].forEach(k => { sheet2.getColumn(k).numFmt = FMT_IMPORTE; });
  }
  sheet2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet2.columns.length } };

  // Encabezados con el mismo estilo que los otros exportables.
  [sheet1, sheet2].forEach(sheet => {
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  });

  return await workbook.xlsx.writeBuffer();
}
