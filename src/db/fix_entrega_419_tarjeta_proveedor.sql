-- Corrección de datos: cobro de $414.000 (Entrega de Dinero #419, cliente 11897, empresa 1,
-- recibo #908, ventas_pagos #1910, 13/11/2026 09:43) cargado con el método 114
-- "Tarjeta de crédito" (tipo TARJETA_PROVEEDOR, método de COMPRAS) en vez de
-- "Galicia Crédito" (método 4, tipo CREDITO, fondo 7).
--
-- Efecto del error: al no ser CHEQUE/CREDITO, EntregaDinero (cuentasRepository.ts) mandó la
-- plata directo al fondo 15 (movimiento #5145) y NO generó valores_acreditar.
--
-- Esta corrección deja el estado que habría generado el sistema con el método correcto:
--   1) ventas_pagos #1910 -> método 4 (Galicia Crédito)
--   2) contra-asiento en fondo 15 (movimientos_fondos es append-only)
--   3) ingreso en fondo "Valores a Acreditar"
--   4) valores_acreditar PENDIENTE, TARJETA_CREDITO, destino fondo 7 (Galicia)
--
-- Auditoría previa (13/11/2026): #1910 es el único ventas_pagos con TARJETA_PROVEEDOR /
-- CHEQUE_PROPIO y #5145 es el único movimiento en los fondos 14 y 15.
-- Los asientos 3) y 4) quedan fechados hoy (NOW), no a la fecha original del cobro.

SET @usuario = 'REEMPLAZAR_USUARIO';   -- quien corre la corrección (para el asiento AJUSTE)

START TRANSACTION;

-- 0) Precondición: debe devolver 1 fila (método 114, entrega 419, 414000). Si devuelve 0, NO seguir.
SELECT id, idMetodo, monto, idEntrega, idRecibo
FROM ventas_pagos
WHERE id = 1910 AND idMetodo = 114 AND idEntrega = 419 AND monto = 414000.00;

-- 1) Método correcto
UPDATE ventas_pagos
SET idMetodo = 4
WHERE id = 1910 AND idMetodo = 114 AND idEntrega = 419 AND monto = 414000.00;

-- 2) Contra-asiento del ingreso indebido en fondo 15
INSERT INTO movimientos_fondos
    (idCaja, idFondo, idEmpresa, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
VALUES
    (1, 15, 1, 'EGRESO', 'AJUSTE', 419, 414000.00,
     'Correccion: reversa de movimiento #5145 - cobro cliente 11897 cargado con metodo de proveedor (Tarjeta de credito, TARJETA_PROVEEDOR)',
     @usuario,
     'Ver movimiento #5145 (original erroneo), entrega #419, ventas_pagos #1910');

-- 3) Ingreso en Valores a Acreditar (igual que EntregaDinero para CREDITO, rama excedente)
INSERT INTO movimientos_fondos
    (idCaja, idFondo, idEmpresa, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
VALUES
    (1, (SELECT id FROM fondos WHERE nombre = 'Valores a Acreditar' LIMIT 1), 1,
     'INGRESO', 'INGRESO_MANUAL', 419, 414000.00,
     'Entrega excedente cliente 11897 - CREDITO pendiente',
     'GABRIELA',
     'Reimputado desde fondo 15 - ver movimiento #5145 y su contra-asiento');

-- 4) Valor a acreditar PENDIENTE (Galicia = fondo 7)
INSERT INTO valores_acreditar
    (idEmpresa, idVentaPago, tipo, monto, idFondoDestino, estado, usuarioAlta, observaciones)
VALUES
    (1, 1910, 'TARJETA_CREDITO', 414000.00, 7, 'PENDIENTE', 'GABRIELA',
     'Corregido 13/11/2026: cobro cargado originalmente con metodo 114 (TARJETA_PROVEEDOR)');

-- ===================== Verificación antes de COMMIT =====================
SELECT * FROM ventas_pagos      WHERE id = 1910;                                  -- idMetodo = 4
SELECT * FROM movimientos_fondos WHERE idReferencia = 419 ORDER BY id;            -- #5145 + reversa + ingreso Valores (+ saldo a favor fondo 5)
SELECT SUM(CASE WHEN tipo='INGRESO' THEN monto ELSE -monto END) AS saldo_fondo_15
FROM movimientos_fondos WHERE idFondo = 15;                                       -- debe dar 0
SELECT * FROM valores_acreditar WHERE idVentaPago = 1910;                         -- 1 fila PENDIENTE, 414000, destino 7

-- Si todo coincide: COMMIT;   Si algo no cierra: ROLLBACK;
-- COMMIT;
