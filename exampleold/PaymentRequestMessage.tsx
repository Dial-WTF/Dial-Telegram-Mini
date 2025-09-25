import React, { useEffect, useRef, useState } from 'react';

import { getRequestStatus } from '#/lib/requestNetwork'; // Import API function
// ⚠️ DEPRECATED: Use matrix-js-sdk client directly in new code
// Import types

// Placeholder for an icon, you can replace it with an actual SVG or an icon library component
const UserAvatarPlaceholder: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`flex-shrink-0 w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 ${className || ''}`}
  ></div>
);

export interface PaymentRequestData {
  id: string; // Unique ID for the request, could be paymentReference from Request Network
  payeeName: string; // Display name of the payee
  payeeAvatarUrl?: string; // Optional URL for payee's avatar
  amount: string; // Formatted amount, e.g., "$20"
  currencySymbol: string; // e.g., "$", "€", "ETH"
  description?: string; // e.g., "for 🦖"
  timestamp: string; // e.g., "3:56 AM"
  status: 'pending' | 'paid' | 'expired' | 'cancelled'; // Status of the request
  paymentCurrency?: string; // The currency ID string like "USDC-base" or "MATIC-matic"
  onPay?: (requestId: string) => void; // Callback when pay button is clicked
  // Add any other relevant fields from Request Network API response or your app's needs
  paymentReference?: string;
  requestIdFromNetwork?: string;
}

interface PaymentRequestMessageProps {
  request: PaymentRequestData;
  isSender: boolean; // To style the bubble differently if sent by the current user
  onPayRequest?: (paymentReference: string, requestData: PaymentRequestData) => void; // Handler for the pay action
  messageId?: string; // Used for updating payment status
}

const PaymentRequestMessage: React.FC<PaymentRequestMessageProps> = ({
  request,
  isSender,
  onPayRequest,
  messageId,
}) => {
  // Local status tracking for payment status updates
  const [paymentStatus, setPaymentStatus] = useState<string>(request.status);
  const hasCheckedStatus = useRef(false);

  // Determine current status from our state or prop
  const currentStatus = paymentStatus || request.status;

  // Check initial status if needed
  useEffect(() => {
    if (
      currentStatus === 'pending' &&
      messageId &&
      request.paymentReference &&
      !hasCheckedStatus.current
    ) {
      hasCheckedStatus.current = true;
      console.log(
        `[PaymentRequestMessage] Checking initial status for pending request: ${request.paymentReference} (Msg ID: ${messageId})`
      );

      getRequestStatus(request.paymentReference)
        .then((statusData) => {
          if (statusData.hasBeenPaid) {
            console.log(
              `[PaymentRequestMessage] Request ${request.paymentReference} is already paid. Updating local status.`
            );
            setPaymentStatus('paid');
          }
        })
        .catch((error) => {
          console.error(
            `[PaymentRequestMessage] Error checking status for ${request.paymentReference}:`,
            error
          );
        });
    }
  }, [currentStatus, messageId, request.paymentReference]);

  // Use currentStatus for rendering logic
  const canPay = currentStatus === 'pending' && onPayRequest && !isSender;

  return (
    <div className={`flex ${isSender ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-md lg:max-w-lg px-4 py-3 rounded-lg shadow ${
          // Base style on derived currentStatus
          currentStatus === 'paid'
            ? isSender
              ? 'bg-gray-400 dark:bg-gray-600'
              : 'bg-gray-200 dark:bg-gray-500' // Example: Gray out if paid
            : isSender
              ? 'bg-blue-500 text-white dark:bg-blue-600'
              : 'bg-white text-gray-800 dark:bg-gray-700 dark:text-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            {request.payeeAvatarUrl ? (
              <img
                src={request.payeeAvatarUrl}
                alt={request.payeeName}
                className="w-10 h-10 rounded-full mr-3"
              />
            ) : (
              <UserAvatarPlaceholder className="mr-3" />
            )}
            <div>
              <p
                className={`font-semibold ${isSender && currentStatus !== 'paid' ? 'text-white' : 'text-gray-900 dark:text-white'}`}
              >
                {request.payeeName}
              </p>
              <p
                className={`text-sm ${isSender && currentStatus !== 'paid' ? 'text-blue-100' : 'text-gray-600 dark:text-gray-400'}`}
              >
                Requested {request.currencySymbol}
                {request.amount} {request.description}
              </p>
              <p
                className={`text-xs mt-1 ${isSender && currentStatus !== 'paid' ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'}`}
              >
                {request.timestamp}
              </p>
            </div>
          </div>

          {canPay && (
            <button
              onClick={() => onPayRequest!(request.paymentReference || request.id, request)}
              className="ml-4 bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full transition duration-150 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75"
            >
              Pay
            </button>
          )}
          {/* Show Paid status based on currentStatus */}
          {currentStatus === 'paid' && (
            <span className="ml-4 text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-700 dark:text-green-100 py-1 px-3 rounded-full">
              Paid
            </span>
          )}
          {/* TODO: Add other statuses like expired, cancelled if needed */}
        </div>

        {/* Optional: Display more details or a link to RequestScan */}
        {request.requestIdFromNetwork && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
            <a
              href={`https://scan.request.network/request/${request.requestIdFromNetwork}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-xs ${isSender ? 'text-blue-100 hover:text-white' : 'text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300'}`}
            >
              View on RequestScan
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentRequestMessage;