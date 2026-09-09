import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  token!: string;

  @IsString()
  @MinLength(12)
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[0-9]/, { message: 'password must include a number' })
  password!: string;
}
