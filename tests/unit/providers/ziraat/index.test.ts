import { describe, it, expect, vi } from 'vitest';
import { Ziraat } from '../../../../src/providers/ziraat';
import { Est } from '../../../../src/providers/est';
import { buildEstHashV3 } from '../../../../src/providers/est/utils';

const ziraatCfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://entegrasyon.asseco-see.com.tr',
  clientId: 'cid',
  username: 'u',
  password: 'p',
  storeKey: 'sk',
} as any;

const sign = (fields: Record<string, string>) => ({ ...fields, HASH: buildEstHashV3(fields, 'sk') });
const callback = { clientid: 'cid', oid: 'o1', amount: '10.00', currency: '949', mdStatus: '1', md: 'MD', xid: 'X', eci: '05', cavv: 'C' };

describe('Ziraat provider (EST)', () => {
  it('is the EST provider with the same config fields', () => {
    expect(new Ziraat(ziraatCfg)).toBeInstanceOf(Est);
    expect(() => new Ziraat({ ...ziraatCfg, clientId: '' })).toThrow(/clientId/);
    expect(() => new Ziraat({ ...ziraatCfg, username: '' })).toThrow(/username/);
    expect(() => new Ziraat({ ...ziraatCfg, password: '' })).toThrow(/password/);
    expect(() => new Ziraat({ ...ziraatCfg, storeKey: '' })).toThrow(/storeKey/);
  });

  it('init 3DS returns a ver3-signed form', async () => {
    const res = await new Ziraat(ziraatCfg).initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4508034508034509', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('pending');
    expect(res.threeDSHtmlContent).toContain('name="hashAlgorithm" value="ver3"');
  });

  it('signed callback with a rejected mdStatus fails without charging', async () => {
    const p = new Ziraat(ziraatCfg);
    const post = vi.spyOn((p as any).client, 'post');
    const res = await p.completeThreeDSPayment(sign({ ...callback, mdStatus: '0' }));
    expect(res.status).toBe('failure');
    expect(res.errorCode).toBe('MD_STATUS_0');
    expect(post).not.toHaveBeenCalled();
  });

  // SECURITY: the callback is only trusted after its ver3 HASH verifies; a
  // correctly signed one goes on to the bank (XML Auth), which decides.
  it('correctly signed callback is charged at the bank', async () => {
    const p = new Ziraat(ziraatCfg);
    const post = vi.spyOn((p as any).client, 'post').mockResolvedValueOnce({
      data: '<CC5Response><OrderId>o1</OrderId><Response>Approved</Response><ProcReturnCode>00</ProcReturnCode></CC5Response>',
    });
    const res = await p.completeThreeDSPayment(sign(callback));
    expect(res.status).toBe('success');
    expect(post).toHaveBeenCalledOnce();
    expect(String(post.mock.calls[0][1])).toContain('<Number>MD</Number>');
  });

  it('tampered or unsigned callback is still rejected without reaching the bank', async () => {
    const p = new Ziraat(ziraatCfg);
    const post = vi.spyOn((p as any).client, 'post');
    for (const bad of [{ ...sign(callback), amount: '0.01' }, { mdStatus: '1', oid: 'o1', ProcReturnCode: '00' }]) {
      const res = await p.completeThreeDSPayment(bad);
      expect(res.status).toBe('failure');
      expect(res.errorCode).toBe('INVALID_HASH');
      expect(res.paymentId).toBeUndefined();
    }
    expect(post).not.toHaveBeenCalled();
  });
});
