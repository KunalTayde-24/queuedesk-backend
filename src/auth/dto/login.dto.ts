import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({ require_tld: false })
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
