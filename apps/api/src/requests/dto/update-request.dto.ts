import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpdateRequestDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  locationHash?: string;

  @IsOptional()
  @IsDateString()
  preferredStart?: string;

  @IsOptional()
  @IsDateString()
  preferredEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMinCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMaxCents?: number;
}
