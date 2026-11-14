import { ConfigService } from '@nestjs/config';
import { EightByEightOtpProvider } from '../src/otp/eight-by-eight-otp.provider';
import { EightByEightSmsSender } from '../src/sms/eight-by-eight-sms.sender';

const config = new ConfigService({
  EIGHTX8_API_KEY: 'key123',
  EIGHTX8_SUBACCOUNT_ID: 'acme_sub',
  EIGHTX8_SENDER_ID: 'CiLeiGong',
  JWT_SECRET: 'secret',
});

const ok = () =>
  Promise.resolve(
    new Response(JSON.stringify({ status: { code: 'QUEUED' } }), { status: 200 }),
  );

describe('8x8 SMS', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(ok);
  });
  afterEach(() => fetchMock.mockRestore());

  it('sends the token-called SMS to the right endpoint', async () => {
    await new EightByEightSmsSender(config).sendTokenCalledMessage('91234567', 7, 'Ann');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sms.8x8.com/api/v1/subaccounts/acme_sub/messages');
    expect(init.headers.Authorization).toBe('Bearer key123');
    expect(JSON.parse(init.body)).toEqual({
      source: 'CiLeiGong',
      destination: '+6591234567',
      text: 'Hi Ann, your token number 7 has been called. Please proceed to the counter.',
      encoding: 'AUTO',
    });
  });

  it('surfaces a rejection as a send error', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'bad key' }), { status: 401 })),
    );
    await expect(
      new EightByEightSmsSender(config).sendTokenCalledMessage('91234567', 1, 'A'),
    ).rejects.toThrow('bad key');
  });

  it('OTP: sends a 6-digit code and verifies only that code', async () => {
    const p = new EightByEightOtpProvider(config);
    const { codeHash } = await p.start('+6591234567', '+6591234567');
    const code = JSON.parse(fetchMock.mock.calls[0][1].body).text.match(/\d{6}/)[0];
    expect(await p.check('', '+6591234567', code, { codeHash: codeHash ?? null })).toBe(true);
    expect(await p.check('', '+6591234567', '000000' === code ? '111111' : '000000', { codeHash: codeHash ?? null })).toBe(false);
  });
});
