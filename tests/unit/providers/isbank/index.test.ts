import { describe, it, expect, vi } from 'vitest';
import { Isbank } from '../../../../src/providers/isbank';
import { Est } from '../../../../src/providers/est';
import { buildEstHashV3 } from '../../../../src/providers/est/utils';

const isbankCfg = {
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://entegrasyon.asseco-see.com.tr',
  clientId: 'cid',
  username: 'u',
  password: 'p',
  storeKey: 'sk',
} as any;

describe('Isbank provider (EST)', () => {
  it('is the EST provider with the same config fields', () => {
    expect(new Isbank(isbankCfg)).toBeInstanceOf(Est);
    expect(() => new Isbank({ ...isbankCfg, clientId: '' })).toThrow(/clientId/);
    expect(() => new Isbank({ ...isbankCfg, username: '' })).toThrow(/username/);
    expect(() => new Isbank({ ...isbankCfg, password: '' })).toThrow(/password/);
    expect(() => new Isbank({ ...isbankCfg, storeKey: '' })).toThrow(/storeKey/);
  });

  it('init 3DS returns a ver3-signed form to the EST gate', async () => {
    const res = await new Isbank(isbankCfg).initThreeDSPayment({
      price: '10',
      currency: 'TRY',
      callbackUrl: 'https://x/cb',
      paymentCard: { cardNumber: '4508034508034509', expireMonth: '12', expireYear: '2030', cvc: '123', cardHolderName: 'X' },
      buyer: { email: 'a@b.c', ip: '1.1.1.1' },
      basketId: 'b',
    } as any);
    expect(res.status).toBe('pending');
    expect(res.threeDSHtmlContent).toContain('/fim/est3Dgate');
    expect(res.threeDSHtmlContent).toContain('name="hashAlgorithm" value="ver3"');
  });

  it('a correctly signed 3d_pay callback is confirmed with the bank', async () => {
    const p = new Isbank({ ...isbankCfg, storeType: '3d_pay' });
    const post = vi.spyOn((p as any).client, 'post').mockResolvedValueOnce({
      data: '<CC5Response><Response>Approved</Response><ProcReturnCode>00</ProcReturnCode><Extra><TRANS_STAT>S</TRANS_STAT><CHARGE_TYPE_CD>S</CHARGE_TYPE_CD><CAPTURE_AMT>1000</CAPTURE_AMT></Extra></CC5Response>',
    });
    const fields = { clientid: 'cid', oid: 'o1', amount: '10.00', mdStatus: '1', Response: 'Approved', ProcReturnCode: '00' };
    const res = await p.completeThreeDSPayment({ ...fields, HASH: buildEstHashV3(fields, 'sk') });
    expect(res.status).toBe('success');
    expect(res.paymentId).toBe('o1');
    expect(post).toHaveBeenCalledOnce();
  });
});
