export interface YapiKrediConfig {
  merchantId: string;
  terminalId: string;
  posnetId: string;
  encKey: string;
}

export interface YapiKrediResponse {
  approved?: string;
  respCode?: string;
  respText?: string;
  hostlogkey?: string;
  authCode?: string;
  ycid?: string;
}
