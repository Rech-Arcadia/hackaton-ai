import React, { useState } from 'react';
import './styles/App.css';
import PaymentForm from './components/PaymentForm';
import PaymentStatus from './components/PaymentStatus';
import AuthorizePayment from './components/AuthorizePayment';
import { usePayment } from './hooks/usePayment';

function App() {
  const {
    paymentState,
    initiatePayment,
    completePayment,
    cancelPayment,
    resetPayment
  } = usePayment();

  const renderCurrentStep = () => {
    switch (paymentState.status) {
      case 'idle':
        return (
          <PaymentForm 
            onSubmit={initiatePayment}
            loading={paymentState.loading}
          />
        );
      
      case 'pending_authorization':
        return (
          <AuthorizePayment 
            paymentData={paymentState.data}
            onComplete={completePayment}
            onCancel={cancelPayment}
            loading={paymentState.loading}
          />
        );
      
      case 'completed':
      case 'error':
        return (
          <PaymentStatus 
            status={paymentState.status}
            data={paymentState.data}
            error={paymentState.error}
            onReset={resetPayment}
          />
        );
      
      default:
        return (
          <div className="loading">
            <div className="spinner"></div>
            <p>Cargando...</p>
          </div>
        );
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>KualiPay</h1>
        <p>Sistema de pagos usando Open Payments API</p>
      </header>
      
      <main className="App-main">
        <div className="payment-container">
          {/* Indicador de progreso */}
          <div className="progress-indicator">
            <div className={`step ${paymentState.status === 'idle' ? 'active' : paymentState.status !== 'idle' ? 'completed' : ''}`}>
              1. Configurar Pago
            </div>
            <div className={`step ${paymentState.status === 'pending_authorization' ? 'active' : paymentState.status === 'completed' ? 'completed' : ''}`}>
              2. Autorización
            </div>
            <div className={`step ${paymentState.status === 'completed' ? 'active completed' : ''}`}>
              3. Finalizado
            </div>
          </div>

          {/* Contenido principal */}
          {renderCurrentStep()}
        </div>
      </main>

      <footer className="App-footer">
        <p>
          Desarrollado con React y Open Payments API
          {paymentState.sessionId && (
            <span className="session-id">
              | Sesión: {paymentState.sessionId}
            </span>
          )}
        </p>
      </footer>
    </div>
  );
}

export default App;