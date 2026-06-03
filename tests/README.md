# Testing Guide

The test strategy and structure for this project.

## Test folder structure

```
tests/
├── unit/                      # Unit tests - use mocks
│   ├── core/                 # Unit tests for core classes
│   ├── providers/            # Unit tests for providers
│   │   ├── iyzico/
│   │   └── paytr/
│   ├── adapters/             # Adapter tests
│   └── client/               # Client tests
│
├── integration/              # Integration tests - verify the real request formats
│   ├── core/                 # Multi-provider integration
│   └── providers/            # Provider-specific integration tests
│       ├── iyzico.test.ts   # Iyzico request format, signature, etc.
│       └── paytr.test.ts    # PayTR hash, basket encoding, etc.
│
├── e2e/                      # End-to-end tests
│   └── payment-flows.test.ts # Full payment flows
│
├── fixtures/                 # Test data
│   ├── payment-data.ts      # Mock payment data
│   └── provider-responses.ts # Provider responses (for unit tests only)
│
└── helpers/                  # Test helpers
    ├── axios-mock.ts        # Axios mock (for unit tests only)
    └── request-validator.ts # Request validation helpers
```

## Test types

### 1. Unit tests (`tests/unit/`)

**Purpose**: Test a single function or class in isolation.

**Characteristics**:
- HTTP requests are mocked (uses axios-mock)
- Provider responses come from fixtures
- Runs fast
- Tests code logic

**When to use**:
- When testing utility functions
- When testing the internal logic of class methods
- When testing error-handling logic

**Example**:
```typescript
// tests/unit/providers/iyzico/utils.test.ts
import { createIyzicoHeaders } from '../../../src/providers/iyzico/utils';

it('should create headers with correct signature', () => {
  const headers = createIyzicoHeaders('api-key', 'secret', '/endpoint', 'body');
  expect(headers.Authorization).toContain('IYZWS');
});
```

### 2. Integration tests (`tests/integration/`)

**Purpose**: Verify that the requests sent to providers are ACTUALLY in the correct format.

**Characteristics**:
- HTTP requests are intercepted (not mocked!)
- Request format, headers, and signature/hash are checked
- A final validation before hitting the real API
- Slower than unit tests but more realistic

**What it tests**:
- ✅ Request format (JSON vs form-urlencoded)
- ✅ Authorization header format
- ✅ Signature/hash calculations
- ✅ Request body transformation
- ✅ Endpoint routing
- ✅ Provider-specific field mapping

**Example**:
```typescript
// tests/integration/providers/iyzico.test.ts
it('should send payment request with correct Iyzico format', async () => {
  await iyzico.createPayment(mockPaymentRequest);

  const lastRequest = requestValidator.getLastRequest();

  // Validate Iyzico-specific format
  validateIyzicoRequest(lastRequest);
  expect(lastRequest.headers['Authorization']).toMatch(/^IYZWS .+:.+$/);
  expect(lastRequest.body.locale).toBe('tr');
});
```

### 3. E2E tests (`tests/e2e/`)

**Purpose**: Test the whole system working together.

**Characteristics**:
- May send requests to real APIs (sandbox environments)
- Or uses a full mock server
- The slowest but most comprehensive tests

**When to use**:
- When testing full payment flows
- When testing multi-step operations (3DS flow, refund, etc.)
- When testing production-like scenarios

## Running tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests only
npm run test:e2e

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## When writing a new test

### Writing a unit test

1. Go to the appropriate folder under `tests/unit/`
2. Import the `axios-mock.ts` helper
3. Use `fixtures/provider-responses.ts` for provider responses
4. Test a single function/method

```typescript
import { mockAxios, setupAxiosMock } from '../../../helpers/axios-mock';
import { mockIyzicoSuccessResponse } from '../../../fixtures/provider-responses';

it('should handle payment success', async () => {
  setupAxiosMock('post', mockIyzicoSuccessResponse);

  const result = await iyzico.createPayment(mockPaymentRequest);

  expect(result.status).toBe(PaymentStatus.SUCCESS);
});
```

### Writing an integration test

1. Go to the appropriate folder under `tests/integration/`
2. Use `RequestValidator`
3. Intercept axios (don't mock it!)
4. Check the request format in detail

```typescript
import { RequestValidator, validateIyzicoRequest } from '../../helpers/request-validator';

beforeEach(() => {
  requestValidator = new RequestValidator();

  // Intercept requests
  vi.spyOn(axios, 'create').mockImplementation((config) => {
    const instance = axios.create(config);
    instance.interceptors.request.use((req) => {
      requestValidator.captureRequest({ /* ... */ });
      return Promise.reject({ response: { data: {}, status: 200 } });
    });
    return instance;
  });
});

it('should send correct format', async () => {
  await iyzico.createPayment(mockPaymentRequest);

  const lastRequest = requestValidator.getLastRequest();
  validateIyzicoRequest(lastRequest);
});
```

## Common mistakes

### ❌ WRONG: Using a mock response in integration tests

```typescript
// BAD - this is a unit test!
setupAxiosMock('post', mockIyzicoSuccessResponse);
await iyzico.createPayment(mockPaymentRequest);
```

### ✅ RIGHT: Validating the request format

```typescript
// GOOD - this is an integration test!
vi.spyOn(axios, 'create').mockImplementation(/* intercept */);
await iyzico.createPayment(mockPaymentRequest);

const request = requestValidator.getLastRequest();
expect(request.headers['Authorization']).toBeDefined();
expect(request.body.locale).toBe('tr');
```

## Testing principles

1. **Unit tests use mocks** - Fast and isolated
2. **Integration tests validate the request** - Real format checking
3. **E2E tests exercise the flow** - Full scenario
4. **Each test should be independent** - Don't write tests that depend on each other
5. **Test names should be descriptive** - It should be clear what they test

## Coverage targets

- **Lines**: 80%+
- **Functions**: 80%+
- **Branches**: 80%+
- **Statements**: 80%+

## CI/CD

Tests run automatically on every commit:
- Unit tests always run
- Integration tests always run
- E2E tests run only on PRs (optional)
