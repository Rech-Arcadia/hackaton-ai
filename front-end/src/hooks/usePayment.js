import { useState, useCallback, useRef } from 'react';
import { paymentService } from '../services/paymentService';

const INITIAL_STATE = {
  status: 'idle', // 'idle' | 'pending_authorization' | 'completed' | 'error'
  loading: false,
  data: null,
  error: null,
  sessionId: null
};

export const usePayment = () => {
  const [paymentState, setPaymentState] = useState(INITIAL_STATE);
  const abortControllerRef = useRef(null);

  // Función para actualizar el estado de forma segura
  const updateState = useCallback((updates) => {
    setPaymentState(prevState => ({
      ...prevState,
      ...updates
    }));
  }, []);

  // Función para iniciar el proceso de pago
  const initiatePayment = useCallback(async (paymentData) => {
    try {
      // Cancelar cualquier solicitud anterior
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      abortControllerRef.current = new AbortController();

      updateState({
        status: 'idle',
        loading: true,
        error: null,
        data: null
      });

      console.log('Iniciando pago con datos:', paymentData);

      const response = await paymentService.initiatePayment(paymentData);
      
      updateState({
        status: 'pending_authorization',
        loading: false,
        data: response,
        sessionId: response.sessionId
      });

      console.log('Pago iniciado exitosamente:', response);
      
    } catch (error) {
      console.error('Error al iniciar pago:', error);
      
      updateState({
        status: 'error',
        loading: false,
        error: error.message || 'Error desconocido al iniciar el pago',
        data: null
      });
    }
  }, [updateState]);

  // Función para completar el pago después de la autorización
  const completePayment = useCallback(async (sessionId) => {
    try {
      if (!sessionId) {
        throw new Error('Se requiere el ID de la sesión');
      }

      updateState({
        loading: true,
        error: null
      });

      console.log('Completando pago para sesión:', sessionId);

      const response = await paymentService.completePayment(sessionId);
      
      updateState({
        status: 'completed',
        loading: false,
        data: response,
        error: null
      });

      console.log('Pago completado exitosamente:', response);
      
    } catch (error) {
      console.error('Error al completar pago:', error);
      
      updateState({
        status: 'error',
        loading: false,
        error: error.message || 'Error desconocido al completar el pago'
      });
    }
  }, [updateState]);

  // Función para cancelar el pago
  const cancelPayment = useCallback(async (reason = 'Pago cancelado por el usuario') => {
    try {
      // Cancelar cualquier solicitud en curso
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Si hay una sesión activa, intentar cancelarla en el servidor
      if (paymentState.sessionId) {
        try {
          await paymentService.cancelSession(paymentState.sessionId);
          console.log('Sesión cancelada en el servidor:', paymentState.sessionId);
        } catch (error) {
          console.warn('Error cancelando sesión en el servidor:', error.message);
          // No lanzar error aquí, ya que el estado local se resetea de todos modos
        }
      }

      updateState({
        status: 'error',
        loading: false,
        error: reason,
        data: paymentState.data // Mantener los datos para referencia
      });

      console.log('Pago cancelado:', reason);
      
    } catch (error) {
      console.error('Error al cancelar pago:', error);
      
      updateState({
        status: 'error',
        loading: false,
        error: error.message || 'Error cancelando el pago'
      });
    }
  }, [updateState, paymentState.sessionId, paymentState.data]);

  // Función para resetear el estado y empezar de nuevo
  const resetPayment = useCallback(() => {
    // Cancelar cualquier solicitud en curso
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setPaymentState(INITIAL_STATE);
    console.log('Estado del pago reseteado');
  }, []);

  // Función para verificar el estado de una sesión
  const checkSessionStatus = useCallback(async (sessionId) => {
    try {
      const response = await paymentService.getSessionStatus(sessionId);
      return response;
    } catch (error) {
      console.error('Error verificando estado de sesión:', error);
      throw error;
    }
  }, []);

  // Función para obtener información de salud del servidor
  const checkServerHealth = useCallback(async () => {
    try {
      const response = await paymentService.healthCheck();
      return response;
    } catch (error) {
      console.error('Error verificando salud del servidor:', error);
      throw error;
    }
  }, []);

  // Función helper para determinar si se puede cancelar el pago
  const canCancel = paymentState.status === 'pending_authorization' && !paymentState.loading;

  // Función helper para determinar si se puede resetear
  const canReset = paymentState.status === 'completed' || paymentState.status === 'error';

  // Función helper para obtener el progreso actual
  const getProgress = () => {
    switch (paymentState.status) {
      case 'idle':
        return { step: 1, total: 3, label: 'Configurando pago' };
      case 'pending_authorization':
        return { step: 2, total: 3, label: 'Esperando autorización' };
      case 'completed':
        return { step: 3, total: 3, label: 'Pago completado' };
      case 'error':
        return { step: 0, total: 3, label: 'Error en el pago' };
      default:
        return { step: 0, total: 3, label: 'Estado desconocido' };
    }
  };

  return {
    // Estado principal
    paymentState,
    
    // Acciones principales
    initiatePayment,
    completePayment,
    cancelPayment,
    resetPayment,
    
    // Funciones auxiliares
    checkSessionStatus,
    checkServerHealth,
    
    // Helpers para UI
    canCancel,
    canReset,
    getProgress,
    
    // Estado derivado
    isLoading: paymentState.loading,
    hasError: paymentState.status === 'error',
    isCompleted: paymentState.status === 'completed',
    isPendingAuth: paymentState.status === 'pending_authorization',
    currentSessionId: paymentState.sessionId
  };
};

export default usePayment;