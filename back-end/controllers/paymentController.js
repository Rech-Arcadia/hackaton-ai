import { createAuthenticatedClient } from "@interledger/open-payments";
import { isFinalizedGrant } from "@interledger/open-payments";
import fs from "fs";

// Variable para mantener sesiones en memoria
// En producción, considera usar Redis o una base de datos
let paymentSessions = new Map();

/**
 * Configuración del wallet principal (sender)
 * Actualiza estos valores según tu configuración
 */
const WALLET_CONFIG = {
  walletAddressUrl: "https://ilp.interledger-test.dev/p1_uvm",
  keyId: "ddc91f99-b73f-4cba-882b-8263aa427a34",
  privateKeyPath: "private.key"
};

/**
 * Crea un cliente autenticado de Open Payments
 * @returns {Promise<Object>} Cliente autenticado
 */
async function createClient() {
  try {
    const privateKey = fs.readFileSync(WALLET_CONFIG.privateKeyPath, "utf8");
    return await createAuthenticatedClient({
      walletAddressUrl: WALLET_CONFIG.walletAddressUrl,
      privateKey: privateKey,
      keyId: WALLET_CONFIG.keyId,
    });
  } catch (error) {
    console.error('Error creando cliente autenticado:', error);
    throw new Error('Error de configuración del cliente de pagos');
  }
}

/**
 * Validaciones de entrada para los pagos
 */
const validatePaymentData = (receivingWallet, amount) => {
  const errors = [];

  // Validar wallet receptor
  if (!receivingWallet || typeof receivingWallet !== 'string') {
    errors.push('El wallet receptor es requerido');
  } else {
    try {
      const url = new URL(receivingWallet.trim());
      if (url.protocol !== 'https:') {
        errors.push('El wallet debe usar protocolo HTTPS');
      } else if (!url.hostname.includes('interledger')) {
        errors.push('URL de wallet no válida');
      }
    } catch {
      errors.push('URL de wallet mal formada');
    }
  }

  // Validar cantidad
  if (!amount) {
    errors.push('La cantidad es requerida');
  } else {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      errors.push('La cantidad debe ser un número mayor a 0');
    } else if (numAmount > 10000000) {
      errors.push('La cantidad excede el límite máximo');
    }
  }

  return errors;
};

/**
 * Genera un ID único para la sesión de pago
 * @returns {string} ID único basado en timestamp y random
 */
const generateSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Controlador para verificar el estado del servidor
 */
export const healthCheck = (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    sessionsActive: paymentSessions.size,
    uptime: process.uptime()
  });
};

/**
 * Controlador para iniciar el proceso de pago
 */
export const initiatePayment = async (req, res) => {
  try {
    const { receivingWallet, amount } = req.body;
    
    // Validar datos de entrada
    const validationErrors = validatePaymentData(receivingWallet, amount);
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Datos de entrada inválidos',
        details: validationErrors
      });
    }

    const trimmedWallet = receivingWallet.trim();
    const numAmount = Number(amount);

    console.log('Iniciando pago:', { 
      receivingWallet: trimmedWallet, 
      amount: numAmount 
    });

    // Crear cliente autenticado
    const client = await createClient();

    // Obtener información de las direcciones de wallet
    const sendingWalletAddress = await client.walletAddress.get({
      url: WALLET_CONFIG.walletAddressUrl,
    });

    const receivingWalletAddress = await client.walletAddress.get({
      url: trimmedWallet,
    });

    console.log('Wallets obtenidas:', { 
      sendingWallet: sendingWalletAddress.id, 
      receivingWallet: receivingWalletAddress.id 
    });

    // Crear grant para pagos entrantes
    const incomingPaymentGrant = await client.grant.request(
      {
        url: receivingWalletAddress.authServer,
      },
      {
        access_token: {
          access: [
            {
              type: "incoming-payment",
              actions: ["create"],
            },
          ],
        },
      }
    );

    if (!isFinalizedGrant(incomingPaymentGrant)) {
      throw new Error("Error finalizando grant de pago entrante");
    }

    // Crear pago entrante
    const incomingPayment = await client.incomingPayment.create(
      {
        url: receivingWalletAddress.resourceServer,
        accessToken: incomingPaymentGrant.access_token.value,
      },
      {
        walletAddress: receivingWalletAddress.id,
        incomingAmount: {
          assetCode: receivingWalletAddress.assetCode,
          assetScale: receivingWalletAddress.assetScale,
          value: numAmount.toString(),
        },
      }
    );

    console.log('Pago entrante creado:', incomingPayment.id);

    // Crear grant para cotización
    const quoteGrant = await client.grant.request(
      {
        url: sendingWalletAddress.authServer,
      },
      {
        access_token: {
          access: [
            {
              type: "quote",
              actions: ["create"],
            },
          ],
        },
      }
    );

    if (!isFinalizedGrant(quoteGrant)) {
      throw new Error("Error finalizando grant de cotización");
    }

    // Crear cotización
    const quote = await client.quote.create(
      {
        url: sendingWalletAddress.resourceServer,
        accessToken: quoteGrant.access_token.value,
      },
      {
        walletAddress: sendingWalletAddress.id,
        receiver: incomingPayment.id,
        method: "ilp",
      }
    );

    console.log('Cotización creada:', quote.id);

    // Crear grant para pago saliente
    const outgoingPaymentGrant = await client.grant.request(
      {
        url: sendingWalletAddress.authServer,
      },
      {
        access_token: {
          access: [
            {
              type: "outgoing-payment",
              actions: ["create"],
              limits: {
                debitAmount: quote.debitAmount,
              },
              identifier: sendingWalletAddress.id,
            },
          ],
        },
        interact: {
          start: ["redirect"],
        },
      }
    );

    // Generar ID de sesión y guardar estado
    const sessionId = generateSessionId();
    
    paymentSessions.set(sessionId, {
      client,
      quote,
      sendingWalletAddress,
      outgoingPaymentGrant,
      incomingPayment,
      amount: numAmount,
      receivingWallet: trimmedWallet,
      timestamp: Date.now(),
      status: 'pending_authorization'
    });

    console.log('Sesión de pago creada:', sessionId);

    // Responder con datos necesarios para autorización
    res.json({
      success: true,
      sessionId,
      authorizationUrl: outgoingPaymentGrant.interact?.redirect,
      continueUrl: outgoingPaymentGrant.continue?.uri,
      amount: numAmount,
      receivingWallet: trimmedWallet,
      debitAmount: quote.debitAmount,
      message: 'Pago iniciado. Se requiere autorización del usuario.'
    });

  } catch (error) {
    console.error('Error iniciando pago:', error);
    
    // Respuesta de error estructurada
    res.status(500).json({ 
      success: false,
      error: 'Error interno del servidor',
      message: 'No se pudo iniciar el pago',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Controlador para completar el pago después de la autorización
 */
export const completePayment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ 
        success: false,
        error: 'ID de sesión requerido y debe ser válido'
      });
    }

    const session = paymentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ 
        success: false,
        error: 'Sesión no encontrada o expirada'
      });
    }

    if (session.status !== 'pending_authorization') {
      return res.status(400).json({
        success: false,
        error: 'La sesión no está en estado válido para completar'
      });
    }

    console.log('Completando pago para sesión:', sessionId);

    const { client, quote, sendingWalletAddress, outgoingPaymentGrant } = session;

    // Continuar con la autorización del pago saliente
    const finalizedOutgoingPaymentGrant = await client.grant.continue({
      url: outgoingPaymentGrant.continue.uri,
      accessToken: outgoingPaymentGrant.continue.access_token.value,
    });

    if (!isFinalizedGrant(finalizedOutgoingPaymentGrant)) {
      throw new Error("Error finalizando grant de pago saliente");
    }

    // Crear el pago saliente final
    const outgoingPayment = await client.outgoingPayment.create(
      {
        url: sendingWalletAddress.resourceServer,
        accessToken: finalizedOutgoingPaymentGrant.access_token.value,
      },
      {
        walletAddress: sendingWalletAddress.id,
        quoteId: quote.id,
      }
    );

    console.log('Pago completado exitosamente:', outgoingPayment.id);

    // Actualizar estado de la sesión
    session.status = 'completed';
    session.outgoingPayment = outgoingPayment;
    session.completedAt = Date.now();

    // Limpiar sesión después de un breve período (para permitir consultas)
    setTimeout(() => {
      paymentSessions.delete(sessionId);
      console.log('Sesión limpiada:', sessionId);
    }, 300000); // 5 minutos

    res.json({
      success: true,
      sessionId,
      outgoingPayment,
      summary: {
        amount: session.amount,
        receivingWallet: session.receivingWallet,
        debitAmount: quote.debitAmount,
        completedAt: new Date(session.completedAt).toISOString()
      },
      message: 'Pago completado exitosamente'
    });

  } catch (error) {
    console.error('Error completando pago:', error);
    
    res.status(500).json({ 
      success: false,
      error: 'Error completando el pago',
      message: 'El pago no pudo ser procesado',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Controlador para obtener el estado de una sesión
 */
export const getSessionStatus = (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId) {
    return res.status(400).json({ 
      success: false,
      error: 'ID de sesión requerido' 
    });
  }

  const session = paymentSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ 
      success: false,
      error: 'Sesión no encontrada o expirada' 
    });
  }

  // Información básica de la sesión (sin datos sensibles)
  res.json({
    success: true,
    sessionId,
    status: session.status,
    amount: session.amount,
    receivingWallet: session.receivingWallet,
    createdAt: new Date(session.timestamp).toISOString(),
    completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null
  });
};

/**
 * Controlador para cancelar una sesión
 */
export const cancelSession = (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId) {
    return res.status(400).json({ 
      success: false,
      error: 'ID de sesión requerido' 
    });
  }
  
  if (paymentSessions.has(sessionId)) {
    const session = paymentSessions.get(sessionId);
    
    // Solo permitir cancelación si no está completada
    if (session.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'No se puede cancelar un pago ya completado'
      });
    }
    
    paymentSessions.delete(sessionId);
    console.log('Sesión cancelada:', sessionId);
    
    res.json({ 
      success: true, 
      message: 'Sesión cancelada exitosamente',
      sessionId
    });
  } else {
    res.status(404).json({ 
      success: false,
      error: 'Sesión no encontrada'
    });
  }
};

/**
 * Controlador para obtener estadísticas del sistema
 */
export const getStats = (req, res) => {
  const now = Date.now();
  const sessions = Array.from(paymentSessions.values());
  
  const stats = {
    totalSessions: sessions.length,
    pendingAuthorization: sessions.filter(s => s.status === 'pending_authorization').length,
    completed: sessions.filter(s => s.status === 'completed').length,
    oldestSession: sessions.length > 0 ? 
      new Date(Math.min(...sessions.map(s => s.timestamp))).toISOString() : null,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  };
  
  res.json({
    success: true,
    stats,
    timestamp: new Date().toISOString()
  });
};

/**
 * Función para limpiar sesiones expiradas
 * Llamar periódicamente desde el servidor principal
 */
export const cleanupExpiredSessions = () => {
  const now = Date.now();
  const EXPIRY_TIME = 3600000; // 1 hora
  
  let cleanedCount = 0;
  
  for (const [sessionId, session] of paymentSessions.entries()) {
    if (now - session.timestamp > EXPIRY_TIME) {
      paymentSessions.delete(sessionId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Limpiadas ${cleanedCount} sesiones expiradas`);
  }
  
  return cleanedCount;
};

/**
 * Función para obtener información de configuración (sin datos sensibles)
 */
export const getConfig = (req, res) => {
  res.json({
    success: true,
    config: {
      walletAddress: WALLET_CONFIG.walletAddressUrl,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    }
  });
};

// Exportar las sesiones para uso en tests (opcional)
export const getSessionsMap = () => paymentSessions;