import { PaymentFormData, RequestFormData } from '#/components/messaging/payments';

const REQUEST_NETWORK_API_BASE_URL = 'https://api.request.network/v1';
// IMPORTANT: Replace with your actual API key, preferably from an environment variable
const REQUEST_NETWORK_API_KEY =
  process.env.NEXT_PUBLIC_REQUEST_NETWORK_API_KEY || 'YOUR_REQUEST_NETWORK_API_KEY';

export interface CreateRequestResponse {
  requestID: string;
  paymentReference: string;
  // Potentially other fields from the API response
}

export interface RequestNetworkError {
  message: string;
  // Potentially other error details
}

export interface PaymentCalldataResponse {
  transactions: {
    data: string;
    to: string;
    value: { type: string; hex: string }; // Representing BigNumber as hex string
  }[];
  metadata: {
    // Include metadata which might be useful
    stepsRequired: number;
    needsApproval: boolean;
    approvalTransactionIndex: number | null;
    hasEnoughBalance: boolean;
    hasEnoughGas: boolean;
  };
  // Potentially other fields
}

export interface RequestStatusResponse {
  hasBeenPaid: boolean;
  paymentReference: string;
  requestId: string;
  isListening: boolean;
  txHash?: string; // Optional, might not be present if not paid
  // Potentially other fields
}

export interface InitiatePaymentResponse extends PaymentCalldataResponse {
  // Extends the calldata response, and also includes request info
  requestID: string;
  paymentReference: string;
}

// Helper to map currency IDs to chain IDs (expand as needed)
// Based on https://github.com/RequestNetwork/request-network/blob/master/packages/currency/src/chainlink-path-aggregators.ts and token list
const currencyIdToChainIdMap: Record<string, number> = {
  'ETH-base-base': 8453,
  'USDC-base': 8453,
  'DAI-base': 8453,
  'MATIC-matic': 137,
  'USDCn-matic': 137, // Native USDC on Polygon
  'USDC-matic': 137, // Bridged USDC on Polygon (USDC.e)
  'DAI-matic': 137,
  // Mainnet Examples (if needed later)
  'ETH-mainnet': 1,
  'USDC-mainnet': 1,
  'DAI-mainnet': 1,
  // Add other supported currencies/chains here
};

/**
 * Gets the chain ID associated with a Request Network currency ID.
 * @param currencyId Example: "USDC-base", "MATIC-matic"
 * @returns The chain ID number or undefined if not found.
 */
export const getChainIdFromCurrencyId = (currencyId: string): number | undefined => {
  return currencyIdToChainIdMap[currencyId];
};

/**
 * Extracts the currency symbol (e.g., "ETH", "USDC", "MATIC") from a Request Network currency ID.
 * @param currencyId Example: "USDC-base", "MATIC-matic"
 * @returns The symbol string or the original ID if no hyphen is found.
 */
export const getSymbolFromCurrencyId = (currencyId: string): string => {
  const parts = currencyId.split('-');
  return parts[0]; // Assumes format TKN-network-chain
};

/**
 * Creates a new payment request via the Request Network API.
 * @param formData The data for creating the request.
 * @returns Promise resolving to the API response or an error.
 */
export const createRequestNetworkPayment = async (
  formData: RequestFormData
): Promise<CreateRequestResponse> => {
  if (REQUEST_NETWORK_API_KEY === 'YOUR_REQUEST_NETWORK_API_KEY') {
    console.warn(
      'Request Network API key is not configured. Please set NEXT_PUBLIC_REQUEST_NETWORK_API_KEY.'
    );
    // Potentially throw an error or return a mock response for local development without an API key
    // For now, let's throw to make it clear it needs setup.
    throw new Error('Request Network API key not configured.');
  }

  const {
    payeeAddress,
    amount,
    invoiceCurrency,
    paymentCurrency,
    description: _description,
  } = formData;

  // The API expects `payee`, not `payeeAddress`
  const payload = {
    payee: payeeAddress,
    amount: amount.toString(), // Ensure amount is a string
    invoiceCurrency, // e.g., "USD"
    paymentCurrency, // e.g., "ETH-base-mainnet" (Check Request Network Token List for correct values)
    // Payer is optional in the API, so we don't include it unless specifically needed
    // description is not directly in the create request body, it might be part of metadata or handled differently.
    // For now, we are not sending it. It might be stored locally with the request.
  };

  // Note: The API docs show `POST /v1/request`. We are using that.
  // The `description` field from our form is not a direct parameter in the `/v1/request` endpoint.
  // It might be something you store alongside the request data in your application, or if Request Network
  // supports custom metadata fields, it would be added there according to their specification.

  try {
    const response = await fetch(`${REQUEST_NETWORK_API_BASE_URL}/request`, {
      method: 'POST',
      headers: {
        'x-api-key': REQUEST_NETWORK_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Try to parse error message from API response
      let errorMsg = `API Error: ${response.status} ${response.statusText}`;
      try {
        const responseText = await response.text();
        if (responseText.trim()) {
          const errorData = JSON.parse(responseText);
          errorMsg = errorData?.message || errorData?.error || errorMsg;
        }
      } catch (_jsonError) {
        // If JSON parsing fails, use the default error message
        console.warn('Failed to parse error response as JSON');
      }
      console.error('Request Network API error:', errorMsg);
      throw new Error(errorMsg);
    }

    const responseData = await response.json();

    return responseData as CreateRequestResponse;
  } catch (error) {
    console.error('Failed to create payment request:', error);
    if (error instanceof Error) {
      throw error; // Re-throw if already an Error object
    }
    throw new Error('An unexpected error occurred while creating the payment request.');
  }
};

/**
 * Gets the transaction calldata needed to pay a specific request.
 * @param paymentReference The payment reference of the request.
 * @param payerAddress Optional address of the payer (may be needed by API/contract).
 * @returns Promise resolving to the payment calldata response or an error.
 */
export const getRequestPaymentCalldata = async (
  paymentReference: string,
  payerAddress?: string // Include optional payer address
): Promise<PaymentCalldataResponse> => {
  if (REQUEST_NETWORK_API_KEY === 'YOUR_REQUEST_NETWORK_API_KEY') {
    console.warn(
      'Request Network API key is not configured. Please set NEXT_PUBLIC_REQUEST_NETWORK_API_KEY.'
    );
    throw new Error('Request Network API key not configured.');
  }

  const url = new URL(`${REQUEST_NETWORK_API_BASE_URL}/request/${paymentReference}/pay`);
  if (payerAddress) {
    url.searchParams.append('wallet', payerAddress);
  }
  // Note: The API also supports optional `chain` and `token` query params for cross-chain payments
  // We are not using them here, assuming payment is on the same chain/token as the request.

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': REQUEST_NETWORK_API_KEY,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // Try to parse error message from API response
      let errorMsg = `API Error: ${response.status} ${response.statusText}`;
      try {
        const responseText = await response.text();
        if (responseText.trim()) {
          const errorData = JSON.parse(responseText);
          errorMsg = errorData?.message || errorData?.error || errorMsg;
        }
      } catch (_jsonError) {
        // If JSON parsing fails, use the default error message
        console.warn('Failed to parse error response as JSON');
      }
      console.error('Request Network API error fetching calldata:', errorMsg);
      throw new Error(errorMsg);
    }

    const responseData = await response.json();

    // Basic validation of expected structure
    if (
      !responseData.transactions ||
      !Array.isArray(responseData.transactions) ||
      responseData.transactions.length === 0
    ) {
      console.error('Invalid payment calldata structure received:', responseData);
      throw new Error('Received invalid payment calldata structure from API.');
    }

    return responseData as PaymentCalldataResponse;
  } catch (error) {
    console.error('Failed to get payment calldata:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while fetching payment calldata.');
  }
};

/**
 * Gets the status of a specific payment request.
 * @param paymentReference The payment reference of the request.
 * @returns Promise resolving to the request status response or an error.
 */
export const getRequestStatus = async (
  paymentReference: string
): Promise<RequestStatusResponse> => {
  if (REQUEST_NETWORK_API_KEY === 'YOUR_REQUEST_NETWORK_API_KEY') {
    console.warn(
      'Request Network API key is not configured. Please set NEXT_PUBLIC_REQUEST_NETWORK_API_KEY.'
    );
    throw new Error('Request Network API key not configured.');
  }

  const url = `${REQUEST_NETWORK_API_BASE_URL}/request/${paymentReference}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': REQUEST_NETWORK_API_KEY,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // Handle cases where the request might not be found (404) gracefully
      if (response.status === 404) {
        console.warn(`Request Network API: Request ${paymentReference} not found.`);
        // Depending on desired behavior, you might return a specific status or throw
        // For now, re-throw a specific error
        throw new Error(`Request not found: ${paymentReference}`);
      }

      // Try to parse error message from API response
      let errorMsg = `API Error: ${response.status} ${response.statusText}`;
      try {
        const responseText = await response.text();
        if (responseText.trim()) {
          const errorData = JSON.parse(responseText);
          errorMsg = errorData?.message || errorData?.error || errorMsg;
        }
      } catch (_jsonError) {
        // If JSON parsing fails, use the default error message
        console.warn('Failed to parse error response as JSON');
      }
      console.error('Request Network API error fetching status:', errorMsg);
      throw new Error(errorMsg);
    }

    const responseData = await response.json();

    // Basic validation
    if (typeof responseData.hasBeenPaid !== 'boolean') {
      console.error('Invalid request status structure received:', responseData);
      throw new Error('Received invalid request status structure from API.');
    }

    return responseData as RequestStatusResponse;
  } catch (error) {
    console.error('Failed to get request status:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while fetching request status.');
  }
};

/**
 * Initiates a payment by creating a request and immediately returning payment calldata.
 * @param formData The data for initiating the payment.
 * @returns Promise resolving to the API response including transaction details or an error.
 */
export const initiateRequestNetworkPayment = async (
  formData: PaymentFormData
): Promise<InitiatePaymentResponse> => {
  if (REQUEST_NETWORK_API_KEY === 'YOUR_REQUEST_NETWORK_API_KEY') {
    console.warn(
      'Request Network API key is not configured. Please set NEXT_PUBLIC_REQUEST_NETWORK_API_KEY.'
    );
    throw new Error('Request Network API key not configured.');
  }

  const { payeeAddress, amount, invoiceCurrency, paymentCurrency } = formData;

  // The API expects `payee`, not `payeeAddress`
  const payload = {
    payee: payeeAddress,
    amount: amount.toString(),
    invoiceCurrency,
    paymentCurrency,
    // Note: description from form is not part of the API payload for POST /v1/pay
  };

  try {
    const response = await fetch(`${REQUEST_NETWORK_API_BASE_URL}/pay`, {
      method: 'POST',
      headers: {
        'x-api-key': REQUEST_NETWORK_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Try to parse error message from API response
      let errorMsg = `API Error: ${response.status} ${response.statusText}`;
      try {
        const responseText = await response.text();
        if (responseText.trim()) {
          const errorData = JSON.parse(responseText);
          errorMsg = errorData?.message || errorData?.error || errorMsg;
        }
      } catch (_jsonError) {
        // If JSON parsing fails, use the default error message
        console.warn('Failed to parse error response as JSON');
      }
      console.error('Request Network API error initiating payment:', errorMsg);
      throw new Error(errorMsg);
    }

    const responseData = await response.json();

    // Basic validation of expected structure
    if (
      !responseData.transactions ||
      !Array.isArray(responseData.transactions) ||
      responseData.transactions.length === 0 ||
      !responseData.requestID ||
      !responseData.paymentReference
    ) {
      console.error('Invalid payment initiation structure received:', responseData);
      throw new Error('Received invalid payment initiation structure from API.');
    }

    return responseData as InitiatePaymentResponse;
  } catch (error) {
    console.error('Failed to initiate payment:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while initiating the payment.');
  }
};

// TODO: Add function to get request status: GET /v1/request/{paymentReference}
