import React from 'react';

const PaymentStatus = ({ status, data, error, onReset }) => {
  const formatAmount = (amount) => {
    if (typeof amount === 'object' && amount.value) {
      return `${new Intl.NumberFormat('es-ES').format(amount.value)} ${amount.assetCode || ''}`;
    }
    return new Intl.NumberFormat('es-ES').format(amount);
  };

  const formatDate = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return 'Fecha no disponible';
    }
  };

  if (status === 'completed') {
    return (
      <div className="payment-status success">
        <div className="status-icon success-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h2>¡Pago Completado!</h2>
        <p>Tu pago se ha procesado exitosamente</p>

        {/* Detalles del pago */}
        {data && (
          <div className="payment-details">
            <h3>Detalles de la Transacción</h3>
            
            {data.outgoingPayment && (
              <div className="detail-group">
                <div className="detail-item">
                  <span className="label">ID de Pago:</span>
                  <span className="value monospace">{data.outgoingPayment.id}</span>
                </div>
                
                {data.outgoingPayment.sentAmount && (
                  <div className="detail-item">
                    <span className="label">Cantidad Enviada:</span>
                    <span className="value amount">
                      {formatAmount(data.outgoingPayment.sentAmount)}
                    </span>
                  </div>
                )}

                {data.outgoingPayment.receiveAmount && (
                  <div className="detail-item">
                    <span className="label">Cantidad Recibida:</span>
                    <span className="value amount">
                      {formatAmount(data.outgoingPayment.receiveAmount)}
                    </span>
                  </div>
                )}

                {data.outgoingPayment.createdAt && (
                  <div className="detail-item">
                    <span className="label">Fecha y Hora:</span>
                    <span className="value">{formatDate(data.outgoingPayment.createdAt)}</span>
                  </div>
                )}

                {data.outgoingPayment.metadata && (
                  <div className="detail-item">
                    <span className="label">Estado:</span>
                    <span className="value status-badge completed">
                      {data.outgoingPayment.metadata.state || 'COMPLETADO'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {data.sessionId && (
              <div className="detail-item">
                <span className="label">ID de Sesión:</span>
                <span className="value monospace">{data.sessionId}</span>
              </div>
            )}
          </div>
        )}

        <div className="success-actions">
          <button onClick={onReset} className="primary-button">
            Realizar Otro Pago
          </button>
        </div>

        <div className="info-panel success-info">
          <h4>¿Qué sigue?</h4>
          <ul>
            <li>Tu pago ha sido procesado exitosamente</li>
            <li>Los fondos han sido transferidos al wallet receptor</li>
            <li>Puedes realizar otro pago cuando lo desees</li>
          </ul>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="payment-status error">
        <div className="status-icon error-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h2>Error en el Pago</h2>
        <p>Ha ocurrido un problema al procesar tu pago</p>

        {/* Detalles del error */}
        <div className="error-details">
          <h3>Detalles del Error</h3>
          <div className="error-message">
            <strong>Error:</strong> {error || 'Error desconocido'}
          </div>
          
          {data && data.sessionId && (
            <div className="detail-item">
              <span className="label">ID de Sesión:</span>
              <span className="value monospace">{data.sessionId}</span>
            </div>
          )}
        </div>

        <div className="error-actions">
          <button onClick={onReset} className="primary-button">
            Intentar de Nuevo
          </button>
        </div>

        <div className="info-panel error-info">
          <h4>Posibles Causas</h4>
          <ul>
            <li>Fondos insuficientes en el wallet de origen</li>
            <li>Problemas de conectividad de red</li>
            <li>Wallet receptor no disponible</li>
            <li>Sesión de autorización expirada</li>
            <li>Error en el servidor de Interledger</li>
          </ul>
          
          <div className="help-section">
            <h4>¿Necesitas Ayuda?</h4>
            <p>
              Si el problema persiste, verifica:
            </p>
            <ul>
              <li>Que el wallet receptor sea válido</li>
              <li>Tu conexión a internet</li>
              <li>Que los servidores de Interledger estén funcionando</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Estado por defecto (no debería llegar aquí)
  return (
    <div className="payment-status unknown">
      <div className="status-icon">
        <div className="spinner"></div>
      </div>
      <h2>Estado Desconocido</h2>
      <p>Estado del pago no reconocido</p>
      <button onClick={onReset} className="primary-button">
        Volver al Inicio
      </button>
    </div>
  );
};

export default PaymentStatus;