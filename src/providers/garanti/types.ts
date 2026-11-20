export interface GarantiConfig {
  merchantId: string;
  terminalId: string;
  provisionUser: string;
  provisionPassword: string;
  storeKey: string;
  /** Password of the PROVRFN provision user. Defaults to `provisionPassword`. */
  refundPassword?: string;
  /** Only set this if the bank issued a separate 3D key; defaults to `storeKey`. */
  secure3DStoreKey?: string;
}

export interface GarantiResponse {
  Order?: { OrderID?: string; GroupID?: string };
  Transaction?: {
    Response?: { Source?: string; Code?: string; ReasonCode?: string; Message?: string; ErrorMsg?: string };
    RetrefNum?: string;
    AuthCode?: string;
    BatchNum?: string;
    SequenceNum?: string;
    ProvDate?: string;
    CardNumberMasked?: string;
    CardHolderName?: string;
    CardType?: string;
  };
}
