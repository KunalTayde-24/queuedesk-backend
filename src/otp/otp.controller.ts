import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { OtpService } from './otp.service';

@Controller('otp')
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  send(@Body() dto: SendOtpDto) {
    return this.otp.send(dto.mobile);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() dto: VerifyOtpDto) {
    return this.otp.verify(dto.mobile, dto.code);
  }
}
