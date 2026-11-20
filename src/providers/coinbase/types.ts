/**
 * Coinbase Commerce REST API shapes.
 * Reference: https://docs.cloud.coinbase.com/commerce/reference
 */

export interface CoinbasePrice {
  amount: string;     // decimal string e.g. "10.00"
  currency: string;   // ISO 4217 e.g. "USD"
}

export interface CoinbaseTimelineEntry {
  status: string;     // NEW | PENDING | COMPLETED | EXPIRED | RESOLVED | CANCELED | UNRESOLVED
  time: string;       // ISO timestamp
  context?: string;
}

export interface CoinbaseCharge {
  id: string;
  code: string;
  name?: string;
  description?: string;
  hosted_url: string;
  created_at: string;
  expires_at: string;
  confirmed_at?: string;
  pricing_type: 'fixed_price' | 'no_price';
  pricing: {
    local: CoinbasePrice;
    bitcoin?: CoinbasePrice;
    ethereum?: CoinbasePrice;
    [k: string]: CoinbasePrice | undefined;
  };
  metadata?: Record<string, string>;
  redirect_url?: string;
  cancel_url?: string;
  timeline: CoinbaseTimelineEntry[];
  payments?: CoinbasePayment[];
}

export interface CoinbasePayment {
  network: string;
  transaction_id: string;
  status: string;
  value: { local: CoinbasePrice; crypto?: CoinbasePrice };
  block?: { height: number; hash: string; confirmations_required: number };
  detected_at?: string;
}

export interface CreateCoinbaseChargeRequest {
  name: string;
  description?: string;
  local_price: CoinbasePrice;
  pricing_type: 'fixed_price' | 'no_price';
  metadata?: Record<string, string>;
  redirect_url?: string;
  cancel_url?: string;
}

export interface CoinbaseWebhookEvent {
  id: string;
  type: string;                 // e.g. 'charge:created', 'charge:confirmed', 'charge:failed'
  api_version: string;
  created_at: string;
  data: CoinbaseCharge;
}

export interface CoinbaseApiResponse<T> {
  data: T;
  warnings?: string[];
  error?: { type: string; message: string };
}
