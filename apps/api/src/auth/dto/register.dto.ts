import { UserRole } from '@fixly/database';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[0-9]/, { message: 'password must include a number' })
  password!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
