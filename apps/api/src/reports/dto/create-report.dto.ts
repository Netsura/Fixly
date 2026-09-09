import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @IsString()
  @MaxLength(64)
  targetType!: string;

  @IsUUID()
  targetId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  reason!: string;
}
