export interface StripeConfig {
  apiVersion?: string;
}

export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'canceled'
    | 'succeeded';
  client_secret?: string;
  next_action?: {
    type: string;
    redirect_to_url?: { url: string; return_url: string };
  };
  charges?: { data: Array<{ id: string; status: string }> };
  last_payment_error?: { code?: string; message?: string; type?: string };
  metadata?: Record<string, string>;
}

export interface StripeRefund {
  id: string;
  object: 'refund';
  amount: number;
  currency: string;
  payment_intent: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';
  failure_reason?: string;
}

export interface StripeError {
  error: {
    type: string;
    code?: string;
    message: string;
    param?: string;
  };
}

/**
 * Stripe Transfer — platform bakiyesinden bir bağlı hesaba (connected account)
 * para aktarımı. Marketplace payout'unun temel primitifi.
 */
export interface StripeTransfer {
  id: string;
  object: 'transfer';
  amount: number;
  currency: string;
  destination: string;
  transfer_group?: string;
  description?: string;
}

/**
 * Stripe Connect Account — marketplace alt-satıcısının Stripe karşılığı.
 */
export interface StripeAccount {
  id: string;
  object: 'account';
  email?: string;
  type?: string;
  metadata?: Record<string, string>;
}
