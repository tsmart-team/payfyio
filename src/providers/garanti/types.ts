export interface GarantiConfig {
  merchantId: string;
  terminalId: string;
  provisionUser: string;
  provisionPassword: string;
  storeKey: string;
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
