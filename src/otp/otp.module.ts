import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevOtpProvider } from './dev-otp.provider';
import { OtpController } from './otp.controller';
import { OTP_PROVIDER } from './otp.provider';
import { OtpService } from './otp.service';
import { TwilioVerifyOtpProvider } from './twilio-verify-otp.provider';

@Module({
  controllers: [OtpController],
  providers: [
    OtpService,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService],
      // OTP_PROVIDER=twilio-verify sends real codes; anything else is test mode.
      useFactory: (config: ConfigService) =>
        config.get<string>('OTP_PROVIDER') === 'twilio-verify'
          ? new TwilioVerifyOtpProvider(config)
          : new DevOtpProvider(config),
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
