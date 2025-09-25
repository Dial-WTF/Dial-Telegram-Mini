import React, { useEffect, useState } from 'react';

// Define the structure for the form data
export interface RequestFormData {
  payeeAddress: string;
  amount: string;
  invoiceCurrency: string; // e.g., "USD"
  paymentCurrency: string; // e.g., "ETH-base-mainnet" (using a placeholder, confirm actual format)
  description?: string; // Optional description for the request
}

interface CreateRequestFormProps {
  onSubmit: (formData: RequestFormData) => void;
  onClose: () => void;
  defaultPayeeAddress?: string;
  defaultAmount?: string;
  defaultInvoiceCurrency?: string;
  defaultDescription?: string;
  // We might need the current user's address if the API requires a payer, even if optional
  // currentUserAddress?: string;
}

const CreateRequestForm: React.FC<CreateRequestFormProps> = ({
  onSubmit,
  onClose,
  defaultPayeeAddress,
  defaultAmount,
  defaultInvoiceCurrency,
  defaultDescription,
}) => {
  const [payeeAddress, setPayeeAddress] = useState(defaultPayeeAddress || '');
  const [amount, setAmount] = useState(defaultAmount || '');
  const [invoiceCurrency, setInvoiceCurrency] = useState(defaultInvoiceCurrency || 'USD');
  const [paymentCurrency, setPaymentCurrency] = useState('ETH-base-base');
  const [description, setDescription] = useState(defaultDescription || '');

  // Update state if default props change (e.g., opening modal again)
  useEffect(() => {
    if (defaultPayeeAddress) setPayeeAddress(defaultPayeeAddress);
    else setPayeeAddress(''); // Reset if no default
  }, [defaultPayeeAddress]);

  useEffect(() => {
    if (defaultAmount) setAmount(defaultAmount);
    else setAmount('');
  }, [defaultAmount]);

  useEffect(() => {
    if (defaultInvoiceCurrency) setInvoiceCurrency(defaultInvoiceCurrency);
    else setInvoiceCurrency('USD');
  }, [defaultInvoiceCurrency]);

  useEffect(() => {
    if (defaultDescription) setDescription(defaultDescription);
    else setDescription('');
  }, [defaultDescription]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payeeAddress || !amount || !invoiceCurrency || !paymentCurrency) {
      // Basic validation, you might want to add more specific error messages
      alert(
        'Please fill in all required fields: Payee Address, Amount, Invoice Currency, and Payment Currency.'
      );
      return;
    }
    onSubmit({
      payeeAddress,
      amount,
      invoiceCurrency,
      paymentCurrency,
      description,
    });
  };

  // TODO: Fetch supported currencies from Request Network Token List for dropdowns
  const supportedInvoiceCurrencies = ['USD', 'EUR', 'GBP']; // Example - these are fiat invoice currencies
  const supportedPaymentCurrencies = [
    { id: 'ETH-base-base', name: 'ETH (Base)' },
    { id: 'USDC-base', name: 'USDC (Base)' },
    { id: 'DAI-base', name: 'DAI (Base)' },
    { id: 'MATIC-matic', name: 'MATIC (Polygon)' },
    { id: 'USDCn-matic', name: 'USDC (Polygon)' }, // Using native USDC ID
    { id: 'DAI-matic', name: 'DAI (Polygon)' },
    // Add more as needed
  ]; // Example for Base

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">
          Create Payment Request
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="payeeAddress"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Payee Wallet Address
            </label>
            <input
              type="text"
              id="payeeAddress"
              value={payeeAddress}
              onChange={(e) => setPayeeAddress(e.target.value)}
              placeholder="0x..."
              required
              readOnly={!!defaultPayeeAddress} // Make read-only if pre-filled
              className={`mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${defaultPayeeAddress ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : ''}`}
            />
          </div>
          <div>
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Amount
            </label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g., 20"
              required
              step="any"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label
              htmlFor="invoiceCurrency"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Invoice Currency
            </label>
            <select
              id="invoiceCurrency"
              value={invoiceCurrency}
              onChange={(e) => setInvoiceCurrency(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {supportedInvoiceCurrencies.map((curr) => (
                <option key={curr} value={curr}>
                  {curr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="paymentCurrency"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Payment Currency (on Base Mainnet)
            </label>
            <select
              id="paymentCurrency"
              value={paymentCurrency}
              onChange={(e) => setPaymentCurrency(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {/* TODO: Populate with actual Request Network Token List values for Base Mainnet */}
              {supportedPaymentCurrencies.map((curr) => (
                <option key={curr.id} value={curr.id}>
                  {curr.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Ensure this matches a supported currency on Request Network for Base.
            </p>
          </div>
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Description (Optional)
            </label>
            <input
              type="text"
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., For dinner"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800"
            >
              Create Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateRequestForm;