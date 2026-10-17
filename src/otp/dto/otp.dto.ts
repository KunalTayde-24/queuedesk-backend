import { Matches } from 'class-validator';

export class SendOtpDto {
  @Matches(/^\d{10}$/, { message: 'mobile must be exactly 10 digits' })
  mobile!: string;
}

export class VerifyOtpDto {
  @Matches(/^\d{10}$/, { message: 'mobile must be exactly 10 digits' })
  mobile!: string;

  @Matches(/^\d{4,8}$/, { message: 'Enter the digits from your code' })
  code!: string;
}
