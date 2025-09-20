// server.js
import { createAuthenticatedClient } from "@interledger/open-payments";
import { isFinalizedGrant } from "@interledger/open-payments";
import fs from "fs";
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Variables globales para mantener el estado de los pagos
let paymentSessions = new Map();

// Ruta principal - sirve la interfaz HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API para iniciar el proceso de pago
app.post('/api/initiate-payment', async (req, res) => {
  try {
    const { receivingWallet, amount } = req.body;
    
    if (!receivingWallet || !amount) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    console.log('Iniciando pago:', { receivingWallet, amount });

    // Lee la clave privada del archivo (como en tu código original)
    const privateKey = fs.readFileSync("private.key", "utf8");

    // Crea un cliente autenticado con los datos del wallet principal
    const client = await createAuthenticatedClient({
      walletAddressUrl: "https://ilp.interledger-test.dev/p1_uvm",
      privateKey: privateKey, // Usa la variable, no el string
      keyId: "ddc91f99-b73f-4cba-882b-8263aa427a34",
    });

    // Obtiene la información de las direcciones de wallet
    const sendingWalletAddress = await client.walletAddress.get({
      url: "https://ilp.interledger-test.dev/p1_uvm",
    });

    const receivingWalletAddress = await client.walletAddress.get({
      url: receivingWallet,
    });

    console.log('Wallets obtenidas:', { sendingWalletAddress: sendingWalletAddress.id, receivingWalletAddress: receivingWalletAddress.id });

    // Solicita un grant para crear pagos entrantes
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
      throw new Error("Se espera finalice la concesión de pago entrante");
    }

    // Crea un pago entrante
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
          value: amount.toString(),
        },
      }
    );

    console.log('Pago entrante creado:', incomingPayment.id);

    // Solicita un grant para crear cotización
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
      throw new Error("Se espera finalice la concesión de cotización");
    }

    // Crea una cotización
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

    // Solicita un grant para crear pago saliente
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

    // Genera un ID único para esta sesión de pago
    const sessionId = Date.now().toString();
    
    // Guarda el estado de la sesión
    paymentSessions.set(sessionId, {
      client,
      quote,
      sendingWalletAddress,
      outgoingPaymentGrant,
      amount,
      receivingWallet
    });

    console.log('Grant de pago saliente creado:', outgoingPaymentGrant);

    // Responde con la información necesaria para la autorización
    res.json({
      success: true,
      sessionId,
      authorizationUrl: outgoingPaymentGrant.interact?.redirect,
      continueUrl: outgoingPaymentGrant.continue?.uri,
      amount,
      receivingWallet,
      debitAmount: quote.debitAmount,
      message: 'Pago iniciado. Se requiere autorización.'
    });

  } catch (error) {
    console.error('Error iniciando pago:', error);
    res.status(500).json({ 
      error: 'Error iniciando el pago',
      details: error.message 
    });
  }
});

// API para completar el proceso de pago después de la autorización
app.post('/api/complete-payment', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Se requiere sessionId' });
    }

    const session = paymentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada o expirada' });
    }

    console.log('Completando pago para sesión:', sessionId);

    const { client, quote, sendingWalletAddress, outgoingPaymentGrant } = session;

    // Continúa con la autorización del pago saliente
    const finalizedOutgoingPaymentGrant = await client.grant.continue({
      url: outgoingPaymentGrant.continue.uri,
      accessToken: outgoingPaymentGrant.continue.access_token.value,
    });

    if (!isFinalizedGrant(finalizedOutgoingPaymentGrant)) {
      throw new Error("Se espera finalice la concesión de pago saliente");
    }

    // Crea el pago saliente
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

    console.log('Pago completado:', outgoingPayment);

    // Limpia la sesión
    paymentSessions.delete(sessionId);

    res.json({
      success: true,
      outgoingPayment,
      message: '¡Pago completado exitosamente!'
    });

  } catch (error) {
    console.error('Error completando pago:', error);
    res.status(500).json({ 
      error: 'Error completando el pago',
      details: error.message 
    });
  }
});

// API para obtener el estado de una sesión
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = paymentSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }

  res.json({
    sessionId,
    amount: session.amount,
    receivingWallet: session.receivingWallet,
    exists: true
  });
});

// Limpia sesiones expiradas cada 30 minutos
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of paymentSessions.entries()) {
    // Expira sesiones después de 1 hora
    if (now - parseInt(sessionId) > 3600000) {
      paymentSessions.delete(sessionId);
      console.log('Sesión expirada eliminada:', sessionId);
    }
  }
}, 1800000);

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log('📁 Asegúrate de que el archivo private.key esté en la raíz del proyecto');
  console.log('🌐 Abre http://localhost:${PORT} en tu navegador para usar la interfaz');
});