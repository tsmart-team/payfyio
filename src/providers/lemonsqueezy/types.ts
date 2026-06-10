/**
 * Lemon Squeezy REST API shapes.
 * Reference: https://docs.lemonsqueezy.com/api
 *
 * Lemon Squeezy is a JSON:API-style endpoint — every request/response is
 * wrapped in `{ data: { type, id, attributes, relationships } }`. The
 * checkout flow is hosted: you POST a checkout, get a `url` back, redirect
 * the buyer, and confirm via webhook.
 */

export interface LSResource<TAttrs, TType extends string = string> {
  type: TType;
  id: string;
  attributes: TAttrs;
  relationships?: Record<string, { data: { type: string; id: string } | null }>;
  links?: Record<string, string>;
}

export interface LSApiResponse<T> {
  data: T;
  errors?: Array<{ status: string; title: string; detail?: string }>;
}

// -------- Checkout --------

export interface LSCheckoutAttributes {
  store_id: number;
  variant_id: number;
  custom_price: number | null;       // cents
  product_options?: Record<string, unknown>;
  checkout_options?: Record<string, unknown>;
  checkout_data?: {
    email?: string;
    name?: string;
    custom?: Record<string, string>;
  };
  expires_at: string | null;
  url: string;                       // hosted checkout URL
  test_mode: boolean;
  created_at: string;
  updated_at: string;
}

export type LSCheckout = LSResource<LSCheckoutAttributes, 'checkouts'>;

export interface CreateLSCheckoutBody {
  data: {
    type: 'checkouts';
    attributes: {
      custom_price?: number;
      product_options?: Record<string, unknown>;
      checkout_options?: Record<string, unknown>;
      checkout_data?: {
        email?: string;
        name?: string;
        custom?: Record<string, string>;
      };
      expires_at?: string;
    };
    relationships: {
      store: { data: { type: 'stores'; id: string } };
      variant: { data: { type: 'variants'; id: string } };
    };
  };
}

// -------- Order --------

export type LSOrderStatus = 'pending' | 'failed' | 'paid' | 'refunded';

export interface LSOrderAttributes {
  store_id: number;
  customer_id: number;
  identifier: string;
  order_number: number;
  user_email: string;
  user_name: string;
  currency: string;
  total: number;                     // cents
  total_formatted: string;
  status: LSOrderStatus;
  status_formatted: string;
  refunded: boolean;
  refunded_at: string | null;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
}

export type LSOrder = LSResource<LSOrderAttributes, 'orders'>;

// -------- Subscription (for completeness) --------

export type LSSubscriptionStatus =
  | 'on_trial'
  | 'active'
  | 'paused'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'expired';

export interface LSSubscriptionAttributes {
  store_id: number;
  customer_id: number;
  order_id: number;
  user_email: string;
  status: LSSubscriptionStatus;
  cancelled: boolean;
  ends_at: string | null;
  trial_ends_at: string | null;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
}

export type LSSubscription = LSResource<LSSubscriptionAttributes, 'subscriptions'>;

// -------- Webhook --------

/**
 * Lemon Squeezy webhook event. The `meta.event_name` identifies the event
 * (e.g. `order_created`, `subscription_created`, `order_refunded`). The
 * `data` field is a resource object matching the entity type.
 */
export interface LSWebhookEvent<TData = LSOrder | LSSubscription> {
  meta: {
    event_name: string;
    custom_data?: Record<string, string>;
  };
  data: TData;
}
