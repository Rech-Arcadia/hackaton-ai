import React, { useEffect, useState } from 'react';

const AuthorizePayment = ({ paymentData, onComplete, onCancel, loading }) => {
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutos en segundos
  const [authorizationCompleted, setAuthorizationCompleted] = useState(false);

  // Contador regresivo para la autorización
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prevTime => {
        if (prevTime <= 1) {
          clearInterval(timer);
          onCancel('Tiempo de autorización agotado');
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onCancel]);

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatAmount = (amount) => {
    return new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const handleOpenAuthorization = () => {
    if (paymentData?.authorizationUrl) {
      // Abrir la URL de autorización en una nueva ventana
      const authWindow = window.open(
        paymentData.authorizationUrl,
        'authorization',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      // Verificar si la ventana se abrió correctamente
      if (authWindow) {
        setAuthorizationCompleted(true);
        
        // Opcional: detectar cuando se cierra la ventana de autorización
        const checkClosed = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkClosed);
            console.log('Ventana de autorización cerrada');
          }
        }, 1000);
      } else {
        alert('No se pudo abrir la ventana de autorización. Verifica que no esté bloqueada por el navegador.');
      }
    }
  };

  const handleCompletePayment = () => {
    if (paymentData?.sessionId) {
      onComplete(paymentData.sessionId);
    }
  };

  const handleCancel = () => {
    onCancel('Pago cancelado por el usuario');
  };

  if (!paymentData) {
    return (
      <div className="authorize-payment error">
        <h2>Error</h2>
        <p>No se encontraron datos del pago</p>
        <button onClick={handleCancel} className="cancel-button">
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="authorize-payment">
      <h2>Autorizar Pago</h2>
      
      {/* Información del pago */}
      <div className="payment-summary">
        <h3>Resumen del Pago</h3>
        <div className="summary-item">
          <span className="label">Wallet Receptor:</span>
          <span className="value">{paymentData.receivingWallet}</span>
        </div>
        <div className="summary-item">
          <span className="label">Cantidad a Enviar:</span>
          <span className="value amount">{formatAmount(paymentData.amount)}</span>
        </div>
        {paymentData.debitAmount && (
          <div className="summary-item">
            <span className="label">Cantidad a Debitar:</span>
            <span className="value amount">
              {formatAmount(paymentData.debitAmount.value)} {paymentData.debitAmount.assetCode}
            </span>
          </div>
        )}
      </div>

      {/* Timer */}
      <div className="authorization-timer">
        <span className="timer-label">Tiempo restante para autorizar:</span>
        <span className={`timer-value ${timeLeft < 120 ? 'warning' : ''}`}>
          {formatTime(timeLeft)}
        </span>
      </div>

      {/* Pasos de autorización */}
      <div className="authorization-steps">
        <div className={`step ${!authorizationCompleted ? 'active' : 'completed'}`}>
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Abrir Autorización</h4>
            <p>Se abrirá una nueva ventana para autorizar el pago</p>
            {!authorizationCompleted && paymentData.authorizationUrl && (
              <button 
                onClick={handleOpenAuthorization}
                className="authorize-button"
                disabled={loading}
              >
                Abrir Autorización
              </button>
            )}
          </div>
        </div>

        <div className={`step ${authorizationCompleted ? 'active' : ''}`}>
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Completar Pago</h4>
            <p>Una vez autorizado, haz clic para completar el pago</p>
            {authorizationCompleted && (
              <button 
                onClick={handleCompletePayment}
                className="complete-button"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="spinner small"></div>
                    Completando...
                  </>
                ) : (
                  'Completar Pago'
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Información adicional */}
      <div className="info-panel">
        <h4>Instrucciones</h4>
        <ol>
          <li>Haz clic en "Abrir Autorización" para abrir la ventana de autorización</li>
          <li>Completa el proceso de autorización en la ventana emergente</li>
          <li>Regresa a esta ventana y haz clic en "Completar Pago"</li>
          <li>El pago se procesará automáticamente</li>
        </ol>
        
        <div className="warning">
          <strong>Importante:</strong> No cierres esta ventana durante el proceso de autorización.
        </div>
      </div>

      {/* Botones de acción */}
      <div className="action-buttons">
        <button 
          onClick={handleCancel}
          className="cancel-button"
          disabled={loading}
        >
          Cancelar Pago
        </button>
        
        {paymentData.sessionId && (
          <div className="session-info">
            <small>ID de Sesión: {paymentData.sessionId}</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthorizePayment;