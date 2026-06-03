export interface PayPalConfig {
  clientId?: string;
}

export interface PayPalOAuthResponse {
  scope: string;
  access_token: string;
  token_type: 'Bearer';
  app_id: string;
  expires_in: number;
}

export interface PayPalOrder {
  id: string;
  status:
    | 'CREATED'
    | 'SAVED'
    | 'APPROVED'
    | 'VOIDED'
    | 'COMPLETED'
    | 'PAYER_ACTION_REQUIRED';
  intent: 'CAPTURE' | 'AUTHORIZE';
  links: Array<{ href: string; rel: string; method: string }>;
  purchase_units?: Array<{
    reference_id?: string;
    amount: { currency_code: string; value: string };
    payments?: {
      captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string } }>;
    };
  }>;
}

export interface PayPalRefund {
  id: string;
  status: 'COMPLETED' | 'CANCELLED' | 'PENDING' | 'FAILED';
  amount: { currency_code: string; value: string };
}

export interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string }>;
}
