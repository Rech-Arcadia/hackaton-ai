// server.js
import { createAuthenticatedClient } from "@interledger/open-payments";
import { isFinalizedGrant } from "@interledger/open-payments";
import fs from "fs";
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"], // Permite tanto frontend como backend
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Variables globales para mantener el estado de los pagos
let paymentSessions = new Map();

// Configuración del wallet (extrae esto a variables de entorno en producción)
const WALLET_CONFIG = {
  walletAddressUrl: "https://ilp.interledger-test.dev/p1_uvm",
  keyId: "ddc91f99-b73f-4cba-882b-8263aa427a34",
  privateKeyPath: "private.key"
};

// Función para crear el cliente autenticado (reutilizable)
async function createClient() {
  try {
    if (!fs.existsSync(WALLET_CONFIG.privateKeyPath)) {
      throw new Error('Archivo private.key no encontrado');
    }
    
    const privateKey = fs.readFileSync(WALLET_CONFIG.privateKeyPath, "utf8");
    
    if (!privateKey || privateKey.trim().length === 0) {
      throw new Error('Clave privada vacía o inválida');
    }
    
    return await createAuthenticatedClient({
      walletAddressUrl: WALLET_CONFIG.walletAddressUrl,
      privateKey: privateKey.trim(),
      keyId: WALLET_CONFIG.keyId,
    });
  } catch (error) {
    console.error('Error creando cliente autenticado:', error.message);
    throw new Error(`Error de configuración del cliente: ${error.message}`);
  }
}

// Validación de entrada
function validatePaymentInput(receivingWallet, amount) {
  const errors = [];
  
  if (!receivingWallet || typeof receivingWallet !== 'string' || receivingWallet.trim().length === 0) {
    errors.push('URL del wallet receptor es requerida');
  } else {
    try {
      const url = new URL(receivingWallet.trim());
      if (url.protocol !== 'https:') {
        errors.push('El wallet debe usar protocolo HTTPS');
      }
    } catch (e) {
      errors.push('URL del wallet mal formada');
    }
  }
  
  if (!amount) {
    errors.push('Cantidad es requerida');
  } else {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      errors.push('Cantidad debe ser un número mayor a 0');
    }
    if (numAmount > 10000000) { // Límite de seguridad
      errors.push('Cantidad excede el límite máximo permitido');
    }
  }
  
  return errors;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    sessionsActive: paymentSessions.size,
    uptime: process.uptime()
  });
});

// API para iniciar el proceso de pago
app.post('/api/initiate-payment', async (req, res) => {
  try {
    const { receivingWallet, amount } = req.body;
    
    // Validar entrada
    const validationErrors = validatePaymentInput(receivingWallet, amount);
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Datos de entrada inválidos',
        details: validationErrors
      });
    }

    const trimmedWallet = receivingWallet.trim();
    const numAmount = Number(amount);

    console.log('Iniciando pago:', { receivingWallet: trimmedWallet, amount: numAmount });

    // Crear cliente autenticado
    const client = await createClient();

    // Obtener información de las direcciones de wallet con timeout
    const sendingWalletAddress = await Promise.race([
      client.walletAddress.get({
        url: WALLET_CONFIG.walletAddressUrl,
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout obteniendo wallet de envío')), 10000)
      )
    ]);

    const receivingWalletAddress = await Promise.race([
      client.walletAddress.get({
        url: trimmedWallet,
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout obteniendo wallet receptor')), 10000)
      )
    ]);

    if (!sendingWalletAddress || !receivingWalletAddress) {
      throw new Error('No se pudieron obtener las direcciones de wallet');
    }

    console.log('Wallets obtenidas:', { 
      sendingWallet: sendingWalletAddress.id, 
      receivingWallet: receivingWalletAddress.id 
    });

    // Solicitar grant para crear pagos entrantes
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

    // Solicitar grant para crear cotización
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

    // Solicitar grant para crear pago saliente
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

    // Generar un ID único para esta sesión de pago
    const sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Guardar el estado de la sesión
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

    console.log('Grant de pago saliente creado para sesión:', sessionId);

    // Verificar que tenemos la URL de autorización
    if (!outgoingPaymentGrant.interact?.redirect) {
      throw new Error('No se pudo obtener URL de autorización');
    }

    // Responder con la información necesaria para la autorización
    res.json({
      success: true,
      sessionId,
      authorizationUrl: outgoingPaymentGrant.interact.redirect,
      continueUrl: outgoingPaymentGrant.continue?.uri,
      amount: numAmount,
      receivingWallet: trimmedWallet,
      debitAmount: quote.debitAmount,
      message: 'Pago iniciado. Se requiere autorización del usuario.'
    });

  } catch (error) {
    console.error('Error iniciando pago:', error);
    
    // Limpiar cualquier sesión parcial
    const { sessionId } = req.body;
    if (sessionId && paymentSessions.has(sessionId)) {
      paymentSessions.delete(sessionId);
    }
    
    let errorMessage = 'Error interno del servidor';
    let statusCode = 500;
    
    if (error.message.includes('Timeout')) {
      errorMessage = 'Timeout conectando con el servicio de pagos';
      statusCode = 408;
    } else if (error.message.includes('wallet mal formada')) {
      errorMessage = 'URL de wallet inválida';
      statusCode = 400;
    } else if (error.message.includes('private.key')) {
      errorMessage = 'Error de configuración del servidor';
      statusCode = 500;
    }
    
    res.status(statusCode).json({ 
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API para completar el proceso de pago después de la autorización
app.post('/api/complete-payment', async (req, res) => {
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

    // Verificar que tenemos los datos necesarios para continuar
    if (!outgoingPaymentGrant.continue?.uri || !outgoingPaymentGrant.continue?.access_token?.value) {
      throw new Error('Datos de continuación del grant no válidos');
    }

    // Continuar con la autorización del pago saliente
    const finalizedOutgoingPaymentGrant = await client.grant.continue({
      url: outgoingPaymentGrant.continue.uri,
      accessToken: outgoingPaymentGrant.continue.access_token.value,
    });

    if (!isFinalizedGrant(finalizedOutgoingPaymentGrant)) {
      throw new Error("Error finalizando grant de pago saliente");
    }

    // Crear el pago saliente
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

    // Actualizar el estado de la sesión
    session.status = 'completed';
    session.outgoingPayment = outgoingPayment;
    session.completedAt = Date.now();

    // Programar limpieza de la sesión (5 minutos)
    setTimeout(() => {
      if (paymentSessions.has(sessionId)) {
        paymentSessions.delete(sessionId);
        console.log('Sesión limpiada:', sessionId);
      }
    }, 300000);

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
    
    // Marcar sesión como error si existe
    const { sessionId } = req.body;
    if (sessionId && paymentSessions.has(sessionId)) {
      const session = paymentSessions.get(sessionId);
      session.status = 'error';
      session.error = error.message;
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Error completando el pago',
      message: 'El pago no pudo ser procesado',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API para obtener el estado de una sesión
app.get('/api/session/:sessionId', (req, res) => {
  try {
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
    const sessionInfo = {
      success: true,
      sessionId,
      status: session.status,
      amount: session.amount,
      receivingWallet: session.receivingWallet,
      createdAt: new Date(session.timestamp).toISOString(),
      completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null
    };

    // Agregar información de error si existe
    if (session.error) {
      sessionInfo.error = session.error;
    }

    res.json(sessionInfo);
  } catch (error) {
    console.error('Error obteniendo estado de sesión:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// API para cancelar una sesión
app.delete('/api/session/:sessionId', (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error cancelando sesión:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Limpiar sesiones expiradas cada 30 minutos
const cleanupInterval = setInterval(() => {
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
}, 1800000); // 30 minutos

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('Error no manejado:', error);
  
  // No enviar respuesta si ya se envió
  if (res.headersSent) {
    return next(error);
  }
  
  res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Endpoint no encontrado
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint no encontrado'
  });
});

// Manejo de cierre graceful
process.on('SIGINT', () => {
  console.log('Cerrando servidor...');
  clearInterval(cleanupInterval);
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
  console.log('📁 Asegúrate de que el archivo private.key esté en la raíz del proyecto backend');
  console.log(`🔗 API disponible en http://localhost:${PORT}/api/`);
});