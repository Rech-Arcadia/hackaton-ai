import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// Configuración global de axios
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para logging y manejo de errores
api.interceptors.response.use(
  (response) => {
    console.log('API Response:', response.data);
    return response;
  },
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const paymentService = {
  /**
   * Verifica el estado del servidor
   */
  async healthCheck() {
    try {
      const response = await api.get('/health');
      return response.data;
    } catch (error) {
      throw new Error('No se pudo conectar con el servidor');
    }
  },

  /**
   * Inicia el proceso de pago
   * @param {Object} paymentData - Datos del pago
   * @param {string} paymentData.receivingWallet - URL del wallet receptor
   * @param {string|number} paymentData.amount - Cantidad a transferir
   * @returns {Promise<Object>} Respuesta con datos de la sesión
   */
  async initiatePayment(paymentData) {
    try {
      const { receivingWallet, amount } = paymentData;
      
      if (!receivingWallet || !amount) {
        throw new Error('Faltan datos requeridos: wallet receptor y cantidad');
      }

      if (isNaN(amount) || Number(amount) <= 0) {
        throw new Error('La cantidad debe ser un número mayor a 0');
      }

      const response = await api.post('/initiate-payment', {
        receivingWallet: receivingWallet.trim(),
        amount: Number(amount)
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Error iniciando el pago');
      }

      return response.data;
    } catch (error) {
      if (error.response) {
        // Error del servidor
        throw new Error(error.response.data?.error || 'Error del servidor');
      } else if (error.request) {
        // Error de red
        throw new Error('Error de conexión. Verifica tu conexión a internet.');
      } else {
        // Error de validación u otro
        throw error;
      }
    }
  },

  /**
   * Completa el proceso de pago después de la autorización
   * @param {string} sessionId - ID de la sesión de pago
   * @returns {Promise<Object>} Respuesta con resultado del pago
   */
  async completePayment(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('Se requiere el ID de la sesión');
      }

      const response = await api.post('/complete-payment', { sessionId });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Error completando el pago');
      }

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data?.error || 'Error completando el pago');
      } else if (error.request) {
        throw new Error('Error de conexión al completar el pago');
      } else {
        throw error;
      }
    }
  },

  /**
   * Obtiene el estado de una sesión de pago
   * @param {string} sessionId - ID de la sesión
   * @returns {Promise<Object>} Estado de la sesión
   */
  async getSessionStatus(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('Se requiere el ID de la sesión');
      }

      const response = await api.get(`/session/${sessionId}`);

      if (!response.data.success) {
        throw new Error(response.data.error || 'Sesión no encontrada');
      }

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Sesión no encontrada o expirada');
      } else if (error.response) {
        throw new Error(error.response.data?.error || 'Error obteniendo estado de sesión');
      } else if (error.request) {
        throw new Error('Error de conexión');
      } else {
        throw error;
      }
    }
  },

  /**
   * Cancela una sesión de pago
   * @param {string} sessionId - ID de la sesión a cancelar
   * @returns {Promise<Object>} Confirmación de cancelación
   */
  async cancelSession(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('Se requiere el ID de la sesión');
      }

      const response = await api.delete(`/session/${sessionId}`);

      if (!response.data.success) {
        throw new Error(response.data.error || 'Error cancelando la sesión');
      }

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        // Si la sesión ya no existe, consideramos que está cancelada
        return { success: true, message: 'Sesión ya cancelada o expirada' };
      } else if (error.response) {
        throw new Error(error.response.data?.error || 'Error cancelando la sesión');
      } else if (error.request) {
        throw new Error('Error de conexión al cancelar');
      } else {
        throw error;
      }
    }
  },

  /**
   * Valida una URL de wallet
   * @param {string} walletUrl - URL a validar
   * @returns {boolean} true si es válida
   */
  validateWalletUrl(walletUrl) {
    try {
      const url = new URL(walletUrl);
      return url.protocol === 'https:' && url.hostname.includes('interledger');
    } catch {
      return false;
    }
  },

  /**
   * Formatea una cantidad para mostrar
   * @param {string|number} amount - Cantidad a formatear
   * @param {string} assetCode - Código de la moneda (opcional)
   * @returns {string} Cantidad formateada
   */
  formatAmount(amount, assetCode = '') {
    try {
      const num = Number(amount);
      if (isNaN(num)) return amount;
      
      return new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(num) + (assetCode ? ` ${assetCode}` : '');
    } catch {
      return amount.toString();
    }
  }
};

export default paymentService;