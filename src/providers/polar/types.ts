/**
 * Polar.sh REST API shapes.
 * Reference: https://docs.polar.sh/api-reference/introduction
 *
 * Polar is a developer-focused checkout/subscription platform — hosted
 * checkout UI, products as the primary entity, webhook-based fulfillment.
 */

export interface PolarPrice {
  id: string;
  amount_type: 'fixed' | 'custom' | 'free';
  price_amount: number;   // cents
  price_currency: string; // ISO 4217, e.g. "usd"
  recurring_interval?: 'month' | 'year' | null;
}

export interface PolarProduct {
  id: string;
  name: string;
  description?: string;
  is_recurring: boolean;
  prices: PolarPrice[];
}

export type PolarCheckoutStatus =
  | 'open'
  | 'expired'
  | 'confirmed'
  | 'succeeded'
  | 'failed';

export interface PolarCheckout {
  id: string;
  status: PolarCheckoutStatus;
  url: string;                      // hosted checkout URL
  success_url?: string;
  customer_email?: string;
  customer_name?: string;
  amount?: number;                  // cents
  currency?: string;
  product?: PolarProduct;
  product_id?: string;
  metadata?: Record<string, string>;
  created_at: string;
  modified_at?: string;
  expires_at?: string;
}

export interface CreatePolarCheckoutRequest {
  product_id?: string;
  product_price_id?: string;
  success_url?: string;
  customer_email?: string;
  customer_name?: string;
  amount?: number;                  // cents — required for pay-what-you-want
  metadata?: Record<string, string>;
}

export interface PolarOrder {
  id: string;
  amount: number;
  currency: string;
  product_id: string;
  checkout_id?: string;
  customer_id?: string;
  status: 'paid' | 'refunded' | 'partially_refunded';
  created_at: string;
}

export interface PolarRefund {
  id: string;
  amount: number;
  currency: string;
  order_id: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  reason?: string;
  created_at: string;
}

export type PolarWebhookEventType =
  | 'checkout.created'
  | 'checkout.updated'
  | 'order.created'
  | 'order.refunded'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled';

export interface PolarWebhookEvent {
  type: PolarWebhookEventType;
  // The `data` shape varies by event type — narrow at the consumer side.
  data: PolarCheckout | PolarOrder | PolarRefund | Record<string, unknown>;
}

export interface PolarErrorBody {
  type?: string;
  detail?: string;
  error?: string;
  error_description?: string;
}
