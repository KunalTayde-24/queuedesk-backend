import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WHATSAPP_SENDER } from './whatsapp.constants';
import { TwilioWhatsAppSender } from './twilio-whatsapp.sender';

@Module({
  imports: [ConfigModule],
  providers: [{ provide: WHATSAPP_SENDER, useClass: TwilioWhatsAppSender }],
  exports: [WHATSAPP_SENDER],
})
export class WhatsappModule {}
