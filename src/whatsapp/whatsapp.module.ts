import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EightByEightSmsSender } from '../sms/eight-by-eight-sms.sender';
import { EightByEightWhatsAppSender } from '../sms/eight-by-eight-whatsapp.sender';
import { WHATSAPP_SENDER } from './whatsapp.constants';
import { TwilioWhatsAppSender } from './twilio-whatsapp.sender';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: WHATSAPP_SENDER,
      inject: [ConfigService],
      // NOTIFY_PROVIDER: 8x8-whatsapp = WhatsApp template through 8x8; 8x8-sms = SMS
      // through 8x8; anything else keeps the Twilio WhatsApp sender.
      useFactory: (config: ConfigService) => {
        switch (config.get<string>('NOTIFY_PROVIDER')) {
          case '8x8-whatsapp':
            return new EightByEightWhatsAppSender(config);
          case '8x8-sms':
            return new EightByEightSmsSender(config);
          default:
            return new TwilioWhatsAppSender(config);
        }
      },
    },
  ],
  exports: [WHATSAPP_SENDER],
})
export class WhatsappModule {}
