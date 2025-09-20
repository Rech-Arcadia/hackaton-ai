import React, { useState } from 'react';

const PaymentForm = ({ onSubmit, loading }) => {
  const [formData, setFormData] = useState({
    receivingWallet: '',
    amount: ''
  });
  const [errors, setErrors] = useState({});

  // Wallets de ejemplo para facilitar las pruebas
  const exampleWallets = [
    'https://ilp.interledger-test.dev/p2_uvm',
    'https://ilp.interledger-test.dev/p3_uvm',
    'https://ilp.interledger-test.dev/p4_uvm'
  ];

  const validateForm = () => {
    const newErrors = {};

    // Validar wallet receptor
    if (!formData.receivingWallet.trim()) {
      newErrors.receivingWallet = 'El wallet receptor es requerido';
    } else {
      try {
        const url = new URL(formData.receivingWallet);
        if (url.protocol !== 'https:') {
          newErrors.receivingWallet = 'El wallet debe usar protocolo HTTPS';
        } else if (!url.hostname.includes('interledger')) {
          newErrors.receivingWallet = 'URL de wallet no válida';
        }
      } catch {
        newErrors.receivingWallet = 'URL de wallet no válida';
      }
    }

    // Validar cantidad
    if (!formData.amount.trim()) {
      newErrors.amount = 'La cantidad es requerida';
    } else {
      const amount = Number(formData.amount);
      if (isNaN(amount) || amount <= 0) {
        newErrors.amount = 'La cantidad debe ser un número mayor a 0';
      } else if (amount > 1000000) {
        newErrors.amount = 'La cantidad es demasiado grande';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Limpiar errores cuando el usuario empiece a escribir
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handleWalletSelect = (walletUrl) => {
    setFormData(prev => ({
      ...prev,
      receivingWallet: walletUrl
    }));
    if (errors.receivingWallet) {
      setErrors(prev => ({
        ...prev,
        receivingWallet: ''
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  return (
    <div className="payment-form">
      <h2>Configurar Pago</h2>
      <p>Ingresa los datos del pago que deseas realizar</p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="receivingWallet">Wallet Receptor</label>
          <input
            type="url"
            id="receivingWallet"
            name="receivingWallet"
            value={formData.receivingWallet}
            onChange={handleInputChange}
            placeholder="https://ilp.interledger-test.dev/wallet"
            className={errors.receivingWallet ? 'error' : ''}
            disabled={loading}
          />
          {errors.receivingWallet && (
            <span className="error-message">{errors.receivingWallet}</span>
          )}
          
          {/* Wallets de ejemplo */}
          <div className="example-wallets">
            <span className="example-label">Wallets de ejemplo:</span>
            <div className="wallet-buttons">
              {exampleWallets.map((wallet, index) => (
                <button
                  key={index}
                  type="button"
                  className="wallet-button"
                  onClick={() => handleWalletSelect(wallet)}
                  disabled={loading}
                >
                  Wallet {index + 2}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="amount">Cantidad</label>
          <input
            type="number"
            id="amount"
            name="amount"
            value={formData.amount}
            onChange={handleInputChange}
            placeholder="100"
            min="1"
            step="0.01"
            className={errors.amount ? 'error' : ''}
            disabled={loading}
          />
          {errors.amount && (
            <span className="error-message">{errors.amount}</span>
          )}
          <small className="input-help">
            Cantidad en unidades básicas (ej: 100 = $1.00)
          </small>
        </div>

        <button 
          type="submit" 
          className="submit-button"
          disabled={loading}
        >
          {loading ? (
            <>
              <div className="spinner small"></div>
              Iniciando Pago...
            </>
          ) : (
            'Iniciar Pago'
          )}
        </button>
      </form>

      <div className="info-panel">
        <h3>Información</h3>
        <ul>
          <li>Este sistema utiliza la red de prueba de Interledger</li>
          <li>Los pagos requieren autorización del usuario</li>
          <li>Las transacciones son instantáneas una vez autorizadas</li>
        </ul>
      </div>
    </div>
  );
};

export default PaymentForm;