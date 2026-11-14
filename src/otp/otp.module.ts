import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevOtpProvider } from './dev-otp.provider';
import { EightByEightOtpProvider } from './eight-by-eight-otp.provider';
import { EightByEightWhatsAppOtpProvider } from './eight-by-eight-whatsapp-otp.provider';
import { OtpController } from './otp.controller';
import { OTP_PROVIDER } from './otp.provider';
import { OtpService } from './otp.service';
import { TwilioVerifyOtpProvider } from './twilio-verify-otp.provider';
import { WhatsAppOtpProvider } from './whatsapp-otp.provider';

@Module({
  controllers: [OtpController],
  providers: [
    OtpService,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService],
      // twilio-verify = Twilio Verify (SMS or WhatsApp), twilio-whatsapp = our own
      // code sent as a WhatsApp message; anything else is test mode (nothing sent).
      useFactory: (config: ConfigService) => {
        switch (config.get<string>('OTP_PROVIDER')) {
          case 'twilio-verify':
            return new TwilioVerifyOtpProvider(config);
          case 'twilio-whatsapp':
            return new WhatsAppOtpProvider(config);
          case '8x8-sms':
            return new EightByEightOtpProvider(config);
          case '8x8-whatsapp':
            return new EightByEightWhatsAppOtpProvider(config);
          default:
            return new DevOtpProvider(config);
        }
      },
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
