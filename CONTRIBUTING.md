# Contributing to Payfyio

Thanks for considering a contribution to Payfyio! This document explains how you can contribute
to the project.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [How can I contribute?](#how-can-i-contribute)
- [Development environment setup](#development-environment-setup)
- [Pull request process](#pull-request-process)
- [Coding standards](#coding-standards)
- [Commit messages](#commit-messages)
- [Adding a new provider](#adding-a-new-provider)
- [Writing tests](#writing-tests)

## Code of conduct

This project and its community are committed to providing an open and welcoming experience for
everyone. Please be respectful and constructive.

## How can I contribute?

### Reporting bugs

When you find a bug, please open an issue and include the following:

- A detailed description of the bug
- Steps to reproduce the error
- Expected behavior
- Actual behavior
- Environment details (Node.js version, OS, etc.)
- Error messages and stack traces, if any

### Feature requests

For new feature proposals:

1. First share your proposal in [Discussions](https://github.com/tsmart-team/payfyio/discussions)
2. Gather feedback from the community
3. Once approved, open an issue

### Documentation

Documentation improvements are always valuable:

- README.md updates
- Code comments
- Example code
- Usage guides

## Development environment setup

### Requirements

- Node.js 18.x or later
- pnpm 8.x or later

### Setup steps

1. Fork the repository

2. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/payfyio.git
cd payfyio
```

3. Add the upstream remote:
```bash
git remote add upstream https://github.com/tsmart-team/payfyio.git
```

4. Install dependencies:
```bash
pnpm install
```

5. Set up environment variables:
```bash
# Create a .env.local file
cp .env.example .env.local
# Add the required API keys
```

6. Run in development mode:
```bash
pnpm dev
```

7. Run the tests:
```bash
pnpm test
```

## Pull request process

1. **Create a branch**
```bash
git checkout -b feature/amazing-feature
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - For new features
- `fix/` - For bug fixes
- `docs/` - For documentation updates
- `refactor/` - For code restructuring
- `test/` - For test updates
- `chore/` - For other changes

2. **Make your changes**
- Follow the coding standards
- Write tests
- Update documentation

3. **Commit**
```bash
git add .
git commit -m "feat: Add amazing feature"
```

4. **Open a pull request**
- Push your branch to your fork
- Open a pull request on GitHub
- Fill in the PR template
- Describe the test results and the changes

5. **Code review**
- Respond to feedback
- Make the requested changes
- Make sure the CI/CD pipeline passes

## Coding standards

### TypeScript

- Use strict mode
- Always provide type definitions
- Avoid using `any`
- Prefer interfaces

```typescript
// Good ✅
interface PaymentConfig {
  apiKey: string;
  secretKey: string;
}

function createPayment(config: PaymentConfig): Promise<PaymentResponse> {
  // ...
}

// Bad ❌
function createPayment(config: any) {
  // ...
}
```

### Code formatting

Prettier and ESLint run automatically:

```bash
# Check formatting
pnpm format:check

# Apply formatting
pnpm format

# Lint check
pnpm lint
```

### Naming conventions

- **Files**: kebab-case (`payment-provider.ts`)
- **Classes**: PascalCase (`PaymentProvider`)
- **Functions**: camelCase (`createPayment`)
- **Constants**: UPPER_SNAKE_CASE (`API_VERSION`)
- **Interfaces**: PascalCase, do not use an "I" prefix (`PaymentRequest`)

### Error handling

```typescript
// Good ✅
try {
  const result = await provider.createPayment(request);
  return result;
} catch (error) {
  if (error instanceof PaymentError) {
    // Specific error handling
  }
  throw new PaymentError('Payment failed', error);
}

// Bad ❌
try {
  const result = await provider.createPayment(request);
  return result;
} catch (e) {
  console.log(e);
}
```

## Commit messages

We use the [Conventional Commits](https://www.conventionalcommits.org/) standard.

### Format

```
<type>(<scope>): <short description>

<detailed description (optional)>

<footer (optional)>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting changes
- `refactor`: Code restructuring
- `test`: Adding or fixing tests
- `chore`: Build, CI/CD, etc. changes
- `perf`: Performance improvements

### Examples

```bash
# New feature
git commit -m "feat(iyzico): Add installment support"

# Bug fix
git commit -m "fix(paytr): Fix token generation issue"

# Documentation
git commit -m "docs: Update installation instructions"

# Breaking change
git commit -m "feat(core)!: Change API response structure

BREAKING CHANGE: Response structure changed from {data} to {result}"
```

### Husky and Commitlint

Commit messages are validated automatically. Invalid commit messages are rejected.

## Adding a new provider

### 1. Create the folder structure

```
src/providers/
└── your-provider/
    ├── index.ts
    ├── types.ts
    ├── mappers.ts
    └── __tests__/
        └── your-provider.test.ts
```

### 2. Extend the PaymentProvider abstract class

```typescript
// src/providers/your-provider/index.ts
import { PaymentProvider } from '../base/payment-provider';
import type { PaymentRequest, PaymentResponse } from '../../types';

export class YourProvider extends PaymentProvider {
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Implementation
  }

  async initThreeDSPayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Implementation
  }

  async completeThreeDSPayment(callbackData: unknown): Promise<PaymentResponse> {
    // Implementation
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    // Implementation
  }

  async cancel(request: CancelRequest): Promise<CancelResponse> {
    // Implementation
  }

  async getPayment(paymentId: string): Promise<PaymentResponse> {
    // Implementation
  }
}
```

### 3. Define the types

```typescript
// src/providers/your-provider/types.ts
export interface YourProviderConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface YourProviderRequest {
  // Provider-specific fields
}

export interface YourProviderResponse {
  // Provider-specific fields
}
```

### 4. Write the mapper functions

```typescript
// src/providers/your-provider/mappers.ts
import type { PaymentRequest } from '../../types';
import type { YourProviderRequest } from './types';

export function mapToProviderRequest(
  request: PaymentRequest
): YourProviderRequest {
  return {
    // Map unified request to provider-specific request
  };
}

export function mapFromProviderResponse(
  response: YourProviderResponse
): PaymentResponse {
  return {
    // Map provider-specific response to unified response
  };
}
```

### 5. Write the tests

```typescript
// src/providers/your-provider/__tests__/your-provider.test.ts
import { describe, it, expect } from 'vitest';
import { YourProvider } from '../index';

describe('YourProvider', () => {
  it('should create payment successfully', async () => {
    const provider = new YourProvider({
      apiKey: 'test',
      secretKey: 'test',
      baseUrl: 'https://test.com',
    });

    const result = await provider.createPayment({
      // Test data
    });

    expect(result.status).toBe('success');
  });
});
```

### 6. Register it on the main Payfyio class

```typescript
// src/index.ts
export { YourProvider } from './providers/your-provider';
```

### 7. Add documentation

Update README.md:
- Add it to the list of supported providers
- Add a usage example
- Add configuration details

## Writing tests

### Test structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });

  it('should handle success case', async () => {
    // Arrange
    const provider = new Provider(config);
    const request = createTestRequest();

    // Act
    const result = await provider.method(request);

    // Assert
    expect(result.status).toBe('success');
    expect(result).toHaveProperty('paymentId');
  });

  it('should handle error case', async () => {
    // Test error scenarios
  });
});
```

### Running tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test --watch

# With UI
pnpm test:ui

# Coverage
pnpm test --coverage
```

### Test coverage

Aim for at least 80% test coverage:
- All public methods should be tested
- Error cases should be tested
- Edge cases should be tested

## Questions and support

- 📖 [Documentation](README.md)
- 🐛 [Issues](https://github.com/tsmart-team/payfyio/issues)
- 💬 [Discussions](https://github.com/tsmart-team/payfyio/discussions)

## License

By contributing, you agree that your changes will be licensed under the MIT License.

---

Thanks again! Your contributions make Payfyio better. ❤️
