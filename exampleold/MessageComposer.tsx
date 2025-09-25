'use client';

import { Bell, Send } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'; // Import wagmi hooks

import { useToast } from '#/hooks/use-toast';
import {
  createRequestNetworkPayment,
  getChainIdFromCurrencyId,
  getSymbolFromCurrencyId,
  initiateRequestNetworkPayment,
} from '#/lib/requestNetwork';
import { useSiweUser } from '#/providers/SiweUserProvider';
import { useNotifications } from '#/services/notificationService';
import { Conversation, getOtherParticipant, MessageContentType } from '#/types/messaging';

import CommandPanel from '../debug/CommandPanel';
import {
  CreatePaymentForm,
  CreateRequestForm,
  PaymentConfirmationData,
  PaymentFormData,
  PaymentRequestData,
  RequestFormData,
} from '../payments';
interface MessageComposerProps {
  conversation: Conversation;
  onSendMessage: (content: string, contentType: MessageContentType) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  disabled?: boolean;
}
const getBlockExplorerLink = (chainId: number | undefined, txHash: string): string | null => {
  if (!chainId || !txHash) return null;
  switch (chainId) {
    case 137: // Polygon Mainnet
      return `https://polygonscan.com/tx/${txHash}`;
    case 8453: // Base Mainnet
      return `https://basescan.org/tx/${txHash}`;
    // Add other chains as needed
    // case 1: // Ethereum Mainnet
    //    return `https://etherscan.io/tx/${txHash}`;
    default:
      return null; // Or return a generic link if possible
  }
};

// Define state structure for last initiated payment
interface LastPaymentData {
  formData: PaymentFormData;
  requestId: string;
  paymentReference: string;
}
export const MessageComposer: React.FC<MessageComposerProps> = ({
  conversation,
  onSendMessage,
  onTypingChange,
  disabled = false,
}) => {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { notify, requestPermission } = useNotifications();
  const { user } = useSiweUser();
  const [showCommandPanel, setShowCommandPanel] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [showCreateRequestModal, setShowCreateRequestModal] = useState(false);
  const [requestModalPrefill, setRequestModalPrefill] = useState<{
    amount?: string;
    invoiceCurrency?: string;
    description?: string;
  }>({});
  const { toast } = useToast();
  const [showCreatePaymentModal, setShowCreatePaymentModal] = useState(false);
  const [paymentModalPrefill, setPaymentModalPrefill] = useState<
    Partial<PaymentFormData> & { shouldLockPayee?: boolean }
  >({});
  const [processingPaymentData, setProcessingPaymentData] = useState<LastPaymentData | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentConfirmationMessageForHash = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { address: payerAddress, chain } = useAccount();
  const {
    data: payTxHash,
    error: sendPayTxError,
    isPending: isSendingPayTx,
    sendTransaction: sendPaymentTransaction,
  } = useSendTransaction();

  const {
    isLoading: isConfirmingPayTx,
    isSuccess: isPayTxConfirmed,
    error: payTxConfirmationError,
  } = useWaitForTransactionReceipt({ hash: payTxHash });
  // Reset input when conversation changes
  useEffect(() => {
    setMessage('');
    setIsSending(false);

    // Clean up any typing indicator
    if (onTypingChange) {
      onTypingChange(false);
    }

    // Clear any existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [conversation.id, onTypingChange]);

  // Handle typing indicator
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const wasEmpty = message.length === 0;
    const isNowEmpty = newValue.length === 0;
    if (newValue.startsWith('/')) {
      setShowCommandPanel(true);
      setCommandFilter(newValue.substring(1));
      //setShowExtrasPanel(false); // Hide emoji/GIF panel if command panel is active
    } else {
      setShowCommandPanel(false);
      setCommandFilter('');
    }
    setMessage(newValue);

    // Only trigger typing events on actual typing changes
    if (onTypingChange) {
      // Started typing (empty -> non-empty)
      if (wasEmpty && !isNowEmpty) {
        onTypingChange(true);
      }
      // Stopped typing (non-empty -> empty)
      else if (!wasEmpty && isNowEmpty) {
        onTypingChange(false);
      }

      // Reset typing timeout on any change
      if (!isNowEmpty) {
        // Clear existing timeout
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }

        // Set a new timeout to clear typing after 5 seconds of inactivity
        typingTimeoutRef.current = setTimeout(() => {
          if (onTypingChange) {
            onTypingChange(false);
          }
        }, 4000);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim() || disabled || isSending) return;

    try {
      // Clear typing indicator when sending
      if (onTypingChange) {
        onTypingChange(false);
      }

      // Clear any existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      setIsSending(true);
      await onSendMessage(message, MessageContentType.TEXT);
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  // Clean up timeouts when unmounting
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Ensure typing indicator is cleared when component unmounts
      if (onTypingChange) {
        onTypingChange(false);
      }
    };
  }, [onTypingChange]);

  // Test notification
  const handleTestNotification = async () => {
    // Request permission if not already granted
    await requestPermission();

    // Get other participant's address for the notification
    const otherAddress = getOtherParticipant(conversation, user?.address || '');
    const displayName = otherAddress
      ? `${otherAddress.substring(0, 6)}...${otherAddress.substring(otherAddress.length - 4)}`
      : 'Test Contact';

    // Send test notification
    notify({
      title: `Message from ${displayName}`,
      body: 'This is a test notification. Your notification system is working!',
      duration: 5000,
    });
  };
  const handleSelectCommand = (command: { id: string; command: string; description: string }) => {
    console.log('Command selected:', command);
    // Set message to the command, ready for arguments
    const baseCommand = command.command + ' ';
    setMessage(baseCommand);

    setShowCommandPanel(false);
    setCommandFilter('');
    textareaRef.current?.focus();

    // Pre-parse arguments if any are typed immediately after selecting command (or handle on send)
    // For now, we'll handle parsing when opening the modal based on the current message state

    if (command.id === 'request') {
      // Parse existing message content if it starts with /request
      const currentMessage = message.trim(); // Use current state, might be just `/request `
      const prefill: typeof requestModalPrefill = {};
      if (currentMessage.startsWith('/request ')) {
        const args = currentMessage.substring('/request '.length).split(' ');
        if (args.length >= 1 && !isNaN(parseFloat(args[0]))) {
          // Check if first arg is a number (amount)
          prefill.amount = args[0];
        }
        if (args.length >= 2) {
          // Check if second arg exists (invoice currency)
          // Basic check - could validate against supportedInvoiceCurrencies
          prefill.invoiceCurrency = args[1].toUpperCase();
        }
        if (args.length >= 3) {
          // Assume rest is description
          prefill.description = args.slice(2).join(' ');
        }
      }
      setRequestModalPrefill(prefill);
      setShowCreateRequestModal(true);
      // Clear the command from the input field as the modal will handle the request creation
      // setMessage(''); // Keep the text for now, maybe user wants to edit?
    } else if (command.id === 'pay') {
      // Parse args for /pay: <amount> <invoiceCurrency> [to:payee] [description...]
      const currentMessage = message.trim(); // Use state just set
      const prefill: Partial<PaymentFormData> & { shouldLockPayee?: boolean } = {};
      if (currentMessage.startsWith('/pay ')) {
        const args = currentMessage.substring('/pay '.length).split(' ');
        if (args.length >= 1 && !isNaN(parseFloat(args[0]))) {
          prefill.amount = args[0];
        }
        if (args.length >= 2) {
          prefill.invoiceCurrency = args[1].toUpperCase();
        }
        // Look for "to:" prefix for payee, otherwise assume payee is needed or use context
        const payeeArgIndex = args.findIndex((arg) => arg.toLowerCase().startsWith('to:'));
        if (payeeArgIndex !== -1 && args[payeeArgIndex].length > 3) {
          prefill.payeeAddress = args[payeeArgIndex].substring(3);
          // Remove payee arg before joining for description
          args.splice(payeeArgIndex, 1);
        }
        // Determine description start index (after amount and currency, skipping payee if parsed)
        const descStartIndex =
          payeeArgIndex !== -1 ? 2 : payeeArgIndex === -1 && args.length >= 3 ? 2 : -1;
        if (descStartIndex !== -1 && args.length > descStartIndex) {
          prefill.description = args.slice(descStartIndex).join(' ');
        }
      }

      // Determine final payee and lock status
      if (conversation && conversation.peerAddress && !prefill.payeeAddress) {
        prefill.payeeAddress = conversation.peerAddress;
        prefill.shouldLockPayee = true; // Store lock status in prefill object
      } else {
        prefill.shouldLockPayee = false;
      }

      setPaymentModalPrefill(prefill);
      setShowCreatePaymentModal(true);
    }
  };
  const handleCreateRequestSubmit = async (formData: RequestFormData) => {
    // if (!client) {
    //   toast({ title: 'XMTP Client not ready', variant: 'destructive' });
    //   return;
    // }

    setIsSending(true);
    try {
      toast({ title: 'Creating payment request...', description: 'Please wait.' });
      const response = await createRequestNetworkPayment(formData);

      // Construct the message content for the payment request
      // This assumes your sendMessage and message rendering can handle an object with a specific type.
      // You might need to adjust this based on how you handle custom message types with XMTP.
      const paymentRequestContent: PaymentRequestData = {
        id: response.paymentReference,
        payeeName: formData.payeeAddress,
        amount: formData.amount,
        // Use the actual payment currency symbol for display
        currencySymbol: getSymbolFromCurrencyId(formData.paymentCurrency),
        description: formData.description || `Payment request`, // Simpler default description
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'pending',
        paymentReference: response.paymentReference,
        requestIdFromNetwork: response.requestID,
        paymentCurrency: formData.paymentCurrency, // Add the missing paymentCurrency field
      };

      console.log('Sending Payment Request Content:', paymentRequestContent);
      const requestString: string = paymentRequestContent.toString();

      // await sendMessage(conversation, paymentRequestContent, {
      //   contentType: ContentTypePaymentRequest,
      // });
      // Replace with the new Logic
      await onSendMessage(requestString, MessageContentType.PAYMENT_REQUEST);

      toast({ title: 'Payment Request Created', description: `Ref: ${response.paymentReference}` });
      setShowCreateRequestModal(false);
      setRequestModalPrefill({}); // Clear prefill state on close
      setMessage(''); // Clear composer
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Failed to create or send payment request:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      toast({
        title: 'Error Creating Request',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };
  const handleCreatePaymentSubmit = async (formData: PaymentFormData) => {
    // Log the data received directly from the form
    console.log('[handleCreatePaymentSubmit] Received formData from form:', formData);

    if (!payerAddress || !chain) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect wallet and ensure network is selected.',
        variant: 'destructive',
      });
      return;
    }
    if (!sendPaymentTransaction) {
      toast({
        title: 'Payment Error',
        description: 'Send transaction function not available.',
        variant: 'destructive',
      });
      return;
    }

    const targetChainId = getChainIdFromCurrencyId(formData.paymentCurrency);

    if (!targetChainId) {
      toast({
        title: 'Payment Error',
        description: `Unsupported payment currency: ${formData.paymentCurrency}`,
        variant: 'destructive',
      });
      return;
    }

    if (chain.id !== targetChainId) {
      toast({
        title: 'Network Mismatch',
        description: `Please switch wallet to target network (Chain ID: ${targetChainId}) before sending payment.`,
        variant: 'default',
      });
      return;
    }

    setShowCreatePaymentModal(false);
    setProcessingPaymentData(null);
    toast({ title: 'Initiating payment...', description: 'Getting transaction details...' });

    try {
      const paymentApiResponse = await initiateRequestNetworkPayment(formData);
      console.log(
        '[handleCreatePaymentSubmit] Received payment initiation data:',
        paymentApiResponse
      );

      // Prepare data to be stored
      const dataToStore: LastPaymentData = {
        formData: formData, // Log this formData again right before setting state
        requestId: paymentApiResponse.requestID,
        paymentReference: paymentApiResponse.paymentReference,
      };
      console.log('[handleCreatePaymentSubmit] Storing processingPaymentData:', dataToStore);
      setProcessingPaymentData(dataToStore);

      if (paymentApiResponse.transactions.length === 0) {
        throw new Error('No transaction details received from Request Network API.');
      }
      const txDetails = paymentApiResponse.transactions[0];

      sendPaymentTransaction({
        to: txDetails.to as `0x${string}`,
        data: txDetails.data as `0x${string}`,
        value: BigInt(txDetails.value.hex),
      });
    } catch (error: any) {
      console.error('Payment initiation failed:', error);
      const errorMessage = error?.message || 'An unknown error occurred initiating payment.';
      toast({
        title: 'Payment Initiation Failed',
        description: errorMessage,
        variant: 'destructive',
      });
      setProcessingPaymentData(null);
      setPaymentModalPrefill({}); // Clear form prefill state on error too
    }
  };
  useEffect(() => {
    if (isPayTxConfirmed && payTxHash && processingPaymentData) {
      if (sentConfirmationMessageForHash.current !== payTxHash) {
        console.log(
          '[EnhancedMessageComposer] Payment is confirmed. Proceeding to send message for data:',
          processingPaymentData
        );
        toast({ title: 'Payment Confirmed!', description: `Payment transaction successful.` });

        let confirmationDataToSend: PaymentConfirmationData | null = null;

        if (conversation && processingPaymentData.formData) {
          const { formData, requestId } = processingPaymentData;
          const targetChainId = getChainIdFromCurrencyId(formData.paymentCurrency);
          const requestScanLink = `https://scan.request.network/request/${requestId}`;
          const txUrl = getBlockExplorerLink(targetChainId, payTxHash);

          confirmationDataToSend = {
            id: payTxHash,
            senderName: user?.address || 'Sender',
            payeeAddress: formData.payeeAddress,
            amount: formData.amount,
            currencySymbol: getSymbolFromCurrencyId(formData.paymentCurrency),
            description: formData.description,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            requestScanUrl: requestScanLink,
            transactionUrl: txUrl ? txUrl : undefined,
          };
        }

        // Check if confirmationDataToSend was successfully created before sending
        if (confirmationDataToSend && conversation) {
          // Ensure conversation is still valid here
          console.log(
            '[EnhancedMessageComposer] Sending payment confirmation data:',
            confirmationDataToSend
          );
          // sendMessage(conversation, confirmationDataToSend, {
          //   contentType: ContentTypePaymentConfirmation,
          // });
          sentConfirmationMessageForHash.current = payTxHash;
          setProcessingPaymentData(null);
        } else {
          console.error(
            '[EnhancedMessageComposer] Could not send confirmation message: Missing conversation or data to construct message.',
            {
              conversationExists: !!conversation,
              processingData: processingPaymentData,
              constructedData: confirmationDataToSend,
            }
          );
          if (processingPaymentData) setProcessingPaymentData(null);
        }
      } else {
        console.log(
          '[EnhancedMessageComposer] Confirmation message already sent for hash:',
          payTxHash
        );
      }
    }
    if ((payTxConfirmationError || sendPayTxError) && payTxHash) {
      if (processingPaymentData) setProcessingPaymentData(null);
    }
  }, [
    isSendingPayTx,
    sendPayTxError,
    isConfirmingPayTx,
    isPayTxConfirmed,
    payTxConfirmationError,
    payTxHash,
    toast,
    conversation,
    processingPaymentData,
    user,
  ]);
  return (
    <div className="border-t border-slate-700 bg-slate-800 px-4 py-3 relative">
      {/* Command Panel */}
      {showCommandPanel && (
        <CommandPanel onCommandSelect={handleSelectCommand} filter={commandFilter} />
      )}
      {/* Create Request Modal */}
      {showCreateRequestModal && (
        <CreateRequestForm
          onSubmit={handleCreateRequestSubmit}
          onClose={() => {
            setShowCreateRequestModal(false);
            setRequestModalPrefill({});
          }}
          defaultPayeeAddress={
            conversation && conversation.peerAddress && payerAddress ? payerAddress : undefined
          }
          defaultAmount={requestModalPrefill.amount}
          defaultInvoiceCurrency={requestModalPrefill.invoiceCurrency}
          defaultDescription={requestModalPrefill.description}
        />
      )}
      {/* Create Payment Modal */}
      {showCreatePaymentModal && (
        <CreatePaymentForm
          onSubmit={handleCreatePaymentSubmit}
          onClose={() => {
            setShowCreatePaymentModal(false);
            setPaymentModalPrefill({});
          }}
          defaultPayeeAddress={paymentModalPrefill.payeeAddress}
          defaultAmount={paymentModalPrefill.amount}
          defaultInvoiceCurrency={paymentModalPrefill.invoiceCurrency}
          defaultPaymentCurrency={paymentModalPrefill.paymentCurrency}
          defaultDescription={paymentModalPrefill.description}
          isPayeeLocked={paymentModalPrefill.shouldLockPayee}
        />
      )}
      <form
        onSubmit={handleSendMessage}
        className="flex items-center p-4 border-t border-gray-200 dark:border-slate-700"
      >
        <button
          type="button"
          onClick={handleTestNotification}
          className="p-2 text-slate-400 hover:text-slate-100 mr-2"
          title="Test Notification"
        >
          <Bell size={18} />
        </button>
        <input
          type="text"
          value={message}
          onChange={handleInputChange}
          placeholder={showCommandPanel ? 'Type a command...' : 'Type a message...'}
          className="flex-1 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
          disabled={disabled || isSending}
        />
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded-r-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-300 dark:disabled:bg-blue-800"
          disabled={!message.trim() || disabled || isSending}
        >
          {isSending ? (
            <div className="animate-spin h-5 w-5 border-t-2 border-white rounded-full" />
          ) : (
            <Send size={18} />
          )}
        </button>
      </form>
    </div>
  );
};