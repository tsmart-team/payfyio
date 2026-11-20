export class PayfyioError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string
  ) {
    super(message);
    this.name = 'PayfyioError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProviderNotEnabledError extends PayfyioError {
  constructor(provider: string) {
    super(`Provider '${provider}' is not enabled or configured`, 'PROVIDER_NOT_ENABLED', provider);
    this.name = 'ProviderNotEnabledError';
  }
}

export class PaymentFailedError extends PayfyioError {
  constructor(
    message: string,
    public readonly errorCode?: string,
    public readonly rawResponse?: unknown,
    provider?: string
  ) {
    super(message, 'PAYMENT_FAILED', provider);
    this.name = 'PaymentFailedError';
  }
}

export class ValidationError extends PayfyioError {
  constructor(message: string, provider?: string) {
    super(message, 'VALIDATION_ERROR', provider);
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends PayfyioError {
  constructor(message: string, provider?: string) {
    super(message, 'CONFIGURATION_ERROR', provider);
    this.name = 'ConfigurationError';
  }
}
