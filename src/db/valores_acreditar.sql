-- =============================================================
-- SPEC: Valores a Acreditar (Cheque + Tarjeta de Crédito)
-- Estado: pendiente de ejecutar en dev (NO producción)
-- Ejecutar en orden, dentro de la misma sesión.
-- =============================================================

USE dbeasystore;

-- -------------------------------------------------------------
-- 1. Habilitar CHEQUE en el ENUM de metodos_pago.tipo
-- -------------------------------------------------------------
ALTER TABLE metodos_pago
  MODIFY COLUMN tipo ENUM(
    'CREDITO','DEBITO','TRANSFERENCIA','DIGITAL',
    'EFECTIVO','CUENTA_CORRIENTE','SALDO_FAVOR','CHEQUE'
  ) NOT NULL;

-- -------------------------------------------------------------
-- 2. Agregar ACREDITACION_VALOR al ENUM origen de movimientos_fondos
-- -------------------------------------------------------------
ALTER TABLE movimientos_fondos
  MODIFY COLUMN origen ENUM(
    'VENTA','COBRO_CC','PAGO_PROVEEDOR','RETIRO','AJUSTE',
    'TRANSFERENCIA','INGRESO_MANUAL','EGRESO_MANUAL',
    'NOTA_CREDITO','ACREDITACION_VALOR'
  ) NOT NULL;

-- -------------------------------------------------------------
-- 3. Fondo único "Valores a Acreditar" (plata en tránsito)
--    tipo VARCHAR(50) → no requiere ALTER
-- -------------------------------------------------------------
INSERT INTO fondos (nombre, tipo, activo, permiteNegativo, icono)
VALUES ('Valores a Acreditar', 'VALOR_PENDIENTE', 1, 0, 'pi pi-clock');

-- -------------------------------------------------------------
-- 4. Método de pago CHEQUE para empresa 1
--    Apunta al fondo "Valores a Acreditar"
-- -------------------------------------------------------------
INSERT INTO metodos_pago (idEmpresa, idFondo, tipo, nombre)
SELECT 1, id, 'CHEQUE', 'Cheque'
FROM fondos
WHERE nombre = 'Valores a Acreditar';

-- NOTA: El método CRÉDITO NO se modifica.
-- Su idFondo (banco real) se preserva y se usa como idFondoDestino
-- en valores_acreditar al registrar la venta. El backend bifurca
-- por tipo y envía el movimiento_fondos INGRESO al fondo
-- "Valores a Acreditar" en lugar del banco real.

-- -------------------------------------------------------------
-- 5. Tabla cabecera de valores en tránsito
--    idFondoDestino es nullable para CHEQUE
--    (se elige por el usuario al momento de acreditar).
--    Para TARJETA_CREDITO se completa al registrar la venta
--    con el idFondo del método de pago usado.
-- -------------------------------------------------------------
CREATE TABLE valores_acreditar (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  idEmpresa         INT            NOT NULL,
  idVentaPago       INT            NOT NULL,
  tipo              ENUM('CHEQUE','TARJETA_CREDITO') NOT NULL,
  monto             DECIMAL(12,2)  NOT NULL,
  idFondoDestino    INT            NULL,        -- nullable para CHEQUE
  estado            ENUM('PENDIENTE','ACREDITADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  fechaAlta         DATETIME       DEFAULT CURRENT_TIMESTAMP,
  fechaAcreditacion DATETIME       NULL,
  usuarioAlta       VARCHAR(15),
  usuarioAcredita   VARCHAR(15),
  observaciones     VARCHAR(255),
  FOREIGN KEY (idVentaPago)    REFERENCES ventas_pagos(id),
  FOREIGN KEY (idFondoDestino) REFERENCES fondos(id)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 6. Tabla detalle de cheque
-- -------------------------------------------------------------
CREATE TABLE cheques (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  idValor        BIGINT        NOT NULL,
  numero         VARCHAR(30)   NOT NULL,
  banco          VARCHAR(100)  NOT NULL,
  importe        DECIMAL(12,2) NOT NULL,
  fechaCobro     DATE          NOT NULL,
  libradorNombre VARCHAR(150),
  libradorCuit   VARCHAR(13),
  FOREIGN KEY (idValor) REFERENCES valores_acreditar(id)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- Verificación post-ejecución (correr manualmente)
-- -------------------------------------------------------------
-- SELECT * FROM fondos WHERE nombre = 'Valores a Acreditar';
-- SELECT * FROM metodos_pago WHERE tipo = 'CHEQUE';
-- SHOW CREATE TABLE valores_acreditar;
-- SHOW CREATE TABLE cheques;
-- SHOW COLUMNS FROM movimientos_fondos LIKE 'origen';
-- SHOW COLUMNS FROM metodos_pago LIKE 'tipo';
