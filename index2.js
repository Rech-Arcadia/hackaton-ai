// Importa la función para crear un cliente autenticado de Open Payments
const { createAuthenticatedClient } = require("@interledger/open-payments");

// Importa función para verificar si una concesión (grant) está finalizada
const { isFinalizedGrant } = require("@interledger/open-payments");

// Importa módulo para trabajar con archivos
const fs = require("fs");

// Importa módulo para leer entrada del usuario en consola (asincrónicamente)
const readline = require("readline/promises");

(async () => {
  try {
    // Lee la clave privada almacenada en el archivo local "private.key"
    const privateKey = fs.readFileSync("private.key", "utf8");

    // Crea un cliente autenticado con los datos del wallet principal
    const client = await createAuthenticatedClient({
      walletAddressUrl: "https://ilp.interledger-test.dev/p1_uvm", // Dirección del wallet
      privateKey: privateKey, // CORREGIDO: usar la variable privateKey, no el string
      keyId: "ddc91f99-b73f-4cba-882b-8263aa427a34", // Identificador de la clave
    });

    // Obtiene la información de la dirección de envío (wallet origen)
    const sendingWalletAddress = await client.walletAddress.get({
      url: "https://ilp.interledger-test.dev/p2_uvm", 
    });

    // Obtiene la información de la dirección de recepción (wallet destino)
    const receivingWalletAddress = await client.walletAddress.get({
      url: "https://ilp.interledger-test.dev/p3_uvm", 
    });

    console.log(sendingWalletAddress, receivingWalletAddress);

    // Solicita un grant (permiso) para crear pagos entrantes en el wallet de destino
    const incomingPaymentGrant = await client.grant.request(
      {
        url: receivingWalletAddress.authServer, // Servidor de autorización del wallet receptor
      },
      {
        access_token: {
          access: [
            {
              type: "incoming-payment", // Tipo de acceso: pagos entrantes
              actions: ["create"], // Acción permitida: crear
            },
          ],
        },
      }
    );

    // Valida que el grant realmente haya sido finalizado
    if (!isFinalizedGrant(incomingPaymentGrant)) {
      throw new Error("Se espera finalice la concesion");
    }

    console.log(incomingPaymentGrant);

    // Crea un pago entrante en el wallet receptor con un monto específico
    const incomingPayment = await client.incomingPayment.create(
      {
        url: receivingWalletAddress.resourceServer, // Servidor de recursos del receptor
        accessToken: incomingPaymentGrant.access_token.value, // Token de autorización
      },
      {
        walletAddress: receivingWalletAddress.id,
        incomingAmount: {
          assetCode: receivingWalletAddress.assetCode, // Tipo de moneda
          assetScale: receivingWalletAddress.assetScale, // Escala de la moneda
          value: "1000", // Monto a recibir
        },
      }
    );

    console.log({ incomingPayment });

    // Solicita un grant para crear una cotización (quote) en el wallet de envío
    const quoteGrant = await client.grant.request(
      {
        url: sendingWalletAddress.authServer,
      },
      {
        access_token: {
          access: [
            {
              type: "quote", // Tipo de acceso: cotización
              actions: ["create"], // Acción permitida: crear
            }
          ]
        }
      }
    );

    if (!isFinalizedGrant(quoteGrant)) {
      throw new Error("Se espera finalice la concesión");
    }

    console.log(quoteGrant);

    // Crea una cotización de pago hacia el receptor
    const quote = await client.quote.create(
      {
        url: sendingWalletAddress.resourceServer, // CORREGIDO: usar sendingWalletAddress
        accessToken: quoteGrant.access_token.value,
      },
      {
        walletAddress: sendingWalletAddress.id, // Wallet que envía
        receiver: incomingPayment.id, // Pago entrante como receptor
        method: "ilp", // Método de transferencia (Interledger Protocol)
      }
    );

    console.log({ quote });

    // Solicita un grant para crear un pago saliente desde el wallet origen
    const outgoingPaymentGrant = await client.grant.request(
      {
        url: sendingWalletAddress.authServer,
      },
      {
        access_token: {
          access: [
            {
              type: "outgoing-payment", // Tipo de acceso: pago saliente
              actions: ["create"], // Acción permitida: crear
              limits: {
                debitAmount: quote.debitAmount, // Límite de débito según la cotización
              },
              identifier: sendingWalletAddress.id, // Identificador del wallet origen
            }
          ]
        },
        interact: {
          start: ["redirect"], // Especifica que la interacción es mediante redirección
        },
      }
    );

    console.log({ outgoingPaymentGrant }); 

    // Pausa para que el usuario confirme continuar con el pago saliente
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    await rl.question("Presione Enter para continuar con el pago saliente...");
    rl.close();

    // Continúa con la autorización del pago saliente
    const isFinalizedOutgoingPaymentGrant = await client.grant.continue({
      url: outgoingPaymentGrant.continue.uri, // URI para continuar el flujo de autorización
      accessToken: outgoingPaymentGrant.continue.access_token.value,
    });

    if (!isFinalizedGrant(isFinalizedOutgoingPaymentGrant)) {
      throw new Error("Se espera finalice la concesión");
    }

    // Crea el pago saliente desde el wallet origen hacia el receptor
    const outgoingPayment = await client.outgoingPayment.create(
      {
        url: sendingWalletAddress.resourceServer,
        accessToken: isFinalizedOutgoingPaymentGrant.access_token.value, 
      },
      {
        walletAddress: sendingWalletAddress.id,
        quoteId: quote.id, // Se usa la cotización creada previamente
      }
    );

    console.log({ outgoingPayment });

  } catch (error) {
    console.error("Error en el proceso de pago:", error);
  }
})();