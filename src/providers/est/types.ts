/**
 * EST `storetype` — which 3D model the bank set up for the store.
 * - `3d`: bank authenticates the card; we charge it afterwards with XML `Auth`.
 * - `3d_pay`: bank authenticates and charges in one leg.
 * - `3d_pay_hosting`: like `3d_pay`, card entered on the bank's page.
 * - `3d_host`: like `3d`, card entered on the bank's page.
 */
export type EstStoreType = '3d' | '3d_pay' | '3d_pay_hosting' | '3d_host';

export interface EstConfig {
  /** Store number (Mağaza No / Client ID). */
  clientId: string;
  /** API user — XML API only. */
  username: string;
  /** API user's password. */
  password: string;
  /** 3D store key — signs the 3D form and the callback (hash ver3). */
  storeKey: string;
  /** Must match what the bank configured for the store. Default `'3d'`. */
  storeType?: EstStoreType;
  /**
   * `mdStatus` values that may be charged in the `3d`/`3d_host` models.
   * Default `['1']` (full authentication). 2/3/4 are half-secure: accepting
   * them can leave chargeback liability with the merchant.
   */
  acceptedMdStatuses?: string[];
}

/** A parsed CC5Response: top-level leaves plus the `<Extra>` block. */
export interface EstXmlResult {
  fields: Record<string, string>;
  extra: Record<string, string>;
}
