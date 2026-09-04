import ExcelJS from 'exceljs';
const moment = require('moment');

// Hoja única (a diferencia de excelVentasService que arma varias hojas): Compras en F1 no tiene
// detalle de líneas/talles que amerite una hoja aparte, es un registro de cabecera por compra.
// El nombre real en metodos_pago distingue "Cuenta Corriente (Proveedor)"/"Saldo a Favor (Proveedor)"
// del homónimo de Ventas (que es de clientes, no de proveedores) - útil en la UI del sistema, pero
// redundante en el Excel de Compras (todo ahí ya es "de proveedor" por definición). Se saca el
// sufijo solo acá, no en la base ni en la UI, a pedido del usuario (04-sep-2026).
function FormatearMetodoPago(metodoPago?: string): string {
  return (metodoPago ?? '').replace(/\s*\(Proveedor\)/gi, '');
}

export async function crearExcelCompras(data: any[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Compras');

  sheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Proveedor', key: 'proveedor', width: 30 },
    { header: 'Cond. IVA Proveedor', key: 'condicionIvaProveedor', width: 20 },
    { header: 'Tipo Comprobante', key: 'tipoComprobante', width: 20 },
    { header: 'N° Comprobante', key: 'nroComprobante', width: 20 },
    { header: 'Neto', key: 'totalNeto', width: 15 },
    { header: 'IVA', key: 'totalIva', width: 15 },
    { header: 'IIBB', key: 'totalIibb', width: 15 },
    { header: 'Tasa Municipal', key: 'tasaMunicipal', width: 15 },
    { header: 'Percepción IVA', key: 'percepcionIva', width: 15 },
    { header: 'Ret. Ganancia', key: 'retencionGanancia', width: 15 },
    { header: 'Total', key: 'total', width: 15 },
    { header: 'Método de Pago', key: 'metodoPago', width: 35 },
    { header: 'Estado', key: 'estado', width: 15 },
  ];

  data.forEach(c => {
    sheet.addRow({
      fecha: c.fecha ? moment(c.fecha).format('DD/MM/YYYY') : '',
      proveedor: c.proveedor ?? '',
      condicionIvaProveedor: c.condicionIvaProveedor ?? '',
      tipoComprobante: c.tipoComprobante ?? '',
      nroComprobante: c.nroComprobante ?? '',
      totalNeto: Number(c.totalNeto ?? 0),
      totalIva: Number(c.totalIva ?? 0),
      totalIibb: Number(c.totalIibb ?? 0),
      tasaMunicipal: Number(c.tasaMunicipal ?? 0),
      percepcionIva: Number(c.percepcionIva ?? 0),
      retencionGanancia: Number(c.retencionGanancia ?? 0),
      total: Number(c.total ?? 0),
      metodoPago: FormatearMetodoPago(c.metodoPago),
      estado: c.estado ?? '',
    });
  });

  sheet.autoFilter = { from: 'A1', to: 'N1' };

  // Fila TOTAL. Mismo guard de referencia circular que excelVentasService/excelFondosService:
  // sin filas de datos, lastDataRow=1 y SUM(F2:F1) se normaliza a F1:F2 (se incluye a sí misma).
  const lastDataRow = sheet.rowCount;
  const totalRow = lastDataRow + 1;
  const columnasSuma = ['totalNeto', 'totalIva', 'totalIibb', 'tasaMunicipal', 'percepcionIva', 'retencionGanancia', 'total'];

  sheet.getCell(`A${totalRow}`).value = 'TOTAL';

  columnasSuma.forEach(key => {
    const col = sheet.getColumn(key).letter;
    sheet.getCell(`${col}${totalRow}`).value = data.length > 0
      ? { formula: `SUM(${col}2:${col}${lastDataRow})` }
      : 0;
  });

  sheet.getRow(totalRow).font = { bold: true };

  // Estilo de encabezado (mismo celeste claro usado en el resto de los excelXService)
  const headerRow = sheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Formato moneda
  columnasSuma.forEach(key => sheet.getColumn(key).numFmt = '$ #,##0.00');

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
