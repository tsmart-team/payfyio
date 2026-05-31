export interface IsbankConfig {
  clientId: string;
  username: string;
  password: string;
  storeKey: string;
}

export interface IsbankResponse {
  OrderId?: string;
  ProcReturnCode?: string;
  Response?: string;
  TransId?: string;
  HostRefNum?: string;
  AuthCode?: string;
  ErrMsg?: string;
  mdStatus?: string;
}
