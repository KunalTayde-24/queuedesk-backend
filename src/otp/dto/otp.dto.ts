import { Matches } from 'class-validator';
import { IsMobile } from '../../common/mobile';

export class SendOtpDto {
  @IsMobile()
  mobile!: string;
}

export class VerifyOtpDto {
  @IsMobile()
  mobile!: string;

  @Matches(/^\d{4,8}$/, { message: 'Enter the digits from your code' })
  code!: string;
}
