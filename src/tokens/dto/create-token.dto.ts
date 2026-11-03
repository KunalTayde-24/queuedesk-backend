import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsMobile } from '../../common/mobile';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A visitor getting a token: needs the date they picked and a verified phone number. */
export class CreateTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsMobile()
  mobile!: string;

  @Matches(DATE_KEY, { message: 'date must look like 2026-10-24' })
  date!: string;

  @IsUUID('all', { message: 'Please verify your mobile number first' })
  verificationToken!: string;
}

/** Staff adding a walk-in from the dashboard: no OTP, date defaults to today. */
export class CreateWalkInDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsMobile()
  mobile!: string;

  @IsOptional()
  @Matches(DATE_KEY, { message: 'date must look like 2026-10-24' })
  date?: string;
}
