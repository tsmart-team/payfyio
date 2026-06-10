import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Iyzico } from '../../../../src/providers/iyzico';
import { PaymentStatus } from '../../../../src/types';

describe('Iyzico Provider - Unit Tests', () => {
  let iyzico: Iyzico;

  beforeEach(() => {
    iyzico = new Iyzico({
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      baseUrl: 'https://sandbox-api.iyzipay.com',
      locale: 'tr',
    });
  });

  describe('binCheck', () => {
    it('should map successful response correctly', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        binNumber: '454360',
        cardType: 'CREDIT_CARD',
        cardAssociation: 'VISA',
        cardFamily: 'Maximum',
        bankName: 'Türkiye İş Bankası',
        bankCode: 64,
        commercial: 0,
      };

      // Mock sendRequest
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.binCheck('454360');

      expect(result).toEqual({
        binNumber: '454360',
        cardType: 'CREDIT_CARD',
        cardAssociation: 'VISA',
        cardFamily: 'Maximum',
        bankName: 'Türkiye İş Bankası',
        bankCode: 64,
        commercial: false,
        rawResponse: mockResponse,
      });
    });

    it('should throw error when status is failure', async () => {
      const mockResponse = {
        status: 'failure',
        errorMessage: 'BIN not found',
      };

      // Mock sendRequest
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      await expect(iyzico.binCheck('000000')).rejects.toThrow('BIN not found');
    });
  });

  describe('mapStatus', () => {
    it('should map success to PaymentStatus.SUCCESS', () => {
      const mapStatus = (iyzico as any).mapStatus.bind(iyzico);
      expect(mapStatus('success')).toBe(PaymentStatus.SUCCESS);
    });

    it('should map failure to PaymentStatus.FAILURE', () => {
      const mapStatus = (iyzico as any).mapStatus.bind(iyzico);
      expect(mapStatus('failure')).toBe(PaymentStatus.FAILURE);
    });

    it('should map unknown status to PaymentStatus.PENDING', () => {
      const mapStatus = (iyzico as any).mapStatus.bind(iyzico);
      expect(mapStatus('unknown')).toBe(PaymentStatus.PENDING);
    });
  });

  describe('installmentInfo', () => {
    it('should return installment details successfully', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        conversationId: 'test-conversation-123',
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Bonus',
            force3ds: 0,
            bankCode: 46,
            bankName: 'Akbank',
            forceCvc: 0,
            commercial: 0,
            installmentPrices: [
              {
                installmentNumber: 1,
                totalPrice: 100,
                installmentPrice: 100,
              },
              {
                installmentNumber: 2,
                totalPrice: 102,
                installmentPrice: 51,
              },
              {
                installmentNumber: 3,
                totalPrice: 104.5,
                installmentPrice: 34.83,
              },
            ],
          },
        ],
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails).toBeDefined();
      expect(result.installmentDetails).toHaveLength(1);

      const detail = result.installmentDetails![0];
      expect(detail.binNumber).toBe('552879');
      expect(detail.bankName).toBe('Akbank');
      expect(detail.cardFamilyName).toBe('Bonus');
      expect(detail.installmentPrices).toHaveLength(3);

      // Check first installment (single payment)
      expect(detail.installmentPrices[0].installmentNumber).toBe(1);
      expect(detail.installmentPrices[0].totalPrice).toBe(100);

      // Check second installment
      expect(detail.installmentPrices[1].installmentNumber).toBe(2);
      expect(detail.installmentPrices[1].totalPrice).toBe(102);
      expect(detail.installmentPrices[1].installmentPrice).toBe(51);
    });

    it('should handle multiple banks installment options', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Bonus',
            bankCode: 46,
            bankName: 'Akbank',
            commercial: 0,
            installmentPrices: [
              { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
              { installmentNumber: 2, totalPrice: 102, installmentPrice: 51 },
            ],
          },
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Maximum',
            bankCode: 64,
            bankName: 'İş Bankası',
            commercial: 0,
            installmentPrices: [
              { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
              { installmentNumber: 3, totalPrice: 105, installmentPrice: 35 },
            ],
          },
        ],
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails).toHaveLength(2);
      expect(result.installmentDetails![0].bankName).toBe('Akbank');
      expect(result.installmentDetails![1].bankName).toBe('İş Bankası');
    });

    it('should handle commercial cards', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Business',
            bankCode: 46,
            bankName: 'Akbank',
            commercial: 1, // Commercial card
            force3ds: 1, // 3DS required
            installmentPrices: [
              { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
            ],
          },
        ],
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails![0].commercial).toBe(1);
      expect(result.installmentDetails![0].force3ds).toBe(1);
    });

    it('should handle installment query failure', async () => {
      const mockResponse = {
        status: 'failure',
        locale: 'tr',
        systemTime: 123456789,
        errorCode: '5001',
        errorMessage: 'Invalid BIN number',
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '000000',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Invalid BIN number');
      expect(result.errorCode).toBe('5001');
      expect(result.installmentDetails).toBeUndefined();
    });

    it('should include conversationId in request', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        conversationId: 'test-conv-123',
        installmentDetails: [],
      };

      const sendRequestSpy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue(mockResponse);

      await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
        conversationId: 'test-conv-123',
      });

      expect(sendRequestSpy).toHaveBeenCalledWith(
        '/payment/iyzipos/installment',
        expect.objectContaining({
          conversationId: 'test-conv-123',
          binNumber: '552879',
          price: '100.00',
          locale: 'tr',
        })
      );
    });

    it('should handle network errors', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockRejectedValue(
        new Error('Network error')
      );

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Network error');
    });
  });

  describe('pre-auth routing', () => {
    const baseRequest = () => ({
      price: '100.00',
      paidPrice: '100.00',
      currency: 'TRY',
      basketId: 'B1',
      paymentCard: {
        cardHolderName: 'John Doe',
        cardNumber: '5528790000000008',
        expireMonth: '12',
        expireYear: '2030',
        cvc: '123',
      },
      buyer: {
        id: 'BY1', name: 'John', surname: 'Doe', gsmNumber: '+905555555555',
        email: 'john@example.com', identityNumber: '11111111111',
        registrationAddress: 'Addr', ip: '1.2.3.4', city: 'Istanbul', country: 'Turkey',
      },
      shippingAddress: { contactName: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Addr' },
      billingAddress: { contactName: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Addr' },
      basketItems: [{ id: 'I1', name: 'Item', category1: 'Cat', itemType: 'PHYSICAL', price: '100.00' }],
    });

    it('routes createPayment to /payment/preauth when capture is false', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'pre_1' });

      await iyzico.createPayment({ ...baseRequest(), capture: false } as any);

      expect(spy.mock.calls[0][0]).toBe('/payment/preauth');
    });

    it('routes createPayment to /payment/auth by default', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'pay_1' });

      await iyzico.createPayment(baseRequest() as any);

      expect(spy.mock.calls[0][0]).toBe('/payment/auth');
    });

    it('routes initThreeDSPayment to preauth init when capture is false', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'pre_3ds' });

      await iyzico.initThreeDSPayment({ ...baseRequest(), capture: false, callbackUrl: 'https://x' } as any);

      expect(spy.mock.calls[0][0]).toBe('/payment/3dsecure/initialize/preauth');
    });
  });

  describe('capturePayment', () => {
    it('captures the full amount (no paidPrice) when amountMinor is omitted', async () => {
      const spy = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        paymentId: 'p_1',
        paidPrice: 100,
        currency: 'TRY',
        conversationId: 'c_1',
      });

      const result = await iyzico.capturePayment({ paymentId: 'p_1', conversationId: 'c_1' });

      expect(spy).toHaveBeenCalledWith(
        '/payment/postauth',
        expect.objectContaining({ paymentId: 'p_1', paidPrice: undefined }),
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.paymentId).toBe('p_1');
      expect(result.capturedAmountMinor).toBe(10000);
      expect(result.currency).toBe('TRY');
    });

    it('sends paidPrice as a decimal string for partial capture', async () => {
      const spy = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        paymentId: 'p_2',
        paidPrice: 40,
        currency: 'TRY',
      });

      const result = await iyzico.capturePayment({
        paymentId: 'p_2',
        amountMinor: 4000,
        currency: 'TRY',
      });

      expect(spy).toHaveBeenCalledWith(
        '/payment/postauth',
        expect.objectContaining({ paymentId: 'p_2', paidPrice: '40.00' }),
      );
      expect(result.capturedAmountMinor).toBe(4000);
    });

    it('maps a failure response', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'failure',
        errorMessage: 'Not in preauth state',
        errorCode: '5088',
      });

      const result = await iyzico.capturePayment({ paymentId: 'p_3' });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Not in preauth state');
    });

    it('handles network errors', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockRejectedValue(new Error('boom'));
      const result = await iyzico.capturePayment({ paymentId: 'p_4' });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('boom');
    });
  });

  describe('voidAuthorization', () => {
    it('releases a pre-auth via /payment/cancel', async () => {
      const spy = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        paymentId: 'p_5',
        conversationId: 'c_5',
      });

      const result = await iyzico.voidAuthorization({ paymentId: 'p_5', conversationId: 'c_5', ip: '1.2.3.4' });

      expect(spy).toHaveBeenCalledWith(
        '/payment/cancel',
        expect.objectContaining({ paymentId: 'p_5', ip: '1.2.3.4' }),
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.voidId).toBe('p_5');
    });

    it('maps a failure response', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'failure',
        errorMessage: 'Already captured',
      });

      const result = await iyzico.voidAuthorization({ paymentId: 'p_6' });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Already captured');
    });
  });

  describe('idempotency (conversationId mapping)', () => {
    it('uses idempotencyKey as conversationId when conversationId is absent', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'p_7' });

      await iyzico.capturePayment({ paymentId: 'p_7', idempotencyKey: 'idem-abc' });

      expect(spy).toHaveBeenCalledWith(
        '/payment/postauth',
        expect.objectContaining({ conversationId: 'idem-abc' }),
      );
    });

    it('keeps an explicit conversationId over idempotencyKey', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'p_8' });

      await iyzico.voidAuthorization({
        paymentId: 'p_8',
        conversationId: 'conv-explicit',
        idempotencyKey: 'idem-xyz',
      });

      expect(spy).toHaveBeenCalledWith(
        '/payment/cancel',
        expect.objectContaining({ conversationId: 'conv-explicit' }),
      );
    });

    it('threads idempotencyKey into refund conversationId', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentTransactionId: 't_1' });

      await iyzico.refund({
        paymentId: 'p_9',
        price: '10.00',
        currency: 'TRY',
        ip: '1.2.3.4',
        idempotencyKey: 'idem-refund',
      });

      expect(spy).toHaveBeenCalledWith(
        '/payment/refund',
        expect.objectContaining({ conversationId: 'idem-refund' }),
      );
    });
  });

  describe('submerchant', () => {
    it('creates a submerchant and maps the response', async () => {
      const spy = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        subMerchantKey: 'smk_1',
        subMerchantExternalId: 'carrier-42',
      });

      const result = await iyzico.createSubmerchant({
        type: 'PRIVATE_COMPANY',
        name: 'Carrier Ltd',
        email: 'c@x.com',
        externalId: 'carrier-42',
        iban: 'TR000000000000000000000000',
      });

      expect(spy).toHaveBeenCalledWith(
        '/onboarding/submerchant',
        expect.objectContaining({
          subMerchantExternalId: 'carrier-42',
          subMerchantType: 'PRIVATE_COMPANY',
          iban: 'TR000000000000000000000000',
        }),
      );
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.submerchantKey).toBe('smk_1');
      expect(result.externalId).toBe('carrier-42');
    });

    it('retrieves a submerchant by externalId', async () => {
      const spy = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        subMerchantKey: 'smk_2',
        subMerchantExternalId: 'carrier-7',
      });

      const result = await iyzico.retrieveSubmerchant('carrier-7');

      expect(spy).toHaveBeenCalledWith(
        '/onboarding/submerchant/detail',
        expect.objectContaining({ subMerchantExternalId: 'carrier-7' }),
      );
      expect(result.submerchantKey).toBe('smk_2');
    });

    it('maps a failure response', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'failure',
        errorMessage: 'Invalid IBAN',
      });
      const result = await iyzico.createSubmerchant({
        type: 'PERSONAL', name: 'X', email: 'x@y.com', externalId: 'e1',
      });
      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Invalid IBAN');
    });
  });

  describe('marketplace split', () => {
    const baseRequest = () => ({
      price: '100.00',
      paidPrice: '100.00',
      currency: 'TRY',
      basketId: 'B1',
      paymentCard: {
        cardHolderName: 'John Doe', cardNumber: '5528790000000008',
        expireMonth: '12', expireYear: '2030', cvc: '123',
      },
      buyer: {
        id: 'BY1', name: 'John', surname: 'Doe', gsmNumber: '+905555555555',
        email: 'john@example.com', identityNumber: '11111111111',
        registrationAddress: 'Addr', ip: '1.2.3.4', city: 'Istanbul', country: 'Turkey',
      },
      shippingAddress: { contactName: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Addr' },
      billingAddress: { contactName: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Addr' },
      basketItems: [{ id: 'I1', name: 'Item', category1: 'Cat', itemType: 'PHYSICAL', price: '100.00' }],
    });

    it('maps split[i] onto basketItems[i] as subMerchantKey + subMerchantPrice', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'pay_split' });

      await iyzico.createPayment({
        ...baseRequest(),
        split: [{ submerchantId: 'smk_1', amountMinor: 9000 }],
      } as any);

      const body = spy.mock.calls[0][1];
      expect(body.basketItems[0].subMerchantKey).toBe('smk_1');
      expect(body.basketItems[0].subMerchantPrice).toBe('90.00');
    });

    it('omits split fields when no split is provided', async () => {
      const spy = vi
        .spyOn(iyzico as any, 'sendRequest')
        .mockResolvedValue({ status: 'success', paymentId: 'pay_nosplit' });

      await iyzico.createPayment(baseRequest() as any);

      const body = spy.mock.calls[0][1];
      expect(body.basketItems[0].subMerchantKey).toBeUndefined();
      expect(body.basketItems[0].subMerchantPrice).toBeUndefined();
    });
  });
});
